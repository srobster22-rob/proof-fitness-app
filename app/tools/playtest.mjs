/**
 * Play PROOF like a user, at phone size, in a real browser — no install, no Browser pane.
 *
 * The growth loop's PLAYTEST rounds need real user flows on the running app. The in-app
 * Browser pane cannot be relied on for that (a hidden pane never paints, see HANDOFF's traps),
 * so this drives the Chrome already on the machine over the DevTools protocol:
 *
 *   - a fresh throwaway profile, so the app starts as a genuinely new user;
 *   - a 375x812 mobile viewport with touch input;
 *   - taps dispatched as real touch events at the element's on-screen centre, never
 *     `element.click()`, so anything that would stop a thumb stops this too;
 *   - a clock offset injected before the app loads, so "week two" is the SAME stored data
 *     seen seven days later rather than a different seed.
 *
 *   node tools/playtest.mjs explore <out-dir> [--offset-days N]
 *
 * Scenario scripts import `launch` and drive a Session; see tools/playtests/.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { devPort } from './dev-port.ts';

const CHROME = process.env.PROOF_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
export const PHONE = { width: 375, height: 812, deviceScaleFactor: 2, mobile: true };
export const APP_URL = `http://localhost:${devPort()}/`;
const DAY = 86_400_000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/*
 * Runs before any app script on every load. `pt.offsetMs` in localStorage shifts the app's
 * clock, which is how a scenario reaches next week without faking the database.
 */
const CLOCK_SHIFT = `(() => {
  const off = Number(localStorage.getItem('pt.offsetMs') || 0);
  if (!off) return;
  const RealDate = Date;
  const realNow = RealDate.now.bind(RealDate);
  class ShiftedDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(realNow() + off); else super(...a); }
    static now() { return realNow() + off; }
  }
  ShiftedDate.parse = RealDate.parse;
  ShiftedDate.UTC = RealDate.UTC;
  globalThis.Date = ShiftedDate;
})();`;

/*
 * The page's own record of when the first control a thumb could use appeared (COACH.md C4).
 * `open` used to time its own polling: a 500 ms loop and an 800 ms settle sat inside the span,
 * so every open read about 1.3 s whatever the app did. performance.now() counts from the
 * navigation itself, so nothing the harness does can land inside it.
 */
const FIRST_CONTROL = `(() => {
  new MutationObserver((_, obs) => {
    if (!document.querySelector('[role=button]')) return;
    window.__ptFirstControlAt = Math.round(performance.now());
    obs.disconnect();
  }).observe(document, { childList: true, subtree: true });
})();`;

async function json(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`playtest: nothing answered at ${url}`);
}

export class Session {
  constructor(send, ws, chrome, profile, ownsProfile) {
    Object.assign(this, { send, ws, chrome, profile, ownsProfile });
    this.shots = [];
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`playtest: page threw: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`);
    return r.result.value;
  }

  /**
   * Load the app and wait until it has rendered controls a user could touch. Returns the time
   * from navigation to the first control by the page's own clock (see FIRST_CONTROL): desktop
   * Chrome against the dev server, not a phone.
   */
  async open(url = APP_URL, timeoutMs = 120_000) {
    await this.send('Page.navigate', { url });
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await sleep(500);
      const at = await this.eval(`window.__ptFirstControlAt ?? null`).catch(() => null);
      if (at !== null) { await sleep(800); return at; }
    }
    throw new Error('playtest: the app never rendered a control');
  }

  /** Shift the app clock by whole days (persisted in the page's own storage), then reload. */
  async offsetDays(days) {
    await this.eval(`localStorage.setItem('pt.offsetMs', String(${days * DAY}))`);
    return this.open();
  }

  /**
   * Every control on screen: its accessible name, visible text, and the centre of the part
   * of it a finger can SEE (vw × vh), inside every scrolling ancestor and the screen. A chip
   * half past the rail's edge has its geometric centre where nothing is drawn; a thumb
   * presses the half that shows (R684: PT1 reported two such chips as dead).
   */
  async controls() {
    return this.eval(`[...document.querySelectorAll('[role=button],[role=tab],[role=link],a,input,textarea,[role=switch]')]
      .map((el, i) => { const r = el.getBoundingClientRect();
        let L = r.left, R = r.right, T = r.top, B = r.bottom;
        for (let p = el.parentElement; p; p = p.parentElement) {
          const cs = getComputedStyle(p), q = p.getBoundingClientRect();
          if (cs.overflowX !== 'visible') { L = Math.max(L, q.left); R = Math.min(R, q.right); }
          if (cs.overflowY !== 'visible') { T = Math.max(T, q.top); B = Math.min(B, q.bottom); }
        }
        L = Math.max(L, 0); T = Math.max(T, 0); R = Math.min(R, innerWidth); B = Math.min(B, innerHeight);
        const seen = R > L && B > T;
        return { i, label: el.getAttribute('aria-label') || '', text: (el.innerText || el.value || '').trim().replace(/\\s+/g, ' ').slice(0, 60),
          role: el.getAttribute('role') || el.tagName.toLowerCase(),
          x: seen ? (L + R) / 2 : r.x + r.width / 2, y: seen ? (T + B) / 2 : r.y + r.height / 2, w: r.width, h: r.height,
          vw: seen ? R - L : 0, vh: seen ? B - T : 0,
          disabled: el.getAttribute('aria-disabled') === 'true' }; })
      .filter(c => c.w > 0 && c.h > 0)`);
  }

  /** Tap the first control whose label or text matches, scrolling it into view first. */
  async tap(match, { nth = 0 } = {}) {
    const re = match instanceof RegExp ? match : new RegExp(match, 'i');
    let all = await this.controls();
    const hits = all.filter(c => re.test(c.label) || re.test(c.text));
    if (!hits[nth]) {
      throw new Error(`playtest: nothing to tap matches ${re}. On screen: ` +
        all.map(c => c.label || c.text).filter(Boolean).slice(0, 40).join(' | '));
    }
    const target = hits[nth];
    const SELECTOR = `document.querySelectorAll('[role=button],[role=tab],[role=link],a,input,textarea,[role=switch]')[${target.i}]`;
    // Off screen on EITHER axis: a chip at the far end of a horizontal row is on screen
    // vertically and still 500px off the right edge, and a touch there reaches nothing.
    // Or none of it shows at all: clipped out of its scroller while still inside the screen.
    if (target.vw === 0 || target.y < 0 || target.y > PHONE.height || target.x < 0 || target.x > PHONE.width) {
      await this.eval(`${SELECTOR}.scrollIntoView({ block: 'center', inline: 'center' })`);
      await sleep(400);
      all = await this.controls();
      Object.assign(target, all.find(c => c.i === target.i));
    }
    // A sliver is not a target: a fingertip needs about 20pt of the control to land on it.
    if (target.vw > 0 && (target.vw < 20 || target.vh < 20)) {
      throw new Error(`playtest: only ${Math.round(target.vw)}×${Math.round(target.vh)} of "${target.label || target.text}" is visible — too little for a finger`);
    }
    // A thumb only presses what is actually under it. Refuse to report a tap on something
    // covered, clipped or still off screen instead of silently touching whatever is there.
    const under = await this.eval(`(() => { const el = ${SELECTOR}; const top = document.elementFromPoint(${target.x}, ${target.y});
      return top && (el === top || el.contains(top)) ? '' : (top ? (top.getAttribute('aria-label') || top.innerText || top.tagName).slice(0, 60) : 'nothing (off screen)'); })()`);
    if (under) throw new Error(`playtest: "${target.label || target.text}" is not what a finger at ${Math.round(target.x)},${Math.round(target.y)} would press — ${under} is`);
    const point = { x: target.x, y: target.y, radiusX: 8, radiusY: 8, force: 1, id: 1 };
    await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await sleep(60);
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(450);
    return target;
  }

  async type(text) {
    await this.send('Input.insertText', { text });
    await sleep(200);
  }

  async text() {
    return this.eval(`document.body.innerText`);
  }

  async shot(dir, name) {
    fs.mkdirSync(dir, { recursive: true });
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(dir, `${String(this.shots.length + 1).padStart(2, '0')}-${name}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    this.shots.push(file);
    return file;
  }

  async close() {
    // Ask Chrome to shut down first (R689). Killed outright, it dropped the
    // localStorage writes it had not yet put on disk, and two PT2 personas
    // reported that as the app losing their sets.
    // And wait for it to finish (R691): under a loaded machine Chrome took over
    // two seconds to write its profile, and the kill below cut it off, so a
    // relaunch on the same profile opened a fresh install.
    const exited = this.chrome.exitCode !== null ? Promise.resolve()
      : new Promise(resolve => this.chrome.once('exit', resolve));
    try { await Promise.race([this.send('Browser.close'), sleep(1500)]); } catch { /* already gone */ }
    await Promise.race([exited, sleep(10_000)]);
    try { this.ws.close(); } catch { /* already gone */ }
    this.chrome.kill();
    await sleep(800);
    if (this.ownsProfile) {
      try { fs.rmSync(this.profile, { recursive: true, force: true }); } catch { /* Chrome may still hold a lock */ }
    }
  }
}

export async function launch({ profile, debugPort = 9333 } = {}) {
  const ownsProfile = !profile;
  const dir = profile ?? fs.mkdtempSync(path.join(os.tmpdir(), 'proof-pt-'));
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', `--window-size=${PHONE.width},${PHONE.height}`, 'about:blank'
  ], { stdio: 'ignore' });
  const page = (await json(`http://127.0.0.1:${debugPort}/json/list`)).find(t => t.type === 'page');
  if (!page) { chrome.kill(); throw new Error('playtest: Chrome opened no page'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (!m.id || !pending.has(m.id)) return;
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(`playtest: ${m.error.message}`)); else resolve(m.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', PHONE);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK_SHIFT });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: FIRST_CONTROL });
  return new Session(send, ws, chrome, dir, ownsProfile);
}

// ---- CLI: look at the app as a brand-new user and list what can be touched
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('playtest.mjs')) {
  const [mode, out] = process.argv.slice(2);
  if (mode === 'explore' && out) {
    const s = await launch();
    try {
      const ms = await s.open();
      const offsetAt = process.argv.indexOf('--offset-days');
      if (offsetAt >= 0) await s.offsetDays(Number(process.argv[offsetAt + 1]));
      console.log(`first control ${ms} ms after navigation (desktop Chrome); screenshot ${await s.shot(out, 'explore')}`);
      for (const c of await s.controls()) {
        console.log(`  [${c.role}] ${c.label ? `"${c.label}"` : ''} ${c.text ? `text="${c.text}"` : ''} at ${Math.round(c.x)},${Math.round(c.y)}${c.disabled ? ' (disabled)' : ''}`);
      }
      console.log('--- visible text ---');
      console.log((await s.text()).slice(0, 900));
    } finally {
      await s.close();
    }
  } else if (mode) {
    console.error('usage: node tools/playtest.mjs explore <out-dir> [--offset-days N]');
    process.exit(1);
  }
}

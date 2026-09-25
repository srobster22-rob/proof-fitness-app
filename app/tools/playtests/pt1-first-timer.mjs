/**
 * PT1 — persona: first-timer. New user -> first workout -> week two, at phone size.
 *
 *   node tools/playtests/pt1-first-timer.mjs <out-dir>
 *
 * Built step by step against what the app actually showed, not against a guess of it.
 * It ends by printing the headline metrics VISION.md defines, as `HEADLINE H<n>` lines.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from '../playtest.mjs';
import { t as translate } from '../../src/domain/i18n.ts';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: node tools/playtests/pt1-first-timer.mjs <out-dir>'); process.exit(1); }

/*
 * H3 counts the coach's sentences on screen. The keys come from coach.ts the way
 * tools/inventory.ts counts them, and each English template becomes a pattern.
 */
const COACH_KEYS = [...new Set([...fs.readFileSync(new URL('../../src/domain/coach.ts', import.meta.url), 'utf8')
  .matchAll(/key: '(coach\w+)'/g)].map(m => m[1]))];
const COACH_LINES = COACH_KEYS.map(k => new RegExp(translate('en', k)
  .replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\w+\}/g, '[^\\s—]+'), 'g'));
const coachSeen = new Set();

const s = await launch();
let taps = 0;
let detours = 0;
const tap = async (re, opts) => { const t = await s.tap(re, opts); taps++; console.log(`tap ${taps}: ${t.label || t.text}`); return t; };
const see = async name => {
  await s.shot(OUT, name);
  const text = (await s.text()).replace(/\s+/g, ' ');
  for (const line of COACH_LINES) for (const m of text.matchAll(line)) coachSeen.add(m[0]);
  console.log(`=== ${name}: ${text.slice(0, 420)}`);
};

/** Every set the persona logged, read back from the database the web build keeps in localStorage. */
async function storedSets() {
  // The web build persists on a 250 ms debounce, so read until two reads agree.
  let prev = null;
  let cur = await s.eval(`localStorage.getItem('proof.db.v1')`);
  for (let i = 0; i < 20 && cur !== prev; i++) {
    prev = cur;
    await new Promise(r => setTimeout(r, 300));
    cur = await s.eval(`localStorage.getItem('proof.db.v1')`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-pt1-'));
  try {
    const file = path.join(dir, 'proof.db');
    fs.writeFileSync(file, Buffer.from(cur, 'base64'));
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return db.prepare('SELECT exercise_id AS lift, weight, reps, at FROM sets WHERE deleted = 0 ORDER BY at').all();
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const dump = async title => {
  console.log(`--- controls: ${title}`);
  for (const c of await s.controls()) {
    console.log(`  [${c.role}] ${c.label} | ${c.text} @y${Math.round(c.y)}${c.disabled ? ' (disabled)' : ''}`);
  }
};

try {
  const opened = await s.open();
  console.log(`first control ${opened} ms after navigation (desktop Chrome, dev server; not a phone)`);
  await see('new-user');
  await tap(/^PUSH \/ PULL \/ LEGS/);
  await see('after-choosing-split');
  await tap(/^PUSH$/);
  await see('push-day');
  await tap(/^LOG SET$/);
  const firstSetTaps = taps;
  console.log(`METRIC first set logged after ${taps} taps`);
  await see('first-set-logged');
  await tap(/^LOG SET$/);
  await tap(/^LOG SET$/);
  await tap(/^Increase weight$/);
  await tap(/^LOG SET$/);
  await see('four-sets');
  await new Promise(r => setTimeout(r, 4000));
  console.log(`METRIC rest line 4s later: ${(await s.text()).match(/RESTING [0-9:]+/)?.[0] ?? '(no rest line)'}`);

  await tap(/suggested next/);
  await see('second-lift');
  await tap(/^LOG SET$/);
  await tap(/^LOG SET$/);
  await tap(/^LOG SET$/);
  await tap(/^Overhead Press$/);
  await see('third-lift');
  await tap(/^LOG SET$/);
  await tap(/^LOG SET$/);
  await tap(/^LOG SET$/);
  await see('before-finish');
  await tap(/^Finish this workout$/);
  const firstWorkoutTaps = taps;
  await see('after-finish');

  // From here a failure is a finding, not the end of the session.
  const step = async (name, fn) => {
    try { await fn(); } catch (e) {
      console.log(`FINDING ${name}: ${e.message.slice(0, 300)}`);
      await dump(`after failed step ${name}`);
    }
  };

  await step('share', async () => { await tap(/^SHARE$/); await see('share'); await dump('after share'); });
  await step('done', async () => { await tap(/^DONE$/); await see('after-done'); });
  // FINDING (first run): the day sheet for the NEXT workout covers the tab bar, so
  // Progress and Goals cannot be reached until it is answered. A user taps SKIP.
  const skipDaySheet = async () => {
    if ((await s.controls()).some(c => /^Skip\. Work it out as I go$/.test(c.label))) {
      await tap(/^Skip\. Work it out as I go$/);
      detours++;
    }
  };
  await step('progress', async () => { await skipDaySheet(); await tap(/^PROGRESS$/); await see('progress-day1'); });
  await step('goals', async () => { await tap(/^GOALS$/); await see('goals-day1'); await dump('goals day 1'); });

  // ---- week two: the same stored workout, seen seven days later
  await step('week-two', async () => {
    await s.offsetDays(7);
    await see('week2-open');
    await tap(/^PULL$/);
    await see('week2-pull-day');
    await tap(/^LOG SET$/);
    await tap(/^LOG SET$/);
    await tap(/^LOG SET$/);
    await tap(/suggested next/);
    await see('week2-second-lift');
    await tap(/^LOG SET$/);
    await tap(/^LOG SET$/);
    await tap(/^Finish this workout$/);
    await see('week2-recap');
    await tap(/^DONE$/);
    await skipDaySheet();
    await tap(/^PROGRESS$/);
    await see('week2-progress');
    await dump('week two progress');
    await tap(/^GOALS$/);
    await see('week2-goals');
    await dump('week two goals');
  });
  console.log(`METRIC total taps ${taps}`);

  // The headline metrics (VISION.md).
  const sets = await storedSets();
  const firstWorkout = sets.filter(x => x.at < sets[0].at + 12 * 3_600_000);
  const firstWeight = new Map();
  for (const x of sets) if (!firstWeight.has(x.lift)) firstWeight.set(x.lift, x.weight);
  const bestBench = Math.max(...sets.filter(x => x.lift === 'bench').map(x => x.weight));
  const heaviestStart = Math.max(...[...firstWeight].filter(([lift]) => lift !== 'bench').map(([, w]) => w));
  console.log(`HEADLINE H1 taps to the first logged set: ${firstSetTaps}`);
  console.log(`HEADLINE H2 taps per set, first workout: ${firstWorkoutTaps}/${firstWorkout.length} = ${(firstWorkoutTaps / firstWorkout.length).toFixed(2)}`);
  console.log(`HEADLINE H3 coach lines seen in two weeks: ${coachSeen.size}${coachSeen.size ? ` (${[...coachSeen].join(' | ')})` : ''}`);
  console.log(`HEADLINE H4 detour taps: ${detours}`);
  console.log(`HEADLINE H5 heaviest first-time weight / best bench: ${heaviestStart}/${bestBench} = ${(heaviestStart / bestBench).toFixed(2)}`);
  // Anything the app caught and swallowed while the screens looked fine (src/ui/error-log.ts).
  const errs = await s.errors();
  console.log(`ERRORS recorded by the app: ${errs === null ? 'unreadable (not a development build)' : errs.length}`);
  if (errs === null || errs.length) { for (const e of errs ?? []) console.log(`  ${e.screen}: ${e.message}`); process.exitCode = 1; }
} finally {
  await s.close();
}

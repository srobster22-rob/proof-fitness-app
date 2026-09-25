// A fingerprint of what the Now screen RENDERS through a fixed flow, for proving that moving `.tsx`
// code changed nothing on screen (AGENT_LOOP §3a; tools/snapshot.ts cannot load .tsx). At each step it
// records every rendered element: tag, role, label, its own text, its rounded box, and the computed
// colour, background, font size, weight and opacity. Motion is reduced, so no animation is caught mid-way,
// and the rest timer's digits are masked. Needs the dev server (`npm run web`). Compare two runs made
// the same day: the dates on screen are real.
//
//   node tools/playtests/ui-trace.mjs [out.json]      prints the hash of each step, and the total
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launch } from '../playtest.mjs';

const OUT = process.argv[2];
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-trace-'));
const settle = ms => new Promise(r => setTimeout(r, ms));

/** Every rendered element, depth first, with what a reader would see of it. */
const DUMP = `(() => {
  const out = [];
  const mask = t => t.replace(/\\b\\d+:\\d\\d\\b/g, 'm:ss');
  const walk = (el, depth) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    // A masked time's digits differ in width, so its horizontal box is masked with it.
    const timed = mask(own) !== own;
    out.push([depth, el.tagName, el.getAttribute('role') || '', mask(el.getAttribute('aria-label') || ''), mask(own),
      timed ? '~' : Math.round(r.x), Math.round(r.y), timed ? '~' : Math.round(r.width), Math.round(r.height),
      cs.color, cs.backgroundColor, cs.fontSize, cs.fontWeight, cs.opacity].join('|'));
    for (const c of el.children) walk(c, depth + 1);
  };
  walk(document.body, 0);
  return out;
})()`;

const steps = [];
let s = await launch({ profile, debugPort: 9347 });
const dump = async name => { await settle(700); steps.push({ name, dom: await s.eval(DUMP) }); };
const step = async (name, act) => { await act(); await dump(name); };
try {
  await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await s.open();
  await s.eval(`fetch('/seed.b64').then(r => r.text()).then(t => localStorage.setItem('proof.db.v1', t))`);
  await s.open();
  await dump('open: the day chooser');
  await step('legs', () => s.tap(/^LEGS$/));
  await step('a set logged', () => s.tap(/^LOG SET$/));
  await step('steppers', async () => {
    await s.tap(/^Increase weight$/); await s.tap(/^Add 45 lb$/); await s.tap(/^Take off 45 lb$/);
    await s.tap(/^Decrease reps$/); await s.tap(/^Add 5 reps$/); await s.tap(/^Take off 5 reps$/);
  });
  await step('a second set', () => s.tap(/^LOG SET$/));
  await step('the set sheet', () => s.tap(/^Set 2, /));
  await step('closed', () => s.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`).then(() => s.open()));
  await step('the picker', () => s.tap(/^Change exercise\./));
  await step('a lift picked', () => s.tap(/^Leg Press$/));
  await step('the equipment sheet', () => s.tap(/^Change equipment$/));
  await step('a machine', () => s.tap(/^MACHINE$/));
  await step('reopened', () => s.open());
  await step('a rail lift', () => s.tap(/^Leg Extension/));
  await step('undo', () => s.tap(/^Undo last /));
  await step('the clear question', () => s.tap(/^Clear this workout$/));
} finally {
  await s.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold a lock */ }
}
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
for (const st of steps) console.log(`  ${st.name.padEnd(24)} ${hash(st.dom)}  (${st.dom.length} elements)`);
console.log(`ui-trace ${hash(steps)}`);
if (OUT) fs.writeFileSync(OUT, JSON.stringify(steps, null, 0));

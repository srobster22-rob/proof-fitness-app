// A miss after a made set is not a reason to add weight (R694).
//
// PT3's three personas each made the coach's call, missed a later set at the same weight, and were
// told to add weight anyway; the line kept saying "made it" above the miss. On the sample's leg day
// this takes the squat call, misses the next set at that weight, finishes, and comes back three days
// later. Needs the dev server (`npm run web`), which also writes the sample's seed. Exits 1 on any miss.
//
//   node tools/playtests/miss-after-made.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from '../playtest.mjs';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-miss-'));
const text = async s => (await s.text()).replace(/\s+/g, ' ');
const checks = [];
const expect = (name, ok, seen) => { checks.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (saw: ${seen.slice(0, 160)})`}`); };

let s = await launch({ profile });
try {
  await s.open();
  await s.eval(`fetch('/seed.b64').then(r => r.text()).then(t => localStorage.setItem('proof.db.v1', t))`);
  await s.open();
  await s.tap(/^LEGS$/);
  await s.tap(/^LOG SET$/);                      // the call, as the dial opens on it
  let t = await text(s);
  expect('the call, taken, is made', /— made it/.test(t), t);
  await s.tap(/^Decrease reps$/);
  await s.tap(/^Decrease reps$/);
  await s.tap(/^LOG SET$/);                      // the same weight, two reps short
  t = await text(s);
  expect('a miss after it ends "made it"', !/— made it/.test(t), t);
  await s.tap(/^FINISH$/);
  t = await text(s);
  const next = t.slice(t.indexOf('NEXT TIME'));
  expect('the recap names the miss, not a raise', /Squat · \d+ again — make \d+/.test(next) && !/Squat · [^·]*try/.test(next), next);
  await s.tap(/^DONE$/);
} finally {
  await s.close();
}
s = await launch({ profile, debugPort: 9334 });
try {
  await s.open();
  await s.offsetDays(3);
  if ((await s.controls()).some(c => /^LEGS$/.test(c.label))) await s.tap(/^LEGS$/);
  const t = await text(s);
  expect('three days later the lift opens on the same weight again', /\d+ again — make \d+/.test(t), t);
  const errs = await s.errors();
  expect('the app recorded no errors', Array.isArray(errs) && errs.length === 0, JSON.stringify(errs));
} finally {
  await s.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold a lock */ }
}
const failed = checks.filter(ok => !ok).length;
console.log(failed ? `MISS AFTER MADE: ${failed} of ${checks.length} checks failed` : `MISS AFTER MADE: all ${checks.length} checks pass`);
process.exit(failed ? 1 : 0);

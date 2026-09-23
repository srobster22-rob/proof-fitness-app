// The latest set, its UNDO and its + must be wholly visible after every set, at phone size (R686).
//
// R684 checked this after 1 and 4 sets and called it fixed; at 3 the chips wrapped away from their
// buttons, and at 4 Chrome's scroll anchoring moved the list up past them. So this sweeps every count
// from 1 past the second wrap. Needs the dev server (`npm run web`). Exits 1 on any failing count.
//
//   node tools/playtests/latest-set-sweep.mjs [max-sets]
import { launch } from '../playtest.mjs';

const MAX = Number(process.argv[2] ?? 7);
const s = await launch();
let failed = 0;
try {
  await s.open();
  await s.tap(/Push \/ Pull \/ Legs/i);
  await s.tap(/^PUSH$/);
  for (let n = 1; n <= MAX; n++) {
    await s.tap(/^LOG SET$/);
    const cs = await s.controls();
    const whole = c => c && Math.abs(c.vw - c.w) < 1 && Math.abs(c.vh - c.h) < 1;
    const latest = cs.find(c => new RegExp(`^Set ${n},`).test(c.label));
    const undo = cs.find(c => /^Undo last /.test(c.label));
    const plus = cs.find(c => /same as the last/.test(c.label));
    const ok = whole(latest) && whole(undo) && whole(plus);
    if (!ok) failed++;
    console.log(`${n} set${n === 1 ? '' : 's'}: latest ${whole(latest) ? 'whole' : 'CUT'}, UNDO ${whole(undo) ? 'whole' : 'CUT'}, + ${whole(plus) ? 'whole' : 'CUT'}`);
  }
  await s.tap(/same as the last/);
} finally {
  await s.close();
}
console.log(failed ? `LATEST SET SWEEP: ${failed} of ${MAX} counts hide the latest set or its buttons` : `LATEST SET SWEEP: all ${MAX} counts show it`);
process.exit(failed ? 1 : 0);

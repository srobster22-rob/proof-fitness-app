import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slabGuard, screenClaim } from './helpers/recap-guards.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const RECAP_TSX = fs.readFileSync(path.join(APP, 'app', 'recap.tsx'), 'utf8');

/*
 * R558. R552 proved the shared CARD and the share MESSAGE make the same claim
 * about the same workout, and said plainly that it could not include the third
 * surface: `recap.tsx` is JSX, the repo has no test renderer, and §12 forbids
 * adding a dependency to get one. So the screen a lifter actually looks at
 * before deciding whether to share was checked by READING.
 *
 * It does not have to be. The slab guards are pure predicates over the payload,
 * so this lifts the REAL expressions out of the file and evaluates them. If
 * somebody edits a guard, this runs the edited logic — which is the difference
 * between executing the rule and matching a string that describes it.
 */
describe('the recap screen climbs the same ladder as the card (R558)', () => {
  const BEST = { lift: 'Bench Press', weight: 205, reps: 5 };
  const CASES: Array<[string, Record<string, unknown>, string]> = [
    ['a personal record', { best: BEST, pr: { lift: 'Bench Press', weight: 205, reps: 5 } }, 'pr'],
    ['a first-ever session', { best: BEST, firstSession: true }, 'firstSession'],
    ['a best not yet a record', { best: BEST, bestYet: { prev: 195 } }, 'bestYet'],
    ['an ordinary workout', { best: BEST }, 'none'],
    // The precedence cases — two claims true, one right answer.
    ['a record on a first session', { best: BEST, firstSession: true, pr: { lift: 'x' } }, 'pr'],
    ['a best yet on a first session', { best: BEST, firstSession: true, bestYet: { prev: 195 } }, 'firstSession'],
    ['a record and a best yet', { best: BEST, bestYet: { prev: 195 }, pr: { lift: 'x' } }, 'pr']
  ];

  test('the guards were actually found', () => {
    // The instrument first. Three guards, and a missing one must throw rather
    // than silently drop a rung and make every case fall through to "none".
    for (const claim of ['pr', 'firstSession', 'bestYet']) {
      assert.equal(typeof slabGuard(claim), 'function', `no guard for ${claim}`);
    }
    assert.throws(() => slabGuard('somethingThatIsNotThere'),
      /anchor moved/, 'a missing guard no longer throws, so this test can go blind');
  });

  for (const [name, payload, expected] of CASES) {
    test(`${name}: the screen shows "${expected}"`, () => {
      assert.equal(screenClaim(payload), expected);
    });
  }

  test('a slab never draws without the data it prints', () => {
    /*
     * `firstSession` and `bestYet` both render `payload.best`, so each guard
     * has to require it. Without that the slab draws and reads the lift name
     * off undefined — a crash on the screen shown after every workout.
     */
    for (const claim of ['firstSession', 'bestYet']) {
      const withoutBest = claim === 'firstSession'
        ? { firstSession: true }
        : { bestYet: { prev: 195 } };
      assert.equal(slabGuard(claim)(withoutBest), false,
        `the ${claim} slab would draw with no \`best\` to print`);
    }
  });
});

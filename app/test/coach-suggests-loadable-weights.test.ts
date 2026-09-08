import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel, WEIGHT_STEP } from '../src/ui/now-model.ts';
import { coachSuggestion } from '../src/domain/coach.ts';
import { TRAINING_GOALS } from '../src/ui/training-goal.ts';
import { t } from '../src/domain/i18n.ts';
import type { Unit } from '../src/domain/types.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 9, 12);

/** Three sessions at one weight and one rep count — a plateau. */
function stuck(unit: Unit, weight: number, reps: number, goal?: string): Repo {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  if (goal) repo.setPref('pref.goal', goal);
  let n = 0;
  for (const d of [10, 7, 4]) {
    const id = `s${d}`;
    repo.startSession(id, unit);
    repo.logSet({ id: `x${n++}`, sessionId: id, exerciseId: 'bench', weight, reps, at: T0 - d * DAY });
    repo.endSession(id, T0 - d * DAY + 3600_000);
  }
  return repo;
}

function said(repo: Repo): string {
  const m = new NowModel(repo, () => T0, 'en-US');
  m.selectExercise('bench');
  return m.state().lastTime.head;
}

/** Every number in a line that could be a weight. */
const numbersIn = (s: string) => [...s.matchAll(/\d+(?:\.\d+)?/g)].map(m => Number(m[0]));

/*
 * R548, continuing R541. That round stopped a deload suggesting a weight below
 * the empty bar; this one stops every OTHER branch suggesting a weight that
 * cannot be loaded at all.
 *
 * The engine rounded to `MIN_INCREMENT`, which is the resolution of the DATA
 * (1 lb, 0.5 kg), not of a barbell. Measured, on a plateau at 60 kg with the
 * size goal: "stuck at 60 for 3 — try 61.25". A 1.25 kg total increase is
 * 0.625 kg a side, and no such plate exists in any gym. In pounds it said
 * 137.5, which is off the app's own 5 lb stepper — the lifter cannot even dial
 * in the advice without typing it.
 *
 * `WEIGHT_STEP` is the right grid for a reason worth writing down: it is both
 * what the + and - buttons move by AND the smallest standard plate pair
 * (2 x 2.5 lb, 2 x 1.25 kg). So a suggestion on that grid is reachable in the
 * app and loadable on the bar, and those two happen to be the same number.
 */
describe('every weight the coach names can actually be loaded (R548)', () => {
  for (const unit of ['lb', 'kg'] as Unit[]) {
    test(`suggestions in ${unit} land on the ${WEIGHT_STEP[unit]} ${unit} grid`, () => {
      const start = unit === 'lb' ? 135 : 60;
      for (const goal of TRAINING_GOALS) {
        for (const offset of [0, 1, 2]) {
          const weight = start + offset * WEIGHT_STEP[unit];
          const line = said(stuck(unit, weight, 8, goal));
          for (const n of numbersIn(line)) {
            // Rep counts and session counts share the line, so only numbers big
            // enough to be a weight are judged.
            if (n < WEIGHT_STEP[unit] * 4) continue;
            assert.equal(Math.round(n / WEIGHT_STEP[unit]) * WEIGHT_STEP[unit], n,
              `${goal} at ${weight} ${unit} named ${n}, which is not on the ` +
              `${WEIGHT_STEP[unit]} ${unit} grid: "${line}"`);
          }
        }
      }
    });
  }

  test('the specific number that started this is gone', () => {
    const line = said(stuck('kg', 60, 8, 'size'));
    assert.doesNotMatch(line, /61\.25/, `still suggesting a weight with no plate: "${line}"`);
    assert.match(line, /62\.5/, `expected the next loadable weight up. It said: "${line}"`);
  });

  test('a deload also lands on the grid', () => {
    // R541 floored it; this puts it on the same grid as everything else. 100 kg
    // less ten per cent is 90, but the arithmetic in between must not surface.
    const line = said(stuck('kg', 102.5, 5, 'strength'));
    for (const n of numbersIn(line)) {
      if (n < 10) continue;
      assert.equal(Math.round(n / 2.5) * 2.5, n, `deload named ${n}: "${line}"`);
    }
  });

  test('an engine given no grid behaves exactly as it did', () => {
    // Optional, defaulting to MIN_INCREMENT, so every existing caller keeps the
    // old arithmetic rather than inheriting a grid that is wrong for it — the
    // same contract R541 gave `base`.
    const s = coachSuggestion(stuck('kg', 60, 8).allSets(), 'bench', T0, { unit: 'kg', goal: 'size' });
    assert.equal(s?.weight, 61.25, 'the default changed, so every existing caller just moved');
  });

  test('Settings no longer promises a difference the grid cannot deliver', () => {
    /*
     * The consequence of the fix, which had to be followed through rather than
     * left. The goals differed by 2.5 lb of step, and on a 5 lb grid that
     * difference rounds away — so "strength adds weight in bigger steps, size
     * in smaller ones" became false in both units the app supports.
     *
     * The goals DO differ, in the rep target that releases the weight (5 vs 8),
     * which is real and survives any grid. Whether strength should also climb
     * faster is a training-model decision and is filed for the owner, not
     * decided here.
     */
    for (const lang of ['en', 'es'] as const) {
      const help = t(lang, 'trainingGoalHelp');
      assert.doesNotMatch(help, /bigger steps|pasos más grandes/,
        `${lang} still claims a step-size difference the grid rounds away: "${help}"`);
      assert.match(help, /5|cinco/, `${lang} no longer names the strength rep target: "${help}"`);
      assert.match(help, /8|ocho/, `${lang} no longer names the size rep target: "${help}"`);
    }
  });
});

/*
 * R549. R548 put the plateau and progress branches on the grid and deliberately
 * left CLIMBING alone, on R518's rule that a lifter's own working increment
 * outranks the goal table. That rule is right and the exemption was not: their
 * "own increment" is only theirs when they loaded it.
 *
 * With one session logged in kilos, 86 kg reads as 189.5 lb and the step reads
 * as 4.5, so the app said "189.5 and climbing, 4 sessions — TRY 194". Nobody
 * ever put 4.5 lb on a bar; the unit conversion did. The number came from the
 * lifter's history in form only.
 *
 * The reported weight stays exact — 189.5 is what they lifted — and only the
 * suggestion is moved onto plates, which is the same split §16 asks for
 * everywhere: report the real number, suggest a reachable one.
 */
describe('a climb suggested from converted history is still loadable (R549)', () => {
  function switchedUnits(): Repo {
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
    let n = 0;
    for (const [d, w] of [[11, 175], [8, 180], [5, 185]] as [number, number][]) {
      const id = `lb${d}`;
      repo.startSession(id, 'lb');
      repo.logSet({ id: `s${n++}`, sessionId: id, exerciseId: 'bench', weight: w, reps: 5, at: T0 - d * DAY });
      repo.endSession(id, T0 - d * DAY + 3600_000);
    }
    repo.startSession('kg2', 'kg');
    repo.logSet({ id: `s${n++}`, sessionId: 'kg2', exerciseId: 'bench', weight: 86, reps: 5, at: T0 - 2 * DAY });
    repo.endSession('kg2', T0 - 2 * DAY + 3600_000);
    return repo;
  }

  test('the climb lands on the grid', () => {
    const line = said(switchedUnits());
    assert.match(line, /climbing/, `the fixture stopped being a climb: "${line}"`);
    assert.match(line, /try 195/, `expected a loadable next weight. It said: "${line}"`);
    assert.doesNotMatch(line, /try 194\b/, `still suggesting 194, which is not on the 5 lb grid: "${line}"`);
  });

  test('but the weight they actually lifted is reported exactly', () => {
    /*
     * The half that must NOT be rounded. 189.5 is 86 kg told truthfully; a
     * lifter who sees "190 and climbing" cannot check it against anything they
     * did, which is the §16 failure in the opposite direction.
     */
    assert.match(said(switchedUnits()), /189\.5 and climbing/,
      'the reported weight was rounded too, so it no longer matches the session');
  });

  test('snapping never turns an increase into a decrease', () => {
    /*
     * `roundTo` goes to the NEAREST multiple, so an off-grid current weight can
     * round the suggestion below itself: 191 plus a 1 lb step is 192, and 192
     * on a 5 lb grid is 190. That is not a rounding error, it is the advice
     * inverted — "climbing, try 190" said to somebody who just lifted 191.
     */
    /*
     * The first version of this looped over plateau fixtures and PASSED against
     * a planted defect — the size step is 2.5 on a 5 grid, so the target is
     * always far enough above to round up and the down-round case never arose.
     * A test that cannot reach the case it names is the blind instrument this
     * session keeps finding.
     *
     * It takes a CLIMBING history to get there, because that branch uses the
     * lifter's own step, which can be small: rising 189 -> 190 -> 191 gives a
     * step of 1, and 191 + 1 = 192 rounds to 190 — below what they just lifted.
     */
    const climbingBy = (step: number, top: number): Repo => {
      const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
      let n = 0;
      const weights = [top - 2 * step, top - step, top];
      weights.forEach((w, i) => {
        const id = `c${i}`;
        repo.startSession(id, 'lb');
        repo.logSet({ id: `q${n++}`, sessionId: id, exerciseId: 'bench', weight: w, reps: 5,
          at: T0 - (9 - i * 3) * DAY });
        repo.endSession(id, T0 - (9 - i * 3) * DAY + 3600_000);
      });
      return repo;
    };

    for (const [step, top] of [[1, 191], [1, 196], [0.5, 191], [2, 192]] as [number, number][]) {
      const s = coachSuggestion(climbingBy(step, top).allSets(), 'bench', T0,
        { unit: 'lb', goal: 'size', grid: 5 });
      assert.ok(s, `no advice climbing by ${step} to ${top}`);
      assert.ok(s!.weight > top,
        `climbing by ${step} from ${top}, the app suggested ${s!.weight} — not an increase`);
      assert.equal(s!.weight % 5, 0,
        `climbing by ${step} from ${top}, it suggested ${s!.weight}, off the grid`);
    }
  });
});

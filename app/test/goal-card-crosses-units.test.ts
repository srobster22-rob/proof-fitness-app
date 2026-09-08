import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { goalProgress, narrativeLine } from '../src/domain/goals.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 9, 12);

/** Squats logged in POUNDS, with the goal written in KILOS. */
function poundsWithKgGoal(): Repo {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  let n = 0;
  for (const [d, w] of [[21, 175], [14, 185], [7, 195]] as [number, number][]) {
    const id = `lb${d}`;
    repo.startSession(id, 'lb');
    repo.logSet({ id: `s${n++}`, sessionId: id, exerciseId: 'squat', weight: w, reps: 5, at: T0 - d * DAY });
    repo.endSession(id, T0 - d * DAY + 3600_000);
  }
  repo.saveGoal({
    id: 'g-kg', exerciseId: 'squat', targetWeight: 100, targetReps: 5,
    createdAt: T0 - 30 * DAY, targetDate: T0 + 60 * DAY, unit: 'kg'
  });
  return repo;
}

const progress = (repo: Repo) =>
  goalProgress(repo.goals()[0], repo.allSets(), repo.exercises(), T0, repo.sessionUnits());

/*
 * R556. Goals was the last screen with no pass this session, and the seam every
 * other surface was checked against — a weight in one unit judged against a
 * weight in another — had no test here at all.
 *
 * `goals.test.ts` has a kg goal, and its history is in kilos too, so nothing
 * ever crossed. The crossing is the case that needs `sessionUnits`: a
 * `LoggedSet` carries no unit, the SESSION owns it, and a goal carries its own
 * separate one.
 *
 * Walked in the product first and it is correct — the card reads "12 kg from a
 * 100 squat" over a pound history, and 89% on the bar. These pin the numbers so
 * that stays true: 195 lb is 88.45 kg, so the gap is 11.55, and the card must
 * round it for display without ever comparing 195 against 100.
 */
describe('a goal in one unit reads a history in another (R556)', () => {
  test('the gap is measured in the GOAL\'s unit, not the session\'s', () => {
    const p = progress(poundsWithKgGoal());
    assert.ok(Math.abs(p.current - 88.45) < 0.1,
      `the best set reads as ${p.current} — 195 lb should be about 88.45 kg`);
    assert.ok(Math.abs(p.remaining - 11.55) < 0.1,
      `the gap reads as ${p.remaining} — 100 kg minus 88.45 is 11.55`);
  });

  test('and the sentence says so in kilos', () => {
    assert.equal(narrativeLine(progress(poundsWithKgGoal())), '12 kg from a 100 squat');
  });

  test('the raw numbers are never compared', () => {
    /*
     * The failure this guards, stated as the number it would produce. Compare
     * 195 against 100 with no conversion and the goal is already smashed —
     * `remaining` 0, `achieved` true — and the app congratulates somebody who
     * is 25 lb short. That is §8's cry-wolf on the one screen whose whole job
     * is saying how far away something is.
     */
    const p = progress(poundsWithKgGoal());
    assert.equal(p.achieved, false,
      'a 195 lb squat was read as clearing a 100 kg goal, which is 220.5 lb');
    assert.ok(p.remaining > 0, 'the goal reports nothing left to do');
  });

  test('the bar fills by the same arithmetic the sentence uses', () => {
    /*
     * §16: the picture and the words have to be checkable against each other.
     * The goal was set before any of this history existed, so the baseline is
     * zero and the fraction is simply current/target.
     */
    const p = progress(poundsWithKgGoal());
    assert.equal(p.start, 0, 'the fixture no longer starts from an empty baseline');
    assert.ok(Math.abs(p.fraction - 0.8845) < 0.005,
      `the bar is at ${Math.round(p.fraction * 100)}% while the sentence says 12 kg of 100 to go`);
  });
});

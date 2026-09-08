import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { goalProgress } from '../src/domain/goals.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 9, 12);

/** Bench and squat history, plus a bench goal that is not yet met. */
function withGoal(): Repo {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  let n = 0;
  for (let d = 30; d >= 2; d -= 3) {
    const id = `h${d}`;
    repo.startSession(id, 'lb');
    repo.logSet({ id: `b${n++}`, sessionId: id, exerciseId: 'bench', weight: 180 + d, reps: 5, at: T0 - d * DAY });
    repo.logSet({ id: `s${n++}`, sessionId: id, exerciseId: 'squat', weight: 300, reps: 5, at: T0 - d * DAY + 1000 });
    repo.endSession(id, T0 - d * DAY + 3600_000);
  }
  repo.saveGoal({
    id: 'g1', exerciseId: 'bench', targetWeight: 250, targetReps: 5,
    createdAt: T0 - 60 * DAY, targetDate: T0 + 30 * DAY, unit: 'lb'
  });
  return repo;
}

/*
 * R525. `goalHint` runs inside `state()`, which runs on every tap, and it was
 * handing `goalProgress` the entire training log.
 *
 * That function touches `history` three times and filters by
 * `goal.exerciseId` every one of them — twice through `bestAt`, once for
 * `trainedSince` — so it walked 14,000 rows to look at a few dozen. Measured:
 * 1.43 ms per call, and `state()` 5.7 ms down to 4.4 ms once the index existed.
 *
 * The risk in a change like this is not speed, it is that withholding rows
 * changes an answer. It cannot here — every use of the array inside that
 * function is already scoped to this exercise, so the rows withheld are ones
 * it would have skipped — and these tests are about proving that rather than
 * asserting it.
 */
describe('the goal hint reads an index, and says the same thing (R525)', () => {
  test('it agrees exactly with passing the whole history', () => {
    /*
     * The comparison that matters: the same goal, scored both ways, must
     * produce the same numbers. If it ever does not, the index is dropping
     * something `goalProgress` needed.
     */
    const repo = withGoal();
    const goal = repo.goals()[0];
    const whole = goalProgress(goal, repo.allSets(), repo.exercises(), T0, repo.sessionUnits());
    const scoped = goalProgress(
      goal, repo.allSets().filter(s => s.exerciseId === goal.exerciseId),
      repo.exercises(), T0, repo.sessionUnits());
    assert.deepEqual(scoped, whole,
      'scoping the history to the goal\'s exercise changed the answer');
  });

  test('another exercise\'s sets cannot move this goal', () => {
    /*
     * The property the index depends on, stated as behaviour. A squat PR must
     * not shift a bench goal by a pound — if it did, the whole log would be
     * load-bearing and the index would be wrong.
     */
    const repo = withGoal();
    const before = new NowModel(repo, () => T0, 'en-US');
    before.selectExercise('bench');
    const remainingBefore = before.state().lastTime.tail;

    const id = 'extra';
    repo.startSession(id, 'lb');
    repo.logSet({ id: 'sq', sessionId: id, exerciseId: 'squat', weight: 500, reps: 5, at: T0 - 1000 });
    repo.endSession(id, T0);

    const after = new NowModel(repo, () => T0, 'en-US');
    after.selectExercise('bench');
    assert.equal(after.state().lastTime.tail, remainingBefore,
      'a 500 lb squat changed what the bench goal says');
  });

  test('the index refreshes when a set is logged', () => {
    /*
     * The staleness question every cache in this codebase has to answer. It is
     * keyed on `allSets()`'s identity, and `Repo` drops that memo on every
     * write — so logging must move the goal without anything else being told.
     */
    const repo = withGoal();
    const m = new NowModel(repo, () => T0, 'en-US');
    m.selectExercise('bench');
    const before = m.state().lastTime.tail;
    m.setWeight(245);
    m.log();
    assert.notEqual(m.state().lastTime.tail, before,
      'the goal line did not move after a set that closed the gap — the index is stale');
  });

  test('a lift with no sets at all is an empty bucket, not a crash', () => {
    /*
     * The missing-bucket path, and it took a plant to find that my first
     * version never reached it: I used `squat`, which HAS sets in this
     * fixture, so `get()` always returned something and dropping the `?? []`
     * changed nothing. An exercise never trained is the only case that
     * exercises it — and it is the case a new user is in for every lift but
     * one.
     */
    const repo = withGoal();
    // A goal ON the untrained lift, which is what actually reaches the lookup:
    // without a goal `goalHint` returns before `setsFor` is ever called, so my
    // first two attempts at this test could not fail however the index broke.
    repo.saveGoal({
      id: 'g2', exerciseId: 'ohp', targetWeight: 135, targetReps: 5,
      createdAt: T0 - 60 * DAY, targetDate: T0 + 30 * DAY, unit: 'lb'
    });
    assert.equal(repo.allSets().some(s => s.exerciseId === 'ohp'), false,
      'the fixture now has ohp sets, so this no longer tests an empty bucket');
    const m = new NowModel(repo, () => T0, 'en-US');
    m.selectExercise('ohp');
    assert.doesNotThrow(() => m.state(), 'an untrained lift crashes the screen');
    // It names the target rather than a gap, because there is nothing to
    // measure a gap FROM yet — the same rule `goalTag` follows on Progress.
    assert.match(m.state().lastTime.tail, /135/,
      'a goal on an untrained lift says nothing about itself');
  });
});

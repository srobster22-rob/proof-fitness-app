import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { recapFor } from '../src/ui/recap-model.ts';
import { coachSuggestion, callMade, type TrainingGoal } from '../src/domain/coach.ts';
import { t, fill } from '../src/domain/i18n.ts';
import type { LoggedSet } from '../src/domain/types.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 23, 18);

/*
 * R691, THE CALL SHEET, slice 1. A climb read only the weights: 200×5 then
 * 205×3 on SIZE was "205 and climbing — try 215", a raise on a set the lifter
 * had just failed (PT2 Broken 3, and R690's blind re-score saw it live). A
 * climb now needs the reps asked of it (the fewer of the session before's and
 * the goal's target); a miss is the same weight again, for those reps.
 */
const squats = (steps: Array<[number, number]>): LoggedSet[] => steps.map(([w, r], i) => ({
  id: `q${i}`, sessionId: `p${i}`, exerciseId: 'squat', weight: w, reps: r,
  at: T0 - (steps.length - i) * 3 * DAY
}));
const call = (sets: LoggedSet[], goal: TrainingGoal = 'size') =>
  coachSuggestion(sets, 'squat', T0, { unit: 'lb', goal, grid: 5 });

describe('a miss is not a rung (R691)', () => {
  test('reps falling at the new weight is a miss: the same weight again, for the reps asked of it', () => {
    const c = call(squats([[195, 5], [200, 5], [205, 3]]))!;
    assert.equal(c.key, 'coachMissed');
    assert.deepEqual([c.kind, c.weight, c.reps], ['hold', 205, 5]);
    assert.equal(fill(t('en', c.key as never), c.params), '205 again — make 5');
    assert.equal(fill(t('es', c.key as never), c.params), '205 otra vez — haz 5');
  });

  test('reps holding is still a climb', () => {
    const c = call(squats([[195, 5], [200, 5], [205, 5]]))!;
    assert.equal(c.key, 'coachClimbing');
    assert.equal(c.weight, 210);
  });

  test('fewer reps that still reach the goal target are a climb, not a miss (R691 review)', () => {
    // SIZE asks for 8: 185×10 then 190×8 made what was asked.
    assert.equal(call(squats([[180, 10], [185, 10], [190, 8]]))?.key, 'coachClimbing');
    // STRENGTH asks for 5: 225×6 then 235×5.
    assert.equal(call(squats([[215, 6], [225, 6], [235, 5]]), 'strength')?.key, 'coachClimbing');
    // Short of the target is still a miss, and asks for the target, not the higher reps before.
    const c = call(squats([[130, 15], [135, 15], [145, 5]]))!;
    assert.deepEqual([c.key, c.weight, c.reps], ['coachMissed', 145, 8]);
  });

  test('a call taken is never called a miss the next time', () => {
    // 100×10 for 3 sets, "try 105" (for 8), then 105×8 for 3 sets.
    const sets = [100, 100, 100].map((w, i) => ({ id: `a${i}`, sessionId: 'a', exerciseId: 'squat', weight: w, reps: 10, at: T0 - 6 * DAY + i * 60_000 }))
      .concat([105, 105, 105].map((w, i) => ({ id: `b${i}`, sessionId: 'b', exerciseId: 'squat', weight: w, reps: 8, at: T0 - 3 * DAY + i * 60_000 })));
    const c = call(sets)!;
    assert.notEqual(c.key, 'coachMissed', 'the made call became "105 again — make 10"');
    assert.equal(c.kind, 'increase');
  });

  test('the missed call is made at its weight with the reps, and not by adding more', () => {
    const c = call(squats([[195, 5], [200, 5], [205, 3]]))!;
    const set = (weight: number, reps: number): LoggedSet => ({ id: `${weight}x${reps}`, sessionId: 'now', exerciseId: 'squat', weight, reps, at: T0 });
    assert.equal(callMade(c, [set(205, 4)]), null);
    assert.equal(callMade(c, [set(210, 5)]), null, 'a heavier set made "205 again"');
    assert.equal(callMade(c, [set(205, 5)])?.reps, 5);
  });

  test('no goal raises after a miss', () => {
    for (const goal of ['size', 'strength', 'consistency'] as const) {
      const c = call(squats([[195, 5], [200, 5], [205, 3]]), goal);
      assert.ok(!c || c.kind !== 'increase', `${goal} raised after a miss: ${c?.key}`);
    }
  });
});

describe('what the lifter sees (R691)', () => {
  /** A squat history climbing to 200×5, then today's session with 200×5 and a missed 205×3. */
  function missedToday() {
    const clock = { now: T0 };
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => clock.now);
    for (const [i, w] of [[3, 190], [2, 195]] as const) {
      const at = T0 - i * 3 * DAY;
      repo.startSession(`p${i}`, 'lb', undefined, at);
      repo.logSet({ id: `p${i}a`, sessionId: `p${i}`, exerciseId: 'squat', weight: w, reps: 5, at });
      repo.endSession(`p${i}`, at + 3_600_000);
    }
    repo.startSession('today', 'lb', undefined, T0);
    repo.logSet({ id: 't1', sessionId: 'today', exerciseId: 'squat', weight: 200, reps: 5, at: T0 + 60_000 });
    repo.logSet({ id: 't2', sessionId: 'today', exerciseId: 'squat', weight: 205, reps: 3, at: T0 + 240_000 });
    repo.endSession('today', T0 + 3_600_000);
    return { repo, clock };
  }

  test('the recap does not promise a raise after a missed set', () => {
    const { repo } = missedToday();
    const next = recapFor(repo, 'today', T0 + 3_600_000)!.next;
    assert.deepEqual(next, [], `the recap said: ${JSON.stringify(next)}`);
  });

  test('the next workout opens on "205 again — make 5"', () => {
    const { repo, clock } = missedToday();
    clock.now = T0 + 3 * DAY;
    const m = new NowModel(repo, () => clock.now, 'en-US');
    m.selectExercise('squat');
    assert.equal(m.state().lastTime.head, '205 again — make 5');
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { recapFor } from '../src/ui/recap-model.ts';
import { coachSuggestion, type TrainingGoal } from '../src/domain/coach.ts';
import { t, fill } from '../src/domain/i18n.ts';
import type { LoggedSet } from '../src/domain/types.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 23, 18);

/*
 * R694. The coach read each session's TOP set, so a made first set hid every
 * miss after it. PT3's three lifters all logged a miss after a made set and
 * all three were told to add weight: row 160×8, ×6, ×5 → "try 165"; squat
 * 200×5, 200×3, 185×5 → "try 205"; squat 200×5, ×5, ×4 → "try 205". And the
 * line kept saying "160×8 — made it" above the 6 and the 5.
 *
 * A raise is now withheld when the latest session made the reps the raise
 * rests on at its top weight and then fell short there. The bar is what the
 * raise rests on, never the session's own best set (R694 review): 200×5 then
 * 200×6 is not a miss, and after a climbing, progress, plateau or all-sets
 * call taken as given, nothing the Now screen called "made it" is.
 */

/** Sessions 3 days apart, oldest first, each a list of [weight, reps] sets of `lift`; the coach's line after. */
function line(sessions: Array<Array<[number, number]>>, goal: TrainingGoal = 'size', lift = 'squat'): string {
  const sets: LoggedSet[] = sessions.flatMap((own, i) => own.map(([weight, reps], k) => ({
    id: `p${i}s${k}`, sessionId: `p${i}`, exerciseId: lift, weight, reps,
    at: T0 - (sessions.length - i) * 3 * DAY + k * 120_000
  })));
  const c = coachSuggestion(sets, lift, T0, { unit: 'lb', goal, grid: 5 });
  return c ? fill(t('en', c.key as never), c.params) : '(none)';
}
const x3 = (w: number, r: number): Array<[number, number]> => [[w, r], [w, r], [w, r]];

describe('no raise on top of a miss (R694)', () => {
  test('the veteran\'s row: 160×8, ×6, ×5 is "160 again — make 8", not "try 165"', () => {
    assert.equal(line([x3(155, 8), [[160, 8], [160, 6], [160, 5]]]), '160 again — make 8');
  });

  test('the struggling lifter\'s squat: 200×5, 200×3, then 185×5, is "200 again — make 5"', () => {
    assert.equal(line([x3(195, 5), [[200, 5], [200, 3], [185, 5]]]), '200 again — make 5');
  });

  test('the critic\'s squat: 200×5, ×5, ×4 is "200 again — make 5"', () => {
    assert.equal(line([x3(195, 5), [[200, 5], [200, 5], [200, 4]]]), '200 again — make 5');
  });

  test('a raise at the same weight rests on the target: 200×8, ×8, ×6 is a miss', () => {
    assert.equal(line([x3(200, 8), [[200, 8], [200, 8], [200, 6]]]), '200 again — make 8');
    // Even when the session before only managed 7: the raise says 8 was reached.
    assert.equal(line([[[200, 7]], [[200, 8], [200, 8], [200, 7]]]), '200 again — make 8');
  });

  test('a plateau is no excuse: stuck at 200 for 3 with the last set short is "make 8"', () => {
    assert.equal(line([x3(200, 8), x3(200, 8), [[200, 8], [200, 8], [200, 6]]]), '200 again — make 8');
    assert.match(line([x3(200, 8), x3(200, 8), x3(200, 8)]), /^Stuck at 200/);
  });

  test('R691 across sessions keeps its own bar with several sets: 200×8×3 then 205×5, ×3 is "make 8"', () => {
    assert.equal(line([x3(200, 8), [[205, 5], [205, 3]]]), '205 again — make 8');
    assert.equal(line([x3(200, 5), [[205, 4], [205, 3]]], 'strength'), '205 again — make 5');
  });
});

describe('what is not a miss (R694 review)', () => {
  test('reps that rise: 200×5 then 200×6 climbs', () => {
    assert.match(line([x3(195, 5), [[200, 5], [200, 6]]]), /try 205$/);
  });

  test('an AMRAP last set: 200×5, ×5, ×9 climbs', () => {
    assert.match(line([x3(195, 5), [[200, 5], [200, 5], [200, 9]]]), /try 205$/);
    assert.match(line([x3(195, 5), [[200, 5], [200, 5], [200, 9]]], 'strength'), /try 205$/);
  });

  test('a first set short of the bar, then one that makes it: 200×4, 200×5 climbs', () => {
    assert.match(line([x3(195, 5), [[200, 4], [200, 5]]]), /try 205$/);
  });

  test('reps past the goal\'s target: 200×10, ×9 on SIZE (8) climbs', () => {
    assert.match(line([x3(195, 10), [[200, 10], [200, 9]]]), /try 205$/);
  });

  test('a lighter set after the top sets is a back-off: the climb stands', () => {
    assert.match(line([x3(195, 5), [[200, 5], [200, 5], [160, 3]]]), /try 205$/);
  });

  test('a hold stays the hold it was: 200×6, then 200×7, ×6, ×6 is "add a rep"', () => {
    assert.equal(line([[[200, 6]], [[200, 7], [200, 6], [200, 6]]]), '200 last 2 — stay here and add a rep');
  });
});

/** Today's workout, live: squat climbing 195 → 200 for 5, so the call is "try 205" for 5. */
function climbing() {
  const clock = { now: T0 };
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => clock.now);
  for (const [i, w] of [[2, 195], [1, 200]] as const) {
    const at = T0 - i * 3 * DAY;
    repo.startSession(`p${i}`, 'lb', undefined, at);
    repo.logSet({ id: `p${i}a`, sessionId: `p${i}`, exerciseId: 'squat', weight: w, reps: 5, at });
    repo.endSession(`p${i}`, at + 3_600_000);
  }
  const m = new NowModel(repo, () => clock.now, 'en-US');
  m.selectExercise('squat');
  const set = (weight: number, reps: number) => {
    clock.now += 180_000; m.setWeight(weight); m.setReps(reps); m.log();
  };
  /** Finish, then the line three days later. */
  const nextTime = () => {
    m.finish();
    clock.now += 3 * DAY;
    const n = new NowModel(repo, () => clock.now, 'en-US');
    n.selectExercise('squat');
    return n.state().lastTime.head;
  };
  return { m, set, nextTime, repo };
}

describe('"made it" and the next call agree (R694)', () => {
  test('205×5 makes it; 205×3 after it ends it, the line goes back to the call, and next time is "205 again"', () => {
    const { m, set, nextTime } = climbing();
    set(205, 5);
    assert.equal(m.state().lastTime.head, '205×5 — made it');
    set(205, 3);
    assert.equal(m.state().lastTime.made, false);
    assert.match(m.state().lastTime.head, /try 205$/);
    assert.equal(nextTime(), '205 again — make 5');
  });

  test('205×6, 205×5 on "try 205" for 5: made it, and next time climbs', () => {
    const { m, set, nextTime } = climbing();
    set(205, 6);
    set(205, 5);
    assert.equal(m.state().lastTime.head, '205×6 — made it');
    assert.match(nextTime(), /try 210$/);
  });

  test('205×4, 205×5: made it on the second, and next time climbs', () => {
    const { m, set, nextTime } = climbing();
    set(205, 4);
    set(205, 5);
    assert.equal(m.state().lastTime.head, '205×5 — made it');
    assert.match(nextTime(), /try 210$/);
  });

  test('a back-off after the made set keeps it made (R682)', () => {
    const { m, set } = climbing();
    set(205, 5);
    set(185, 3);
    assert.equal(m.state().lastTime.head, '205×5 — made it');
  });

  test('a heavier try after the made set keeps it made: the call was 205', () => {
    const { m, set } = climbing();
    set(205, 5);
    set(215, 2);
    assert.equal(m.state().lastTime.head, '205×5 — made it');
  });
});

describe('the recap says what to do after a miss (R694)', () => {
  test('NEXT TIME names the miss, and the lift that made its call still gets its raise', () => {
    const clock = { now: T0 };
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => clock.now);
    const day = (id: string, at: number, sets: Array<[string, number, number]>) => {
      repo.startSession(id, 'lb', undefined, at);
      sets.forEach(([exerciseId, weight, reps], k) =>
        repo.logSet({ id: `${id}s${k}`, sessionId: id, exerciseId, weight, reps, at: at + (k + 1) * 120_000 }));
      repo.endSession(id, at + 3_600_000);
    };
    day('before', T0 - 3 * DAY, [['row', 155, 8], ['row', 155, 8], ['row', 155, 8], ['squat', 195, 5], ['squat', 195, 5]]);
    day('today', T0, [['row', 160, 8], ['row', 160, 6], ['row', 160, 5], ['squat', 200, 5], ['squat', 200, 5]]);
    const next = recapFor(repo, 'today', T0 + 3_600_000)!.next;
    assert.deepEqual(next.map(c => c.line), ['160 again — make 8', '200 and climbing, 2 sessions — try 205']);
  });
});

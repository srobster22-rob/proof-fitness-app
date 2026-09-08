import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findPRs, heaviestEver, bestSetAtReps } from '../src/domain/pr.ts';
import { buildRecap } from '../src/domain/session.ts';
import type { LoggedSet, Exercise, Session } from '../src/domain/types.ts';
import type { Measurement } from '../src/domain/measure.ts';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { progressRows } from '../src/ui/progress-model.ts';

const DAY = 86_400_000;
const T = Date.UTC(2026, 7, 22, 8);

const PULLUP = 'pullup';
const BENCH = 'bench';
const exercises = new Map<string, Exercise>([
  [PULLUP, { id: PULLUP, name: 'Pull-up' }],
  [BENCH, { id: BENCH, name: 'Bench Press' }]
]);

let n = 0;
const set = (
  sessionId: string, exerciseId: string, weight: number, reps: number, daysAgo = 0
): LoggedSet =>
  ({ id: `s${n++}`, sessionId, exerciseId, weight, reps, at: T - daysAgo * DAY });

/** Four prior sessions, enough to clear the cold-start guard. */
const before = (exerciseId: string, weight: number, reps: number) =>
  Array.from({ length: 4 }, (_, i) => set(`p${i}`, exerciseId, weight, reps, 30 - i * 5));

const weighed = (value: number, daysAgo: number, unit: 'lb' | 'kg' = 'lb'): Measurement =>
  ({ id: `w${daysAgo}${value}`, kind: 'bodyweight', value, unit, at: T - daysAgo * DAY });

/*
 * Two bugs, one cause: this module compared pull-ups by the weight ADDED to the
 * lifter, which is the smallest part of the load and sometimes none of it.
 */
describe('a pull-up is judged by what it moved', () => {
  /*
   * The one that had been silently true since R1. `e1rm(0, reps)` is 0 whatever
   * the reps, so `bestE1rm` was 0, so the e1RM branch hit its own
   * `bestPrior <= 0` guard and returned empty. Somebody going from 8 strict
   * pull-ups to 15 — about as visible as strength gains get — was told nothing,
   * and would have been told nothing for ever.
   */
  describe('a strict pull-up could never set a record at all', () => {
    const history = before(PULLUP, 0, 8);
    const today = [set('now', PULLUP, 0, 12)];
    const body = [weighed(185, 60)];

    test('and now it can', () => {
      const prs = findPRs(today, history, exercises, 'lb', body);
      assert.equal(prs.length, 1, '12 strict pull-ups beats a history of 8');
      assert.equal(prs[0].claim, 'Best pull-up set yet');
    });

    test('which is exactly what it could not do before', () => {
      assert.equal(findPRs(today, history, exercises, 'lb').length, 0,
        'documenting the bug: with nothing to add, 0 x 12 could not beat 0 x 8');
    });

    test('the record reports the real load beside the typed one', () => {
      const pr = findPRs(today, history, exercises, 'lb', body)[0];
      assert.equal(pr.weight, 0, 'still the number they typed');
      assert.equal(pr.realWeight, 185, 'and what it actually weighed');
    });
  });

  describe('weight added at an unchanged bodyweight is still a record', () => {
    test('the ordinary case, unchanged', () => {
      const prs = findPRs(
        [set('now', PULLUP, 25, 8)], before(PULLUP, 0, 8), exercises, 'lb', [weighed(185, 60)]);
      assert.equal(prs[0].claim, 'Heaviest 8-rep pull-up');
      assert.equal(prs[0].realWeight, 210);
    });
  });

  /*
   * The cry-wolf this fix would have introduced if it had stopped at "use real
   * load". `findPRs`' weight branch holds reps constant-or-better and lets
   * weight decide, so on a bodyweight movement the only way real load can rise
   * with the lifter doing nothing is the lifter getting heavier. A badge for
   * eating is the purest §8 violation available.
   */
  describe('a record cannot be bought by gaining weight', () => {
    const history = before(PULLUP, 0, 8);

    test('same set, twenty-five pounds heavier, no record', () => {
      const body = [weighed(185, 60), weighed(210, 1)];
      assert.equal(findPRs([set('now', PULLUP, 0, 8)], history, exercises, 'lb', body).length, 0);
    });

    test('but adding weight on top of it still is one', () => {
      const body = [weighed(185, 60), weighed(210, 1)];
      const prs = findPRs([set('now', PULLUP, 10, 8)], history, exercises, 'lb', body);
      assert.equal(prs.length, 1, 'they did something the scale did not do for them');
    });

    /*
     * The reps branch deliberately has no such guard: getting there means no
     * set in history ever reached this many reps, so the rep count is a best on
     * its own terms. Guarding it would re-break the case above, since added
     * weight is 0 on a strict pull-up and 0 can never beat 0.
     */
    test('more reps than ever still counts, whatever the scale says', () => {
      const body = [weighed(185, 60), weighed(210, 1)];
      const prs = findPRs([set('now', PULLUP, 0, 12)], history, exercises, 'lb', body);
      assert.equal(prs.length, 1);
    });
  });

  /*
   * The other direction, and the reason this is a rule rather than a bias
   * toward awarding. Losing fifteen pounds and hanging ten from a belt is a
   * lighter pull than the one they were already doing — the old code called it
   * "Heaviest 8-rep pull-up", which was false by five pounds.
   */
  test('and a claim that is not true is not made, even when the belt is heavier', () => {
    const history = before(PULLUP, 5, 8);
    const today = [set('now', PULLUP, 10, 8)];
    const body = [weighed(200, 60), weighed(185, 1)];
    assert.equal(findPRs(today, history, exercises, 'lb', body).length, 0,
      '185 + 10 is 195, and 195 is not heavier than the 205 they were already pulling');
    assert.equal(findPRs(today, history, exercises, 'lb')[0].claim,
      'Heaviest 8-rep pull-up',
      'documenting what it used to claim, five pounds short of true');
  });

  /*
   * Recording a bodyweight today does not retroactively weigh sets done before
   * it. The comparison would be 210 against a history the app cannot weigh, and
   * mixing the two scales inside one comparison is the whole bug — so it stays
   * quiet, and heals itself the moment there is a reading older than the
   * history it is judging.
   */
  test('a first-ever reading does not reach backwards', () => {
    const history = before(PULLUP, 0, 8);
    assert.equal(
      findPRs([set('now', PULLUP, 25, 8)], history, exercises, 'lb', [weighed(185, 0)]).length, 0);
    assert.equal(
      findPRs([set('now', PULLUP, 25, 8)], history, exercises, 'lb', [weighed(185, 60)]).length, 1,
      'a reading older than the history judges all of it');
  });
});

/*
 * Everything above must be invisible to the other eleven lifts in the library.
 */
describe('an ordinary lift is judged exactly as it was', () => {
  const history = before(BENCH, 225, 5);
  const today = [set('now', BENCH, 235, 5)];
  const body = [weighed(185, 60)];

  test('the same record, with or without a bodyweight on record', () => {
    const withBw = findPRs(today, history, exercises, 'lb', body);
    const without = findPRs(today, history, exercises, 'lb');
    assert.equal(withBw.length, 1);
    assert.deepEqual(
      withBw.map(p => [p.weight, p.previousWeight, p.claim]),
      without.map(p => [p.weight, p.previousWeight, p.claim]));
  });

  test('and never grows a real load', () => {
    assert.equal(findPRs(today, history, exercises, 'lb', body)[0].realWeight, null,
      'a barbell weighs what it weighs');
  });
});

/*
 * §16 — the numbers on the shareable have to be ones the lifter can check.
 * `gain` is `weight - previousWeight`, so if the award moved to real load and
 * those two fields did not move with it, a pull-up PR would have rendered
 * "PULL-UP -160 LB".
 */
describe('the record reports the numbers the lifter typed', () => {
  const session: Session = { id: 'now', startedAt: T, endedAt: T + 30 * 60_000, unit: 'lb', updatedAt: T };
  const history = before(PULLUP, 0, 8);
  const body = [weighed(185, 60)];

  function recap(weight: number, reps: number) {
    const sets = [set('now', PULLUP, weight, reps)];
    const prs = findPRs(sets, history, exercises, 'lb', body);
    return buildRecap({
      session, sets, exercises, prs, allSets: [...history, ...sets],
      now: T + 3600_000, measurements: body
    });
  }

  test('the gain is the belt, not the body', () => {
    const p = recap(25, 8);
    assert.equal(p.pr!.weight, 25, 'the number off the belt, which they can check');
    assert.equal(p.pr!.prev, 0, 'no comparable added weight before, so the sentinel');
    assert.equal(p.pr!.gain, null, 'and therefore no gain claimed, rather than +25 over nothing');
    assert.ok(p.pr!.heaviest, '210 is the most they have pulled');
  });

  test('a heavier belt over a lighter one reports the belt difference', () => {
    const withBelt = [...before(PULLUP, 5, 8)];
    const sets = [set('now', PULLUP, 25, 8)];
    const prs = findPRs(sets, withBelt, exercises, 'lb', body);
    const p = buildRecap({
      session, sets, exercises, prs, allSets: [...withBelt, ...sets],
      now: T + 3600_000, measurements: body
    });
    assert.equal(p.pr!.gain, 20, '25 on the belt against 5, not 210 against 190');
  });

  test('heaviest ever is decided on what was moved', () => {
    // A heavier belt at a much lighter bodyweight, long ago.
    const past = [...history, set('old', PULLUP, 40, 5, 45)];
    const measured = [weighed(150, 50), weighed(185, 20)];
    assert.equal(heaviestEver(past, PULLUP, measured, 'lb'), 190,
      '150 + 40 beats 185 + 0, and neither is 40');
  });
});

/*
 * The set a screen DISPLAYS, chosen the same way.
 */
describe('the best set on record is the one that moved the most', () => {
  test('a heavier bodyweight is not filed as a lighter set', () => {
    const sets = [
      set('a', PULLUP, 20, 8, 60),   // 150 + 20 = 170
      set('b', PULLUP, 0, 8, 5)      // 185 + 0  = 185
    ];
    const body = [weighed(150, 70), weighed(185, 10)];
    assert.equal(bestSetAtReps(sets, PULLUP, 5, body, 'lb')!.id, sets[1].id);
    assert.equal(bestSetAtReps(sets, PULLUP, 5)!.id, sets[0].id,
      'without a reading it can only rank by the belt');
  });
});

/*
 * A set is in its session's unit; a reading is in whatever the lifter stepped on
 * the scale in. Nothing makes those agree, and adding them as if they did
 * produced 84 + 25 = 109 "kg" — 240 lb, off by fifty.
 */
describe('two units, one number', () => {
  test('a kilo bodyweight against a pound session', async () => {
    const { realLoad } = await import('../src/domain/measure.ts');
    const r = realLoad({ exerciseId: PULLUP, weight: 25, at: T }, [weighed(84, 1, 'kg')], 'lb');
    assert.equal(r!.unit, 'lb');
    assert.equal(r!.load, 210.2, '84 kg is 185.2 lb, plus the 25 on the belt');
  });

  test('and the reading’s own unit is still the default', async () => {
    const { realLoad } = await import('../src/domain/measure.ts');
    const r = realLoad({ exerciseId: PULLUP, weight: 10, at: T }, [weighed(84, 1, 'kg')]);
    assert.deepEqual(r, { load: 94, unit: 'kg' });
  });
});

/*
 * Two more places the same zero was hiding, both feeding the Progress row: the
 * per-session top set the sparkline is plotted from, and the change column.
 */
describe('the Progress row is drawn from what was moved', () => {
  function pulled(bodyweights: Array<[number, number]>) {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    // Four sessions of the same strict set, at four different bodyweights.
    bodyweights.forEach(([value, daysAgo], i) => {
      repo.saveMeasurement({
        id: `w${i}`, kind: 'bodyweight', value, unit: 'lb', at: T - (daysAgo + 1) * DAY });
      repo.startSession(`s${i}`, 'lb');
      repo.logSet({
        id: `x${i}`, sessionId: `s${i}`, exerciseId: PULLUP,
        weight: 0, reps: 8, at: T - daysAgo * DAY });
      repo.endSession(`s${i}`, T - daysAgo * DAY + 60_000);
    });
    return repo;
  }

  const gained: Array<[number, number]> = [[160, 90], [170, 60], [180, 30], [185, 1]];

  test('the change column reports the twenty-five pounds they actually gained on the bar',
    () => {
      const row = progressRows(pulled(gained), T).find(r => r.exerciseId === PULLUP)!;
      assert.equal(row.trend, 25, 'same set, same reps, twenty-five more pounds pulled');
    });

  test('and reported nothing at all before', () => {
    const repo = pulled(gained);
    // The old answer is what you get with no readings to work from.
    const bare = new Repo(new DatabaseSync(':memory:') as any, () => T);
    for (const s of repo.allSets()) {
      if (!bare.session(s.sessionId)) {
        bare.startSession(s.sessionId, 'lb');
        bare.endSession(s.sessionId, s.at + 60_000);
      }
      bare.logSet(s);
    }
    assert.equal(progressRows(bare, T).find(r => r.exerciseId === PULLUP)!.trend, 0,
      'documenting the bug: the belt never changed, so nothing did');
  });

  test('the session top set is the heaviest one, not the first one', () => {
    const repo = pulled(gained);
    repo.startSession('extra', 'lb');
    repo.logSet({ id: 'e1', sessionId: 'extra', exerciseId: PULLUP, weight: 0, reps: 8, at: T });
    repo.logSet({ id: 'e2', sessionId: 'extra', exerciseId: PULLUP, weight: 45, reps: 8, at: T + 60_000 });
    repo.endSession('extra', T + 120_000);
    const row = progressRows(repo, T + 300_000).find(r => r.exerciseId === PULLUP)!;
    assert.equal(row.best, 45, 'e1rm(0, 8) equals e1rm(0, 8), so this used to be a coin toss');
    assert.equal(row.realBest, 230);
  });
});

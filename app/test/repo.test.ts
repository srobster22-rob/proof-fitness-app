import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { BUILTIN, prefillFor } from '../src/domain/coldstart.ts';
import { findPRs } from '../src/domain/pr.ts';
import { buildRecap, autoEnd, isStale } from '../src/domain/session.ts';
import type { LoggedSet } from '../src/domain/types.ts';

const MIN = 60_000, DAY = 86_400_000;
const T0 = Date.UTC(2026, 6, 29, 18);

function fresh(now = () => T0) {
  return new Repo(new DatabaseSync(':memory:') as any, now);
}

let uid = 0;
const setIn = (sessionId: string, exerciseId: string, weight: number, reps: number, at: number): LoggedSet =>
  ({ id: `x${uid++}`, sessionId, exerciseId, weight, reps, at });

describe('persistence', () => {
  test('migrates from empty and seeds the starting twelve', () => {
    const repo = fresh();
    const ex = repo.exercises();
    assert.equal(ex.size, BUILTIN.length);
    assert.equal(ex.get('bench')!.name, 'Bench Press');
  });

  test('migrating twice is a no-op, not a duplicate', () => {
    const repo = fresh();
    repo.migrate(); repo.migrate();
    assert.equal(repo.exercises().size, BUILTIN.length);
  });

  test('round-trips a session and its sets', () => {
    const repo = fresh();
    const session = repo.startSession('s1', 'lb', 'PUSH DAY');
    assert.equal(session.endedAt, null);
    repo.logSet(setIn('s1', 'bench', 225, 5, T0 - 20 * MIN));
    repo.logSet(setIn('s1', 'ohp', 135, 6, T0 - 10 * MIN));

    const sets = repo.setsInSession('s1');
    assert.equal(sets.length, 2);
    assert.equal(sets[0].exerciseId, 'bench', 'ordered by time');
    assert.equal(sets[0].weight, 225);
  });

  test('finds the live session and closes it', () => {
    const repo = fresh();
    repo.startSession('s1', 'lb');
    assert.equal(repo.liveSession()!.id, 's1');
    repo.endSession('s1', T0);
    assert.equal(repo.liveSession(), null);
    assert.equal(repo.session('s1')!.endedAt, T0);
  });

  test('lastSetOf drives the prefill — the hottest read in the app', () => {
    const repo = fresh();
    repo.startSession('old', 'lb');
    repo.logSet(setIn('old', 'bench', 205, 5, T0 - 14 * DAY));
    repo.logSet(setIn('old', 'bench', 215, 5, T0 - 7 * DAY));

    assert.equal(repo.lastSetOf('bench')!.weight, 215, 'most recent, not heaviest');
    assert.equal(repo.lastSetOf('squat'), null);

    const p = prefillFor('bench', repo.allSets(), 'lb');
    assert.equal(p.weight, 215);
    assert.equal(p.source, 'history');
  });

  test('a deleted set leaves a tombstone and vanishes from reads', () => {
    const repo = fresh();
    repo.startSession('s1', 'lb');
    const s = setIn('s1', 'bench', 225, 5, T0 - 5 * MIN);
    repo.logSet(s);
    assert.equal(repo.setsInSession('s1').length, 1);
    repo.deleteSet(s.id);
    assert.equal(repo.setsInSession('s1').length, 0);
    assert.equal(repo.allSets().length, 0);
  });

  test('historyBefore excludes the session itself, so a set cannot beat itself', () => {
    const repo = fresh();
    repo.startSession('old', 'lb');
    repo.logSet(setIn('old', 'bench', 215, 5, T0 - 7 * DAY));
    repo.startSession('now', 'lb');
    repo.logSet(setIn('now', 'bench', 225, 5, T0 - 20 * MIN));
    repo.logSet(setIn('now', 'bench', 230, 5, T0 - 10 * MIN));

    const before = repo.historyBefore('now');
    assert.equal(before.length, 1);
    assert.equal(before[0].weight, 215);
  });

  test('custom exercises coexist with the built-ins', () => {
    const repo = fresh();
    repo.addExercise('gm', 'Good Morning');
    assert.equal(repo.exercises().get('gm')!.name, 'Good Morning');
    assert.equal(repo.exercises().size, BUILTIN.length + 1);
  });

  /*
   * §16: adding a custom exercise has always existed; removing one never did,
   * so a typo stayed in the picker forever. `removeExercise` only undoes a
   * genuine mistake — untouched, user-created, nothing logged against it —
   * and refuses everything else rather than risk orphaning real history.
   */
  test('a fresh custom exercise, never logged against, can be removed', () => {
    const repo = fresh();
    repo.addExercise('gm', 'Good Morning');
    assert.equal(repo.removeExercise('gm'), true);
    assert.equal(repo.exercises().has('gm'), false);
  });

  test('a built-in cannot be removed', () => {
    const repo = fresh();
    assert.equal(repo.removeExercise('bench'), false);
    assert.equal(repo.exercises().has('bench'), true);
  });

  test('a custom exercise with a set logged against it is refused, even if that set was undone', () => {
    const repo = fresh();
    repo.addExercise('gm', 'Good Morning');
    repo.startSession('s1', 'lb');
    const s = setIn('s1', 'gm', 95, 5, T0);
    repo.logSet(s);
    assert.equal(repo.removeExercise('gm'), false, 'a real set exists — refuse');

    repo.deleteSet(s.id);
    assert.equal(repo.removeExercise('gm'), false,
      'undone, not erased — the row still points at this exercise, so it must still refuse');
    assert.equal(repo.exercises().has('gm'), true);
  });

  test('an unknown id is refused, not thrown on', () => {
    const repo = fresh();
    assert.equal(repo.removeExercise('nonexistent'), false);
  });

  test('weight is stored in the entered unit, not normalised', () => {
    // 102.5 kg normalised through pounds does not come back 102.5, and a lifter
    // whose own numbers drift stops trusting the app.
    const repo = fresh();
    repo.startSession('s1', 'kg');
    repo.logSet(setIn('s1', 'bench', 102.5, 3, T0 - 5 * MIN));
    assert.equal(repo.setsInSession('s1')[0].weight, 102.5);
    assert.equal(repo.session('s1')!.unit, 'kg');
  });
});

describe('persistence + domain, end to end', () => {
  test('twelve weeks of stored training produces a correct recap', () => {
    let clock = T0;
    const repo = fresh(() => clock);

    for (let w = 12; w >= 1; w--) {
      const at = T0 - w * 7 * DAY;
      clock = at;
      repo.startSession(`h${w}`, 'lb', 'PUSH DAY');
      repo.logSet(setIn(`h${w}`, 'bench', 200 + Math.floor((12 - w) / 3) * 5, 5, at));
      repo.logSet(setIn(`h${w}`, 'ohp', 130, 6, at + 20 * MIN));
      repo.endSession(`h${w}`, at + 45 * MIN);
    }

    clock = T0;
    const startedAt = T0 - 50 * MIN;
    repo.startSession('today', 'lb', 'PUSH DAY');
    repo.logSet(setIn('today', 'bench', 135, 8, startedAt + 5 * MIN));   // warm-up
    repo.logSet(setIn('today', 'bench', 225, 5, startedAt + 20 * MIN));  // the PR
    repo.logSet(setIn('today', 'ohp', 135, 6, startedAt + 40 * MIN));

    const live = repo.liveSession()!;
    const sets = repo.setsInSession(live.id);
    const history = repo.historyBefore(live.id);
    const exercises = repo.exercises();
    const prs = findPRs(sets, history, exercises);

    const payload = buildRecap({
      session: { ...live, endedAt: T0 }, sets, exercises, prs,
      allSets: repo.allSets(), now: T0, title: 'PUSH DAY'
    });

    assert.equal(payload.sets, 3);
    assert.equal(payload.volume, 135 * 8 + 225 * 5 + 135 * 6);
    assert.ok(payload.pr, 'beating a 215x5 history is a PR');
    assert.equal(payload.pr!.lift, 'Bench Press',
      'the payload carries the real name; the card shouts it, the share message does not');
    assert.equal(payload.pr!.prev, 215);
    assert.equal(payload.lifts.filter(l => l[2]).length, 1, 'only the headline is badged');
    assert.ok(payload.streak >= 12, `stored 12 weeks, streak read ${payload.streak}`);
  });

  test('a session abandoned mid-workout auto-ends on next launch', () => {
    let clock = T0;
    const repo = fresh(() => clock);
    const startedAt = T0 - 5 * DAY;
    // The clock moves to when the session actually started, so its own
    // `started_at`/`updated_at` land 5 days ago too — otherwise `startSession`
    // stamps both from `this.now()` and the session reads as touched TODAY
    // while its only set is from 5 days back, the exact inconsistent fixture
    // shape R333's own idle-rule fix (`lastTouch`) was built to see through.
    clock = startedAt;
    repo.startSession('stale', 'lb');
    repo.logSet(setIn('stale', 'bench', 225, 5, startedAt + 10 * MIN));
    clock = T0;

    const live = repo.liveSession()!;
    const sets = repo.setsInSession(live.id);
    assert.equal(isStale(live, sets, T0), true);

    const closed = autoEnd(live, sets, T0);
    repo.endSession(closed.id, closed.endedAt!);
    assert.equal(repo.liveSession(), null);
    assert.equal(repo.session('stale')!.endedAt, startedAt + 10 * MIN,
      'backdated to the last set, not to now');
  });
});

describe('erasing everything (§11)', () => {
  test('it takes every set, session and goal', () => {
    const repo = fresh();
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'a', sessionId: 's1', exerciseId: 'bench', weight: 225, reps: 5, at: T0 });
    repo.logSet({ id: 'b', sessionId: 's1', exerciseId: 'bench', weight: 235, reps: 5, at: T0 + 1000 });
    repo.endSession('s1', T0 + 60_000);
    repo.saveGoal({
      id: 'g1', exerciseId: 'bench', targetWeight: 315, targetReps: 5,
      createdAt: T0, targetDate: T0 + 90 * 86_400_000, unit: 'lb'
    } as never);

    repo.eraseAll();

    assert.equal(repo.allSets().length, 0);
    assert.equal(repo.goals().length, 0);
    assert.equal(repo.session('s1'), null, 'the session row is gone, not just its sets');
    assert.equal(repo.liveSession(), null);
  });

  /*
   * A HARD delete, unlike every other write. Leaving 1,680 rows marked
   * `deleted = 1` and calling that erased would be a lie told for a sync
   * feature that does not exist yet.
   */
  test('the rows are actually gone, not tombstoned', () => {
    const repo = fresh();
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'a', sessionId: 's1', exerciseId: 'bench', weight: 225, reps: 5, at: T0 });
    repo.eraseAll();
    assert.equal(repo.knownSetIds().size, 0, 'knownSetIds sees soft-deleted rows too');
  });

  // Library, not user data — without them the next launch has nothing to offer.
  test('the built-in movements come back, so the app still works', () => {
    const repo = fresh();
    repo.addExercise('hack_squat', 'Hack Squat');
    repo.eraseAll();
    const left = repo.exercises();
    assert.ok(left.size >= 12, 'the starting twelve are re-seeded');
    assert.equal(left.has('hack_squat'), false, 'but a movement the user invented is user data');
    assert.ok(left.has('bench'), 'and a real one is there to log against');
  });

  test('the app is usable immediately afterwards', () => {
    const repo = fresh();
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'a', sessionId: 's1', exerciseId: 'bench', weight: 225, reps: 5, at: T0 });
    repo.eraseAll();
    repo.startSession('s2', 'lb');
    repo.logSet({ id: 'b', sessionId: 's2', exerciseId: 'bench', weight: 135, reps: 5, at: T0 + 1000 });
    assert.equal(repo.allSets().length, 1, 'a fresh set logs against a re-seeded exercise');
  });

  test('erasing an empty database is harmless', () => {
    const repo = fresh();
    repo.eraseAll();
    repo.eraseAll();
    assert.equal(repo.allSets().length, 0);
    assert.ok(repo.exercises().size >= 12);
  });
});

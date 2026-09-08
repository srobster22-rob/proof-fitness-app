import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { SCHEMA, MIGRATIONS, SCHEMA_VERSION } from '../src/data/schema.ts';
import { headlineGoal, narrativeLine, type Goal } from '../src/domain/goals.ts';
import { buildRecap } from '../src/domain/session.ts';
import type { LoggedSet } from '../src/domain/types.ts';
import { MAX_GOALS } from '../src/domain/goals.ts';

/** Real built-in ids — goals carry a foreign key to the exercise table. */
/**
 * MAX_GOALS distinct exercises, invented as needed.
 *
 * The cap is a hundred and the seeded library is twenty-eight, so filling it
 * takes more movements than the app ships with. That is not a contrivance:
 * one goal per exercise is enforced, so the only way a real user reaches the
 * cap is by inventing lifts, and this is what that looks like.
 */
function capSlate(repo: Repo): string[] {
  const ids: string[] = [];
  for (let n = 0; n < MAX_GOALS; n++) {
    const id = `lift${n}`;
    repo.addExercise(id, `Lift ${n}`);
    ids.push(id);
  }
  return ids;
}

const DAY = 86_400_000, MIN = 60_000;
const T0 = Date.UTC(2026, 6, 29, 18);

const fresh = () => new Repo(new DatabaseSync(':memory:') as any, () => T0);

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g1', exerciseId: 'squat', targetWeight: 315, targetReps: 5,
  targetDate: T0 + 90 * DAY, unit: 'lb', createdAt: T0 - 30 * DAY, ...over
});

describe('goals persistence', () => {
  test('round-trips every field, including the load-bearing created_at', () => {
    const repo = fresh();
    repo.saveGoal(goal());
    const back = repo.goals();
    assert.equal(back.length, 1);
    assert.deepEqual(back[0], goal());
  });

  test('the goal cap is enforced at the write, not just in the UI', () => {
    const repo = fresh();
    const slate = capSlate(repo);
    slate.forEach((ex, n) => repo.saveGoal(goal({ id: `g${n}`, exerciseId: ex })));
    assert.throws(() => repo.saveGoal(goal({ id: 'over', exerciseId: 'row' })),
      new RegExp(`caps this at ${MAX_GOALS}`));
    assert.equal(repo.goals().length, MAX_GOALS);
  });

  test('updating an existing goal is not blocked by the cap', () => {
    const repo = fresh();
    const slate = capSlate(repo);
    slate.forEach((ex, n) => repo.saveGoal(goal({ id: `g${n}`, exerciseId: ex })));
    repo.saveGoal(goal({ id: 'g0', exerciseId: slate[0], targetWeight: 325 }));
    assert.equal(repo.goals().find(g => g.id === 'g0')!.targetWeight, 325);
    assert.equal(repo.goals().length, MAX_GOALS);
  });

  test('deleting leaves a tombstone and frees a slot', () => {
    const repo = fresh();
    repo.saveGoal(goal({ id: 'a', exerciseId: 'squat' }));
    repo.deleteGoal('a');
    assert.equal(repo.goals().length, 0);
    repo.saveGoal(goal({ id: 'b', exerciseId: 'bench' }));
    assert.equal(repo.goals().length, 1);
  });
});

describe('migration to version 2', () => {
  test('an existing v1 database gains goals without losing data', () => {
    const raw = new DatabaseSync(':memory:');
    // Stand up a v1 install exactly as it would exist on someone's phone.
    raw.exec(SCHEMA);
    raw.exec("INSERT INTO meta (key, value) VALUES ('schema_version', '1')");
    raw.exec("INSERT INTO exercises (id, name, builtin, updated_at) VALUES ('squat','Squat',1,1)");
    raw.exec("INSERT INTO sessions (id, started_at, ended_at, unit, updated_at) VALUES ('s1',1,2,'lb',1)");
    raw.exec("INSERT INTO sets (id, session_id, exercise_id, weight, reps, at, updated_at) " +
             "VALUES ('x1','s1','squat',275,5,1,1)");

    const repo = new Repo(raw as any, () => T0);   // migrates on construct
    assert.equal(repo.allSets().length, 1, 'existing training survived');
    assert.equal(repo.allSets()[0].weight, 275);
    repo.saveGoal(goal());
    assert.equal(repo.goals().length, 1, 'and the new table works');

    const v = raw.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as any;
    assert.equal(Number(v.value), SCHEMA_VERSION);
  });

  test('migrations are append-only — index 0 is still the v1 schema', () => {
    assert.equal(MIGRATIONS[0], SCHEMA);
    assert.equal(MIGRATIONS.length, SCHEMA_VERSION);
  });

  test('migrating repeatedly is idempotent', () => {
    const repo = fresh();
    repo.saveGoal(goal());
    repo.migrate(); repo.migrate();
    assert.equal(repo.goals().length, 1);
  });
});

describe('stored goals reach the recap', () => {
  test('a persisted goal produces the narrative line on the shareable', () => {
    const repo = fresh();
    repo.saveGoal(goal());

    let i = 0;
    const mk = (w: number, at: number, sid: string): LoggedSet =>
      ({ id: `x${i++}`, sessionId: sid, exerciseId: 'squat', weight: w, reps: 5, at });

    repo.startSession('old', 'lb');
    repo.logSet(mk(275, T0 - 40 * DAY, 'old'));
    repo.endSession('old', T0 - 40 * DAY);
    repo.startSession('now', 'lb');
    repo.logSet(mk(285, T0 - 20 * MIN, 'now'));

    const exercises = repo.exercises();
    const h = headlineGoal(repo.goals(), repo.allSets(), exercises, T0);
    const payload = buildRecap({
      session: { ...repo.session('now')!, endedAt: T0 },
      sets: repo.setsInSession('now'), exercises, prs: [],
      allSets: repo.allSets(), now: T0,
      goalLine: h && narrativeLine(h)
    });

    assert.equal(payload.goalLine, '30 lb from a 315 squat');
  });
});

/*
 * `goals()` is memoised now, for the same reason `allSets()` is and at a worse
 * cadence: the Now screen reads the goal on the lift being trained inside
 * `state()`, and during rest that runs once a SECOND for the whole timer.
 *
 * The risk a cache brings is staleness, so every one of these is a write
 * followed by a read.
 */
describe('the memoised goal list cannot go stale', () => {
  test('a new goal is visible immediately', () => {
    const repo = fresh();
    assert.deepEqual(repo.goals(), []);
    repo.saveGoal(goal({ id: 'a', exerciseId: 'squat' }));
    assert.equal(repo.goals().length, 1, 'the empty read was cached and never dropped');
  });

  test('an updated goal reads back updated', () => {
    const repo = fresh();
    repo.saveGoal(goal({ id: 'a', exerciseId: 'squat', targetWeight: 315 }));
    repo.goals();
    repo.saveGoal(goal({ id: 'a', exerciseId: 'squat', targetWeight: 405 }));
    assert.equal(repo.goals()[0].targetWeight, 405);
  });

  test('a deleted goal is gone on the next read', () => {
    const repo = fresh();
    repo.saveGoal(goal({ id: 'a', exerciseId: 'squat' }));
    repo.goals();
    repo.deleteGoal('a');
    assert.deepEqual(repo.goals(), []);
  });

  test('erasing everything erases this too', () => {
    const repo = fresh();
    repo.saveGoal(goal({ id: 'a', exerciseId: 'squat' }));
    repo.goals();
    repo.eraseAll();
    assert.deepEqual(repo.goals(), []);
  });

  test('the array is frozen, so one screen cannot reorder what another is reading', () => {
    const repo = fresh();
    repo.saveGoal(goal({ id: 'a', exerciseId: 'squat' }));
    assert.throws(() => (repo.goals() as Goal[]).push(goal({ id: 'b', exerciseId: 'bench' })));
  });

  test('and the second read is the same array, not a fresh query', () => {
    const repo = fresh();
    repo.saveGoal(goal({ id: 'a', exerciseId: 'squat' }));
    assert.equal(repo.goals(), repo.goals(), 'nothing is being cached at all');
  });
});

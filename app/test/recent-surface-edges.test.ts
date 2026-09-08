import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel, RAIL_MAX } from '../src/ui/now-model.ts';
import { progressRows, hiddenRowCount } from '../src/ui/progress-model.ts';
import { headlineGoal } from '../src/domain/goals.ts';
import type { Goal } from '../src/domain/goals.ts';
import type { LoggedSet, Exercise } from '../src/domain/types.ts';

const DAY = 86_400_000, MIN = 60_000;
const T0 = Date.UTC(2026, 6, 29, 18);

function model() {
  const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
  return { repo, m: new NowModel(repo, () => T0, 'en-US') };
}

/**
 * Edge cases in the surface added between R58 and R69 — the day rail, the
 * equipment memory, the Progress cap and the recap headline. All of it was
 * verified on the happy path by walking the app; none of it had been pushed at
 * the boundaries.
 */
describe('the day rail under pressure', () => {
  test('switching plan mid-workout re-scopes the rail', () => {
    const { m } = model();
    m.setPlan('ppl');
    m.setDay('push');
    m.log();
    assert.ok(m.state().dayRail.some(r => r.name === 'Chest Fly'));
    m.setPlan('full');
    const rail = m.state().dayRail;
    assert.ok(rail.length > 0, 'changing plan emptied the rail');
    assert.ok(rail.length <= RAIL_MAX + 4,
      `a full-body plan put ${rail.length} movements on the logging path`);
  });

  test('a lift trained twice appears once', () => {
    const { m } = model();
    m.setPlan('ppl');
    m.setDay('push');
    m.log();
    m.log();
    const ids = m.state().dayRail.map(r => r.id);
    assert.equal(new Set(ids).size, ids.length, 'a lift is on the rail twice');
  });

  test('exactly one chip is current, and at most one is suggested', () => {
    const { m } = model();
    m.setPlan('ppl');
    m.setDay('push');
    m.log();
    const rail = m.state().dayRail;
    assert.equal(rail.filter(r => r.current).length, 1);
    assert.ok(rail.filter(r => r.suggested).length <= 1);
  });

  test('the suggested chip is never one already trained', () => {
    const { m } = model();
    m.setPlan('ppl');
    m.setDay('push');
    m.log();
    const s = m.state().dayRail.find(r => r.suggested);
    if (s) assert.equal(s.done, false, 'the app suggested a lift you already did');
  });

  test('with every day-lift trained there is simply no suggestion', () => {
    const { m } = model();
    m.setPlan('ppl');
    m.setDay('push');
    // Train everything the rail offers.
    for (const r of [...m.state().dayRail]) { m.selectExercise(r.id); m.log(); }
    const rail = m.state().dayRail;
    assert.ok(rail.every(r => r.done || r.current));
    assert.equal(rail.filter(r => r.suggested).length, 0,
      'nothing is left to suggest, so nothing should be tagged');
  });
});

describe('the equipment memory under pressure', () => {
  test('an exercise id that looks like a pref key does not collide', () => {
    const { repo, m } = model();
    repo.addExercise('kit.bench', 'Odd Name');
    m.selectExercise('kit.bench');
    m.setEquipment('machine', 'Arsenal');
    m.selectExercise('bench');
    assert.equal(m.state().equipment, null,
      'a custom id collided with another lift\'s stored equipment');
  });

  test('a machine name of only spaces is not a machine name', () => {
    const { m } = model();
    m.selectExercise('bench');
    m.setEquipment('machine', '   ');
    assert.equal(m.state().machine, null);
    assert.equal(m.state().equipment, 'machine', 'the kit itself is still a real answer');
  });

  test('a machine name containing the separator survives', () => {
    // The pref is stored as `kit:machine`, so a colon in the name must not
    // truncate it.
    const { m } = model();
    m.selectExercise('lateral');
    m.setEquipment('machine', 'Arsenal: Row 2');
    m.selectExercise('bench');
    m.selectExercise('lateral');
    assert.equal(m.state().machine, 'Arsenal: Row 2');
  });

  test('switching away from machine forgets the machine, not the lift', () => {
    const { m } = model();
    m.selectExercise('lateral');
    m.setEquipment('machine', 'Arsenal');
    m.setEquipment('dumbbell');
    m.selectExercise('bench');
    m.selectExercise('lateral');
    assert.equal(m.state().equipment, 'dumbbell');
    assert.equal(m.state().machine, null);
  });
});

describe('the Progress cap under pressure', () => {
  const seeded = () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    let i = 0;
    for (const [k, id] of ['bench', 'squat', 'deadlift', 'ohp', 'row',
                           'pulldown', 'dbpress', 'dbrow', 'legpress', 'curl'].entries()) {
      const at = T0 - (10 - k) * DAY, sid = 's' + id;
      repo.startSession(sid, 'lb', undefined, at);
      repo.logSet({ id: 'x' + i++, sessionId: sid, exerciseId: id, weight: 100 + k, reps: 5, at });
      repo.endSession(sid, at + 40 * MIN);
    }
    return repo;
  };

  test('a goal on an achieved lift still keeps its seat', () => {
    const repo = seeded();
    repo.saveGoal({ id: 'g', exerciseId: 'bench', targetWeight: 50, targetReps: 5,
      createdAt: T0 - 30 * DAY, targetDate: T0 + 30 * DAY, unit: 'lb' } as Goal);
    const row = progressRows(repo, T0).find(r => r.exerciseId === 'bench');
    assert.ok(row, 'the lift fell off despite carrying a goal');
    assert.equal(row!.goal!.achieved, true);
    assert.equal(row!.goal!.remaining, 0, 'a met goal has nothing left to find');
  });

  test('the hidden count never goes negative', () => {
    const repo = seeded();
    for (const id of ['bench', 'squat', 'deadlift']) {
      repo.saveGoal({ id: 'g' + id, exerciseId: id, targetWeight: 400, targetReps: 5,
        createdAt: T0 - 30 * DAY, targetDate: T0 + 30 * DAY, unit: 'lb' } as Goal);
    }
    assert.ok(hiddenRowCount(repo, T0) >= 0);
  });

  test('shown + hidden accounts for every trained lift, exactly once', () => {
    const repo = seeded();
    repo.saveGoal({ id: 'g', exerciseId: 'bench', targetWeight: 400, targetReps: 5,
      createdAt: T0 - 30 * DAY, targetDate: T0 + 30 * DAY, unit: 'lb' } as Goal);
    const rows = progressRows(repo, T0);
    assert.equal(new Set(rows.map(r => r.exerciseId)).size, rows.length, 'a lift is listed twice');
    assert.equal(rows.length + hiddenRowCount(repo, T0), 10);
  });
});

describe('the recap headline under pressure', () => {
  const EX = new Map<string, Exercise>([['bench', { id: 'bench', name: 'Bench Press' }]]);
  const set = (ex: string, weight: number, at: number): LoggedSet =>
    ({ id: `${ex}${weight}${at}`, sessionId: 's', exerciseId: ex, weight, reps: 5, at }) as LoggedSet;
  const goal = (ex: string, target: number): Goal => ({
    id: 'g_' + ex, exerciseId: ex, targetWeight: target, targetReps: 5,
    createdAt: T0 - 60 * DAY, targetDate: T0 + 60 * DAY, unit: 'lb'
  } as Goal);

  test('an empty trained list behaves like no session context', () => {
    // A session with sets but none matching a goal must not crash or invent.
    const history = [set('bench', 190, T0 - 7 * DAY), set('bench', 200, T0 + MIN)];
    const head = headlineGoal([goal('bench', 225)], history, EX, T0 + 3600_000, new Map(), T0, []);
    assert.ok(head, 'an empty preference list should not suppress every goal');
  });

  test('a duplicate id in the trained list changes nothing', () => {
    const history = [set('bench', 190, T0 - 7 * DAY), set('bench', 200, T0 + MIN)];
    const a = headlineGoal([goal('bench', 225)], history, EX, T0 + 3600_000, new Map(), T0, ['bench']);
    const b = headlineGoal([goal('bench', 225)], history, EX, T0 + 3600_000, new Map(), T0, ['bench', 'bench']);
    assert.deepEqual(a?.goal.id, b?.goal.id);
  });

  test('no goals at all is null, not a throw', () => {
    assert.equal(headlineGoal([], [set('bench', 200, T0)], EX, T0, new Map(), T0, ['bench']), null);
  });
});

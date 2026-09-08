import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { SCHEMA_VERSION } from '../src/data/schema.ts';
import type { Measurement } from '../src/domain/measure.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 7, 22, 8);
const fresh = () => new Repo(new DatabaseSync(':memory:') as any, () => T0);

const reading = (over: Partial<Measurement> = {}): Measurement => ({
  id: 'm1', kind: 'bodyweight', value: 185, unit: 'lb', at: T0, ...over
});

describe('measurements persist like everything else', () => {
  test('the schema knows about them', () => {
    assert.ok(SCHEMA_VERSION >= 5, 'measurements arrived in v5');
    // The real check: a fresh database can hold one.
    const repo = fresh();
    repo.saveMeasurement(reading());
    assert.equal(repo.measurements().length, 1);
  });

  test('every field round-trips', () => {
    const repo = fresh();
    const m = reading({ note: 'morning, empty' });
    repo.saveMeasurement(m);
    assert.deepEqual(repo.measurements()[0], m);
  });

  /*
   * Ordered oldest-first because everything that consumes it — trends, "what
   * did I weigh then" — reads forwards through time.
   */
  test('they come back oldest first, whatever order they went in', () => {
    const repo = fresh();
    repo.saveMeasurement(reading({ id: 'c', at: T0 }));
    repo.saveMeasurement(reading({ id: 'a', at: T0 - 30 * DAY }));
    repo.saveMeasurement(reading({ id: 'b', at: T0 - 10 * DAY }));
    assert.deepEqual(repo.measurements().map(m => m.id), ['a', 'b', 'c']);
  });

  /*
   * People weigh themselves more than once a day, and an app that silently
   * overwrote this morning's number with this evening's would be deciding
   * which one was true.
   */
  test('two readings on one day are two readings', () => {
    const repo = fresh();
    repo.saveMeasurement(reading({ id: 'am', value: 184, at: T0 }));
    repo.saveMeasurement(reading({ id: 'pm', value: 187, at: T0 + 10 * 3600_000 }));
    assert.equal(repo.measurements().length, 2);
  });

  test('but correcting one keeps its place in time', () => {
    const repo = fresh();
    repo.saveMeasurement(reading({ id: 'm1', value: 1855, at: T0 }));
    repo.saveMeasurement(reading({ id: 'm1', value: 185.5, at: T0 }));
    assert.equal(repo.measurements().length, 1, 'a fix is not a second reading');
    assert.equal(repo.measurements()[0].value, 185.5);
  });

  test('a unit is stored as entered and never rewritten', () => {
    const repo = fresh();
    repo.saveMeasurement(reading({ id: 'lb', value: 185, unit: 'lb' }));
    repo.saveMeasurement(reading({ id: 'kg', value: 84, unit: 'kg', at: T0 + DAY }));
    assert.deepEqual(repo.measurements().map(m => m.unit), ['lb', 'kg'],
      'converting on write would rewrite history the first time a preference changed');
  });

  test('height and bodyweight share a table without sharing a kind', () => {
    const repo = fresh();
    repo.saveMeasurement(reading({ id: 'w', kind: 'bodyweight', value: 185, unit: 'lb' }));
    repo.saveMeasurement(reading({ id: 'h', kind: 'height', value: 180, unit: 'cm' }));
    const all = repo.measurements();
    assert.equal(all.filter(m => m.kind === 'bodyweight').length, 1);
    assert.equal(all.filter(m => m.kind === 'height').length, 1);
  });

  test('a blank note is no note, not an empty one', () => {
    const repo = fresh();
    repo.saveMeasurement(reading({ note: '   ' }));
    assert.equal(repo.measurements()[0].note, undefined);
  });

  test('deleting removes it from the read', () => {
    const repo = fresh();
    repo.saveMeasurement(reading());
    repo.deleteMeasurement('m1');
    assert.deepEqual(repo.measurements(), []);
  });
});

/*
 * The Now screen needs a bodyweight to work out what a pull-up actually
 * weighed, and that lives inside `state()` — which runs on every render and
 * once a second through a rest timer. Staleness is the only thing a cache can
 * get wrong, so every one of these is a write followed by a read.
 */
describe('the memoised read cannot go stale', () => {
  test('a new reading is visible immediately', () => {
    const repo = fresh();
    assert.deepEqual(repo.measurements(), []);
    repo.saveMeasurement(reading());
    assert.equal(repo.measurements().length, 1, 'the empty read was cached and never dropped');
  });

  test('a corrected reading reads back corrected', () => {
    const repo = fresh();
    repo.saveMeasurement(reading({ value: 185 }));
    repo.measurements();
    repo.saveMeasurement(reading({ value: 190 }));
    assert.equal(repo.measurements()[0].value, 190);
  });

  test('a deleted reading is gone on the next read', () => {
    const repo = fresh();
    repo.saveMeasurement(reading());
    repo.measurements();
    repo.deleteMeasurement('m1');
    assert.deepEqual(repo.measurements(), []);
  });

  test('erasing everything erases these too', () => {
    const repo = fresh();
    repo.saveMeasurement(reading());
    repo.measurements();
    repo.eraseAll();
    assert.deepEqual(repo.measurements(), []);
  });

  test('the array is frozen, so one screen cannot reorder another', () => {
    const repo = fresh();
    repo.saveMeasurement(reading());
    assert.throws(() => (repo.measurements() as Measurement[]).push(reading({ id: 'x' })));
  });

  test('and the second read is the same array, not a fresh query', () => {
    const repo = fresh();
    repo.saveMeasurement(reading());
    assert.equal(repo.measurements(), repo.measurements(), 'nothing is being cached at all');
  });
});

/*
 * The upgrade, which is the part of a schema change that can actually hurt.
 *
 * A fresh install runs every migration and cannot tell you whether the new one
 * composes with the old data. `MIGRATIONS` is indexed by version, so a database
 * that stopped at 4 must run exactly the fifth and keep everything it already
 * held.
 */
describe('an existing database gains measurements without losing anything', () => {
  test('a v4 database upgrades and keeps its sets, sessions and goals', () => {
    const db = new DatabaseSync(':memory:') as any;

    // Build it as v4 would have: every migration except the last.
    const before = new Repo(db, () => T0);
    before.startSession('s1', 'lb');
    before.logSet({ id: 'x1', sessionId: 's1', exerciseId: 'bench', weight: 145, reps: 8, at: T0 });
    before.saveGoal({
      id: 'g1', exerciseId: 'bench', targetWeight: 225, targetReps: 5,
      targetDate: T0 + 90 * DAY, unit: 'lb', createdAt: T0
    });
    // Wind the recorded version back so the next open re-runs from there.
    db.prepare('UPDATE meta SET value = ? WHERE key = ?').run('4', 'schema_version');
    db.exec('DROP TABLE IF EXISTS measurements');

    const after = new Repo(db, () => T0);
    assert.equal(after.allSets().length, 1, 'the sets survived');
    assert.equal(after.goals().length, 1, 'the goals survived');
    assert.deepEqual(after.measurements(), [], 'and the new table is there, empty');

    after.saveMeasurement(reading());
    assert.equal(after.measurements().length, 1, 'and usable');
  });

  test('opening twice does not run the migration twice', () => {
    const db = new DatabaseSync(':memory:') as any;
    const a = new Repo(db, () => T0);
    a.saveMeasurement(reading());
    const b = new Repo(db, () => T0);
    assert.equal(b.measurements().length, 1, 'a re-open must not drop or duplicate rows');
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import type { LoggedSet } from '../src/domain/types.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 9, 12);
const UNIT_QUERY = 'SELECT id, unit FROM sessions';

/** A repo whose unit-map reads are counted at the database. */
function counted(): { repo: Repo; reads: () => number } {
  const db = new DatabaseSync(':memory:');
  const prepare = db.prepare.bind(db);
  let n = 0;
  (db as unknown as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
    if (sql.includes(UNIT_QUERY)) n++;
    return prepare(sql);
  };
  return { repo: new Repo(db as never, () => NOW), reads: () => n };
}

/** Twenty sessions: the older half in kg, the newer half in lb. */
function mixedHistory(repo: Repo): void {
  for (let i = 20; i >= 1; i--) {
    const id = `s${i}`, at = NOW - i * 2 * DAY;
    repo.startSession(id, i > 10 ? 'kg' : 'lb', undefined, at);
    repo.logSet({ id: `x${i}`, sessionId: id, exerciseId: 'bench', weight: 100, reps: 5, at });
    repo.endSession(id, at + 3600_000);
  }
}

type WithHistory = { historyInSessionUnit(): LoggedSet[] };

/*
 * R665. Measured at 800 sessions, a repeat `state()` on an unchanged model
 * still cost 5.7ms: it read the session-unit map from sqlite twice per tap
 * and walked the whole history twice to convert units that had not changed.
 * `sessionUnits` had been left unmemoised on the belief that it ran only
 * when the exercise changed. Both reads are now memos, dropped exactly when
 * their inputs change.
 */
describe('a repeat render reads memos, not the database (R665)', () => {
  test('the unit map is one query until a session is added or everything is erased', () => {
    const { repo, reads } = counted();
    mixedHistory(repo);
    const first = repo.sessionUnits();
    const again = repo.sessionUnits();
    assert.equal(again, first, 'reading the unit map twice built it twice');
    const before = reads();

    repo.startSession('late', 'kg', undefined, NOW);
    const after = repo.sessionUnits();
    assert.notEqual(after, first, 'a new session left the old unit map in place');
    assert.equal(after.get('late'), 'kg', 'the session started after the map was read is missing from it');
    assert.equal(reads(), before + 1);

    repo.eraseAll();
    assert.equal(repo.sessionUnits().size, 0, 'erasing everything left sessions in the unit map');
  });

  test('re-rendering an unchanged screen does not query the unit map', () => {
    const { repo, reads } = counted();
    mixedHistory(repo);
    const m = new NowModel(repo, () => NOW, 'en-US');
    m.selectExercise('bench');
    m.state();
    const before = reads();
    for (let i = 0; i < 20; i++) m.state();
    assert.equal(reads() - before, 0, 'every tap re-read the unit of every session from sqlite');
  });

  test('the unit-converted history is built once per history, and rebuilt after a write', () => {
    const { repo } = counted();
    mixedHistory(repo);
    const m = new NowModel(repo, () => NOW, 'en-US');
    m.selectExercise('bench');
    const read = () => (m as unknown as WithHistory).historyInSessionUnit();
    const first = read();
    assert.notEqual(first, repo.allSets(), 'the fixture must mix units, or this checks nothing');
    assert.equal(read(), first, 'the whole history was converted again with nothing changed');

    const last = first[first.length - 1];
    repo.logSet({ ...last, id: 'fresh', at: NOW - 1000 });
    const rebuilt = read();
    assert.notEqual(rebuilt, first, 'a logged set left the converted history stale');
    assert.ok(rebuilt.some(s => s.id === 'fresh'), 'the new set is missing from the converted history');
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { adaptExpoDb, type ExpoSQLiteDatabase } from '../src/data/expo-db.ts';
import { Repo } from '../src/data/repo.ts';
import { BUILTIN } from '../src/domain/coldstart.ts';

/**
 * The adapter cannot be tested against real expo-sqlite on a laptop — but its
 * CONTRACT can. This fakes expo-sqlite's shape on top of node:sqlite and runs
 * the real Repo through it, which catches the things that actually go wrong:
 * a misnamed method, parameters dropped, results not unwrapped, or statements
 * never finalised.
 */
function fakeExpoSqlite(): { db: ExpoSQLiteDatabase; open: () => number; finalized: () => number } {
  const inner = new DatabaseSync(':memory:');
  let opened = 0, finalized = 0;

  const db: ExpoSQLiteDatabase = {
    execSync(sql) { inner.exec(sql); },
    prepareSync(sql) {
      opened++;
      const stmt = inner.prepare(sql);
      return {
        executeSync(params: unknown[] = []) {
          // expo-sqlite returns rows for every statement kind, including writes.
          const rows = /^\s*(select|pragma)/i.test(sql) ? stmt.all(...params as any[]) : (stmt.run(...params as any[]), []);
          return { getAllSync: () => rows as unknown[] };
        },
        finalizeSync() { finalized++; }
      };
    }
  };
  return { db, open: () => opened, finalized: () => finalized };
}

describe('expo-sqlite adapter', () => {
  test('Repo runs unchanged through the adapter', () => {
    const fake = fakeExpoSqlite();
    const repo = new Repo(adaptExpoDb(fake.db), () => 1_000_000);

    assert.equal(repo.exercises().size, BUILTIN.length, 'migration + seeding worked');

    repo.startSession('s1', 'lb', 'PUSH DAY');
    repo.logSet({ id: 'x1', sessionId: 's1', exerciseId: 'bench', weight: 225, reps: 5, at: 1_000_001 });
    repo.logSet({ id: 'x2', sessionId: 's1', exerciseId: 'bench', weight: 230, reps: 5, at: 1_000_002 });

    const sets = repo.setsInSession('s1');
    assert.equal(sets.length, 2, 'parameters reached the driver');
    assert.equal(sets[1].weight, 230, 'rows came back unwrapped');
    assert.equal(repo.lastSetOf('bench')!.weight, 230, 'get() takes the first row');
    assert.equal(repo.liveSession()!.id, 's1');

    repo.endSession('s1', 1_000_003);
    assert.equal(repo.liveSession(), null, 'writes committed');
  });

  test('every prepared statement is finalised — a leaked handle per set is not survivable', () => {
    const fake = fakeExpoSqlite();
    const repo = new Repo(adaptExpoDb(fake.db), () => 2_000_000);
    repo.startSession('s1', 'lb');
    for (let i = 0; i < 50; i++) {
      repo.logSet({ id: `x${i}`, sessionId: 's1', exerciseId: 'bench', weight: 100, reps: 5, at: 2_000_000 + i });
    }
    repo.setsInSession('s1');
    assert.ok(fake.open() > 50, 'sanity: statements really were prepared');
    assert.equal(fake.finalized(), fake.open(), `${fake.open() - fake.finalized()} statements leaked`);
  });

  test('a throwing statement still finalises', () => {
    const fake = fakeExpoSqlite();
    const db = adaptExpoDb(fake.db);
    db.exec('CREATE TABLE t (a INTEGER PRIMARY KEY)');
    db.prepare('INSERT INTO t (a) VALUES (?)').run(1);
    const before = fake.finalized();
    assert.throws(() => db.prepare('INSERT INTO t (a) VALUES (?)').run(1), /UNIQUE|constraint/i);
    assert.equal(fake.finalized(), before + 1, 'the failed statement was finalised too');
  });
});

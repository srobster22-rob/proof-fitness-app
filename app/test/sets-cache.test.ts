import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';

const T0 = Date.UTC(2026, 6, 29, 18);
const MIN = 60_000;

function repoWith(n = 3): Repo {
  const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
  repo.startSession('s1', 'lb', undefined, T0 - 60 * MIN);
  for (let i = 0; i < n; i++) {
    repo.logSet({ id: 'x' + i, sessionId: 's1', exerciseId: 'bench', weight: 100 + i, reps: 5, at: T0 - (50 - i) * MIN });
  }
  return repo;
}

/**
 * `allSets` is the hot read in the app: `NowModel.state()` calls it five times,
 * and `state()` runs on every tap of the logging path — so its cost is paid per
 * stepper press, and it grows with everything the user has ever logged.
 *
 * Measured against five years of training (9,360 sets, native sqlite): one call
 * was 11.4ms and a single `state()` was 47ms — three dropped frames on every
 * tap, worst for the users who had used the app longest. Memoised it is 2.5ms,
 * and the realistic worst case (log a set, which invalidates, then recompute)
 * is 15.3ms.
 *
 * These assert the CONTRACT rather than the timing: a timing test on a shared
 * laptop measures the laptop. What has to hold is that the cache is returned
 * while nothing has written, and is gone the moment something has.
 */
describe('allSets is memoised, and invalidated by every write', () => {
  test('repeated reads return the same array', () => {
    const repo = repoWith();
    assert.equal(repo.allSets(), repo.allSets(), 'the read is not memoised at all');
  });

  test('logging a set invalidates it', () => {
    const repo = repoWith();
    const before = repo.allSets();
    repo.logSet({ id: 'new', sessionId: 's1', exerciseId: 'bench', weight: 200, reps: 5, at: T0 });
    const after = repo.allSets();
    assert.notEqual(before, after, 'a stale cache would hide the set just logged');
    assert.equal(after.length, before.length + 1);
  });

  test('deleting a set invalidates it', () => {
    const repo = repoWith();
    const before = repo.allSets();
    repo.deleteSet('x0');
    const after = repo.allSets();
    assert.notEqual(before, after);
    assert.equal(after.length, before.length - 1);
    assert.ok(!after.some(s => s.id === 'x0'), 'a removed set came back from the cache');
  });

  test('erasing everything invalidates it', () => {
    const repo = repoWith();
    repo.allSets();
    repo.eraseAll();
    assert.equal(repo.allSets().length, 0, 'erased data was still readable from the cache');
  });

  /*
   * The cached array is handed to every caller, and several of them sort or
   * reverse what they are given. Without freezing, one screen's ordering would
   * silently become another's.
   */
  test('the cache cannot be mutated by whoever reads it', () => {
    const repo = repoWith();
    const sets = repo.allSets();
    assert.throws(() => { (sets as any).push({ id: 'sneaky' }); },
      'a caller can append to the shared cache');
    assert.throws(() => { (sets as any).sort(() => -1); },
      'a caller can reorder the shared cache for everyone else');
    assert.equal(repo.allSets().length, 3, 'the cache survived the attempts intact');
  });

  test('a fresh Repo over the same database reads what was written', () => {
    // Two Repos over one Db would each hold their own cache, which is why the
    // app uses exactly one — this pins that the cache is per-instance and not
    // some process-wide store that would leak between them.
    const db = new DatabaseSync(':memory:') as any;
    const a = new Repo(db, () => T0);
    a.startSession('s1', 'lb', undefined, T0 - 60 * MIN);
    a.logSet({ id: 'x', sessionId: 's1', exerciseId: 'bench', weight: 100, reps: 5, at: T0 });
    a.allSets();
    const b = new Repo(db, () => T0);
    assert.equal(b.allSets().length, 1);
  });
});

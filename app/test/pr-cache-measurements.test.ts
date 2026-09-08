import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { around } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODEL = fs.readFileSync(path.join(HERE, '..', 'src', 'ui', 'now-model.ts'), 'utf8');
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 9, 12);

/** Three sessions of weighted pull-ups at 25x5, enough to clear the cold-start guard. */
function pullups(): Repo {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  let n = 0;
  for (const d of [12, 9, 6]) {
    const id = `s${d}`;
    repo.startSession(id, 'lb');
    repo.logSet({ id: `x${n++}`, sessionId: id, exerciseId: 'pullup', weight: 25, reps: 5, at: T0 - d * DAY });
    repo.endSession(id, T0 - d * DAY + 3600_000);
  }
  repo.saveMeasurement({ id: 'bw0', kind: 'bodyweight', value: 215, unit: 'lb', at: T0 - 30 * DAY });
  return repo;
}

/** Log 30x5 today and return the model, with the set marked as a PR. */
function todaysSet(repo: Repo): NowModel {
  const m = new NowModel(repo, () => T0, 'en-US');
  m.selectExercise('pullup');
  m.setWeight(30);
  m.setReps(5);
  m.log();
  return m;
}

/*
 * R539. R522 cached the PR marking on `allSets()`'s array identity and its own
 * comment ended "nothing else can" invalidate it. That was wrong, and this is
 * the case it missed.
 *
 * `findPRs` is handed the MEASUREMENT list as well, because the four
 * bodyweight-carrying lifts are judged on real load — belt weight plus what the
 * lifter weighed that day. Stepping on the scale changes what a pull-up
 * weighed without writing a single set, so the cache key never moves.
 *
 * Measured rather than reasoned: 30x5 today against a 25x5 history is a PR on
 * the bar, and stays one until the lifter records today's bodyweight twenty
 * pounds down — at which point `findPRs` correctly retracts it (225 lifted
 * against 240 to beat) and the cached screen kept the star anyway.
 *
 * That is §8 cry-wolf manufactured by an optimisation: the rule was right, the
 * badge was wrong, and the app was claiming a record it had already decided
 * against. It is also the exact failure R538 was looking for and did not find —
 * the identity-cache pattern is sound, but only over the inputs it keys on.
 */
describe('the PR marking notices a new measurement (R539)', () => {
  test('recording a bodyweight drop retracts a star the same screen is showing', () => {
    const repo = pullups();
    const m = todaysSet(repo);
    const before = m.state().prSetIds;
    assert.equal(before.length, 1, 'a 30x5 over a 25x5 history should be a PR before the scale speaks');

    repo.saveMeasurement({ id: 'bw1', kind: 'bodyweight', value: 195, unit: 'lb', at: T0 });
    assert.deepEqual(m.state().prSetIds, [],
      'the star survived the measurement that took the record away — the cache is ' +
      'keyed on sets only, and findPRs also reads measurements');
  });

  test('and a model built after the measurement agrees with one built before it', () => {
    /*
     * The oracle, and the reason the bug was invisible: a session that opened
     * the app fresh saw the RIGHT answer. Only the screen that was already
     * open was wrong, which is the one nobody re-checks.
     */
    const repo = pullups();
    const live = todaysSet(repo);
    // Reading the screen first is the whole point: an unread model has nothing
    // cached and gets the right answer under the bug too, which is why the
    // first version of this test passed against a planted defect.
    assert.equal(live.state().prSetIds.length, 1);
    repo.saveMeasurement({ id: 'bw1', kind: 'bodyweight', value: 195, unit: 'lb', at: T0 });

    const fresh = new NowModel(repo, () => T0, 'en-US');
    fresh.selectExercise('pullup');
    assert.deepEqual(live.state().prSetIds, fresh.state().prSetIds,
      'the open screen and a fresh launch disagree about the same set');
  });

  test('the cache is still a cache — an unchanged repo does not recompute', () => {
    // The fix must not become "read it twice and throw the key away". Two
    // reads with nothing written between them return the SAME array object.
    const m = todaysSet(pullups());
    assert.equal(m.state().prSetIds, m.state().prSetIds,
      'prSetIds is recomputing on every render; the memo is gone');
  });

  test('both inputs are in the key', () => {
    const src = around(MODEL, 'private prSetIds(', 0, 700);
    assert.match(src, /all === this\.prCacheKey && measurements === this\.prMeasureKey/,
      'the PR cache no longer keys on both the sets and the measurements');
  });
});

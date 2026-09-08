import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import { erasureCounts, erasureLine } from '../src/ui/progress-model.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T = Date.UTC(2026, 7, 24, 8);
const fresh = () => new Repo(new DatabaseSync(':memory:') as never, () => T);

/*
 * R488. `eraseAll` deletes sets, sessions, goals, custom exercises,
 * measurements, measurement targets and every `pref.%` row — its own comment
 * says of the last of those "their chosen jump amounts are theirs too". The
 * control that invokes it was gated on `counts.sets > 0`.
 *
 * So a lifter who set their units, recorded a bodyweight on YOU and invented a
 * movement before ever logging a set had data the app was holding and NO
 * control to erase it. §11 makes the export file the only backup and treats all
 * of this as the user's own; being able to destroy it is the other half of that
 * promise, and it was reachable only by logging a set first.
 *
 * The gate is `erasureCounts` now — already the single place that decides what
 * counts as erasable, and what the confirmation sentence is built from, so the
 * button and the sentence cannot disagree about whether there is anything here.
 */
describe('anything erasable can actually be erased (§11)', () => {
  test('a bodyweight with no sets is erasable', () => {
    const repo = fresh();
    repo.saveMeasurement({ id: 'w', kind: 'bodyweight', value: 185, unit: 'lb', at: T } as never);
    assert.equal(repo.allSets().length, 0, 'the fixture logged a set — it must not');
    assert.ok(erasureCounts(repo).length > 0,
      'a recorded bodyweight leaves nothing the erase control would offer to remove');
    assert.match(erasureLine(repo), /1 measurement/);
  });

  test('a changed preference with no sets is erasable', () => {
    const repo = fresh();
    repo.setPref('pref.unit', 'kg');
    assert.equal(repo.allSets().length, 0);
    assert.ok(erasureCounts(repo).length > 0,
      'eraseAll deletes every pref row, and nothing offers to');
    assert.match(erasureLine(repo), /1 setting/);
  });

  test('a custom exercise with no sets is erasable', () => {
    const repo = fresh();
    repo.addExercise('mine', 'Zercher Squat');
    assert.equal(repo.allSets().length, 0);
    assert.ok(erasureCounts(repo).length > 0,
      'a movement the user invented is not offered for erasure');
  });

  /*
   * The other half, and the reason the predicate is `erasureCounts` rather than
   * "anything at all": on an untouched install the control must still be
   * absent, or the first thing a new user sees on this screen is an offer to
   * destroy nothing.
   */
  test('but an untouched install still offers nothing to erase', () => {
    assert.equal(erasureCounts(fresh()).length, 0);
    assert.equal(erasureLine(fresh()), 'Nothing');
  });

  test('and the screen gates on that, not on the set count', () => {
    const src = readFileSync(path.join(HERE, '..', 'app', 'progress.tsx'), 'utf8');
    assert.match(src, /erasable: erasureCounts\(repo\)\.length > 0/,
      'the erase gate no longer asks the one place that knows what is erasable');
    assert.match(src, /\{counts\.erasable && \(/);
    assert.doesNotMatch(src, /counts\.sets > 0/,
      'the set-count gate is back — measurements, settings and custom ' +
      'exercises become unerasable again for anyone who has logged nothing');
  });

  test('and the block no longer computes counts nothing reads', () => {
    // `sets`, `sessions` and `goals` were all built on every render of this
    // block and none of them was read once the gate changed.
    const src = readFileSync(path.join(HERE, '..', 'app', 'progress.tsx'), 'utf8');
    for (const dead of ['counts.sessions', 'counts.goals', 'counts.sets']) {
      assert.ok(!src.includes(dead), `${dead} is read again — was that intended?`);
    }
  });
});

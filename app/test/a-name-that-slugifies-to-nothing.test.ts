import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';

const T0 = Date.UTC(2026, 8, 9, 12);

function model(): NowModel {
  const m = new NowModel(new Repo(new DatabaseSync(':memory:') as never, () => T0), () => T0, 'en-US');
  m.selectExercise('bench');
  return m;
}

const nameOf = (m: NowModel, id: string) =>
  [...(m as unknown as { repo: Repo }).repo.exercises().values()].find(e => e.id === id)?.name ?? null;

/*
 * R564. Walking the exercise picker found the add path sound and well covered —
 * blank names refused, duplicates resolved case-insensitively and across
 * hyphens and spacing rather than creating a second "Hack Squat", a 96-letter
 * name accepted and ellipsized cleanly on the hero at 375px.
 *
 * One path had nothing on it: a name made ENTIRELY of characters the slug drops.
 * "---" slugifies to the empty string, so the id falls through to a generated
 * one built from `Date.now()`, and two of those added in the same millisecond
 * share a stem. That is the one place in this flow where a collision would not
 * error — it would quietly merge two of a lifter's own movements, and every set
 * logged against either would land on one.
 *
 * The behaviour is correct today: `freeSlug` de-duplicates against the ids
 * already taken, so the stem repeating does not matter. Nothing said so.
 */
describe('a name made only of punctuation still gets its own lift (R564)', () => {
  const ODD = ['---', '***', '???', '!!!', '###', '@@@', '...'];

  test('seven of them are seven lifts, not one', () => {
    const m = model();
    const ids = ODD.map(n => m.addCustomExercise(n));
    assert.equal(new Set(ids).size, ODD.length,
      `${ODD.length} movements collapsed into ${new Set(ids).size} — sets logged ` +
      'against one would land on another');
    for (const id of ids) assert.ok(id, 'a punctuation-only name was refused');
  });

  test('and each keeps the name the lifter typed', () => {
    const m = model();
    const ids = ODD.map(n => m.addCustomExercise(n)!);
    assert.deepEqual(ids.map(id => nameOf(m, id)), ODD,
      'the stored names do not match what was typed');
  });

  test('the generated id is still a usable id', () => {
    // It has to survive being a key: selected, found in the picker, and logged
    // against. An id that only half works fails later and somewhere else.
    const m = model();
    const id = m.addCustomExercise('+++')!;
    assert.match(id, /^[a-z0-9_]+$/, `the generated id is not slug-shaped: "${id}"`);
    m.selectExercise(id);
    assert.equal(m.state().exercise.id, id, 'the new lift cannot be selected');
    m.log();
    assert.equal(m.state().loggedThisExercise.length, 1, 'a set could not be logged against it');
  });

  test('whitespace is collapsed before the duplicate check', () => {
    /*
     * `'  Bench   Press  '` has to find the builtin rather than create a second
     * one. Case and hyphens are already pinned in now-model.test.ts; the
     * collapse of runs of spaces was not.
     */
    const m = model();
    assert.equal(m.addCustomExercise('  Bench   Press  '), 'bench',
      'a second Bench Press was created from extra spacing');
  });
});

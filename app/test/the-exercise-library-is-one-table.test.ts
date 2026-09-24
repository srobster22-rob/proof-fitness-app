import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES, STARTING, MORE, WIDER } from '../src/domain/exercises.ts';
import { CARRIES_BODYWEIGHT } from '../src/domain/measure.ts';
import { BUILTIN, STARTING_TWELVE, MORE_MOVEMENTS, WIDER_LIBRARY } from '../src/domain/coldstart.ts';
import { profileFor } from '../src/domain/muscles.ts';
import { dayOf, SPLIT_DAYS } from '../src/domain/split.ts';
import { exactExercise, normalizeName } from '../src/domain/find-exercise.ts';
import { EQUIPMENT } from '../src/domain/types.ts';

/*
 * R696 (ORGANIZE, AGENT_LOOP §3a "content is data"). The same ids were typed
 * in three tables, coldstart.ts, muscles.ts and split.ts, plus the aliases in
 * find-exercise.ts, so a new movement could exist in one and be missing from
 * another. Now there is one entry per movement in exercises.ts and the rest
 * are views of it. These pin the registry's own rules and that the views read
 * it, from the values the modules export.
 */
describe('the exercise library is one table', () => {
  test('one entry per movement', () => {
    const ids = EXERCISES.map(e => e.id);
    assert.equal(new Set(ids).size, ids.length, 'a movement has two entries');
  });

  test('what lifters type for a movement still picks it, never a new lift', () => {
    // Every alias the library knows, as a lifter types it (R683, R696 review):
    // dropping one makes ADD create a duplicate of the movement it meant.
    const library = BUILTIN.map(({ id, name }) => ({ id, name }));
    for (const [typed, id] of [
      ['RDL', 'rdl'], ['skullcrusher', 'skull-crusher'], ['lying tricep extension', 'skull-crusher'],
      ['OHP', 'ohp'], ['military press', 'ohp'], ['rope pushdown', 'pushdown'], ['BSS', 'bulgarian-split-squat'],
      ['KB swing', 'kettlebell-swing'], ['pec fly', 'fly'], ['bench', 'bench'],
    ]) assert.equal(exactExercise(typed, library)?.id, id, `"${typed}" no longer picks ${id}`);
    assert.equal(EXERCISES.flatMap(e => e.aliases ?? []).length, 10, 'an alias was added: pin it above');
  });

  test('the first launch still offers exactly twelve (§6)', () => {
    assert.equal(STARTING.length, 12);
  });

  test('every entry is complete: a day, what it trains, what it is done on', () => {
    for (const e of EXERCISES) {
      assert.ok(SPLIT_DAYS.includes(e.day), `${e.id}: no push/pull/legs day`);
      assert.ok(e.muscles.primary.length > 0, `${e.id}: trains nothing`);
      assert.ok(EQUIPMENT.includes(e.kit), `${e.id}: kit ${e.kit}`);
      assert.ok(e.seedLb >= 0 && e.seedKg >= 0 && e.reps > 0, `${e.id}: seed`);
    }
  });

  test('the library, the muscles and the days are views of it', () => {
    assert.deepEqual(BUILTIN.map(e => e.id), EXERCISES.map(e => e.id));
    assert.deepEqual([STARTING_TWELVE, MORE_MOVEMENTS, WIDER_LIBRARY].map(t => t.length), [STARTING, MORE, WIDER].map(t => t.length));
    for (const e of EXERCISES) {
      assert.equal(profileFor(e.id), e.muscles, `${e.id}: muscles.ts has its own copy`);
      assert.equal(dayOf(e.id), e.day, `${e.id}: split.ts files it elsewhere`);
      assert.equal(CARRIES_BODYWEIGHT.has(e.id), e.kit === 'bodyweight', `${e.id}: measure.ts weighs it differently`);
    }
  });

  test('the first session sees only what seeds a lifter: no day, muscles or aliases in BUILTIN', () => {
    const allowed = new Set(['id', 'name', 'seedLb', 'seedKg', 'reps', 'kit', 'factor', 'calibrates']);
    for (const e of BUILTIN) assert.deepEqual(Object.keys(e).filter(k => !allowed.has(k)), [], e.id);
  });

  test('every alias picks its own movement, and no alias is another movement\'s name', () => {
    const library = BUILTIN.map(({ id, name }) => ({ id, name }));
    const seen = new Set<string>();
    for (const e of EXERCISES) {
      for (const alias of e.aliases ?? []) {
        assert.equal(exactExercise(alias, library)?.id, e.id, `"${alias}" does not pick ${e.id}`);
        const typed = normalizeName(alias);
        assert.ok(!seen.has(typed), `"${alias}" is an alias twice`);
        seen.add(typed);
        const named = EXERCISES.find(o => o !== e && normalizeName(o.name) === typed);
        assert.equal(named, undefined, `"${alias}" is the name of ${named?.id}`);
      }
    }
  });
});

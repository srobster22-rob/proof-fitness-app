import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parse, serialize, EXPORT_FORMAT } from '../src/data/portable.ts';
import { SCHEMA_VERSION } from '../src/data/schema.ts';

/** A minimal, otherwise-valid export file. */
function baseFile(overrides: Record<string, unknown> = {}) {
  return {
    format: EXPORT_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: 0,
    counts: { exercises: 0, sessions: 0, sets: 0, goals: 0, measurements: 0, measureGoals: 0 },
    exercises: [], sessions: [], sets: [], goals: [],
    ...overrides
  };
}

/*
 * R627, filed R626. `parse()` checked the four required arrays but not the
 * three optional ones -- a malformed `measurements`/`measureGoals`/`prefs`
 * passed straight through to `restore()`, which throws on a non-iterable or
 * non-object. `applyBackup`'s try/catch already stopped that from crashing
 * the app, but the user saw a raw TypeError instead of the same "Missing or
 * malformed" message every required field already gets.
 */
describe('parse rejects a malformed optional field with a clean message (R627)', () => {
  for (const key of ['measurements', 'measureGoals']) {
    test(`a non-array "${key}" is rejected, not passed through`, () => {
      const text = serialize(baseFile({ [key]: {} }) as never);
      const result = parse(text);
      assert.equal(result.file, null);
      assert.match(result.error ?? '', new RegExp(`malformed "${key}"`));
    });

    test(`an absent "${key}" is accepted (older backups predate it)`, () => {
      const text = serialize(baseFile() as never);
      const result = parse(text);
      assert.equal(result.error, null);
    });
  }

  test('a non-object "prefs" is rejected', () => {
    const text = serialize(baseFile({ prefs: ['not', 'an', 'object'] }) as never);
    const result = parse(text);
    assert.equal(result.file, null);
    assert.match(result.error ?? '', /malformed "prefs"/);
  });

  test('an absent "prefs" is accepted', () => {
    const text = serialize(baseFile() as never);
    const result = parse(text);
    assert.equal(result.error, null);
  });
});

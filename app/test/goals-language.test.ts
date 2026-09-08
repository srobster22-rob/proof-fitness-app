import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, '..', 'app', 'goals.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

/**
 * Three ways an English string escapes a sweep built around `<Text>literal`.
 *
 * Found by continuing the exact search that found the YOU screen's
 * accessibility labels, on the next screen over:
 *
 *   1. `FILTER_LABEL[f]` / `SORT_LABEL[sort]` — id-keyed records rendered as
 *      `{expr}`. A sweep matching literal text between `<Text>` and `</Text>`
 *      never sees an expression, however English the thing it evaluates to.
 *   2. "Pick the lifts you want to move. Up to {MAX_GOALS} at once." — a
 *      LITERAL with an interpolation in the middle. A sweep whose pattern
 *      cannot contain `{` skips the whole node rather than the one slot.
 *   3. "reps" / "days" — bare lowercase words. The wide sweep's own filter
 *      (`/[A-Z]/.test(x) || x.includes(' ')`) was written on the assumption a
 *      lowercase single word is always a unit suffix, which these were not.
 */
describe('the Goals screen has no English left of any of the three shapes', () => {
  test('no accessibilityLabel is a bare English sentence', () => {
    const labels = [...src.matchAll(/accessibilityLabel=(?:"([A-Z][^"]*)"|\{`([A-Z][^`]*)`\})/g)]
      .map(m => m[1] ?? m[2]);
    assert.deepEqual(labels, [],
      `these ignore the LANGUAGE setting: ${labels.join(' | ')}`);
  });

  test('the filter chips and sort toggle read from the table, not the raw record', () => {
    assert.doesNotMatch(src, /FILTER_LABEL\[/, 'the id-keyed English record must not be imported');
    assert.doesNotMatch(src, /SORT_LABEL\[/);
    assert.match(src, /T\(FILTER_KEY\[f\]\)/);
    assert.match(src, /T\(SORT_KEY\[sort\]\)/);
  });

  test('the horizon unit (days/weeks/months/years) is never shown raw', () => {
    assert.doesNotMatch(src, /\{byUnit\.toUpperCase\(\)\}/,
      'the enum VALUE is English by construction — see KIT_KEY for the same fix on equipment');
    assert.doesNotMatch(src, /\{u\.toUpperCase\(\)\}/);
    assert.match(src, /HORIZON_KEY\[byUnit\]/);
    assert.match(src, /HORIZON_KEY\[u\]/);
  });

  test('mixed literal-plus-interpolation text is gone', () => {
    assert.doesNotMatch(src, /Pick the lifts you want to move/);
    assert.doesNotMatch(src, />reps</, 'bare lowercase "reps" as a text node');
    assert.doesNotMatch(src, /days —/, 'bare "days" spliced into a template literal');
    assert.match(src, /T\('pickLiftsUpTo'\)/);
  });

  test('the picker\'s section header is translated, both branches', () => {
    assert.doesNotMatch(src, /'OR ANYTHING ELSE'/);
    assert.match(src, /T\('orAnythingElse'\) : T\('lift'\)/);
  });

  test('the undo bar\'s three messages are all built from the table', () => {
    assert.doesNotMatch(src, /goal wiped\.`/);
    assert.doesNotMatch(src, /goals wiped\.`/);
    assert.doesNotMatch(src, /came back — the rest hit the cap/);
    assert.match(src, /T\('goalWiped'\)/);
    assert.match(src, /T\('goalsWiped'\)/);
    assert.match(src, /T\('cappedComeBack'\)/);
  });

  /*
   * R272 built `goalErrGeneric` for the save-failure fallback without
   * noticing `couldNotSave` already exists — `measure.tsx` has used it for
   * the same fallback since long before. Two keys, identical English AND
   * identical Spanish, for the same sentence. Fixed R283 by reusing the
   * existing key; this guards the reuse rather than the string, since the
   * string itself was already correct either way.
   */
  test('the save-failure fallback reuses the key measure.tsx already has, not a second one', () => {
    assert.match(src, /T\('couldNotSave'\)/,
      'goals.tsx should fall back to the same key measure.tsx uses for an identical sentence');
    assert.doesNotMatch(src, /goalErrGeneric/,
      'a second key for "Could not save that." — reuse couldNotSave instead');
  });
});

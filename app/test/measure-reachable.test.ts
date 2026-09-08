import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.join(HERE, '..', ...p.split('/')), 'utf8');
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

/*
 * Progress is the ONLY route to the measurements screen, and it renders in two
 * branches — one for a database with rows and one for an empty one. The YOU row
 * existed only in the populated branch, so on a fresh install there was no way
 * to reach `/measure` at all.
 *
 * That is worse than an ordinary missing link, because a bodyweight reading
 * does not back-fill: `readingAt` accepts only a reading logged at or before a
 * set, deliberately, so June's weight cannot rewrite January's sets. The
 * consequence is that the sets which most need a bodyweight — a beginner's
 * first push-ups — are exactly the ones whose reading has to exist BEFORE they
 * are logged. The recap even prints "Add your bodyweight on YOU to count these
 * sets" while, on a fresh install, the YOU it named was unreachable.
 *
 * Source tests because the claim lives in a `.tsx` no Node test can render —
 * same approach as `erase-claim.test.ts` and `accent.test.ts`.
 */
describe('the measurements screen is reachable from an empty Progress', () => {
  const src = code(read('app/progress.tsx'));

  test('one YouRow component, not a copy per branch', () => {
    const declared = src.match(/function YouRow\b/g) ?? [];
    assert.equal(declared.length, 1, 'YouRow should be declared exactly once');
    // Two call sites: the empty branch and the populated one.
    const used = src.match(/<YouRow\b/g) ?? [];
    assert.equal(used.length, 2,
      'the YOU row must render in BOTH the empty and the populated branch');
  });

  test('it is inside the empty branch, not only the populated one', () => {
    // The empty branch runs from the `rows.length === 0 ?` test to the `) : (`
    // that opens the populated one. Anchors go through `region` so a moved one
    // fails loudly instead of silently reading the wrong part of the file.
    const empty = region(src, 'rows.length === 0', ') : (');
    assert.match(empty, /<YouRow\b/,
      'a fresh install has no route to the measurements screen');
  });

  test('and it still points at /measure', () => {
    assert.match(src, /push\('\/measure'\)/);
  });

  test('the row is a labelled link, so it is reachable without sight too', () => {
    const decl = region(src, 'function YouRow', 'function PastSession');
    assert.match(decl, /accessibilityRole="link"/);
    assert.match(decl, /accessibilityLabel=\{T\('yourMeasurementsA11y'\)\}/);
  });
});

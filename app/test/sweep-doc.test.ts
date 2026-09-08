import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const doc = readFileSync(path.join(HERE, '..', '..', 'BUILD_LOOP.md'), 'utf8');

/*
 * The documented layout sweep must not scope itself to `#root`.
 *
 * It did, for one round, and `#root` looks like exactly the right way to skip
 * the HTML shell's `<title>` and `<noscript>`. It is not: every sheet in this
 * app — the exercise picker, the goal sheet, ConfirmSheet, SettingsSheet,
 * ScreenModal — renders as a SIBLING of `#root`, directly under `body`. The
 * scoped sweep therefore examined nothing at all on any of them and reported a
 * clean result, and a clean result gets written into LOOP_LOG as evidence.
 *
 * Measured with the picker open at 320pt: the `#root` version found 0 leaves,
 * the corrected one found 107.
 *
 * A test on a markdown file is unusual, but this snippet is the instrument the
 * last four rounds' findings came from. An instrument that silently measures
 * nothing is worse than no instrument, because it manufactures false negatives
 * that later rounds build on.
 */
describe('the documented layout sweep actually looks at the whole page', () => {
  const sweep = region(doc, '## The sweep that finds layout bugs you cannot see', '## What "great');

  test('it queries the body, not a subtree that excludes every sheet', () => {
    assert.match(sweep, /document\.body\.querySelectorAll/);
    assert.doesNotMatch(sweep, /querySelectorAll\('#root \*'\)/,
      'the sweep is scoped to #root again — it will skip every modal in the app');
  });

  test('it skips the shell by tag instead', () => {
    for (const tag of ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TITLE']) {
      assert.ok(sweep.includes(tag), `the skip list no longer excludes ${tag}`);
    }
  });

  test('it ignores elements hidden behind another screen', () => {
    // A route stacked over another leaves the one underneath mounted at zero
    // width. Measured on the recap over Now at 320pt: 67 leaves, 51 of them
    // reported as failures, every one from the hidden screen. A sweep that
    // cries wolf on every stacked route is a sweep nobody reads.
    assert.match(sweep, /checkVisibility/);
    assert.match(sweep, /offsetParent !== null/,
      'the fallback for engines without checkVisibility is gone');
  });

  test('it reports how many leaves it checked', () => {
    // The whole failure was a vacuous pass. Without a count on screen there is
    // no way to tell "nothing is broken" from "nothing was examined".
    // Both counts: `leaves` proves the sweep found the page at all, `checked`
    // proves it found something visible on it. Either can be zero for its own
    // reason, and only reporting both distinguishes them.
    assert.match(sweep, /leaves: leaves\.length/);
    assert.match(sweep, /checked: shown\.length/);
    assert.match(sweep, /Report `checked`/,
      'the warning about believing bad: 0 without a count is gone');
  });

  test('and it still names both failure modes', () => {
    assert.match(sweep, /width: 0|width < 1/);
    assert.match(sweep, /scrollWidth > e\.clientWidth/);
    assert.match(sweep, /textOverflow/,
      'truncation is only a bug when it is not an honest ellipsis — that note is gone');
  });
});

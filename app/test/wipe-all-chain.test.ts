import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { around } from './helpers/source.ts';
import { t } from '../src/domain/i18n.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, '..', 'app', 'goals.tsx'), 'utf8');

/*
 * The most destructive control in the app, and its safety net.
 *
 * WIPE ALL can destroy a year of targets in one tap, so it asks three times and
 * then leaves an UNDO that persists until dismissed. Walked end to end on the
 * running app with a seeded database: "Wipe your 1 goal?" → "Really all of
 * them? 1 still open, 0 already hit. Your sets, sessions and history are not
 * touched — only the targets." → "Last chance. One tap of UNDO puts them
 * straight back" → "1 goal wiped. UNDO" → the goal returns with its target,
 * its narrative line and "60 days left · on pace" intact.
 *
 * Every step of that was correct. What had no test was the CHAIN — the step
 * numbers, the direction they advance, and that every cancel goes back to
 * nothing rather than to the previous step. A three-step confirmation that
 * quietly became a two-step one would look completely normal in a diff.
 */
describe('WIPE ALL asks three times before it destroys anything', () => {
  // A window rather than a region: the natural closing anchor `)}` also ends
  // the title line inside the block, which truncated it to nothing.
  const step = (n: number) => around(src, `{wipeAllStep === ${n} && (`, 0, 520);

  test('there are exactly three steps, and they advance in order', () => {
    assert.match(step(1), /onConfirm=\{\(\) => setWipeAllStep\(2\)\}/);
    assert.match(step(2), /onConfirm=\{\(\) => setWipeAllStep\(3\)\}/);
    // Only the last one is allowed to touch the data.
    assert.doesNotMatch(step(1), /wipe\(/);
    assert.doesNotMatch(step(2), /wipe\(/);
    assert.match(step(3), /wipe\(goals\.map/);
  });

  test('cancelling at any step abandons the whole chain', () => {
    // Back to the PREVIOUS step would be a trap: three taps to escape a dialog
    // the user has already declined once.
    for (const n of [1, 2, 3]) {
      assert.match(step(n), /onCancel=\{\(\) => setWipeAllStep\(0\)\}/,
        `step ${n} does not abandon the chain on cancel`);
    }
  });

  test('the middle step states what is about to go, and that history is not', () => {
    // The one step that carries facts rather than warnings. It is what makes
    // the confirmation checkable (§16) instead of just loud.
    assert.match(step(2), /\{ open: counts\.open, done: counts\.done \}/);
    assert.match(t('en', 'wipeAll2Body'), /not touched/);
    assert.match(t('es', 'wipeAll2Body'), /no se tocan|no cambian|intactos/);
  });

  test('and the last one promises the undo it actually leaves behind', () => {
    assert.match(t('en', 'wipeAll3Body'), /UNDO/);
    assert.match(step(3), /wipe\(goals\.map\(g => g\.goal\.id\)/,
      'the undo depends on removeGoals returning what it took');
  });

  test('one goal is not addressed as several', () => {
    // Same rule R211 fixed on the WIPE ALL chip itself: a count of one has to
    // read as one, in both languages.
    assert.match(step(1), /goals\.length === 1 \? 'wipeAllTitleOne' : 'wipeAllTitle'/);
    assert.match(src, /goals\.length === 1 \? T\('goalsWipedOne'\)/);
    for (const lang of ['en', 'es'] as const) {
      assert.doesNotMatch(t(lang, 'wipeAllTitleOne'), /\{n\}/,
        `${lang} singular title still interpolates a count`);
    }
  });
});

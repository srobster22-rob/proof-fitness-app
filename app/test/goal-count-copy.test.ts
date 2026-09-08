import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from '../src/domain/i18n.ts';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..', 'app');
const read = (p: string) => readFileSync(p, 'utf8');
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*/g, '');

/*
 * A count next to a label has to read as English when the count is one.
 *
 * Found on the running app with a seeded database and a single goal: the wipe
 * control read **"WIPE ALL 1"**, and in Spanish **"BORRAR TODAS 1"**, which is
 * worse — `todas` is already plural and agreeing with nothing.
 *
 * The telling part is that the accessibility label right beside it was already
 * correct. Someone had added `wipeAllA11yOne` ("Wipe the 1 goal") and the
 * Spanish `'Borrar la única meta'`, so the half of the control that nobody
 * sees had been through a singular pass and the half everyone sees had not.
 *
 * The fix is not another string: with one goal there is nothing to count, so
 * the number is simply omitted and both languages read naturally on their own.
 */
describe('the wipe-all control counts only when there is something to count', () => {
  const src = strip(read(path.join(APP, 'goals.tsx')));

  test('the count is conditional on there being more than one', () => {
    const chip = region(src, "<Text style={s.wipeAllText}>", '</Text>');
    assert.match(chip, /goals\.length > 1 \? ` \$\{goals\.length\}` : ''/);
    assert.doesNotMatch(chip, /\{T\('wipeAll'\)\} \{goals\.length\}/,
      'the count is concatenated unconditionally again — one goal reads "WIPE ALL 1"');
  });

  test('the singular accessibility label is still the one used for a single goal', () => {
    assert.match(src, /goals\.length === 1 \? 'wipeAllA11yOne' : 'wipeAllA11y'/);
  });

  test('both languages read as words with the number gone', () => {
    // The whole fix rests on the bare label standing alone, so pin that it
    // does in both — a future `wipeAll: 'WIPE ALL {n}'` would break it
    // silently and this is the only place that would notice.
    for (const lang of ['en', 'es'] as const) {
      assert.doesNotMatch(t(lang, 'wipeAll'), /\{n\}|\d/,
        `${lang} wipeAll must be a complete label on its own`);
    }
    assert.equal(t('en', 'wipeAll'), 'WIPE ALL');
    assert.equal(t('es', 'wipeAll'), 'BORRAR TODAS');
  });
});

/*
 * The same shape, anywhere else on the four screens.
 *
 * `{T('someLabel')} {things.length}` is the exact construction that produced
 * "WIPE ALL 1". It is always suspicious: either the label already implies a
 * plural, or the number needs a singular form. This sweeps for it rather than
 * waiting for the next one to be found by eye on a seeded database.
 */
describe('no screen concatenates a raw count onto a translated label', () => {
  const files = readdirSync(APP).filter(f => f.endsWith('.tsx'));

  test('every screen is checked, so this cannot pass by finding nothing', () => {
    assert.ok(files.length >= 5, `only found ${files.length} screens to check`);
  });

  for (const f of files) {
    test(`${f} has no bare "{T('x')} {y.length}"`, () => {
      const src = strip(read(path.join(APP, f)));
      const hits = src.match(/\{T\('[a-zA-Z]+'\)\}\s*\{[a-zA-Z.]+\.length\}/g) ?? [];
      assert.deepEqual(hits, [],
        `${f} pastes a count straight onto a label — it will read "... 1" for a single item`);
    });
  }
});

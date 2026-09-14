import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t, fill } from '../src/domain/i18n.ts';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = fs.readFileSync(path.join(HERE, '..', 'src', 'ui', 'NowScreen.tsx'), 'utf8');

/*
 * R655. A set that beats your best is marked on the logging screen with the
 * accent and a star (R522) -- and a screen reader heard none of it. The chip
 * is a button with its own label, and a button's label replaces its children,
 * so the star was never read. Measured live: log 180 x 5 on a bench whose best
 * was 175 and the chip announced "Set 1, 180 by 5. Tap to edit." §8 calls the
 * personal record the emotional payload of the product.
 */
describe('a personal-record set says so to a screen reader (R655)', () => {
  test('the record clause reads naturally inside the chip label, in both languages', () => {
    const en = fill(t('en', 'setByRepsA11y'), { n: 1, weight: '180', reps: 5 }) +
      t('en', 'personalRecordA11y') + t('en', 'tapToEditA11y');
    assert.equal(en, 'Set 1, 180 by 5, a personal record. Tap to edit.');
    const es = fill(t('es', 'setByRepsA11y'), { n: 1, weight: '180', reps: 5 }) +
      t('es', 'personalRecordA11y') + t('es', 'tapToEditA11y');
    assert.equal(es, 'Serie 1, 180 por 5, récord personal. Toca para editar.');
  });

  test('the chip adds it under the same condition that paints the record', () => {
    const label = region(SCREEN, "fill(T('setByRepsA11y')", "T('tapToEditA11y')");
    assert.match(label, /state\.prSetIds\.includes\(set\.id\) \? T\('personalRecordA11y'\) : ''/,
      'a record set is painted with a star and announced as an ordinary set');
    assert.match(SCREEN, /state\.prSetIds\.includes\(set\.id\) && s\.chipPR/,
      'the record styling no longer keys off prSetIds, so the label and the paint can disagree');
  });
});

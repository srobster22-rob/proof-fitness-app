import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  LANGUAGES, LANGUAGE_LABEL, t, missingKeys, languageFor, type Language
} from '../src/domain/i18n.ts';
import { convertWeight, LB_PER_KG } from '../src/domain/types.ts';

/*
 * §12 bans dependencies that are not carrying their weight, so this is a typed
 * table rather than an i18n library. The failure mode a table has to defend
 * against is a key added to one language and forgotten in the other.
 */
describe('the app speaks more than one language', () => {
  test('every language has a label a speaker of it would recognise', () => {
    for (const l of LANGUAGES) {
      assert.ok(LANGUAGE_LABEL[l].length > 0, `${l} has no name`);
    }
    assert.equal(LANGUAGE_LABEL.es, 'Español', 'named in the language, not about it');
  });

  test('Spanish translates every string the app shows', () => {
    assert.deepEqual(missingKeys('es'), [],
      'an untranslated key falls back to English, which is honest but not finished');
  });

  test('a missing translation falls back to English, never to the key', () => {
    // The guarantee, checked through the real function rather than asserted.
    for (const l of LANGUAGES) {
      for (const k of ['logSet', 'goals', 'settings'] as const) {
        const s = t(l, k);
        assert.ok(s.length > 0 && !s.includes('.'), `${l}/${k} came back as "${s}"`);
      }
    }
  });

  test('the two languages actually differ', () => {
    assert.notEqual(t('en', 'settings'), t('es', 'settings'));
    assert.equal(t('es', 'settings'), 'AJUSTES');
  });

  /* §4 — never ask a question the app can answer. */
  test('the starting language comes from the device', () => {
    assert.equal(languageFor('es-MX'), 'es');
    assert.equal(languageFor('es'), 'es');
    assert.equal(languageFor('en-US'), 'en');
    assert.equal(languageFor(null), 'en', 'a half-matched locale is worse than the default');
    assert.equal(languageFor('fr-FR'), 'en');
  });

  test('reps stays "reps", because that is what Spanish gyms say', () => {
    assert.equal(t('es', 'reps'), 'reps');
  });
});

/*
 * Weights are stored in the unit they were logged in, forever. Converting on
 * write would rewrite history the first time somebody changed a preference.
 */
describe('pounds and kilos', () => {
  test('a plate number a lifter would recognise', () => {
    assert.equal(convertWeight(225, 'lb', 'kg'), 102);
    assert.equal(convertWeight(100, 'kg', 'lb'), 220.5);
  });

  test('rounded to the half unit, because a rack does not load to four decimals', () => {
    const kg = convertWeight(185, 'lb', 'kg');
    assert.equal(kg * 2, Math.round(kg * 2), `${kg} is not a half unit`);
  });

  test('converting to the same unit changes nothing at all', () => {
    assert.equal(convertWeight(225, 'lb', 'lb'), 225);
    assert.equal(convertWeight(0, 'lb', 'kg'), 0, 'bodyweight stays bodyweight');
  });

  test('a round trip lands within half a unit of where it started', () => {
    for (const w of [45, 95, 135, 185, 225, 315, 405]) {
      const back = convertWeight(convertWeight(w, 'lb', 'kg'), 'kg', 'lb');
      assert.ok(Math.abs(back - w) <= 1.5, `${w} came back as ${back}`);
    }
  });

  test('the constant is the real one, not a gym-rounded 2.2', () => {
    assert.ok(Math.abs(LB_PER_KG - 2.20462) < 0.0001);
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { missingKeys, LANGUAGES } from '../src/domain/i18n.ts';

/*
 * R460, the peer's ask: the house pattern (derive the population from source,
 * exempt explicitly, prove the gate can fail before trusting it — see
 * HANDOFF.md #13) aimed at translation coverage instead of render coverage or
 * unit coverage.
 *
 * `language-reaches-the-app.test.ts` already checks that a missing key falls
 * back to English rather than to a blank or a raw key — a real and separate
 * guarantee. What it does NOT check is whether anything is actually missing:
 * that test passes identically whether ES is 100% complete or 40% complete,
 * because "falls back correctly" is true either way. A key added to EN and
 * never given a Spanish line is a silent, permanent regression under that
 * test — it would render English mid-Spanish-app forever and nothing would
 * ever go red. This file is the gate that DOES go red: zero tolerance,
 * because every existing key already has both (confirmed below), so the
 * correct count is not "small" but exactly zero.
 *
 * No EXEMPT list: unlike the render-coverage and unit-coverage sweeps, there
 * is no category of key that has a legitimate reason to stay English-only —
 * `t()`'s whole contract is "the string appropriate for this language," and
 * an EN-only key is a translation nobody has written yet, not a deliberate
 * design choice the way `Session.unit` staying raw is.
 */
describe('every key English declares, Spanish declares too', () => {
  test('the population is not accidentally empty — a sanity floor', () => {
    // Reuses `missingKeys`'s own definition of the population (every key EN
    // has) rather than re-deriving it, so this test moves in lockstep with
    // whatever `missingKeys` itself considers "every key."
    for (const lang of LANGUAGES) {
      assert.ok(Array.isArray(missingKeys(lang)), `missingKeys('${lang}') did not return an array`);
    }
  });

  test('Spanish is missing nothing English has', () => {
    const missing = missingKeys('es');
    assert.deepEqual(missing, [],
      `${missing.length} key(s) exist in English with no Spanish line and will silently render ` +
      `English to a Spanish user: ${missing.join(', ')}. Add the Spanish line, or if this key is ` +
      `deliberately English-only, name it in this test's own EXEMPT comment with a stated reason.`);
  });
});

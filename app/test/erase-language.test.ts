import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import { erasureLine, erasureCounts, erasureIsSingle } from '../src/ui/progress-model.ts';
import { t, fill, LANGUAGES, type Language } from '../src/domain/i18n.ts';
import { region, upTo } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DAY = 86_400_000;
const T = Date.UTC(2026, 7, 24, 8);
const fresh = () => new Repo(new DatabaseSync(':memory:') as never, () => T);

function loaded(): Repo {
  const repo = fresh();
  for (let i = 0; i < 2; i++) {
    repo.startSession(`s${i}`, 'lb', undefined, T - i * DAY);
    for (let k = 0; k < 3; k++) {
      repo.logSet({ id: `x${i}_${k}`, sessionId: `s${i}`, exerciseId: 'bench',
        weight: 135, reps: 5, at: T - i * DAY } as never);
    }
    repo.endSession(`s${i}`, T - i * DAY + 60_000);
  }
  repo.saveMeasurement({ id: 'w', kind: 'bodyweight', value: 185, unit: 'lb', at: T } as never);
  return repo;
}

/*
 * R480. `erasureLine` built its sentence from English literals — the category
 * words, the joining "and", and the "Nothing" fallback — so a Spanish lifter
 * read "Se eliminará 700 workouts, 14,000 sets and 3 measurements" and then
 * pressed the button that destroys everything they have ever logged.
 *
 * §11 makes the export file the only backup and there is no server, so this is
 * the one dialog in the app where misreading it cannot be undone. It is also
 * the last place a half-translated sentence should survive: R450's own sweep
 * went through this screen for accessibility and R221's for the card's labels,
 * and both walked past this string because it is assembled in a model rather
 * than written in a .tsx, where every earlier i18n sweep was looking.
 */
describe('the erase warning speaks the lifter\'s language (§11)', () => {
  test('English is unchanged, which is what the existing erase tests assert', () => {
    const line = erasureLine(loaded());
    assert.match(line, /2 workouts/);
    assert.match(line, /6 sets/);
    assert.match(line, /1 measurement\b/);
    assert.match(line, / and /, 'the joining word went missing');
  });

  test('and Spanish is actually Spanish, not English with Spanish numbers', () => {
    const line = erasureLine(loaded(), 'es');
    assert.match(line, /2 entrenamientos/);
    assert.match(line, /6 series/);
    assert.match(line, /1 medición/);
    assert.match(line, / y /, 'the list still joins with the English "and"');
    // The real assertion: not one English category word survives.
    for (const english of [
      'workout', 'set', 'goal', 'measurement', 'custom exercise', 'setting', ' and '
    ]) {
      assert.ok(!line.includes(english),
        `"${english}" is still English in the Spanish erase warning: "${line}"`);
    }
  });

  test('the empty case is translated too, not a bare "Nothing"', () => {
    assert.equal(erasureLine(fresh(), 'en'), 'Nothing');
    assert.equal(erasureLine(fresh(), 'es'), 'Nada');
  });

  /*
   * The population is derived, not listed: every key `erasureCounts` can
   * return has to resolve in every language. Written this way so a category
   * added later cannot ship half-translated — which is exactly how the words
   * this round replaced got there.
   */
  test('every category key resolves in every language', () => {
    const src = readFileSync(path.join(HERE, '..', 'src', 'ui', 'progress-model.ts'), 'utf8');
    const body = region(src, 'export function erasureCounts', 'filter(([n]) => n > 0)');
    const keys = [...body.matchAll(/'([a-zA-Z]+)'/g)].map(m => m[1]);
    assert.ok(keys.length >= 12,
      `only ${keys.length} category keys found — the scan went stale, or the ` +
      'tuples stopped being i18n keys and went back to literals');
    /*
     * Checked by PRESENCE in each table, not by "the word differs from the key
     * name" — which is what this asserted first, and it failed on `sets`, whose
     * English value legitimately IS "sets". `t()` falls back to English for a
     * missing key, so a Spanish gap is silent at runtime and only a source
     * check can see it.
     */
    const i18n = readFileSync(path.join(HERE, '..', 'src', 'domain', 'i18n.ts'), 'utf8');
    // Through the guarded helpers, not a bare `indexOf` — a moved anchor must
    // fail loudly rather than silently reading the wrong half of the file.
    // (Written with `slice(indexOf(...))` first; the standing sweep in
    // `source-helper.test.ts` caught it, which is the sweep working.)
    const es = region(i18n, 'const ES');
    const en = upTo(i18n, 'const ES');
    for (const key of keys) {
      assert.match(en, new RegExp(`\\n\\s*${key}:`), `${key} is missing from the EN table`);
      assert.match(es, new RegExp(`\\n\\s*${key}:`),
        `${key} is missing from the ES table — t() falls back to English, so ` +
        'this renders an English word inside the Spanish erase warning');
    }
  });

  /*
   * R481. The Spanish body read "Se eliminará 36 entrenamientos" — a singular
   * verb in front of a plural list. English does not inflect there, so the two
   * EN strings are identical on purpose and asserted equal below rather than
   * left to drift.
   */
  test('the Spanish verb agrees with what is being erased', () => {
    const many = fill(t('es', 'eraseBody'), { what: erasureLine(loaded(), 'es') });
    assert.match(many, /^Se eliminarán /,
      'a plural list still takes the singular "Se eliminará"');

    const one = fresh();
    one.saveMeasurement({ id: 'w', kind: 'bodyweight', value: 185, unit: 'lb', at: T } as never);
    assert.equal(erasureIsSingle(one), true, 'one measurement is not being seen as one thing');
    const single = fill(t('es', 'eraseBodyOne'), { what: erasureLine(one, 'es') });
    assert.match(single, /^Se eliminará 1 medición /,
      'the single-item case lost its correct singular verb');
  });

  test('and English keeps one sentence for both, since it does not inflect', () => {
    assert.equal(t('en', 'eraseBody'), t('en', 'eraseBodyOne'),
      'the two English erase bodies have drifted apart — they are the same ' +
      'sentence and only exist as two keys so Spanish can inflect');
    assert.notEqual(t('es', 'eraseBody'), t('es', 'eraseBodyOne'),
      'the Spanish pair stopped differing, so the singular case is unfixed again');
  });

  /*
   * Spanish turns "y" into "e" before a word starting with an i- or hi- sound
   * ("metas e informes"). None of the current categories do, so the rule is
   * not implemented — a branch that can never run would be dead code that
   * `orphan-scan` reports without explaining. This asserts the assumption
   * instead, so adding an "informes" category fails HERE with the reason.
   */
  test('no Spanish category word would need "e" instead of "y"', () => {
    const keys = erasureCounts(loaded()).flatMap(([, one, many]) => [one, many]);
    assert.ok(keys.length > 0, 'no categories to check — the fixture stopped loading data');
    for (const key of keys) {
      const word = t('es' as Language, key as Parameters<typeof t>[1]);
      assert.doesNotMatch(word, /^(i|hi)/i,
        `"${word}" starts with an i- sound, so Spanish would need "e" rather ` +
        'than "y" before it when it lands last in the list — erasureLine hardcodes "y"');
    }
  });
});

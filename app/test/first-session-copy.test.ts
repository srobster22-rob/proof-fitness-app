import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from '../src/domain/i18n.ts';
import { streakWorthShowing } from '../src/ui/recap-model.ts';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, '..', 'app', 'recap.tsx'), 'utf8');

/*
 * §6 makes the first recap the hook: "the first workout produces a recap even
 * if it is one set". Walked from an empty database — one set of 45 × 8 — the
 * card came out right in every way but one. It showed SESSION ONE / THE ONE TO
 * BEAT instead of a PR (§6: claim no PRs on day one), a 360 lb total that
 * checks out, SETS and TIME and no STREAK cell — and then said
 *
 *   "Short one. It still counts — the streak holds."
 *
 * Nothing was held. It started. And the streak it referred to was not on the
 * card at all, because `streakWorthShowing` refuses to print a 1 — so the one
 * line of reassurance in the most important frame the product has pointed at
 * something both untrue and invisible (§16).
 */
describe('the first recap does not claim a streak it does not have', () => {
  test('a first session gets its own line', () => {
    const block = region(src, '{thin && (', ')}');
    assert.match(block, /payload\.firstSession \? 'shortOneFirst' : 'shortOne'/,
      'the first session is told the streak holds again');
  });

  test('and that line claims no streak, in either language', () => {
    for (const lang of ['en', 'es'] as const) {
      const first = t(lang, 'shortOneFirst');
      assert.doesNotMatch(first, /streak|racha/i,
        `${lang} still mentions a streak on a session that has none`);
      assert.ok(first.length > 20, `${lang} first-session line is too short to reassure anyone`);
    }
  });

  test('the continuing line still does mention it, because there it is true', () => {
    assert.match(t('en', 'shortOne'), /streak/);
    assert.match(t('es', 'shortOne'), /racha/);
  });

  test('the two are different sentences', () => {
    // A copy-paste that leaves them identical would pass every test above.
    for (const lang of ['en', 'es'] as const) {
      assert.notEqual(t(lang, 'shortOne'), t(lang, 'shortOneFirst'));
    }
  });

  test('and the card really would have shown no streak to hold', () => {
    // The reason the old line was wrong rather than merely redundant.
    assert.equal(streakWorthShowing(1), false);
  });
});

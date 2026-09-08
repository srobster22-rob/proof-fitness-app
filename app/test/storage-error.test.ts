import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { t } from '../src/domain/i18n.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', 'src', 'ui', 'RepoGate.tsx'), 'utf8');

/**
 * The storage failure screen, walked against a deliberately corrupted store.
 *
 * It handles the case well — "your sets are still on this device", the
 * diagnostic present but not leading, and no destructive button, which
 * RepoGate's own docstring argues for on §11 grounds: deleting is the obvious
 * "fix" and it destroys the only copy of the history that exists.
 *
 * What it did not do was stop giving advice it could see was not working. TRY
 * AGAIN failed identically every time while the screen went on saying "closing
 * and reopening usually clears it" — true of a locked file or a half-finished
 * migration, false of a corrupt one — with no other guidance offered and no way
 * forward. Repeated failure is itself information.
 *
 * R405: this copy moved into the i18n table (RepoGate is the one screen that
 * cannot read the LANGUAGE preference through `repo.getPref`, since it renders
 * exactly when the repo may have failed to open — it uses the device locale
 * instead). These tests moved from matching RepoGate.tsx's own source text to
 * matching the table, since the words themselves no longer live in the source.
 */
describe('the storage error stops repeating advice that fails (§11)', () => {
  test('the guidance depends on how many attempts have failed', () => {
    assert.match(SRC, /attempt < 2/,
      'the same reassurance was printed however many times retrying had failed');
    assert.match(SRC, /repoGateBody2Early/);
    assert.match(SRC, /repoGateBody2Late/);
  });

  test('the first message still offers the cheap fix', () => {
    assert.match(t('en', 'repoGateBody2Early'), /usually clears it/,
      'most storage errors really are transient — that advice is right first');
  });

  test('the later message names the two real outcomes, in both languages', () => {
    for (const lang of ['en', 'es'] as const) {
      const late = t(lang, 'repoGateBody2Late');
      assert.match(late, lang === 'en' ? /not temporary/ : /no.*temporal/i);
      assert.match(late, /back|recuperará/i,
        'a user with a backup needs telling it is the way out');
      assert.match(late, /reinstalling|reinstalar/i,
        'and a user without one needs to know what reinstalling costs');
    }
  });

  test('it still refuses to offer a destructive button', () => {
    // The labels themselves now live in the table, not the source — check
    // every RepoGate key that ends up on a button/label in both languages.
    const keys = ['repoGateRetry', 'repoGateSend', 'repoGateSendA11y'] as const;
    for (const lang of ['en', 'es'] as const) {
      for (const key of keys) {
        const label = t(lang, key);
        assert.doesNotMatch(label, /ERASE|DELETE|START OVER|RESET|BORRAR TODO|REINICIAR/i,
          `a destructive button here throws away the data the screen just promised was safe: ${lang}.${key} = "${label}"`);
      }
    }
  });

  test('the diagnostic is present but not the headline', () => {
    const title = SRC.indexOf("T('repoGateTitle')");
    const detail = SRC.indexOf('s.detailText');
    assert.ok(title > 0 && detail > title,
      'the error message must sit below the reassurance, not lead with it');
    assert.match(SRC, /selectable/, 'the user has to be able to copy it to send it');
  });

  test('the screen picks its language from the device, not the (possibly broken) repo', () => {
    // Comments stripped first — RepoGate.tsx's OWN doc comment names the
    // pattern being ruled out as an example, which trips a raw string match
    // against itself.
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    assert.doesNotMatch(code, /repo\.getPref\(PREF_LANG\)/,
      'this is the one screen that renders when the repo may have failed to open');
    assert.match(code, /languageFor\(deviceLocale\(\)\)/);
  });
});

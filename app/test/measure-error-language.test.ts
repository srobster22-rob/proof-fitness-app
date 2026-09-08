import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { recordMeasurement, saveMeasureGoal } from '../src/ui/measure-model.ts';
import { measureGoalMessage } from '../src/domain/measure-goal.ts';
import { PREF_LANG } from '../src/domain/i18n.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DAY = 86_400_000;
const T = Date.UTC(2026, 7, 24, 9);
const fresh = () => new Repo(new DatabaseSync(':memory:') as any, () => T);

/**
 * The two dynamic error messages on the YOU screen — the ones a naive sweep
 * for `<Text>` literals cannot see, because they are returned from a function
 * and only reach a `<Text>` through a variable. Same shape as `backup.ts`'s
 * gap: this session's language pass caught every STATIC label on this screen
 * and missed both messages that actually explain a mistake.
 */
describe('the YOU screen explains a rejected number in the chosen language', () => {
  test('an implausible reading', () => {
    const repo = fresh();
    repo.setPref(PREF_LANG, 'es');
    const r = recordMeasurement(repo, 'bodyweight', '4000', 'kg', T);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'Eso no parece un valor de peso corporal en kg.');
  });

  test('and defaults to English for a device that never chose', () => {
    const r = recordMeasurement(fresh(), 'bodyweight', '4000', 'kg', T);
    assert.equal(r.error, 'That does not look like a bodyweight in kg.');
  });

  test('the kind name in the error matches the card heading exactly', () => {
    // Height uses a different word than bodyweight — confirms the lookup is
    // keyed on the KIND actually passed in, not hardcoded to one of them.
    const repo = fresh();
    repo.setPref(PREF_LANG, 'es');
    const r = recordMeasurement(repo, 'height', '9999', 'cm', T);
    assert.match(r.error!, /altura/);
    assert.doesNotMatch(r.error!, /peso corporal/);
  });
});

describe('a rejected target explains itself in the chosen language', () => {
  test('every reason has a Spanish sentence', () => {
    for (const err of ['implausible', 'already-there', 'no-reading', 'past-date', 'duplicate'] as const) {
      const es = measureGoalMessage(err, 'es');
      const en = measureGoalMessage(err, 'en');
      assert.notEqual(es, en, `${err} is not translated`);
      assert.ok(es.length > 0);
    }
  });

  test('defaults to English when no language is given', () => {
    assert.equal(measureGoalMessage('past-date'), measureGoalMessage('past-date', 'en'));
  });

  test('reached through the screen: no reading yet, in Spanish', () => {
    const repo = fresh();
    repo.setPref(PREF_LANG, 'es');
    const r = saveMeasureGoal(repo, 'bodyweight', '175', 'lb', T + 90 * DAY, T);
    assert.equal(r.ok, false);
    assert.match(r.error!, /Registra primero dónde estás/);
  });

  test('reached through the screen: a target already met, in Spanish', () => {
    const repo = fresh();
    repo.saveMeasurement({ id: 'w', kind: 'bodyweight', value: 175, unit: 'lb', at: T - DAY });
    repo.setPref(PREF_LANG, 'es');
    const r = saveMeasureGoal(repo, 'bodyweight', '175', 'lb', T + 90 * DAY, T);
    assert.equal(r.ok, false);
    assert.match(r.error!, /Ya estás ahí/);
  });
});

/*
 * The accessibility labels on the YOU screen — invisible on screen, read only
 * by VoiceOver/TalkBack — escaped both the visible-text sweep (they are not
 * rendered `<Text>`) and the dynamic-error pass earlier in this file (they are
 * not error prose). Found by opening the actual sheet with the actual
 * aria-label as the selector and getting "not found", because the label was
 * still asking for it in English on an otherwise all-Spanish screen.
 *
 * A source test, like the sweeps in `language-reaches-the-app.test.ts`: the
 * literal strings themselves were removed from the file, so a regression back
 * to hardcoded English is a `readFileSync` + `match` away from being caught.
 */
describe('accessibility labels follow the language too', () => {
  const src = readFileSync(
    path.join(HERE, '..', 'app', 'measure.tsx'), 'utf8'
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

  test('no accessibilityLabel is a bare English sentence', () => {
    const labels = [...src.matchAll(/accessibilityLabel=(?:"([A-Z][^"]*)"|\{`([A-Z][^`]*)`\})/g)]
      .map(m => m[1] ?? m[2]);
    assert.deepEqual(labels, [],
      `these accessibility labels ignore the LANGUAGE setting: ${labels.join(' | ')}`);
  });

  test('the kind name in an accessibility label comes from the table', () => {
    assert.doesNotMatch(src, /profile\.label/,
      '`profile.label` is the domain\'s English name; the screen must use T(KIND_KEY[kind])');
    assert.doesNotMatch(src, /row\.label/,
      'same for the per-row form of the same name');
  });

  test('the note placeholder and its fallback save error are both translated', () => {
    assert.doesNotMatch(src, /placeholder="morning/);
    assert.doesNotMatch(src, /'Could not save that\.'/);
    assert.match(src, /T\('notePlaceholder'\)/);
    assert.match(src, /T\('couldNotSave'\)/);
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { exportAll, serialize, parse, restore, summarise } from '../src/data/portable.ts';
import { prepareBackup, applyBackup } from '../src/ui/backup-model.ts';
import { PREF_LANG } from '../src/domain/i18n.ts';

const DAY = 86_400_000;
const T = Date.UTC(2026, 7, 24, 9);
const fresh = () => new Repo(new DatabaseSync(':memory:') as any, () => T);

/**
 * The rest of the app got a language pass — this corner did not.
 *
 * `summarise()`, the export summary and every message in `backup.ts` are
 * plain prose reaching the ONE screen whose whole job is reassuring somebody
 * about their data, and until now they read in English regardless of the
 * LANGUAGE setting: exporting a Spanish-language install still shared a file
 * captioned "Exported 2 sets across 1 session."
 */
describe('the backup screen speaks the chosen language', () => {
  function populated() {
    const repo = fresh();
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'x1', sessionId: 's1', exerciseId: 'bench', weight: 185, reps: 5, at: T - DAY });
    repo.endSession('s1', T - DAY + 60_000);
    repo.setPref(PREF_LANG, 'es');
    return repo;
  }

  test('the export summary is drawn in the chosen language', () => {
    const repo = populated();
    const { summary } = prepareBackup(repo, T);
    assert.equal(summary, '1 serie en 1 sesión');
  });

  test('and defaults to English for a device that never chose', () => {
    const repo = fresh();
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'x1', sessionId: 's1', exerciseId: 'bench', weight: 185, reps: 5, at: T - DAY });
    repo.endSession('s1', T - DAY + 60_000);
    const { summary } = prepareBackup(repo, T);
    assert.equal(summary, '1 set across 1 session');
  });

  test('a successful restore reports back in Spanish', () => {
    const repo = populated();
    const text = serialize(exportAll(repo, T));
    repo.eraseAll();
    repo.setPref(PREF_LANG, 'es');   // eraseAll wipes prefs too — the choice must survive the test's own setup
    const outcome = applyBackup(repo, text);
    assert.equal(outcome.ok, true);
    assert.match(outcome.message, /^Restaurado:/);
    assert.match(outcome.message, /serie/);
    assert.match(outcome.message, /sesión/);
  });

  /*
   * The plural forms matter on their own: Spanish does not pluralise by
   * appending "s" the way `count`'s English default does ("sesión" ->
   * "sesiones", not "sesións"), so a lazy default would have shipped a typo
   * in every restore of more than one session.
   */
  test('plurals are the real Spanish plurals, not English-shaped', () => {
    const repo = fresh();
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'a', sessionId: 's1', exerciseId: 'bench', weight: 185, reps: 5, at: T - 2 * DAY });
    repo.endSession('s1', T - 2 * DAY + 60_000);
    repo.startSession('s2', 'lb');
    repo.logSet({ id: 'b', sessionId: 's2', exerciseId: 'bench', weight: 190, reps: 5, at: T - DAY });
    repo.endSession('s2', T - DAY + 60_000);
    const text = serialize(exportAll(repo, T));

    const target = fresh();
    target.setPref(PREF_LANG, 'es');
    const outcome = applyBackup(target, text);
    assert.match(outcome.message, /2 sesiones/, 'not "2 sesións"');
    assert.match(outcome.message, /2 series/);
  });

  test('the skip count is translated too', () => {
    const repo = populated();
    const text = serialize(exportAll(repo, T));
    // Do NOT erase — restoring onto a device that already has this data
    // produces a skip, which is the sentence's "awkward part".
    const outcome = applyBackup(repo, text);
    assert.match(outcome.message, /omitidos/);
    assert.doesNotMatch(outcome.message, /skipped/);
  });

  /*
   * `applyBackup`'s own catch is a defensive backstop — `restore()` already
   * catches everything it can throw internally — so it is exercised directly
   * here with a repo double, rather than hunting for a real input that trips it.
   */
  test('a thrown restore error is translated, and the reason survives inside it', () => {
    const angry = {
      getPref: (k: string) => (k === PREF_LANG ? 'es' : null),
      exercises: () => { throw new Error('disk is full'); }
    };
    const text = serialize(exportAll(fresh(), T));
    const outcome = applyBackup(angry as never, text);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.message, 'Error al restaurar: disk is full');
  });

  test('summarise itself defaults to English for every existing caller', () => {
    const report = {
      ok: true as const,
      added: { exercises: 0, sessions: 1, sets: 1, goals: 0, measurements: 0, measureGoals: 0, prefs: 0 },
      skipped: []
    };
    assert.equal(summarise(report), 'Restored 1 set, 1 session.');
    assert.equal(summarise(report, 'es'), 'Restaurado: 1 serie, 1 sesión.');
  });

  test('a plain restore failure is translated', () => {
    const failed = { ok: false as const, added: {
      exercises: 0, sessions: 0, sets: 0, goals: 0, measurements: 0, measureGoals: 0, prefs: 0
    }, skipped: [] };
    assert.equal(summarise(failed), 'Restore failed.');
    assert.equal(summarise(failed, 'es'), 'Error al restaurar.');
  });
});

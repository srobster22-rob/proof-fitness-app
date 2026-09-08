import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { erasureCounts } from '../src/ui/progress-model.ts';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const REPO_SRC = fs.readFileSync(path.join(APP, 'src', 'data', 'repo.ts'), 'utf8');
const DAY = 86_400_000;
const T = Date.UTC(2026, 8, 9, 12);

/**
 * Which counted category speaks for each table `eraseAll` empties.
 *
 * A map with a REASON per row, not a list of names — the two entries that are
 * not one-to-one are exactly where a reader would otherwise assume a gap.
 */
const SPOKEN_FOR: Record<string, string> = {
  sets: 'counted directly as "sets"',
  sessions: 'counted directly as "workouts"',
  goals: 'counted directly as "goals"',
  measurements: 'counted as "measurements"',
  measure_goals: 'folded into "measurements" — "1 measurement, 1 target" reads as ' +
    'bookkeeping, and summarise makes the same choice',
  exercises: 'counted as "custom exercises" ONLY — seedBuiltins puts the starting ' +
    'twelve straight back, so a builtin is not lost and must not be claimed as lost'
};

/*
 * R561. ERASE EVERYTHING is the one irreversible action in the app, and §11
 * makes the export file the only backup — so the sentence a user reads before
 * tapping it is load-bearing in a way no other copy is.
 *
 * The defect here has recurred TWICE. R480: the categories were English
 * literals, so a Spanish lifter read "Se eliminará 700 workouts, 14,000 sets
 * and 3 measurements". R446: the sentence named four things while `eraseAll`
 * also destroyed a custom exercise and every changed setting, silently, both
 * verified live.
 *
 * `erase.test.ts` guards the six categories that exist today by naming them.
 * That cannot catch the third occurrence, because the failure mode IS a new
 * thing being deleted without being named — a hand-kept list is exactly what
 * the last two rounds of this were about (HANDOFF #13).
 *
 * So the population comes from `eraseAll`'s own SQL: every table it empties has
 * to be spoken for above, with a reason.
 */
describe('the erase warning names everything erase deletes (R561)', () => {
  /** Tables `eraseAll` empties, read from its body rather than remembered. */
  function tablesErased(): string[] {
    const body = region(REPO_SRC, 'eraseAll(): void {', 'seedBuiltins();');
    const found = [...body.matchAll(/DELETE FROM (\w+)/g)].map(m => m[1]);
    // Trap 16: an extraction that finds nothing must fail loudly, not agree.
    if (!found.length) throw new Error('no DELETE statements found — eraseAll moved');
    return [...new Set(found)];
  }

  test('the scan finds the deletes it is supposed to', () => {
    const tables = tablesErased();
    assert.ok(tables.length >= 6, `only found ${tables.length}: ${tables.join(', ')}`);
    for (const t of ['sets', 'sessions', 'goals']) {
      assert.ok(tables.includes(t), `the scan missed ${t}; its anchor has drifted`);
    }
  });

  test('every table it empties is spoken for in the sentence', () => {
    const unspoken = tablesErased().filter(t => !(t in SPOKEN_FOR) && t !== 'meta');
    assert.deepEqual(unspoken, [],
      'erase destroys these and the warning never names them — the R446 defect, ' +
      'a third time: ' + unspoken.join(', '));
  });

  test('and the preferences it deletes are counted too', () => {
    /*
     * `meta` is excluded above because erase does not empty it — it deletes the
     * `pref.%` rows and deliberately keeps the schema version. So the check is
     * that the prefs deletion exists AND is counted, rather than that the table
     * is cleared.
     */
    const body = region(REPO_SRC, 'eraseAll(): void {', 'seedBuiltins();');
    assert.match(body, /DELETE FROM meta WHERE key LIKE 'pref\.%'/,
      'settings are no longer deleted, or are deleted differently — recheck the sentence');
    assert.doesNotMatch(body, /DELETE FROM meta(?! WHERE)/,
      'erase now empties the whole meta table, which takes the schema version with it');
  });

  test('a device holding one of everything has every one of them named', () => {
    /*
     * The behavioural half. The source check above proves the categories are
     * complete; this proves they are non-zero and reach the sentence together,
     * which is what the user actually reads.
     */
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => T);
    repo.startSession('s1', 'lb', undefined, T - DAY);
    repo.logSet({ id: 'x1', sessionId: 's1', exerciseId: 'bench', weight: 135, reps: 5, at: T - DAY + 60_000 });
    repo.endSession('s1', T - DAY + 3600_000);
    repo.saveGoal({ id: 'g1', exerciseId: 'bench', targetWeight: 225, targetReps: 5,
      createdAt: T - 30 * DAY, targetDate: T + 60 * DAY, unit: 'lb' });
    repo.saveMeasurement({ id: 'm1', kind: 'bodyweight', value: 180, unit: 'lb', at: T - DAY });
    repo.addExercise('sledpush', 'Sled Push');
    repo.setPref('jump.lb', '10');

    const named = erasureCounts(repo).map(([, one]) => one);
    for (const key of ['eraseWorkoutOne', 'setOne', 'eraseGoalOne', 'eraseMeasurementOne',
                       'eraseCustomExerciseOne', 'eraseSettingOne']) {
      assert.ok(named.includes(key), `${key} is not in the warning: ${named.join(', ')}`);
    }

    repo.eraseAll();
    assert.deepEqual(erasureCounts(repo), [],
      'after erasing everything the device still claims to hold something');
  });
});

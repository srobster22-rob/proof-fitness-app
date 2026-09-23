import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { erasureLine, erasureCounts } from '../src/ui/progress-model.ts';

const DAY = 86_400_000;
const T = Date.UTC(2026, 7, 24, 8);
const fresh = () => new Repo(new DatabaseSync(':memory:') as any, () => T);

function trained(repo: Repo, sessions = 1, setsEach = 1) {
  for (let i = 0; i < sessions; i++) {
    repo.startSession(`s${i}`, 'lb', undefined, T - i * DAY);
    for (let k = 0; k < setsEach; k++) {
      repo.logSet({ id: `x${i}_${k}`, sessionId: `s${i}`, exerciseId: 'bench',
        weight: 135, reps: 5, at: T - i * DAY });
    }
    repo.endSession(`s${i}`, T - i * DAY + 60_000);
  }
}

/*
 * Found by walking the confirmation on the running app with a stress database
 * loaded. It read "700 workouts, 14,000 sets and 100 goals will be deleted" —
 * and `eraseAll` also drops every measurement and every measurement target.
 *
 * A destructive confirmation that under-reports what it destroys is worse than
 * one that says nothing, because the user has read it and now believes they
 * know what they are agreeing to.
 */
describe('the erase warning names everything erase deletes', () => {
  test('measurements are counted, because they are deleted', () => {
    const repo = fresh();
    trained(repo, 2, 3);
    repo.saveMeasurement({ id: 'w', kind: 'bodyweight', value: 185, unit: 'lb', at: T });
    assert.match(erasureLine(repo), /measurement/);
  });

  test('so is a measurement target', () => {
    const repo = fresh();
    trained(repo);
    repo.saveMeasureGoal({
      id: 'mg', kind: 'bodyweight', target: 175, unit: 'lb',
      targetDate: T + 90 * DAY, createdAt: T });
    assert.match(erasureLine(repo), /1 measurement/);
  });

  /*
   * The check that actually holds the line: every table `eraseAll` empties has
   * to be represented, so adding a table and forgetting the sentence fails
   * here rather than in front of somebody about to delete their training.
   */
  test('nothing survives that the sentence did not mention', () => {
    const repo = fresh();
    trained(repo, 3, 4);
    repo.saveGoal({ id: 'g', exerciseId: 'bench', targetWeight: 225, targetReps: 5,
      targetDate: T + 90 * DAY, unit: 'lb', createdAt: T });
    repo.saveMeasurement({ id: 'w', kind: 'bodyweight', value: 185, unit: 'lb', at: T });
    repo.saveMeasureGoal({ id: 'mg', kind: 'bodyweight', target: 175, unit: 'lb',
      targetDate: T + 90 * DAY, createdAt: T });
    // R446: live-verified live in the running app, the same way the R290-class
    // fix at the top of this file was — a custom exercise and a changed
    // setting, both erased for real, neither ever named in the sentence.
    repo.addExercise('custom-lunge', 'Walking Lunge');
    repo.setPref('jump.lb', '77');

    const before = {
      sets: repo.allSets().length,
      goals: repo.goals().length,
      measurements: repo.measurements().length,
      measureGoals: repo.measureGoals().length,
      customExercises: repo.customExerciseCount(),
      prefs: Object.keys(repo.allPrefs()).length
    };
    for (const [k, v] of Object.entries(before)) assert.ok(v > 0, `${k} was empty to begin with`);

    // Everything non-empty is named in the sentence, once.
    const line = erasureLine(repo);
    assert.match(line, /3 workouts/);
    assert.match(line, /12 sets/);
    assert.match(line, /1 goal\b/);
    assert.match(line, /2 measurements/, 'the reading and the target');
    assert.match(line, /1 custom exercise\b/);
    assert.match(line, /1 setting\b/);

    repo.eraseAll();
    assert.deepEqual(
      [repo.allSets().length, repo.goals().length,
       repo.measurements().length, repo.measureGoals().length,
       repo.customExerciseCount(), Object.keys(repo.allPrefs()).length],
      [0, 0, 0, 0, 0, 0],
      'erase left something behind that the warning had promised to delete');
  });

  /*
   * R446: found by driving ERASE EVERYTHING on the real running app — the
   * confirm text read "3 workouts, 7 sets, 1 goal and 4 measurements will be
   * deleted" while a custom exercise and a changed jump amount were erased
   * silently alongside them. Same defect this file's own header describes for
   * measurements, recurring for two more things `eraseAll` genuinely drops.
   */
  test('a custom exercise is counted, because it does not come back', () => {
    const repo = fresh();
    trained(repo);
    repo.addExercise('custom-lunge', 'Walking Lunge');
    assert.match(erasureLine(repo), /1 custom exercise\b/);
  });

  test('a builtin exercise is never counted — seedBuiltins puts it straight back', () => {
    const repo = fresh();
    trained(repo); // logs against the builtin 'bench' exercise
    assert.doesNotMatch(erasureLine(repo), /exercise/,
      'the starting twelve survive eraseAll and must not be claimed as lost');
  });

  test('a changed setting is counted, because it is the user\'s own choice', () => {
    const repo = fresh();
    trained(repo);
    repo.setPref('jump.lb', '77');
    assert.match(erasureLine(repo), /1 setting\b/);
  });

  test('a kind with nothing in it is absent, not zero', () => {
    const repo = fresh();
    trained(repo);
    const line = erasureLine(repo);
    assert.doesNotMatch(line, /0 /, '"0 goals" reads as filler, not as information');
    assert.doesNotMatch(line, /measurement/);
  });

  test('singulars are singular', () => {
    const repo = fresh();
    trained(repo, 1, 1);
    assert.equal(erasureLine(repo), '1 workout and 1 set');
  });

  test('and thousands are readable', () => {
    const repo = fresh();
    trained(repo, 2, 700);
    assert.match(erasureLine(repo), /1,400 sets/);
  });

  test('an empty device says so rather than listing nothing', () => {
    assert.equal(erasureLine(fresh()), 'Nothing');
    assert.deepEqual(erasureCounts(fresh()), []);
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import { displayUnit, PREF_UNIT } from '../src/ui/display-unit.ts';
import { progressRows, goalTag, weeklyLine, recentSessions } from '../src/ui/progress-model.ts';
import { createGoal } from '../src/ui/goals-model.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 27, 12);

function seeded(): Repo {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => NOW);
  // Twelve weeks of pounds, the shape a real user arrives with.
  for (let i = 0; i < 12; i++) {
    const id = 's' + i;
    repo.startSession(id, 'lb');
    repo.logSet({
      id: 'set' + i, sessionId: id, exerciseId: 'squat',
      weight: 140 + i * 5, reps: 5, at: NOW - (11 - i) * 7 * DAY
    });
  }
  return repo;
}

/*
 * One answer to "what unit is this shown in", not two.
 *
 * `now-model` honoured the Settings choice through `unitForNewSession`;
 * Progress, Goals, Settings' own jump fields and the weekly comparison each
 * read `lastUsedUnit() ?? 'lb'` and ignored it. Walked on the running app with
 * twelve weeks of pounds and the unit switched to kilograms: the Now screen
 * said **79.5 KG** and Progress said **175 lb** for the same lift at the same
 * moment, until a kilogram session happened to be logged — while the Settings
 * sheet promised, in words, "converted for display".
 */
describe('every surface shows weights in the same unit', () => {
  test('the Settings choice wins over what was last logged', () => {
    const repo = seeded();
    assert.equal(displayUnit(repo), 'lb', 'twelve weeks of pounds should read as pounds');
    repo.setPref(PREF_UNIT, 'kg');
    assert.equal(displayUnit(repo), 'kg',
      'the app is arguing with an answer it asked for (§4)');
  });

  test('with no choice made it follows the history, and then falls back', () => {
    const repo = seeded();
    assert.equal(displayUnit(repo), 'lb');
    const empty = new Repo(new DatabaseSync(':memory:') as never, () => NOW);
    assert.equal(displayUnit(empty), 'lb');
  });

  test('Progress converts every figure once the choice is made', () => {
    const repo = seeded();
    const inLb = progressRows(repo, NOW)[0];
    repo.setPref(PREF_UNIT, 'kg');
    const inKg = progressRows(repo, NOW)[0];
    assert.equal(inLb.unit, 'lb');
    assert.equal(inKg.unit, 'kg');
    // 195 lb is about 88.5 kg. The point is that it MOVED, not the rounding.
    assert.ok(Math.abs(inKg.best - 88.5) < 1,
      `195 lb should read as about 88.5 kg, got ${inKg.best}`);
  });

  test('and so does the rest-day line', () => {
    const repo = seeded();
    assert.match(weeklyLine(repo, NOW)!, / lb /);
    repo.setPref(PREF_UNIT, 'kg');
    assert.match(weeklyLine(repo, NOW)!, / kg /,
      'the weekly comparison kept its own idea of the unit');
  });

  /*
   * R454: `progressRows` (the per-lift trend row, tested two blocks up) had
   * this exact fix. `recentSessions` — the "Recent Workouts" daily-summary
   * list — never called `displayUnit` at all, so a kg lifter saw the trend
   * rows correctly converted and the workout history two inches below them
   * still in pounds. Same bug the header comment above describes, in a
   * sibling function the first fix never reached.
   */
  test('Recent Workouts converts too, not just the trend rows', () => {
    const repo = seeded();
    repo.setPref(PREF_UNIT, 'kg');
    const row = recentSessions(repo)[0];
    assert.equal(row.unit, 'kg');
    // The seeded fixture's last session is 195 lb x 5, about 88.5 kg.
    assert.match(row.lifts[0].best, /88\.5/,
      `Recent Workouts should show the converted weight, got "${row.lifts[0].best}"`);
    assert.doesNotMatch(row.lifts[0].best, /195\b/,
      'the raw pound value is still on a kilogram row');
  });

  test('nothing reads the raw fallback any more', () => {
    // The whole defect was five copies of one expression. `display-unit.ts` is
    // the only place allowed to spell it out.
    for (const dir of ['app', path.join('src', 'ui')]) {
      for (const f of readdirSync(path.join(APP, dir))) {
        if (!/\.tsx?$/.test(f) || f === 'display-unit.ts') continue;
        const src = readFileSync(path.join(APP, dir, f), 'utf8');
        assert.doesNotMatch(src, /lastUsedUnit\(\)\s*\?\?\s*'lb'/,
          `${dir}/${f} decides the display unit for itself again`);
      }
    }
  });
});

/*
 * A goal's target is stored in the unit it was SET in, and compared in that
 * unit deliberately — mixing units in the subtraction would be meaningless.
 * But the two numbers that come out are printed beside figures in the screen's
 * unit, and they were not converted: a 225 lb squat goal read
 * "88.5 × 5   30 TO 225   +11.5 kg" — three numbers in kilos and a target in
 * pounds, on one line, with nothing saying which was which.
 */
describe('a goal target is shown in the unit the row is in', () => {
  const withGoal = () => {
    const repo = seeded();
    const made = createGoal(repo, { exerciseId: 'squat', targetWeight: 225, targetReps: 5,
      unit: 'lb', inDays: 60 }, NOW);
    assert.equal(made.ok, true, `the fixture goal was rejected: ${(made as { error?: string }).error}`);
    return repo;
  };

  test('in pounds it is the number the user typed', () => {
    const row = progressRows(withGoal(), NOW)[0];
    assert.equal(row.goal?.targetWeight, 225);
  });

  test('in kilograms it is converted, not left in pounds', () => {
    const repo = withGoal();
    repo.setPref(PREF_UNIT, 'kg');
    const row = progressRows(repo, NOW)[0];
    assert.ok(row.goal, 'the goal row vanished');
    assert.ok(Math.abs(row.goal!.targetWeight - 102) < 1,
      `225 lb should show as about 102 kg, got ${row.goal!.targetWeight}`);
    assert.match(goalTag(row.goal!), /102/);
    assert.doesNotMatch(goalTag(row.goal!), /225/,
      'the pound target is still on a kilogram row');
  });

  test('conversion cannot turn a hit goal into a near miss', () => {
    /*
     * `achieved` is decided BEFORE converting, so rounding a converted pair
     * can never flip it either way.
     *
     * The goal has to be set while it is still out of reach and then MET,
     * because `validateNewGoal` refuses a target already beaten — "a goal you
     * have already beaten is not a goal". Writing it the other way round is
     * what this test did first, and the guard was right to refuse it.
     */
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => NOW);
    repo.startSession('a', 'lb');
    repo.logSet({ id: 'g1', sessionId: 'a', exerciseId: 'squat', weight: 180, reps: 5, at: NOW - 7 * DAY });
    const made = createGoal(repo, { exerciseId: 'squat', targetWeight: 200, targetReps: 5,
      unit: 'lb', inDays: 60 }, NOW);
    assert.equal(made.ok, true, `goal rejected: ${(made as { error?: string }).error}`);

    repo.startSession('b', 'lb');
    repo.logSet({ id: 'g2', sessionId: 'b', exerciseId: 'squat', weight: 205, reps: 5, at: NOW - DAY });

    repo.setPref(PREF_UNIT, 'kg');
    const row = progressRows(repo, NOW)[0];
    assert.equal(row.goal?.achieved, true, 'a 205 lb squat clears a 200 lb goal');
    assert.equal(row.goal?.remaining, 0);
    // And the tick still names the target in the unit on screen.
    assert.match(goalTag(row.goal!), /9[01]/, `expected about 91 kg, got "${goalTag(row.goal!)}"`);
  });
});

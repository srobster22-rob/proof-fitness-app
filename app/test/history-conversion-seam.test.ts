import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { goalProgress } from '../src/domain/goals.ts';
import { convertWeight } from '../src/domain/types.ts';
import { around } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODEL = fs.readFileSync(path.join(HERE, '..', 'src', 'ui', 'now-model.ts'), 'utf8');
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 9, 12);

/** Benched in pounds, one session in kilos, with a 225 lb goal. */
function switched(): Repo {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  let n = 0;
  for (const [d, w] of [[11, 175], [8, 180], [5, 185]] as [number, number][]) {
    const id = `lb${d}`;
    repo.startSession(id, 'lb');
    repo.logSet({ id: `s${n++}`, sessionId: id, exerciseId: 'bench', weight: w, reps: 5, at: T0 - d * DAY });
    repo.endSession(id, T0 - d * DAY + 3600_000);
  }
  repo.startSession('kg2', 'kg');
  repo.logSet({ id: `s${n++}`, sessionId: 'kg2', exerciseId: 'bench', weight: 86, reps: 5, at: T0 - 2 * DAY });
  repo.endSession('kg2', T0 - 2 * DAY + 3600_000);
  repo.saveGoal({
    id: 'g1', exerciseId: 'bench', targetWeight: 225, targetReps: 5,
    createdAt: T0 - 60 * DAY, targetDate: T0 + 30 * DAY, unit: 'lb'
  });
  return repo;
}

/*
 * R538. `now-model` feeds two consumers from the same history and they want it
 * in OPPOSITE forms, which is the kind of seam that looks like an inconsistency
 * and gets "tidied up".
 *
 *   the coach     needs history ALREADY CONVERTED — it takes a `unit` and does
 *                 no conversion of its own (R537 measured what raw costs: a
 *                 86 kg session read as 86 lb, and a climb read as a 54% drop).
 *   goalProgress  needs history RAW — it takes `sessionUnits` and converts
 *                 internally, per set, because a goal carries its own unit.
 *
 * So `historyInSessionUnit()` for one and `setsFor()` (buckets of `allSets()`)
 * for the other, in the same file, deliberately.
 *
 * Making them "consistent" is the plausible mistake, and it is not a rounding
 * error. Measured: hand `goalProgress` a pre-converted history and it converts
 * again — `current` becomes 418 instead of 189.5 and `remaining` becomes 0, so
 * a lifter benching 189.5 is told they have HIT a 225 goal. Nothing errors.
 */
describe('each consumer gets the history in the form it expects (R538)', () => {
  test('a goal on a mixed-unit history reads the real best', () => {
    const m = new NowModel(switched(), () => T0, 'en-US');
    m.selectExercise('bench');
    const tail = m.state().lastTime.tail;
    assert.match(tail, /36 to 225/,
      `the goal line should be 36 lb short of 225 (best is 86 kg = 189.5 lb). It said: "${tail}"`);
  });

  test('bucketing by exercise did not change the answer', () => {
    // R525 replaced "the whole log" with a per-exercise bucket. Under mixed
    // units that is the moment a conversion could be dropped.
    const repo = switched();
    const goal = repo.goals()[0];
    const whole = goalProgress(goal, repo.allSets(), repo.exercises(), T0, repo.sessionUnits());
    const bucket = goalProgress(
      goal, repo.allSets().filter(s => s.exerciseId === 'bench'),
      repo.exercises(), T0, repo.sessionUnits());
    assert.deepEqual(bucket, whole);
    assert.equal(whole.current, 189.5, 'the 86 kg session is not being converted at all');
  });

  test('converting before goalProgress converts twice, and says the goal is met', () => {
    /*
     * The failure this seam protects against, measured rather than asserted.
     * If this ever stops being wrong, `goalProgress` has changed its contract
     * and the guard below is obsolete rather than merely passing.
     */
    const repo = switched();
    const units = repo.sessionUnits();
    const raw = repo.allSets().filter(s => s.exerciseId === 'bench');
    const preConverted = raw.map(s => {
      const from = units.get(s.sessionId) ?? 'lb';
      return from === 'lb' ? s : { ...s, weight: convertWeight(s.weight, from, 'lb') };
    });
    const doubled = goalProgress(repo.goals()[0], preConverted, repo.exercises(), T0, units);
    assert.equal(doubled.current, 418, 'the double conversion no longer produces 418');
    assert.equal(doubled.remaining, 0,
      'pre-converting no longer reports the goal as met; re-check whether this seam still matters');
  });

  test('the two call sites still use the two different forms', () => {
    /*
     * The one-line change that would break it, in either direction. They sit
     * in the same class, which is exactly why somebody would make them match.
     * The coach's call is made in `callFor()`, for every lift.
     */
    const coachCall = around(MODEL, 'private callFor(', 0, 300);
    assert.match(coachCall, /this\.historyInSessionUnit\(\)/,
      'the coach is being handed raw history, which mixes kilos and pounds');

    const goalCall = around(MODEL, 'goal, this.setsFor(goal.exerciseId)', 0, 160);
    assert.match(goalCall, /this\.setsFor\(goal\.exerciseId\)/);
    assert.doesNotMatch(goalCall, /historyInSessionUnit/,
      'goalProgress is being handed pre-converted history, so every kilogram ' +
      'session is converted twice and the goal reads as met');
  });
});

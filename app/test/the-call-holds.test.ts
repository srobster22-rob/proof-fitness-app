import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { coachSuggestion, callMade, type Suggestion, type TrainingGoal } from '../src/domain/coach.ts';
import type { LoggedSet } from '../src/domain/types.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 6, 29, 18);

/*
 * R682, THE CALL, slice 1. The coach's line read the live workout as evidence,
 * so the call moved while the lifter chased it: "205 and climbing, try 210",
 * then a set of 210 turned it into "210 and climbing, try 215". Nobody could
 * ever finish the call they were given. Now the call is the one they walked in
 * with, and the first set that makes it says so.
 */

/** Squats at the given weights, `gap` days apart and at `at`, oldest first, one set each; then a live workout. */
function history(weights: number[], { reps = 5, gap = 4, at = T0 }: { reps?: number | number[]; gap?: number; at?: number } = {}) {
  const clock = { now: at };
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => clock.now);
  weights.forEach((w, i) => {
    const when = at - (weights.length - i) * gap * DAY;
    const r = Array.isArray(reps) ? reps[i] : reps;
    repo.startSession(`p${i}`, 'lb', undefined, when);
    repo.logSet({ id: `p${i}a`, sessionId: `p${i}`, exerciseId: 'squat', weight: w, reps: r, at: when });
    repo.endSession(`p${i}`, when + 3_600_000);
  });
  const m = new NowModel(repo, () => clock.now, 'en-US');
  m.selectExercise('squat');
  const log = (weight: number, r: number) => {
    m.setWeight(weight);
    m.setReps(r);
    m.log();
    clock.now += 3 * 60_000;
  };
  return { repo, m, log, clock, line: () => m.state().lastTime };
}

describe('the call holds for the whole workout (R682)', () => {
  test('the line is the same before and after every set', () => {
    const { log, line } = history([200, 205]);
    const before = line().head;
    assert.match(before, /try 210/, 'the fixture no longer produces a climbing call');
    for (const [w, r] of [[190, 5], [205, 5], [200, 3]] as const) {
      log(w, r);
      assert.equal(line().head, before, `a set of ${w} × ${r} moved the call`);
    }
  });

  test('a weekly lifter\'s oldest session does not leave the window mid-workout', () => {
    // Squats a week apart, at the time of day this workout starts: two weeks
    // back from `now` loses the older one partway through the lift.
    const { log, line, clock } = history([205, 205], { reps: 8, gap: 7, at: T0 - 20 * 60_000 });
    clock.now = T0 - 20 * 60_000;
    const before = line().head;
    assert.match(before, /205 for 2 sessions — try 210/, 'the fixture no longer produces the call');
    log(210, 8);
    assert.equal(line().made, true);
    clock.now = T0 + 25 * 60_000;
    assert.equal(line().made, true, 'the made call vanished when the window slid');
    assert.equal(line().head, '210×8 — made it');
  });

  test('a set that makes the call says so, and the call stays made', () => {
    const { log, line } = history([200, 205]);
    log(210, 5);
    assert.equal(line().made, true);
    assert.equal(line().head, '210×5 — made it');
    log(200, 5);
    assert.equal(line().made, true, 'a lighter back-off set un-made the call');
    assert.equal(line().head, '210×5 — made it', 'the line moved to the back-off set');
  });

  test('the made line names the set that made it, not the call', () => {
    const { log, line } = history([200, 205]);
    log(210, 8);
    assert.equal(line().head, '210×8 — made it', 'eight reps were reported as the five the call asked for');
  });

  test('a set short of the call, in weight or in reps, does not make it', () => {
    const { log, line } = history([200, 205]);
    log(205, 8);
    assert.equal(line().made, false, 'more reps at the old weight made a call for more weight');
    log(210, 4);
    assert.equal(line().made, false, 'a short set at the new weight made it');
    assert.match(line().head, /try 210/);
  });

  test('the success tap belongs to the set that made it', () => {
    const { log, line } = history([200, 205]);
    log(210, 5);
    assert.equal(line().justMade, true);
    log(215, 5);
    assert.equal(line().made, true);
    assert.equal(line().justMade, false, 'a second qualifying set played the success tap again');
  });

  test('"repeat it before adding" is not made by adding', () => {
    // One session in the window and one before this one: the settle line.
    const { log, line } = history([205, 185], { gap: 4 });
    assert.match(line().head, /First time at 185×5 — repeat it before adding/, 'the fixture no longer settles');
    log(205, 5);
    assert.equal(line().made, false, 'a heavier set made a call that said not to add yet');
    log(185, 5);
    assert.equal(line().made, true);
  });
});

describe('what each call asks for', () => {
  const set = (weight: number, reps: number): LoggedSet =>
    ({ id: `${weight}x${reps}`, sessionId: 'now', exerciseId: 'squat', weight, reps, at: T0 });
  const past = (weights: number[], reps: number[]) => weights.map((w, i) => ({
    id: `s${i}`, sessionId: `p${i}`, exerciseId: 'squat', weight: w, reps: reps[i],
    at: T0 - (weights.length - i) * 4 * DAY
  }));
  const coach = (weights: number[], reps: number[], goal: TrainingGoal = 'size') =>
    coachSuggestion(past(weights, reps), 'squat', T0, { unit: 'lb', goal, grid: 5 })!;

  test('every call names its weight and reps, each what its sentence says', () => {
    // [fixture, key, weight, reps]
    const cases: [Suggestion, string, number, number][] = [
      [coach([205, 205], [9, 8]), 'coachIncrease', 210, 8],          // "try 210", at the goal's reps
      [coach([205, 205, 205], [6, 6, 6]), 'coachPlateau', 210, 6],   // "stuck at 205, try 210", same reps
      [coach([195, 200, 205], [5, 5, 5]), 'coachClimbing', 210, 5],  // "climbing, try 210", same reps
      [coach([205, 205], [6, 6]), 'coachHold', 205, 7],              // "stay here and add a rep"
      [coach([205, 205], [6, 6], 'consistency'), 'coachHold', 205, 7],
      [coach([185, 205], [5, 5]), 'coachSettle', 205, 5]             // "repeat it before adding"
    ];
    for (const [s, key, weight, reps] of cases) {
      assert.equal(s.key, key, `the fixture for ${key} now says ${s.key}`);
      assert.deepEqual([s.weight, s.reps], [weight, reps], key);
    }
  });

  test('a deload asks for nothing, so it is never made', () => {
    // Reps falling at one weight over three sessions: the coach backs off.
    const deload = coach([205, 205, 205], [8, 6, 4]);
    assert.equal(deload.key, 'coachDeload');
    assert.equal(deload.reps, undefined);
    assert.equal(callMade(deload, [set(205, 8), set(185, 8)]), null);
  });

  test('an increase is made by the first set at or above it; a hold only at its weight', () => {
    const up: Suggestion = { kind: 'increase', weight: 210, reps: 5, recentWeight: 205, sessions: 2, key: 'coachClimbing', params: {} };
    const sets = [set(205, 5), set(210, 4), set(215, 5), set(210, 5)];
    assert.equal(callMade(up, sets), sets[2]);
    const hold: Suggestion = { ...up, kind: 'hold', weight: 205, reps: 7, key: 'coachHold' };
    assert.equal(callMade(hold, [set(215, 8), set(205, 7)])?.weight, 205);
  });
});

describe('the screen shows it', () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const screen = readFileSync(path.join(HERE, '..', 'src', 'ui', 'NowScreen.tsx'), 'utf8');

  test('a made call is in volt', () => {
    assert.match(screen, /<Text style=\{\[s\.lastTimeText, state\.lastTime\.made && s\.lastTimeHit\]\} numberOfLines=\{1\}>\s*\{state\.lastTime\.head\}/,
      'a made call is not in volt');
  });

  test('the success tap plays for the set that made the call, read from the state that set produced', () => {
    // Pinned whole, so neither an inverted choice nor a stale `state` read passes.
    assert.match(screen,
      /model\.log\(\);[\s\S]{0,200}const next = model\.state\(\);\s*setState\(next\);[\s\S]{0,250}feedback\(\(\) => next\.lastTime\.justMade\s*\? Haptics\.notificationAsync\(Haptics\.NotificationFeedbackType\.Success\)\s*: Haptics\.impactAsync\(Haptics\.ImpactFeedbackStyle\.Medium\)\);/,
      'LOG SET no longer plays the success tap for exactly the set that made the call');
  });
});

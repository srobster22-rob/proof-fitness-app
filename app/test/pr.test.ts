import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findPRs, bestWeightAtReps, e1rm, MIN_SESSIONS_BEFORE_PR } from '../src/domain/pr.ts';
import type { LoggedSet, Exercise } from '../src/domain/types.ts';
import { buildRecap } from '../src/domain/session.ts';

const BENCH = 'bench';
const SQUAT = 'squat';
const exercises = new Map<string, Exercise>([
  [BENCH, { id: BENCH, name: 'Bench Press' }],
  [SQUAT, { id: SQUAT, name: 'Squat' }]
]);

let n = 0;
const set = (sessionId: string, exerciseId: string, weight: number, reps: number): LoggedSet =>
  ({ id: `s${n++}`, sessionId, exerciseId, weight, reps, at: n * 1000 });

/** History with `count` sessions of the same exercise at a fixed load. */
const priorSessions = (exerciseId: string, count: number, weight: number, reps: number) =>
  Array.from({ length: count }, (_, i) => set(`prior${i}`, exerciseId, weight, reps));

describe('PR detection', () => {
  test('awards a PR for more weight at the same reps', () => {
    const history = priorSessions(BENCH, 4, 225, 5);
    const prs = findPRs([set('now', BENCH, 230, 5)], history, exercises);
    assert.equal(prs.length, 1);
    assert.equal(prs[0].weight, 230);
    assert.equal(prs[0].previousWeight, 225);
    assert.equal(prs[0].claim, 'Heaviest 5-rep bench press');
  });

  test('awards a PR for more weight at MORE reps', () => {
    const history = priorSessions(BENCH, 4, 225, 5);
    const prs = findPRs([set('now', BENCH, 230, 8)], history, exercises);
    assert.equal(prs.length, 1, 'beating the 5-rep best at 8 reps is a PR');
  });

  test('does NOT award for the same weight', () => {
    const history = priorSessions(BENCH, 4, 225, 5);
    assert.equal(findPRs([set('now', BENCH, 225, 5)], history, exercises).length, 0);
  });

  test('does NOT award for fewer reps at the same weight', () => {
    const history = priorSessions(BENCH, 4, 225, 5);
    assert.equal(findPRs([set('now', BENCH, 225, 3)], history, exercises).length, 0);
  });

  test('rejects a sub-increment increase as a typo', () => {
    const history = priorSessions(BENCH, 4, 225, 5);
    assert.equal(findPRs([set('now', BENCH, 225.4, 5)], history, exercises).length, 0);
  });

  test('rejects high-rep sets — conditioning is not a strength record', () => {
    const history = priorSessions(BENCH, 4, 95, 20);
    assert.equal(findPRs([set('now', BENCH, 135, 20)], history, exercises).length, 0);
  });

  // §6: an app that calls your first ever set a personal record has told you it is lying.
  test('awards nothing during an exercise\'s first sessions', () => {
    for (let prior = 0; prior < MIN_SESSIONS_BEFORE_PR; prior++) {
      const history = priorSessions(BENCH, prior, 100, 5);
      const prs = findPRs([set('now', BENCH, 500, 5)], history, exercises);
      assert.equal(prs.length, 0, `${prior} prior sessions should award nothing`);
    }
  });

  test('one PR per exercise per session, taking the best set', () => {
    const history = priorSessions(BENCH, 4, 225, 5);
    const prs = findPRs(
      [set('now', BENCH, 230, 5), set('now', BENCH, 235, 5), set('now', BENCH, 232, 5)],
      history, exercises
    );
    assert.equal(prs.length, 1);
    assert.equal(prs[0].weight, 235);
  });

  test('ranks multiple exercises by e1RM', () => {
    const history = [...priorSessions(BENCH, 4, 225, 5), ...priorSessions(SQUAT, 4, 315, 5)];
    const prs = findPRs(
      [set('now', BENCH, 230, 5), set('now', SQUAT, 325, 5)],
      history, exercises
    );
    assert.equal(prs.length, 2);
    assert.equal(prs[0].exerciseId, SQUAT, 'heavier lift leads');
  });

  // The reason e1RM does not gate awards: it would reject this, and every
  // lifter alive would call it a PR.
  test('rep PR counts even when e1RM is below an old low-rep single', () => {
    const history = [
      ...priorSessions(BENCH, 4, 225, 5),
      set('prior-heavy', BENCH, 275, 2)   // e1rm 293.3
    ];
    const prs = findPRs([set('now', BENCH, 230, 5)], history, exercises); // e1rm 268.3
    assert.equal(prs.length, 1, '230x5 beats every previous set at 5+ reps');
  });

  test('bestWeightAtReps ignores lower-rep sets and other exercises', () => {
    const history = [
      set('a', BENCH, 275, 2), set('b', BENCH, 225, 5), set('c', SQUAT, 405, 5)
    ];
    assert.equal(bestWeightAtReps(history, BENCH, 5), 225);
    assert.equal(bestWeightAtReps(history, BENCH, 2), 275);
    assert.equal(bestWeightAtReps(history, BENCH, 13), 0);
  });

  test('e1rm follows Epley', () => {
    assert.equal(e1rm(225, 5), 225 * (1 + 5 / 30));
    assert.equal(e1rm(100, 0), 100);
  });
});

/*
 * The recap's PR block, as the card and the clip actually read it.
 * `previousWeight` is 0 in the e1RM branch — a sentinel — and both renderers
 * subtracted it, printing the whole bar as the improvement.
 */
describe('the PR payload says what was actually beaten', () => {
  const T = Date.UTC(2026, 6, 29, 18);
  const DAY = 86_400_000;
  const ex = new Map<string, Exercise>([['bench', { id: 'bench', name: 'Bench Press' }]]);

  const payloadFor = (histW: number, histR: number, todayW: number, todayR: number) => {
    const history: LoggedSet[] = [];
    for (let i = 3; i >= 1; i--) {
      history.push({ id: `h${i}`, sessionId: `h${i}`, exerciseId: 'bench',
                     weight: histW, reps: histR, at: T - i * 7 * DAY });
    }
    const today: LoggedSet[] = [
      { id: 'n1', sessionId: 'now', exerciseId: 'bench', weight: todayW, reps: todayR, at: T }
    ];
    return buildRecap({
      session: { id: 'now', startedAt: T - 30 * 60_000, endedAt: T, unit: 'lb', updatedAt: T },
      sets: today, exercises: ex, prs: findPRs(today, history, ex),
      allSets: [...history, ...today], now: T
    });
  };

  test('no comparable set means no gain to claim, not the whole bar', () => {
    // 225x5 history, today 200x10 -> e1RM branch, previousWeight 0.
    const pr = payloadFor(225, 5, 200, 10).pr!;
    assert.equal(pr.prev, 0, 'the sentinel is still there for older readers');
    assert.equal(pr.gain, null, 'this is the bug: the card printed "+200 LB"');
  });

  test('and it is not the heaviest ever when something heavier exists', () => {
    const pr = payloadFor(225, 5, 200, 10).pr!;
    assert.equal(pr.heaviest, false,
      'they moved 25 lb LESS than their best; the share said "heaviest ever"');
  });

  test('a genuine gain reports its real size', () => {
    const pr = payloadFor(225, 5, 235, 5).pr!;
    assert.equal(pr.gain, 10);
    assert.equal(pr.heaviest, true);
  });

  // The e1RM branch fires on real progress too, and used to print the load.
  test('more weight AND more reps is a gain of the weight, not the bar', () => {
    const pr = payloadFor(300, 3, 315, 5).pr!;
    assert.equal(pr.gain, null, 'nothing at 5 reps to compare against');
    assert.equal(pr.heaviest, true, 'but it IS the most weight they have moved');
  });

  test('heaviest ever ignores rep count — a 275x3 counts against a 230x5', () => {
    const history: LoggedSet[] = [];
    for (let i = 3; i >= 1; i--) {
      history.push({ id: `a${i}`, sessionId: `s${i}`, exerciseId: 'bench', weight: 275, reps: 3, at: T - i * 7 * DAY });
      history.push({ id: `b${i}`, sessionId: `s${i}`, exerciseId: 'bench', weight: 225, reps: 5, at: T - i * 7 * DAY + 60_000 });
    }
    const today: LoggedSet[] = [{ id: 'n', sessionId: 'now', exerciseId: 'bench', weight: 230, reps: 5, at: T }];
    const p = buildRecap({
      session: { id: 'now', startedAt: T - 30 * 60_000, endedAt: T, unit: 'lb', updatedAt: T },
      sets: today, exercises: ex, prs: findPRs(today, history, ex),
      allSets: [...history, ...today], now: T
    });
    assert.equal(p.pr!.gain, 5, 'a real 5 lb five-rep PR');
    assert.equal(p.pr!.heaviest, false, 'but 275 is still the heaviest bar they have held');
  });
});

/*
 * §8's one rule is NEVER CRY WOLF, and this is exactly that. A `LoggedSet`
 * carries no unit of its own — the session owns it — so comparing `s.weight`
 * straight across sessions logged in different units let a genuine ~220 lb
 * (100 kg) history read as a mere 100, and a later, genuinely LIGHTER 205 lb
 * set got announced as "Heaviest 5-rep bench press". `sessionUnits`
 * (sessionId -> Unit, from `repo.sessionUnits()`) is what closes it, threaded
 * through every function in this file that compares a weight across sets.
 */
describe('a set logged in another unit is converted before it can cry wolf', () => {
  test('a lighter lb set is NOT a PR against a heavier kg history', () => {
    const history = [
      set('k1', BENCH, 100, 5), set('k2', BENCH, 100, 5), set('k3', BENCH, 100, 5)
    ];                                                    // 100 kg, ~220.5 lb each
    const units = new Map([['k1', 'kg' as const], ['k2', 'kg' as const], ['k3', 'kg' as const]]);
    const today = [set('now', BENCH, 205, 5)];             // genuinely lighter than 220.5 lb
    const withoutFix = findPRs(today, history, exercises, 'lb', []);
    assert.equal(withoutFix.length, 1, 'the bug: 205 beats a history read as raw 100');
    const withFix = findPRs(today, history, exercises, 'lb', [], units);
    assert.equal(withFix.length, 0, 'the fix: 205 lb does not beat ~220.5 lb');
  });

  test('a genuine PR across units is still awarded', () => {
    const history = [
      set('k1', BENCH, 100, 5), set('k2', BENCH, 100, 5), set('k3', BENCH, 100, 5)
    ];
    const units = new Map([['k1', 'kg' as const], ['k2', 'kg' as const], ['k3', 'kg' as const]]);
    const today = [set('now', BENCH, 225, 5)];             // a real 4.5 lb PR over ~220.5
    const prs = findPRs(today, history, exercises, 'lb', [], units);
    assert.equal(prs.length, 1);
    // Converted, not raw — `previousWeight` sits next to `weight` (in TODAY's
    // unit) wherever it is shown, and "up from 100" beside "225 lb" would be
    // uncheckable (§16) if 100 were still in kg.
    assert.equal(prs[0].previousWeight, 220.5, "converted into today's unit, not the raw kg number");
  });

  test('bestWeightAtReps agrees with findPRs once the map is supplied', () => {
    const history = [set('k1', BENCH, 100, 5)];
    const units = new Map([['k1', 'kg' as const]]);
    assert.equal(bestWeightAtReps(history, BENCH, 5, [], 'lb'), 100, 'without the map, raw kg');
    assert.equal(bestWeightAtReps(history, BENCH, 5, [], 'lb', units), 220.5, 'with it, real lb');
  });

  test('a session missing from the map is assumed already in the target unit', () => {
    const history = [set('k1', BENCH, 205, 5)];
    assert.equal(bestWeightAtReps(history, BENCH, 5, [], 'lb', new Map()), 205,
      'pre-schema data with no session unit on record must not be treated as foreign');
  });
});

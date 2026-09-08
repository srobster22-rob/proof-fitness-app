import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withinBudget } from './helpers/perf.ts';
import {
  goalProgress, narrativeLine, goalCardLine, goalBarA11y, headlineGoal, validateNewGoal, rankGoals, MAX_GOALS,
  activeGoals, isAchieved, goalE1rmGap,
  type Goal
} from '../src/domain/goals.ts';
import { e1rm } from '../src/domain/pr.ts';
import type { LoggedSet, Exercise } from '../src/domain/types.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 6, 29, 12);

const exercises = new Map<string, Exercise>([
  ['squat', { id: 'squat', name: 'Squat' }],
  ['bench', { id: 'bench', name: 'Bench Press' }]
]);

let uid = 0;
const set = (exerciseId: string, weight: number, reps: number, at: number): LoggedSet =>
  ({ id: `x${uid++}`, sessionId: `s${uid}`, exerciseId, weight, reps, at });

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g1', exerciseId: 'squat', targetWeight: 315, targetReps: 5,
  targetDate: NOW + 90 * DAY, unit: 'lb', createdAt: NOW - 30 * DAY, ...over
});

/*
 * R461: a sweep for exported helpers whose only reference is their own
 * definition (grep everything `export function` declares in src/, count
 * hits elsewhere, keep the zeroes) found `goalE1rmGap` alongside the
 * translation-parity gate's own `missingKeys` from R460 — but this one is a
 * different anatomy of the same failure. `missingKeys` was a coverage TOOL
 * nobody had pointed at anything; `goalE1rmGap` is a documented FEATURE
 * ("for the Progress screen's secondary readout") that was never built —
 * `progress-model.ts` calls `e1rm` directly in three places and never once
 * calls this. Wiring an unbuilt UI readout into the Progress screen is a
 * product surface change this loop declines to make unasked (§12's own
 * boundary on inventing scope); what belongs here is making sure the
 * function is at least CORRECT and tested for whenever it is wired, rather
 * than leaving it both unused and unverified. Flagged in HANDOFF.md for an
 * owner decision: build the readout, or delete the function.
 */
describe('goalE1rmGap — built for a Progress readout that does not exist yet (R461)', () => {
  test('is the estimated-1RM gap between the goal and the current best, in e1rm units', () => {
    const g = goal({ targetWeight: 315, targetReps: 5 });
    const p = goalProgress(g, [set('squat', 275, 5, NOW - 10 * DAY)], exercises, NOW);
    const expected = e1rm(315, 5) - e1rm(275, 5);
    assert.ok(Math.abs(goalE1rmGap(p) - expected) < 1e-9,
      `expected the e1rm gap ${expected}, got ${goalE1rmGap(p)}`);
  });

  test('is zero once current and target read the same estimated 1RM', () => {
    const g = goal({ targetWeight: 315, targetReps: 5 });
    const p = goalProgress(g, [set('squat', 315, 5, NOW - DAY)], exercises, NOW);
    assert.ok(Math.abs(goalE1rmGap(p)) < 1e-9, `expected ~0, got ${goalE1rmGap(p)}`);
  });

  test('goes negative once the current estimated 1RM clears the target\'s', () => {
    const g = goal({ targetWeight: 315, targetReps: 5 });
    const p = goalProgress(g, [set('squat', 335, 5, NOW - DAY)], exercises, NOW);
    assert.ok(goalE1rmGap(p) < 0, `expected a negative gap once the target is cleared, got ${goalE1rmGap(p)}`);
  });
});

describe('goals — progress', () => {
  test('measures from the baseline when the goal was set, not from zero', () => {
    const history = [
      set('squat', 275, 5, NOW - 40 * DAY),   // before the goal existed
      set('squat', 285, 5, NOW - 10 * DAY)
    ];
    const p = goalProgress(goal(), history, exercises, NOW);
    assert.equal(p.start, 275, 'baseline is what they could do when they set it');
    assert.equal(p.current, 285);
    assert.equal(p.remaining, 30);
    // 10 of the 40 lb span, not 285/315
    assert.ok(Math.abs(p.fraction - 0.25) < 1e-9, `fraction was ${p.fraction}`);
  });

  test('a bar measured from zero would be a lie on day one', () => {
    const history = [set('squat', 300, 5, NOW - 40 * DAY)];
    const p = goalProgress(goal(), history, exercises, NOW);
    assert.equal(p.fraction, 0, 'no training since setting it means no progress');
    assert.notEqual(p.fraction, 300 / 315);
  });

  test('achieved when the target is hit at the right reps', () => {
    const history = [set('squat', 315, 5, NOW - 2 * DAY)];
    const p = goalProgress(goal(), history, exercises, NOW);
    assert.equal(p.achieved, true);
    assert.equal(p.fraction, 1);
    assert.equal(p.remaining, 0);
  });

  test('hitting the weight at fewer reps does not count', () => {
    const history = [set('squat', 315, 3, NOW - 2 * DAY)];
    const p = goalProgress(goal(), history, exercises, NOW);
    assert.equal(p.achieved, false, 'a 315 triple is not a 315 five');
  });

  test('on-pace compares progress against elapsed time', () => {
    const g = goal({ createdAt: NOW - 50 * DAY, targetDate: NOW + 50 * DAY });
    const behind = goalProgress(g, [
      set('squat', 275, 5, NOW - 60 * DAY), set('squat', 280, 5, NOW - DAY)
    ], exercises, NOW);
    assert.equal(behind.onPace, false, 'half the time gone, an eighth of the way');

    const ahead = goalProgress(g, [
      set('squat', 275, 5, NOW - 60 * DAY), set('squat', 310, 5, NOW - DAY)
    ], exercises, NOW);
    assert.equal(ahead.onPace, true);
  });

  /*
   * R318: every OTHER fixture in this file leans on `goal()`'s own default —
   * a target date exactly 90 days out — which is also this whole test suite's
   * favourite round number to reach for. Hardcoded `const total = 90` in place
   * of the real `(targetDate - createdAt) / DAY` passed all 1580 tests in the
   * suite, this one included: its "behind"/"ahead" fractions (1/8 and 35/40)
   * are extreme enough to read the same way against 90 real days or 100. Pace
   * is a RATIO — progress made over time allowed — and a ratio test that never
   * varies the goal's own duration cannot tell "divided by the real span" from
   * "divided by a constant that happens to usually match it", the same hole
   * the sparkline's shape-only tests had.
   *
   * A goal with a duration FAR from 90 days, at a fraction that is on the
   * correct side of ITS OWN elapsed/total but the wrong side of 30/90,
   * discriminates the two directly.
   */
  test('on-pace measures against THIS goal\'s own duration, not a stand-in constant', () => {
    // 300-day goal, 30 days in: real elapsed/total is 30/300 = 0.10.
    // Against a hardcoded 90-day stand-in it would read as 30/90 = 0.33.
    const g = goal({ createdAt: NOW - 30 * DAY, targetDate: NOW + 270 * DAY });
    // 15% of the way there — clears the real 10% bar, misses the wrong 33% one.
    const p = goalProgress(g, [
      set('squat', 275, 5, NOW - 40 * DAY), set('squat', 281, 5, NOW - DAY)
    ], exercises, NOW);
    assert.ok(Math.abs(p.fraction - 0.15) < 1e-9, `fixture drifted: fraction was ${p.fraction}`);
    assert.equal(p.onPace, true,
      '15% progress at 10% of a 300-day goal\'s time is ahead, not behind — a 90-day stand-in reads this as behind');
  });
});

/*
 * `LoggedSet` carries no unit of its own — the session owns it — so a goal
 * compared by raw `s.weight` against `goal.targetWeight` silently assumed
 * every set in history was already in the goal's unit. Checked directly: a
 * lifter who set a 225 lb bench goal and then switched Settings to kilos read
 * a genuine ~220 lb (100 kg) set as 44% progress rather than essentially
 * done. This is the same class of bug `now-model.ts`'s
 * `historyInSessionUnit` already exists to prevent for the logging screen's
 * own "last time" line — `goals.ts` just never got the equivalent fix.
 * `sessionUnits` (sessionId -> Unit, from `repo.sessionUnits()`) is what
 * closes it; a set whose session is missing from the map is treated as
 * already being in the goal's unit, which is the honest answer for data
 * logged before `sessions.unit` existed.
 */
describe('goals — a set logged in another unit is converted before it is compared', () => {
  test('a kg set reads correctly against an lb goal', () => {
    const s = set('bench', 100, 5, NOW - DAY);          // 100 kg, ~220.5 lb
    const units = new Map([[s.sessionId, 'kg' as const]]);
    const g = goal({ exerciseId: 'bench', targetWeight: 225, unit: 'lb' });
    const withoutFix = goalProgress(g, [s], exercises, NOW);
    assert.equal(withoutFix.current, 100, 'the raw kg number, uncorrected');
    const withFix = goalProgress(g, [s], exercises, NOW, units);
    assert.equal(withFix.current, 220.5, 'converted to the goal\'s own unit');
    assert.ok(withFix.fraction > 0.95, `${withFix.fraction} should read as essentially done`);
  });

  test('isAchieved agrees with goalProgress once the unit is known', () => {
    const s = set('bench', 103, 5, NOW - DAY);           // 103 kg -> ~227 lb, past the goal
    const units = new Map([[s.sessionId, 'kg' as const]]);
    const g = goal({ exerciseId: 'bench', targetWeight: 225, unit: 'lb' });
    assert.equal(isAchieved(g, [s]), false, 'without the map, 103 does not clear 225');
    assert.equal(isAchieved(g, [s], units), true, 'with it, ~227 lb does');
  });

  test('validateNewGoal reads a kg PR correctly when rejecting an already-beaten target', () => {
    const s = set('squat', 145, 5, NOW - DAY);            // 145 kg is well past 300 lb
    const units = new Map([[s.sessionId, 'kg' as const]]);
    const g = goal({ exerciseId: 'squat', targetWeight: 300, unit: 'lb', createdAt: NOW });
    assert.equal(validateNewGoal(g, [], [s], NOW), null,
      'without the map this looks like a 145 lb lifter, nowhere near the target');
    assert.equal(validateNewGoal(g, [], [s], NOW, units), 'target_below_current',
      'with it, ~320 lb has already beaten a 300 lb target');
  });

  test('a set in the goal\'s own unit is untouched (the common case is not slowed down)', () => {
    const s = set('bench', 200, 5, NOW - DAY);
    const units = new Map([[s.sessionId, 'lb' as const]]);
    const g = goal({ exerciseId: 'bench', targetWeight: 225, unit: 'lb' });
    assert.equal(goalProgress(g, [s], exercises, NOW, units).current, 200);
  });

  test('a session missing from the map is assumed to already be in the goal\'s unit', () => {
    const s = set('bench', 200, 5, NOW - DAY);
    const g = goal({ exerciseId: 'bench', targetWeight: 225, unit: 'lb' });
    assert.equal(goalProgress(g, [s], exercises, NOW, new Map()).current, 200,
      'pre-schema data with no session unit on record must not be treated as foreign');
  });
});

describe('goals — the narrative line (the reason the screen exists)', () => {
  test('reads as a sentence with a direction', () => {
    const history = [set('squat', 275, 5, NOW - 40 * DAY), set('squat', 285, 5, NOW - DAY)];
    const line = narrativeLine(goalProgress(goal(), history, exercises, NOW));
    assert.equal(line, '30 lb from a 315 squat');
  });

  test('says so plainly when it is done', () => {
    const history = [set('squat', 315, 5, NOW - DAY)];
    const line = narrativeLine(goalProgress(goal(), history, exercises, NOW));
    assert.equal(line, 'Squat: 315 × 5. Done.');
  });

  test('says nothing rather than something fake', () => {
    // never trained
    assert.equal(narrativeLine(goalProgress(goal(), [], exercises, NOW)), null);
    // trained, but no movement since the goal was set
    const flat = [set('squat', 275, 5, NOW - 40 * DAY)];
    assert.equal(narrativeLine(goalProgress(goal(), flat, exercises, NOW)), null);
  });

  test('honours the goal\'s own unit', () => {
    const g = goal({ targetWeight: 140, unit: 'kg' });
    const history = [set('squat', 120, 5, NOW - 40 * DAY), set('squat', 130, 5, NOW - DAY)];
    assert.equal(narrativeLine(goalProgress(g, history, exercises, NOW)), '10 kg from a 140 squat');
  });
});

describe('goals — picking one for the shareable', () => {
  const history = [
    set('squat', 275, 5, NOW - 40 * DAY), set('squat', 305, 5, NOW - DAY),
    set('bench', 185, 5, NOW - 40 * DAY), set('bench', 190, 5, NOW - DAY)
  ];
  const goals = [
    goal(),
    goal({ id: 'g2', exerciseId: 'bench', targetWeight: 225 })
  ];

  test('the closest live goal leads', () => {
    const h = headlineGoal(goals, history, exercises, NOW)!;
    assert.equal(h.goal.exerciseId, 'squat', '30 of 40 lb beats 5 of 40');
  });

  test('a finished goal outranks everything — that is the thing worth sending', () => {
    const done = [...history, set('squat', 315, 5, NOW)];
    const h = headlineGoal(goals, done, exercises, NOW)!;
    assert.equal(h.achieved, true);
    assert.equal(narrativeLine(h), 'Squat: 315 × 5. Done.');
  });

  test('returns null when no goal has anything honest to say', () => {
    assert.equal(headlineGoal(goals, [], exercises, NOW), null);
  });

  test('rankGoals puts live goals first and achieved ones last', () => {
    const done = [...history, set('squat', 315, 5, NOW)];
    const ranked = rankGoals(goals, done, exercises, NOW);
    assert.equal(ranked[ranked.length - 1].achieved, true, 'finished goals stop taking up the top');
  });
});

describe('goals — creation guard rails', () => {
  const history = [set('squat', 300, 5, NOW - 10 * DAY)];

  test('the cap is a hard cap', () => {
    // Built from MAX_GOALS rather than a literal three, so raising the cap does
    // not quietly turn this into a test of nothing. It WAS three; the product
    // owner raised it so every lift can carry a target of its own.
    const full = Array.from({ length: MAX_GOALS }, (_, n) =>
      goal({ id: `g${n}`, exerciseId: `lift${n}` }));
    assert.equal(full.length, MAX_GOALS);
    assert.equal(validateNewGoal(goal({ id: 'over', exerciseId: 'row' }), full, [], NOW), 'too_many');
  });

  test('rejects a goal already beaten — the bar would start full', () => {
    assert.equal(
      validateNewGoal(goal({ targetWeight: 295 }), [], history, NOW),
      'target_below_current'
    );
  });

  test('rejects one goal per exercise, silly rep counts, and dates in the past', () => {
    assert.equal(validateNewGoal(goal({ id: 'x' }), [goal()], [], NOW), 'duplicate');
    assert.equal(validateNewGoal(goal({ targetReps: 20 }), [], [], NOW), 'bad_reps');
    assert.equal(validateNewGoal(goal({ targetReps: 0 }), [], [], NOW), 'bad_reps');
    assert.equal(validateNewGoal(goal({ targetDate: NOW - DAY }), [], [], NOW), 'date_in_past');
  });

  test('accepts a real one', () => {
    assert.equal(validateNewGoal(goal(), [], history, NOW), null);
  });
});

// §5 — goals earn their place by feeding the output, or the screen gets cut.
// This is that obligation, asserted.
describe('goals reach the shareable', () => {
  test('the narrative line lands in the recap payload', async () => {
    const { buildRecap } = await import('../src/domain/session.ts');
    const history = [set('squat', 275, 5, NOW - 40 * DAY), set('squat', 285, 5, NOW - DAY)];
    const today = [set('squat', 285, 5, NOW - 10 * 60_000)];
    const h = headlineGoal([goal()], history, exercises, NOW)!;

    const payload = buildRecap({
      session: { id: 'now', startedAt: NOW - 40 * 60_000, endedAt: NOW, unit: 'lb', updatedAt: NOW },
      sets: today, exercises, prs: [], allSets: [...history, ...today], now: NOW,
      goalLine: narrativeLine(h)
    });
    assert.equal(payload.goalLine, '30 lb from a 315 squat');
  });

  test('no goal means no line, not an empty one', async () => {
    const { buildRecap } = await import('../src/domain/session.ts');
    const today = [set('squat', 285, 5, NOW - 10 * 60_000)];
    const payload = buildRecap({
      session: { id: 'now', startedAt: NOW - 40 * 60_000, endedAt: NOW, unit: 'lb', updatedAt: NOW },
      sets: today, exercises, prs: [], allSets: today, now: NOW,
      goalLine: headlineGoal([], [], exercises, NOW) ? 'x' : null
    });
    assert.equal(payload.goalLine, undefined);
  });
});

// "behind pace" appeared the instant a goal was created. `elapsed` was floored
// at a whole day, so a goal set five seconds ago was judged as a day old with
// zero progress — and that same floor made the `elapsed <= 0 -> null` branch
// underneath it unreachable, so the intent to stay quiet early never fired.
describe('pace makes no claim until there is something to judge', () => {
  const T = Date.UTC(2026, 6, 30, 12);
  const DAYS = 86_400_000;

  function goal(createdAt = T, days = 90): Goal {
    return {
      id: 'g1', exerciseId: 'squat', targetWeight: 315, targetReps: 5,
      createdAt, targetDate: createdAt + days * DAYS, unit: 'lb'
    } as Goal;
  }
  const names = new Map([['squat', { id: 'squat', name: 'Squat' }]]);
  const set = (at: number, weight: number) =>
    ({ id: `x${at}`, sessionId: 's', exerciseId: 'squat', weight, reps: 5, at });

  test('a goal set seconds ago is not behind on it', () => {
    const p = goalProgress(goal(), [set(T - DAYS, 225)], names, T + 5000);
    assert.equal(p.onPace, null, 'the card read "behind pace" from birth');
  });

  test('nor is it a week later, if they have not trained it yet', () => {
    const p = goalProgress(goal(), [set(T - DAYS, 225)], names, T + 7 * DAYS);
    assert.equal(p.onPace, null, 'a guess about them, not a fact about their training');
  });

  test('once they train it, the judgement resumes', () => {
    const history = [set(T - DAYS, 225), set(T + 2 * DAYS, 230)];
    const p = goalProgress(goal(), history, names, T + 3 * DAYS);
    assert.notEqual(p.onPace, null, 'there is real training to judge now');
  });

  test('and training that keeps up reads as on pace', () => {
    // Three days into ninety, already a fifth of the way there.
    const history = [set(T - DAYS, 225), set(T + 2 * DAYS, 243)];
    assert.equal(goalProgress(goal(), history, names, T + 3 * DAYS).onPace, true);
  });

  test('training that does not keep up still reads as behind', () => {
    // Half the time gone, barely moved — this must still be said.
    const history = [set(T - DAYS, 225), set(T + 40 * DAYS, 230)];
    assert.equal(goalProgress(goal(), history, names, T + 45 * DAYS).onPace, false);
  });

  test('hitting the target reads as on pace whatever the clock says', () => {
    const history = [set(T - DAYS, 225), set(T + 80 * DAYS, 315)];
    assert.equal(goalProgress(goal(), history, names, T + 85 * DAYS).onPace, true);
  });
});

// The cap counts only goals still in play. It counted ACHIEVED ones too, so
// app demanded the user delete a trophy before they could set a new target —
// punishing exactly the person it exists for.
describe('a goal you have hit does not occupy a slot', () => {
  const T = Date.UTC(2026, 6, 31, 12);
  const DAYS = 86_400_000;
  const goal = (id: string, ex: string, target: number): Goal => ({
    id, exerciseId: ex, targetWeight: target, targetReps: 5,
    createdAt: T - 30 * DAYS, targetDate: T + 60 * DAYS, unit: 'lb'
  } as Goal);
  const set = (ex: string, weight: number) =>
    ({ id: `x_${ex}_${weight}`, sessionId: 's', exerciseId: ex, weight, reps: 5, at: T - DAYS });

  // A full slate, sized from the cap. 'squat' stays first so the "hitting one
  // frees the slot" test below can retire it with a single 225 lb set.
  const three = [
    goal('a', 'squat', 225),
    ...Array.from({ length: MAX_GOALS - 1 }, (_, n) => goal(`g${n}`, `lift${n}`, 185 + n))
  ];

  test('a full slate of unmet goals is full', () => {
    assert.equal(activeGoals(three, []).length, MAX_GOALS);
    assert.equal(
      validateNewGoal(goal('d', 'row', 135), three, [], T),
      'too_many'
    );
  });

  test('hitting one frees the slot without deleting it', () => {
    const history = [set('squat', 225)];
    assert.equal(activeGoals(three, history).length, MAX_GOALS - 1);
    assert.equal(
      validateNewGoal(goal('d', 'row', 135), three, history, T),
      null,
      'the user had to delete a win to set a new target'
    );
  });

  test('hitting every one of them does not lock the screen', () => {
    // Every goal in the slate met, whatever the cap is.
    const history = three.map(g => set(g.exerciseId, g.targetWeight));
    assert.equal(activeGoals(three, history).length, 0);
    assert.equal(validateNewGoal(goal('over', 'row', 135), three, history, T), null);
  });

  test('the achieved goals are still there, not quietly dropped', () => {
    const history = [set('squat', 225)];
    assert.equal(three.length, MAX_GOALS, 'freeing a slot must not delete the trophy');
    assert.equal(isAchieved(three[0], history), true);
    assert.equal(isAchieved(three[1], history), false);
  });

  test('the other rules still apply once a slot is free', () => {
    const history = [set('squat', 225)];
    assert.equal(
      validateNewGoal(goal('over', three[1].exerciseId, three[1].targetWeight), three, history, T),
      'duplicate',
      'a free slot is not a licence to double up on a lift'
    );
  });
});

/*
 * Journey D, second walk. R39 established the rule — "three at a time" means
 * three things you are working TOWARD, and a goal you have hit is a result, not
 * a commitment — and applied it to the cap. It applies to two more places, and
 * both were still counting trophies.
 */
describe('goals — a finished goal is a result, not a commitment', () => {
  const hit = goal({ id: 'g1', exerciseId: 'squat', targetWeight: 225, targetReps: 5,
                     createdAt: NOW - 60 * DAY });
  const history = [set('squat', 195, 5, NOW - 61 * DAY), set('squat', 225, 5, NOW - 30 * DAY)];

  test('it does not count against the cap (R39)', () => {
    assert.equal(activeGoals([hit], history).length, 0);
    assert.equal(isAchieved(hit, history), true);
  });

  /*
   * The half R39 missed. Hitting 225 and wanting 275 is the most likely next
   * thing a user does, and the app said "You already have a goal for this lift"
   * with no way forward but deleting the trophy — punishing exactly the person
   * the feature exists for, which is R39's own sentence.
   */
  test('and it does not block a new goal on the same lift', () => {
    const next = goal({ id: 'g2', exerciseId: 'squat', targetWeight: 275, targetReps: 5,
                        createdAt: NOW });
    assert.equal(validateNewGoal(next, [hit], history, NOW), null,
      'this is the bug: it returned "duplicate"');
  });

  test('a LIVE goal on the same lift still blocks a second one', () => {
    const live = goal({ id: 'g1', exerciseId: 'squat', targetWeight: 315, targetReps: 5 });
    const another = goal({ id: 'g2', exerciseId: 'squat', targetWeight: 335, targetReps: 5 });
    assert.equal(validateNewGoal(another, [live], [], NOW), 'duplicate',
      'one live goal per lift is what keeps the screen and the narrative unambiguous');
  });

  test('a different lift was never blocked and still is not', () => {
    const bench = goal({ id: 'g2', exerciseId: 'bench', targetWeight: 225, targetReps: 5 });
    assert.equal(validateNewGoal(bench, [hit], history, NOW), null);
  });
});

describe('goals — a trophy stops speaking once it is not news', () => {
  const SESSION = NOW - 60 * 60_000;          // today's workout started an hour ago
  const hit = goal({ id: 'g1', exerciseId: 'squat', targetWeight: 225, targetReps: 5,
                     createdAt: NOW - 60 * DAY });
  const live = goal({ id: 'g2', exerciseId: 'bench', targetWeight: 225, targetReps: 5,
                      createdAt: NOW - 20 * DAY });
  const history = [
    set('squat', 195, 5, NOW - 61 * DAY),
    set('squat', 225, 5, NOW - 30 * DAY),      // squat goal met a month ago
    set('bench', 185, 5, NOW - 21 * DAY),
    set('bench', 205, 5, NOW - 10 * DAY)       // bench goal moving
  ];

  /*
   * The defect: a bench-only Tuesday went out carrying "Squat: 225 × 5. Done."
   * — a month-old result presented as this workout's story, crowding out the
   * goal that was actually moving.
   */
  test('a goal achieved in an EARLIER session does not headline today', () => {
    const h = headlineGoal([hit, live], history, exercises, NOW, new Map(), SESSION);
    assert.ok(h, 'the live goal still has something to say');
    assert.equal(h!.goal.exerciseId, 'bench', 'the month-old trophy led before this');
    assert.match(narrativeLine(h!)!, /from a 225 bench press$/);
  });

  test('a goal achieved TODAY still leads — that is the thing worth sending (R39)', () => {
    const today = [...history, set('squat', 225, 5, NOW - 5 * 60_000)];
    const fresh = goal({ id: 'g3', exerciseId: 'squat', targetWeight: 225, targetReps: 5,
                         createdAt: NOW - 40 * DAY });
    const before = [set('squat', 195, 5, NOW - 61 * DAY), set('bench', 205, 5, NOW - 10 * DAY)];
    const h = headlineGoal([fresh, live], [...before, set('squat', 225, 5, NOW - 5 * 60_000)],
                           exercises, NOW, new Map(), SESSION);
    assert.equal(h!.achieved, true);
    assert.equal(narrativeLine(h!), 'Squat: 225 × 5. Done.');
    void today;
  });

  test('an old trophy alone produces NO line rather than a stale one', () => {
    const h = headlineGoal([hit], history, exercises, NOW, new Map(), SESSION);
    assert.equal(h, null, '§5: an absent goal line beats an invented one');
  });

  test('without session context nothing changes for existing callers', () => {
    const h = headlineGoal([hit, live], history, exercises, NOW);
    assert.equal(h!.goal.exerciseId, 'squat', 'no `since` means every achieved goal is fresh');
  });
});

/*
 * The Goals screen and a shareable answer different questions, and for a while
 * they shared one answer. `narrativeLine` stays silent unless there has been
 * movement since the goal was set — right for a recap, which must not claim
 * progress that did not happen. The card then treated that silence as "Not
 * trained yet", and walked with five weeks of real history a fresh 160 lb bench
 * goal read "Not trained yet" to somebody who had been benching 145 for a
 * month. The gap — the only thing they opened the screen for — was the one
 * thing it would not say.
 */
describe('the Goals card says where you stand (§5)', () => {
  const EXS = new Map([['bench', { id: 'bench', name: 'Bench Press' }]]);
  const T = Date.UTC(2026, 6, 29, 18);
  const D = 86_400_000;
  const g = (target: number, createdAt = T - 30 * D) => ({
    id: 'g1', exerciseId: 'bench', targetWeight: target, targetReps: 5,
    createdAt, targetDate: T + 60 * D, unit: 'lb'
  } as Goal);
  const set = (w: number, at: number) =>
    ({ id: 'x' + w + at, sessionId: 's', exerciseId: 'bench', weight: w, reps: 8, at }) as any;

  test('a goal just set on a lift you already train states the gap', () => {
    const history = [set(145, T - 40 * D), set(145, T - 3 * D)];
    const p = goalProgress(g(160), history, EXS, T);
    assert.equal(narrativeLine(p), null, 'the shareable is right to stay quiet');
    assert.equal(goalCardLine(p), '15 lb to go, from 145');
  });

  test('a lift genuinely never trained still says nothing', () => {
    assert.equal(goalCardLine(goalProgress(g(160), [], EXS, T)), null,
      'there is no baseline and no gap — the card shows "Not trained yet"');
  });

  test('once there is progress, the card and the shareable agree', () => {
    const history = [set(145, T - 40 * D), set(155, T - 2 * D)];
    const p = goalProgress(g(160), history, EXS, T);
    assert.equal(goalCardLine(p), narrativeLine(p));
    assert.match(goalCardLine(p)!, /from a 160 bench press$/);
  });

  /*
   * `goal.createdAt` was already on `GoalProgress` in full — `goalFor`'s own
   * pace math has always read it — and the progress bar itself carried no
   * accessibility label at all, so nothing ever surfaced WHEN a goal started.
   * "60 days left" is checkable against today on its own; the start date is
   * the fact a countdown alone cannot recover once days have already passed
   * (R294/R295, same shape as `bestSetA11y`/`trendA11y` on Progress).
   */
  test('the bar names the percentage AND the date the goal was set', () => {
    const history = [set(145, T - 40 * D), set(155, T - 2 * D)];
    const p = goalProgress(g(160, T - 30 * D), history, EXS, T);
    const label = goalBarA11y(p, 'en');
    assert.match(label, new RegExp(`${Math.round(p.fraction * 100)} percent`));
    // createdAt = T - 30 days; T is 29 Jul 2026, so 30 days back is 29 Jun.
    assert.match(label, /Jun 29/);
  });

  test('and in Spanish, not a fallback', () => {
    const p = goalProgress(g(160, T - 30 * D), [set(145, T - 40 * D), set(155, T - 2 * D)], EXS, T);
    const label = goalBarA11y(p, 'es');
    assert.match(label, /por ciento/);
    assert.doesNotMatch(label, /percent/);
  });

  test('a goal set a year ago still names its real month, not a relative guess', () => {
    const p = goalProgress(g(160, T - 365 * D), [set(145, T - 40 * D), set(155, T - 2 * D)], EXS, T);
    const label = goalBarA11y(p, 'en');
    // T - 365 days from 29 Jul 2026 lands in Jul 2025.
    assert.match(label, /Jul 29/);
  });

  test('a met goal reads as met on both', () => {
    const history = [set(145, T - 40 * D), set(165, T - 2 * D)];
    const p = goalProgress(g(160), history, EXS, T);
    assert.equal(p.achieved, true);
    assert.equal(goalCardLine(p), narrativeLine(p));
  });
});

/*
 * Found on the running app, on a card that said all of this at once:
 *
 *   "Not trained yet  ·  130 days left  ·  behind pace"
 *
 * Both halves were true under different definitions of "trained" — pace asks
 * whether the LIFT has been touched, the card asks whether anything qualifies
 * at the goal's rep count — and a lifter rowing 8s against a x10 goal satisfies
 * one and not the other. §16: a judgement the user cannot check against
 * anything on the same card is one they cannot trust.
 */
describe('pace and the card cannot contradict each other', () => {
  const g = { id: 'g1', exerciseId: 'row', targetWeight: 185, targetReps: 10,
    createdAt: NOW - 60 * DAY, targetDate: NOW + 30 * DAY, unit: 'lb' as const };
  const names = new Map([['row', { id: 'row', name: 'Barbell Row' }]]);
  const set = (weight: number, reps: number, at: number) =>
    ({ id: 's' + at, sessionId: 'x', exerciseId: 'row', weight, reps, at });

  test('a lift trained only below the goal reps is not judged', () => {
    // Rowed hard, twice a week, every week — at eight reps, against a ten-rep
    // goal. Nothing qualifies, so `current` is 0 and the card says so.
    const history = [set(135, 8, NOW - 40 * DAY), set(145, 8, NOW - 10 * DAY)];
    const p = goalProgress(g, history, names, NOW);
    assert.equal(p.current, 0, 'no set met the rep count');
    assert.equal(goalCardLine(p), null, 'so the card reports nothing');
    assert.equal(p.onPace, null,
      'and a judgement on top of nothing is what produced "not trained yet, behind pace"');
  });

  test('one qualifying set is enough to start judging', () => {
    const history = [set(135, 8, NOW - 40 * DAY), set(120, 10, NOW - 10 * DAY)];
    const p = goalProgress(g, history, names, NOW);
    assert.equal(p.current, 120);
    assert.notEqual(p.onPace, null, 'now there is real progress to measure');
  });

  /*
   * The judgement must not be lost in the case it was written for: someone who
   * qualified before setting the goal and has gone nowhere since IS behind, and
   * their card has a line to show alongside it.
   */
  test('qualified before the goal and stalled since is still behind pace', () => {
    const history = [set(160, 10, NOW - 90 * DAY), set(160, 10, NOW - 5 * DAY)];
    const p = goalProgress(g, history, names, NOW);
    assert.equal(p.onPace, false);
    assert.ok(goalCardLine(p), 'and it says so with a line, not with silence');
  });

  test('every goal that reports a pace has something on the card beside it', () => {
    for (const history of [
      [], [set(135, 8, NOW - 5 * DAY)], [set(120, 10, NOW - 5 * DAY)],
      [set(200, 10, NOW - 5 * DAY)], [set(160, 10, NOW - 90 * DAY)]
    ]) {
      const p = goalProgress(g, history, names, NOW);
      if (p.onPace === null) continue;
      assert.ok(goalCardLine(p) !== null,
        'a pace with no line beside it is the contradiction, in either direction');
    }
  });
});

/*
 * The cap went to a hundred, and the screen's cost went with it.
 *
 * `goalProgress` reads the history twice per goal, and `bestAt` used to filter
 * the whole list to apply its cutoff — a fresh copy of every set the user has
 * ever logged, per goal, per render, on a screen that recomputes on every add
 * and every delete. Measured: 100 goals against 20,000 sets took 48ms on a
 * desktop, which is a dropped frame or several on a phone.
 *
 * Bucketing the history by exercise once makes it O(sets): 0.9ms for the same
 * input. The first test is the one that matters — the optimisation is only
 * worth anything if the numbers did not move.
 */
describe('a hundred goals against a long history', () => {
  const build = (goalsN: number, setsN: number) => {
    const ex = new Map<string, Exercise>();
    const gs: Goal[] = [];
    for (let i = 0; i < goalsN; i++) {
      ex.set(`e${i}`, { id: `e${i}`, name: `Lift ${i}` });
      gs.push({ id: `g${i}`, exerciseId: `e${i}`, targetWeight: 200 + i, targetReps: 5,
        targetDate: NOW + 90 * DAY, unit: 'lb', createdAt: NOW - 60 * DAY });
    }
    const history: LoggedSet[] = [];
    for (let i = 0; i < setsN; i++) {
      history.push({ id: `s${i}`, sessionId: 'x', exerciseId: `e${i % goalsN}`,
        weight: 100 + (i % 90), reps: 5 + (i % 6), at: NOW - (setsN - i) * 3600_000 });
    }
    return { ex, gs, history };
  };

  test('bucketing the history changes nothing about the answers', () => {
    const { ex, gs, history } = build(40, 2000);
    const ranked = rankGoals(gs, history, ex, NOW);
    // The same computation the screen used to do: every goal against the whole
    // undivided history.
    const naive = gs.map(g => goalProgress(g, history, ex, NOW))
      .sort((a, b) => a.achieved !== b.achieved ? (a.achieved ? 1 : -1) : b.fraction - a.fraction);
    assert.deepEqual(
      ranked.map(p => [p.goal.id, p.current, p.start, p.fraction, p.achieved, p.onPace]),
      naive.map(p => [p.goal.id, p.current, p.start, p.fraction, p.achieved, p.onPace]));
  });

  test('a set on another lift cannot leak into a goal', () => {
    // The bucket is the whole safety argument: each goal now sees only its own
    // exercise's sets, which is only correct because every read was already
    // scoped that way.
    const ex = new Map<string, Exercise>([['squat', { id: 'squat', name: 'Squat' }]]);
    const g: Goal = { id: 'g1', exerciseId: 'squat', targetWeight: 300, targetReps: 5,
      targetDate: NOW + 90 * DAY, unit: 'lb', createdAt: NOW - 30 * DAY };
    const history: LoggedSet[] = [
      { id: 'a', sessionId: 'x', exerciseId: 'squat', weight: 200, reps: 5, at: NOW - DAY },
      { id: 'b', sessionId: 'x', exerciseId: 'legpress', weight: 500, reps: 10, at: NOW - DAY }
    ];
    assert.equal(rankGoals([g], history, ex, NOW)[0].current, 200,
      'a 500 lb leg press must not count toward a squat goal');
  });

  /*
   * A guard, not a benchmark. It is generous enough not to flake on a loaded
   * machine and tight enough that the quadratic version — 20 to 50 times over
   * this on the same hardware — cannot come back unnoticed.
   */
  test('the screen still computes in a frame at the cap', () => {
    const { ex, gs, history } = build(100, 20_000);
    withinBudget(7, 16, 'the per-goal scan is back', () => { rankGoals(gs, history, ex, NOW); });
  });
});

/*
 * R494. The bucketing above was only half the screen, and the other half was
 * the busier half.
 *
 * `activeGoals` asks `isAchieved` — which reads `bestAt` — once per goal, and
 * handed each one the WHOLE history. Same O(goals x sets) shape `rankGoals`
 * was fixed for, in a function on far more paths: `canAddGoal`, `goalLifts`,
 * `validateNewGoal` (twice per call) and `Repo.saveGoal`.
 *
 * Benchmarked against the database `tools/stress-web.ts` builds — 14,000 sets,
 * 100 goals — before and after: `canAddGoal` 14.57ms to 1.09ms, `goalLifts`
 * 15.97ms to 2.49ms. The already-bucketed `listGoals` sat at 1.76ms throughout,
 * which is how the cost gave itself away: the screen's slowest call was not the
 * one carrying the optimisation comment.
 */
describe('the cap check reads the history once, not once per goal', () => {
  const build = (goalsN: number, setsN: number) => {
    const gs: Goal[] = [];
    for (let i = 0; i < goalsN; i++) {
      // History tops out at 189 lb, so every third goal is reachable and the
      // rest are not — the filter has to actually decide, in both directions.
      gs.push({ id: `g${i}`, exerciseId: `e${i}`, targetWeight: i % 3 === 0 ? 120 : 200 + i,
        targetReps: 5, targetDate: NOW + 90 * DAY, unit: 'lb', createdAt: NOW - 60 * DAY });
    }
    const history: LoggedSet[] = [];
    for (let i = 0; i < setsN; i++) {
      history.push({ id: `s${i}`, sessionId: 'x', exerciseId: `e${i % goalsN}`,
        weight: 100 + (i % 90), reps: 5 + (i % 6), at: NOW - (setsN - i) * 3600_000 });
    }
    return { gs, history };
  };

  test('bucketing changes nothing about which goals are active', () => {
    // The optimisation is worth nothing if the answers moved. A third of these
    // are met and two thirds are not, so the filter has both to decide.
    const { gs, history } = build(40, 2000);
    const naive = gs.filter(g => !isAchieved(g, history));
    assert.deepEqual(activeGoals(gs, history).map(g => g.id), naive.map(g => g.id));
    assert.ok(naive.length > 0 && naive.length < gs.length,
      'the fixture proves nothing — every goal fell the same side of achieved');
  });

  test('and a set on another lift still cannot leak in', () => {
    const gs: Goal[] = [{ id: 'g1', exerciseId: 'squat', targetWeight: 300, targetReps: 5,
      targetDate: NOW + 90 * DAY, unit: 'lb', createdAt: NOW - 30 * DAY }];
    const history: LoggedSet[] = [
      { id: 'a', sessionId: 'x', exerciseId: 'squat', weight: 200, reps: 5, at: NOW - DAY },
      { id: 'b', sessionId: 'x', exerciseId: 'legpress', weight: 500, reps: 10, at: NOW - DAY }
    ];
    assert.equal(activeGoals(gs, history).length, 1,
      'a 500 lb leg press marked a 300 lb squat goal achieved');
  });

  /*
   * Counted, not timed.
   *
   * A millisecond budget is a guard against a regression coming back; it is a
   * poor gate for proving one was fixed, because a fast machine passes it
   * either way. So this counts how many sets the function actually walks, by
   * handing it a history whose iterator reports every element it yields. The
   * bucketing pass walks the list once; the per-goal scans then walk small
   * private arrays that are not counted. The quadratic version walks the whole
   * list once per goal, so the same input reads 100x higher.
   */
  test('the whole history is walked once, whatever the goal count', () => {
    const { gs, history } = build(100, 5000);
    let yielded = 0;
    const counted = Object.create(history) as LoggedSet[];
    Object.assign(counted, history);
    counted.length = history.length;
    counted[Symbol.iterator] = (function* () {
      for (const s of history) { yielded++; yield s; }
    }) as () => ArrayIterator<LoggedSet>;

    activeGoals(gs, counted);
    assert.ok(yielded <= 2 * history.length,
      `walked ${yielded} sets for ${gs.length} goals over ${history.length} sets — ` +
      'that is the per-goal scan, back');
  });

  test('it still computes in a frame at the cap', () => {
    const { gs, history } = build(100, 20_000);
    withinBudget(7, 16, 'the per-goal scan is back', () => { activeGoals(gs, history); });
  });
});

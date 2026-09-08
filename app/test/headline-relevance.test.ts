import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { headlineGoal, type Goal } from '../src/domain/goals.ts';
import type { LoggedSet, Exercise } from '../src/domain/types.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 6, 29, 18);
const SESSION = T0;                       // the workout being recapped starts here

const EX = new Map<string, Exercise>([
  ['bench', { id: 'bench', name: 'Bench Press' }],
  ['squat', { id: 'squat', name: 'Squat' }],
  ['ohp', { id: 'ohp', name: 'Overhead Press' }]
]);

const goal = (id: string, exerciseId: string, targetWeight: number): Goal => ({
  id, exerciseId, targetWeight, targetReps: 5,
  createdAt: T0 - 60 * DAY, targetDate: T0 + 60 * DAY, unit: 'lb'
} as Goal);

const set = (ex: string, weight: number, at: number): LoggedSet =>
  ({ id: `${ex}${weight}${at}`, sessionId: at >= SESSION ? 'today' : 'old',
     exerciseId: ex, weight, reps: 5, at }) as LoggedSet;

/**
 * The recap reports what happened THAT DAY.
 *
 * `since` already enforces this for achieved goals — the docstring records a
 * bench-only Tuesday going out carrying "Squat: 225 × 5. Done." But the same
 * flaw survived for goals still in progress: the headline is "closest to done"
 * across every goal, so the winner is whichever goal happens to be furthest
 * along, trained today or not. With the cap at three that was usually harmless.
 * At twelve it is the normal case.
 */
describe('the recap headline is about the workout it is on (§5)', () => {
  test('a push session does not headline a squat goal', () => {
    const history = [
      set('squat', 290, T0 - 7 * DAY),     // squat goal is 97% done, from last week
      set('bench', 185, T0 - 7 * DAY),
      set('bench', 190, SESSION + 60_000)  // today: bench only
    ];
    const goals = [goal('g1', 'squat', 300), goal('g2', 'bench', 225)];
    const head = headlineGoal(goals, history, EX, T0 + 3600_000, new Map(), SESSION,['bench']);
    assert.ok(head, 'a bench goal was moved today, so there is something to say');
    assert.equal(head!.goal.exerciseId, 'bench',
      'the card headlined a lift the session never touched');
  });

  /*
   * Deliberately a PREFERENCE and not a filter. Written first as a filter, which
   * made this case return null — and that contradicted a decision already made
   * and tested elsewhere ("the goal line survives, behind the work"): a goal on
   * an untrained lift may still reach the shareable, it just must not open the
   * message. §5 says goals earn their place by feeding the output, so removing
   * them entirely takes more than the bug did.
   */
  test('with no goal on anything trained today, the best one still speaks', () => {
    const history = [
      set('squat', 290, T0 - 7 * DAY),
      set('ohp', 100, SESSION + 60_000)    // today: only a lift with no goal
    ];
    const goals = [goal('g1', 'squat', 300)];
    const head = headlineGoal(goals, history, EX, T0 + 3600_000, new Map(), SESSION,['ohp']);
    assert.ok(head, 'a live goal vanished rather than following the work');
    assert.equal(head!.goal.exerciseId, 'squat');
  });

  test('a goal achieved TODAY still leads', () => {
    const history = [
      set('bench', 150, T0 - 7 * DAY),
      set('bench', 225, SESSION + 60_000)  // hit it today
    ];
    const goals = [goal('g1', 'bench', 225), goal('g2', 'squat', 300)];
    const head = headlineGoal(goals, history, EX, T0 + 3600_000, new Map(), SESSION,['bench']);
    assert.equal(head!.goal.exerciseId, 'bench');
    assert.equal(head!.achieved, true, 'finishing one is the best thing that happens here');
  });

  test('among several trained today, the closest still wins', () => {
    const history = [
      set('bench', 100, T0 - 7 * DAY),
      set('ohp', 100, T0 - 7 * DAY),
      set('bench', 120, SESSION + 60_000),   // 120/225 = 53%
      set('ohp', 130, SESSION + 120_000)     // 130/135 = 96%
    ];
    const goals = [goal('g1', 'bench', 225), goal('g2', 'ohp', 135)];
    const head = headlineGoal(goals, history, EX, T0 + 3600_000, new Map(), SESSION,['bench', 'ohp']);
    assert.equal(head!.goal.exerciseId, 'ohp');
  });

  test('with no session context every goal is still eligible', () => {
    // Progress screen and anywhere else without a workout to be about.
    const history = [set('squat', 290, T0 - 7 * DAY)];
    const goals = [goal('g1', 'squat', 300)];
    assert.ok(headlineGoal(goals, history, EX, T0), 'omitting `since` must not filter by session');
  });
});

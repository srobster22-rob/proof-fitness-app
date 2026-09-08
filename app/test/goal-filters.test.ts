import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterGoals, filterCounts, goalFilters, GOAL_SORTS,
  lastView, rememberView } from '../src/ui/goal-filters.ts';
import type { GoalProgress } from '../src/domain/goals.ts';

const DAY = 86_400_000;
const T = Date.UTC(2026, 7, 21, 18);

/** A GoalProgress with only the fields the filters read. */
function p(
  exerciseId: string, exerciseName: string,
  { fraction = 0.5, achieved = false, days = 60, made = 30 } = {}
): GoalProgress {
  return {
    goal: {
      id: 'g_' + exerciseId, exerciseId, targetWeight: 200, targetReps: 5,
      createdAt: T - made * DAY, targetDate: T + days * DAY, unit: 'lb'
    },
    exerciseName, current: 100, remaining: 100, fraction, achieved,
    daysLeft: days, onPace: null
  } as unknown as GoalProgress;
}

/**
 * The cap went from three to a hundred, and a hundred of anything is a list you
 * scroll rather than read. The screen earns the higher cap by letting you cut
 * the list down instead of refusing the goal.
 */
describe('filtering a hundred goals down to a useful few', () => {
  const goals = [
    p('bench', 'Bench Press', { fraction: 0.9, days: 90 }),
    p('ohp', 'Overhead Press', { fraction: 0.2, days: 10 }),
    p('squat', 'Squat', { fraction: 0.5, days: 30 }),
    p('row', 'Barbell Row', { fraction: 0.7, days: 45 }),
    p('deadlift', 'Deadlift', { fraction: 1, achieved: true }),
    p('legpress', 'Leg Press', { fraction: 0.4, days: 20 })
  ];

  test('a split day shows only that day', () => {
    const push = filterGoals(goals, 'push', 'closest').map(g => g.exerciseName);
    assert.deepEqual(push, ['Bench Press', 'Overhead Press']);
    const legs = filterGoals(goals, 'legs', 'closest').map(g => g.exerciseName);
    assert.deepEqual(legs, ['Squat', 'Leg Press']);
  });

  /*
   * A met goal is a trophy, not a target. Mixing the two is what made the old
   * three-goal screen confusing when one of them was finished.
   */
  test('every live filter excludes what is already done', () => {
    for (const f of goalFilters('ppl')) {
      if (f === 'done') continue;
      assert.ok(!filterGoals(goals, f, 'closest').some(g => g.achieved),
        `the ${f} filter is showing a goal that has been met`);
    }
  });

  test('and DONE shows only those', () => {
    const done = filterGoals(goals, 'done', 'closest');
    assert.deepEqual(done.map(g => g.exerciseName), ['Deadlift']);
  });

  test('closest first is nearest to finished', () => {
    assert.deepEqual(filterGoals(goals, 'open', 'closest').map(g => g.exerciseName),
      ['Bench Press', 'Barbell Row', 'Squat', 'Leg Press', 'Overhead Press']);
  });

  test('soonest first is running out of time, whatever the progress', () => {
    assert.deepEqual(filterGoals(goals, 'open', 'soonest').map(g => g.exerciseName),
      ['Overhead Press', 'Leg Press', 'Squat', 'Barbell Row', 'Bench Press']);
  });

  test('newest first finds the one you just made', () => {
    const recent = [
      p('bench', 'Bench Press', { made: 90 }),
      p('squat', 'Squat', { made: 1 }),
      p('row', 'Barbell Row', { made: 30 })
    ];
    assert.deepEqual(filterGoals(recent, 'open', 'newest').map(g => g.exerciseName),
      ['Squat', 'Barbell Row', 'Bench Press']);
  });

  /*
   * Two goals at the same fraction could otherwise swap places between renders,
   * and a hundred-item list that reshuffles under the finger is worse than one
   * in a mediocre order.
   */
  test('ties break stably, so the list does not reshuffle', () => {
    const same = [p('squat', 'Squat'), p('bench', 'Bench Press'), p('row', 'Barbell Row')];
    for (const sort of GOAL_SORTS) {
      const once = filterGoals([...same], 'open', sort).map(g => g.exerciseName);
      const twice = filterGoals([...same].reverse(), 'open', sort).map(g => g.exerciseName);
      assert.deepEqual(once, twice, `${sort} depends on the order it was handed`);
    }
  });

  /*
   * A filter chip that leads to an empty list is a wasted tap, and with a
   * hundred goals there is no way to tell by looking.
   */
  test('the chips can say how many each would show', () => {
    const counts = filterCounts(goals, 'ppl');
    assert.equal(counts.open, 5);
    assert.equal(counts.push, 2);
    assert.equal(counts.legs, 2);
    assert.equal(counts.pull, 1);
    assert.equal(counts.done, 1);
  });

  test('the counts come from the same function that filters', () => {
    const counts = filterCounts(goals, 'ppl');
    for (const f of goalFilters('ppl')) {
      assert.equal(counts[f], filterGoals(goals, f, 'closest').length,
        `the ${f} chip would promise a number the list does not deliver`);
    }
  });

  test('a custom movement has no split day and only shows under OPEN', () => {
    const mine = [p('sled', 'Sled Push')];
    assert.equal(filterGoals(mine, 'open', 'closest').length, 1);
    for (const f of ['push', 'pull', 'legs'] as const) {
      assert.equal(filterGoals(mine, f, 'closest').length, 0);
    }
  });

  test('an empty list stays empty rather than throwing', () => {
    for (const f of goalFilters('ppl')) {
      for (const s of GOAL_SORTS) assert.deepEqual(filterGoals([], f, s), []);
    }
  });
});

/*
 * Goals is a place you leave and come back to inside one workout - check the
 * pull numbers, go log a set, come back - and at a hundred goals, re-filtering
 * every time is the screen refusing to remember what you just told it.
 */
describe('the screen remembers what it was showing', () => {
  test('a fresh run starts on the whole list', () => {
    assert.deepEqual(lastView(), { filter: 'open', sort: 'closest' });
  });

  test('and hands back whatever was last set', () => {
    rememberView('pull', 'soonest');
    assert.deepEqual(lastView(), { filter: 'pull', sort: 'soonest' });
    rememberView('open', 'closest');
    assert.deepEqual(lastView(), { filter: 'open', sort: 'closest' });
  });

  /*
   * The reason this is a module variable and not a row in the database. A
   * filter that survives a restart is a mode: open the app a week later, see
   * eleven goals, and the fact that thirty-one exist is something you have to
   * notice a highlighted chip to work out.
   */
  test('it is memory, not storage', async () => {
    rememberView('legs', 'newest');
    const cold = '../src/ui/goal-filters.ts?fresh';
    const again = await import(cold);
    assert.deepEqual(again.lastView(), { filter: 'open', sort: 'closest' },
      'a cold start must always be the whole list');
  });
});

/*
 * R497. The chips spoke push/pull/legs to every lifter, including the two
 * thirds who did not choose it.
 *
 * Same defect R496 found in UP NEXT, one screen over: `dayOf` files bench
 * under push and row under pull, which is the right question for PPL and the
 * wrong one for the other two plans this app offers. An UPPER/LOWER lifter was
 * given chips for days they do not have, and a FULL BODY lifter three chips
 * that all mean the same thing to them — and because the counts came from the
 * same filter, a chip could read PULL 9 while the lifter's every session is an
 * upper day.
 */
describe('the Goals chips are the days of the plan the lifter chose', () => {
  const NOW = T;
  const goal = (id: string, exerciseId: string): GoalProgress => ({
    goal: { id, exerciseId, targetWeight: 300, targetReps: 5, unit: 'lb',
      createdAt: NOW - 30 * DAY, targetDate: NOW + 30 * DAY },
    exerciseName: exerciseId, current: 100, start: 50, fraction: 0.2,
    achieved: false, onPace: null, perWeek: null, remaining: 200
  } as unknown as GoalProgress);

  const goals = [goal('g1', 'bench'), goal('g2', 'row'), goal('g3', 'squat')];

  test('push/pull/legs still gets push, pull and legs', () => {
    assert.deepEqual(goalFilters('ppl'), ['open', 'push', 'pull', 'legs', 'done'],
      'the plan this always worked for must not change');
  });

  test('upper/lower gets upper and lower, and no third day', () => {
    assert.deepEqual(goalFilters('upper-lower'), ['open', 'upper', 'lower', 'done']);
  });

  test('full body gets one day, not three that mean the same thing', () => {
    assert.deepEqual(goalFilters('full'), ['open', 'full', 'done']);
  });

  test('an upper day holds both the press and the row', () => {
    // The whole point. `dayOf` calls these push and pull; the lifter calls
    // both of them upper, and the chip has to agree with the lifter.
    const upper = filterGoals(goals, 'upper', 'closest').map(p => p.goal.exerciseId);
    assert.deepEqual(upper.sort(), ['bench', 'row'],
      'the row was filed under pull and vanished from an upper-day filter');
    assert.deepEqual(filterGoals(goals, 'lower', 'closest').map(p => p.goal.exerciseId), ['squat']);
  });

  test('and full body holds all of them', () => {
    assert.equal(filterGoals(goals, 'full', 'closest').length, 3,
      'a full-body lifter filtered their own goals down to a third of them');
  });

  test('the counts are counted for the same plan the chips came from', () => {
    /*
     * Counts and chips have to be one decision. Counting at push/pull/legs
     * while showing upper/lower chips would put a number on a chip that does
     * not exist, and leave the ones that do at zero — which the screen reads
     * as "cannot be tapped".
     */
    const counts = filterCounts(goals, 'upper-lower');
    assert.equal(counts.upper, 2);
    assert.equal(counts.lower, 1);
    assert.equal(counts.open, 3);
    for (const f of goalFilters('upper-lower')) {
      assert.equal(typeof counts[f], 'number', `no count for the ${f} chip`);
    }
  });
});

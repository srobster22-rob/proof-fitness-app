import type { GoalProgress } from '../domain/goals.ts';
import { inPlanDay, PLAN_DAYS, type PlanDay, type SplitPlan } from '../domain/split.ts';

/**
 * Filtering and ordering for the Goals screen.
 *
 * The cap went from three to a hundred, and a hundred of anything is a list you
 * scroll rather than a list you read. At three the screen could just show them
 * all in one honest order; past that the useful question stops being "what are
 * my goals" and becomes "which of these am I about to train", "which is nearly
 * done", "which runs out first". So the screen earns the higher cap by letting
 * you cut the list down instead of refusing the goal.
 *
 * Lives here rather than in `domain/` because it is a property of the screen —
 * nothing else in the app needs to sort goals by deadline — but it is pure and
 * tested, which is the same split as every other `*-model.ts` in this folder.
 */

/**
 * Which goals to show. `open` is the default; the middle three are split days.
 *
 * It was called `all`, and that was a small lie with a real cost: it excludes
 * met goals, so a screen holding 36 had a chip reading "ALL 31". OPEN and DONE
 * are a pair of states, which is what they actually are, and the split days sit
 * underneath OPEN as subsets of it.
 */
export type GoalFilter = 'open' | PlanDay | 'done';

/** What to order by within the filter. */
export type GoalSort = 'closest' | 'soonest' | 'newest';

/**
 * The chips, in the vocabulary of the split the lifter actually chose.
 *
 * This was the constant `['open', 'push', 'pull', 'legs', 'done']`, which is
 * right for one of the three plans the app offers and wrong for the other two.
 * An UPPER/LOWER lifter was shown push, pull and legs chips — days they do not
 * have — and a FULL BODY lifter was shown three chips that all mean the same
 * thing to them. Same defect R496 found in UP NEXT, on a different screen:
 * asking at the push/pull/legs level when the lifter thinks at their plan's.
 */
export function goalFilters(plan: SplitPlan): GoalFilter[] {
  return ['open', ...PLAN_DAYS[plan], 'done'];
}
export const GOAL_SORTS: GoalSort[] = ['closest', 'soonest', 'newest'];

/**
 * Apply a filter and an order.
 *
 * `done` is a filter rather than a sort because a met goal is a different kind
 * of thing: it is a trophy, not a target, and mixing the two is what made the
 * old three-goal screen confusing when one of them was finished. Every other
 * filter EXCLUDES met goals for the same reason — asking for "push" means "push
 * goals I am still chasing".
 *
 * Ties break on the lift's name so the order is stable: without it two goals at
 * the same fraction could swap places between renders, and a list of a hundred
 * that reshuffles under the finger is worse than one in a mediocre order.
 */
export function filterGoals(
  goals: GoalProgress[], filter: GoalFilter, sort: GoalSort
): GoalProgress[] {
  const kept = goals.filter(p => {
    if (filter === 'done') return p.achieved;
    if (p.achieved) return false;
    if (filter === 'open') return true;
    return inPlanDay(p.goal.exerciseId, filter);
  });

  const by: Record<GoalSort, (a: GoalProgress, b: GoalProgress) => number> = {
    // Nearest to finished first — the ones worth a session this week.
    closest: (a, b) => b.fraction - a.fraction,
    // Running out of time first, whatever the progress.
    soonest: (a, b) => a.goal.targetDate - b.goal.targetDate,
    // Most recently set first, for finding the one you just made.
    newest: (a, b) => b.goal.createdAt - a.goal.createdAt
  };

  return kept.sort((a, b) => by[sort](a, b) || a.exerciseName.localeCompare(b.exerciseName));
}

/**
 * How many goals each filter would show, for the chips to say so.
 *
 * A filter chip that leads to an empty list is a wasted tap, and with a hundred
 * goals there is no way to tell from looking. The counts come from the same
 * function that does the filtering, so a chip can never promise a number the
 * list does not deliver.
 */
export function filterCounts(
  goals: GoalProgress[], plan: SplitPlan
): Record<GoalFilter, number> {
  const out = {} as Record<GoalFilter, number>;
  for (const f of goalFilters(plan)) out[f] = filterGoals(goals, f, 'closest').length;
  return out;
}

/*
 * What the screen was last showing, for as long as the app is running.
 *
 * Goals is a place you leave and come back to inside one workout — check the
 * pull numbers, go log a set, come back — and at a hundred goals, re-filtering
 * every time is the screen refusing to remember what you just told it.
 *
 * Deliberately NOT persisted to the database. A filter that survives a restart
 * is a mode: open the app a week later, see eleven goals, and the fact that
 * thirty-one exist is something you have to notice a highlighted chip to work
 * out. In-memory it lasts exactly as long as the reason for it does, and a cold
 * start is always the whole list. The active chip is volt and ALL always shows
 * its own count, so even mid-session the state is on screen rather than hidden.
 */
let last: { filter: GoalFilter; sort: GoalSort } = { filter: 'open', sort: 'closest' };

export function lastView(): { filter: GoalFilter; sort: GoalSort } {
  return last;
}

export function rememberView(filter: GoalFilter, sort: GoalSort): void {
  last = { filter, sort };
}

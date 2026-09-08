import type { TrainingGoal } from '../domain/coach.ts';

/** Where the Settings TRAINING GOAL choice is stored. */
export const PREF_GOAL = 'pref.goal';

/**
 * What the lifter is training FOR, as the coach line should read it.
 *
 * R517 built the rule engine taking this as a parameter and nothing ever
 * passed one, so every lifter got the `size` default and the half of OWNER.md
 * #2 that says "tuned to the person's stated goal" was not true yet. The
 * engine was already right; what was missing was somebody to ask.
 *
 * One definition in one file that both sides import, for the reason
 * `display-unit.ts` gives at length: the unit preference was read one way by
 * `now-model` and another way by three other screens, and they disagreed ON
 * SCREEN for months. A preference with two readers and no shared definition is
 * how that happens.
 *
 * The default is `size` rather than "unset". A lifter who has never opened
 * Settings still gets useful advice, and `size` is the middle of the three: a
 * strength lifter told to add 5 lb when they wanted 10 has lost a little, and
 * so has a hypertrophy lifter told to add 10 when they wanted 5, but neither
 * has been given advice that is wrong in KIND. There is deliberately no
 * "unknown" state for the screen to have to render.
 */
export function trainingGoal(repo: { getPref(key: string): string | null }): TrainingGoal {
  const stored = repo.getPref(PREF_GOAL);
  return stored === 'strength' || stored === 'size' || stored === 'consistency'
    ? stored
    : 'size';
}

/**
 * The three, in the order Settings shows them: least load added per session to
 * most. Ordering by what the choice DOES means the row reads as a dial rather
 * than as three unrelated words.
 */
export const TRAINING_GOALS: readonly TrainingGoal[] = ['consistency', 'size', 'strength'];

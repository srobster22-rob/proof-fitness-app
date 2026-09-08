import { MAX_PR_REPS } from '../domain/pr.ts';
import { pickerFor } from '../domain/coldstart.ts';
import type { Repo } from '../data/repo.ts';
import { convertWeight, type Unit } from '../domain/types.ts';
import {
  rankGoals, validateNewGoal, MAX_GOALS,
  type Goal, type GoalProgress, type GoalError, activeGoals
} from '../domain/goals.ts';
import { t, fill, languageOf, type Language } from '../domain/i18n.ts';

/**
 * Screen 3 — Goals. PROMPT.md §5.
 *
 * Thin by design: `goals.ts` already owns progress, ranking, the narrative line
 * and validation. This adds only what the screen needs on top — id minting, the
 * repo round-trip, and turning a `GoalError` into something a person can read.
 */

let counter = 0;
const newId = () => `g_${Date.now().toString(36)}_${(counter++).toString(36)}`;

export interface GoalDraft {
  exerciseId: string;
  targetWeight: number;
  targetReps: number;
  /** Days from now. The UI offers a few presets rather than a date picker. */
  inDays: number;
  unit: Unit;
}

export const HORIZONS = [
  { label: '6 WEEKS', days: 42 },
  { label: '3 MONTHS', days: 90 },
  { label: '6 MONTHS', days: 182 },
  { label: '1 YEAR', days: 365 }
];

/**
 * The rep counts offered for a goal.
 *
 * Every one is a rep scheme people actually train and talk about — singles,
 * doubles, triples, the 5 and 3x5 world, 6s and 8s for hypertrophy, 10s and 12s
 * at the top. It stops at `MAX_PR_REPS` because above that the set is
 * conditioning, not a strength target, and `validateNewGoal` would reject it
 * anyway — offering a chip the app then refuses would be the form arguing with
 * itself.
 */
export const REP_CHOICES = [1, 2, 3, 5, 6, 8, 10, 12];

/** Longest horizon: two years. Past that a "goal" is a daydream. */
export const MAX_GOAL_DAYS = 730;

/** The units a person actually says a deadline in. */
export type HorizonUnit = 'days' | 'weeks' | 'months' | 'years';
export const HORIZON_UNITS: HorizonUnit[] = ['days', 'weeks', 'months', 'years'];

/**
 * Days per unit.
 *
 * A month is 30 and a year 365 — nominal, not calendar. The goal's target date
 * is advisory (`Goal.targetDate` says so: "a missed date does not delete the
 * goal"), and the alternative is a date that lands on the 31st of a 30-day
 * month and has to be argued about. The previous fixed horizons used the same
 * arithmetic: 3 MONTHS was 90 days, 1 YEAR was 365.
 */
export const DAYS_PER: Record<HorizonUnit, number> = {
  days: 1, weeks: 7, months: 30, years: 365
};

/**
 * A typed horizon in the unit the user chose, as days.
 *
 * Null for anything the app should not turn into a deadline. The field holds
 * TEXT while it is being typed, so a "1" on the way to "12" must read as a
 * clean "not yet" rather than a one-day goal committed behind their back.
 */
export function horizonDays(raw: string, unit: HorizonUnit): number | null {
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 1) return null;
  const days = n * DAYS_PER[unit];
  if (days > MAX_GOAL_DAYS) return null;
  return days;
}


/**
 * A typed rep count, or null if it is not one the app will accept.
 *
 * Parsed here rather than in the sheet so the presets and the custom field
 * cannot disagree about what a legal goal is — the chips are drawn from
 * `REP_CHOICES` and this holds the same ceiling.
 */
export function customReps(raw: string): number | null {
  const n = Number(raw.trim());
  if (!Number.isInteger(n)) return null;
  if (n < 1 || n > MAX_PR_REPS) return null;
  return n;
}


/**
 * The lifts a goal can be set on, split into ones they actually train and the
 * rest of the library.
 *
 * `pickerFor` already orders correctly — ranked by history, then their own
 * movements, then everything else — but as one long horizontal scroll it put a
 * squat they do every week and a movement they have never touched in the same
 * undifferentiated row. A goal is almost always about a lift you already train,
 * so that one gets its own category and leads; the library stays underneath as
 * the alternative rather than as noise to scroll past.
 *
 * `trained` is empty for a new user, and the sheet drops the row rather than
 * showing an empty heading.
 *
 * A lift with a LIVE goal on it is left out of both lists. One live goal per
 * exercise is enforced at the write, so offering those was the app asking a
 * question it could already answer (§4): with 36 goals set, most chips in the
 * sheet led to "You already have a goal for this lift" — discovered only after
 * choosing a target, a rep count and a deadline, and only on the tap that was
 * meant to commit. The default selection was one of them.
 *
 * An ACHIEVED goal does not take the lift away: it is a trophy, not a
 * commitment, and aiming higher on a lift you just hit is the whole point.
 */
export function goalLifts(
  repo: Repo, now: number
): { trained: { id: string; name: string }[]; rest: { id: string; name: string }[] } {
  const all = repo.allSets();
  const library = [...repo.exercises().values()].map(({ id, name }) => ({ id, name }));
  // `pickerFor` for the ORDER, then the whole library behind it. Its cold-start
  // branch deliberately returns only the starting twelve — §6's short list is
  // about a beginner's first LOGGING screen, and applying it here would mean a
  // goal could not be set on two thirds of the app until the third session.
  const ordered = pickerFor(all, now, undefined, 12, library);
  const listed = new Set(ordered.map(e => e.id));
  const full = [...ordered, ...library.filter(e => !listed.has(e.id))];

  // `activeGoals`, not every goal. Excluding achieved ones too would put back
  // at the picker exactly what R39 removed from the validator: hitting a 225
  // squat and wanting 275 is the most likely next thing a user does, and the
  // lift would simply have vanished from the sheet — quieter than the old error
  // message and no more helpful. One LIVE goal per lift, everywhere.
  const taken = new Set(activeGoals(repo.goals(), all, repo.sessionUnits()).map(g => g.exerciseId));
  const open = full.filter(e => !taken.has(e.id));

  const done = new Set(all.map(s => s.exerciseId));
  return {
    trained: open.filter(e => done.has(e.id)),
    rest: open.filter(e => !done.has(e.id))
  };
}

/**
 * Messages say what to do about it, not what the code called it.
 *
 * A function rather than a table, and taking `lang` rather than defaulting to
 * English, because this is the ONE validation-error path on the Goals screen
 * that was never localized — `measure-goal.ts`'s twin (`measureGoalMessage`)
 * has always gone through `t()`, and this one printed raw English straight
 * into a Spanish screen every time a duplicate or an already-beaten target was
 * rejected. Found while looking for craft work, not reported — the bug had no
 * failing test because nothing ever asserted these five strings were reachable
 * through `t()` at all.
 */
export function goalErrorMessage(err: GoalError, lang: Language = 'en'): string {
  const KEY: Record<GoalError, Parameters<typeof t>[1]> = {
    too_many: 'goalErrTooMany',
    duplicate: 'goalErrDuplicate',
    target_below_current: 'goalErrTargetBelow',
    bad_reps: 'goalErrBadReps',
    date_in_past: 'goalErrDateInPast'
  };
  return err === 'too_many'
    ? fill(t(lang, KEY[err]), { n: MAX_GOALS })
    : t(lang, KEY[err]);
}

export function listGoals(repo: Repo, now: number): GoalProgress[] {
  return rankGoals(repo.goals(), repo.allSets(), repo.exercises(), now, repo.sessionUnits());
}

export function draftToGoal(draft: GoalDraft, now: number): Goal {
  return {
    id: newId(),
    exerciseId: draft.exerciseId,
    targetWeight: draft.targetWeight,
    targetReps: draft.targetReps,
    targetDate: now + draft.inDays * 86_400_000,
    unit: draft.unit,
    createdAt: now
  };
}

export interface CreateResult { ok: boolean; error?: string; goal?: Goal; }

/**
 * Validate against the domain rules, then persist. Validation happens here and
 * again inside `saveGoal` — belt and braces on purpose, because §5's "three is
 * a hard cap" stops being true the moment a UI bug writes a fourth.
 */
export function createGoal(repo: Repo, draft: GoalDraft, now: number): CreateResult {
  const goal = draftToGoal(draft, now);
  const err = validateNewGoal(goal, repo.goals(), repo.allSets(), now, repo.sessionUnits());
  if (err) return { ok: false, error: goalErrorMessage(err, languageOf(repo)) };
  repo.saveGoal(goal);
  return { ok: true, goal };
}

/**
 * Amend a goal in place, keeping its identity and its start date.
 *
 * Until this existed the only way to change a target or push a deadline out was
 * to remove the goal and set a new one — and that quietly threw away the thing
 * the progress bar is measured from. `start` is what the lift could do WHEN THE
 * GOAL WAS SET, so a recreated goal reads as zero progress no matter how much
 * of the distance has already been covered: someone 40 lb into a 60 lb climb
 * who moves their deadline out by a month would watch the bar drop to empty and
 * `onPace` go silent. Keeping `createdAt` keeps the history the goal has.
 *
 * The lift itself is not editable. A goal is a target ON a lift, so changing
 * the lift makes it a different goal — that is what remove and add are for, and
 * pretending otherwise would silently move the baseline to another movement's
 * history.
 */
export function editGoal(repo: Repo, id: string, draft: GoalDraft, now: number): CreateResult {
  const lang = languageOf(repo);
  const before = repo.goals().find(g => g.id === id);
  if (!before) return { ok: false, error: t(lang, 'goalErrGone') };

  const goal: Goal = {
    ...draftToGoal(draft, now),
    id,
    exerciseId: before.exerciseId,
    createdAt: before.createdAt
  };
  const err = validateNewGoal(goal, repo.goals(), repo.allSets(), now, repo.sessionUnits(), id);
  if (err) return { ok: false, error: goalErrorMessage(err, lang) };
  repo.saveGoal(goal);
  return { ok: true, goal };
}

/**
 * The number the target stepper counts from.
 *
 * On a NEW goal that is `suggestTarget` — the app's own read of what this lift
 * is ready for. On an EDIT it is the target already set, and never the
 * suggestion: the user picked 222 and came back to adjust it, so a stepper that
 * silently re-bases on a 140 lb suggestion the moment it is touched turns one
 * tap of "+45" into a 37 lb REDUCTION. Measured on the running app, which is
 * the only place it was visible — nothing about the sheet says which number the
 * plus button is adding to.
 */
export function targetBase(editing: Goal | null | undefined, suggested: number): number {
  return editing ? editing.targetWeight : suggested;
}

/*
 * `removeGoal` (singular) lived here and was superseded by `removeGoals`
 * below, which returns what it took so the undo bar can put it back. Nothing
 * called the singular version — the one-goal WIPE path goes through
 * `wipe([id])` like every other — and anything that had would have silently
 * lost the undo, since it returns nothing. Removed rather than left as a
 * thinner alternative to the function that does the job properly.
 */

/**
 * Remove goals, and hand back exactly what it took.
 *
 * The return value is the undo. Deletion here is soft — the row stays with
 * `deleted = 1` — but nothing else in the app knows that, and a screen that
 * wants to offer UNDO would otherwise have to reach into the schema to find out
 * what it just destroyed. Returning the goals makes the reversal a matter of
 * handing them back, and makes it work identically for one goal and a hundred.
 */
export function removeGoals(repo: Repo, ids: string[]): Goal[] {
  const byId = new Map(repo.goals().map(g => [g.id, g]));
  const taken: Goal[] = [];
  for (const id of ids) {
    const g = byId.get(id);
    if (!g) continue;      // already gone; removing it twice is not an error
    repo.deleteGoal(id);
    taken.push(g);
  }
  return taken;
}

/**
 * Put back what `removeGoals` took.
 *
 * `saveGoal` upserts and clears the deleted flag, so a goal comes back with its
 * id, its target AND its `createdAt` — which is the part that matters, because
 * `createdAt` is the baseline the progress bar measures from. An undo that
 * recreated the goals would return them looking untouched, which is not what
 * undo means.
 *
 * Returns how many actually came back. The cap is enforced at the write, so an
 * undo attempted after filling the freed slots with new goals restores what
 * fits and reports the shortfall rather than throwing on the user's behalf.
 */
export function restoreGoals(repo: Repo, goals: Goal[]): number {
  let back = 0;
  for (const g of goals) {
    try { repo.saveGoal(g); back++; } catch { /* the cap took the slot */ }
  }
  return back;
}

/** Whether the "add a goal" affordance should be offered at all. */
export function canAddGoal(repo: Repo): boolean {
  // Achieved goals do not count — see `activeGoals`. Counting them meant three
  // wins locked the screen until the user deleted one.
  return activeGoals(repo.goals(), repo.allSets(), repo.sessionUnits()).length < MAX_GOALS;
}

/**
 * A sensible starting target for a lift: their current best at those reps,
 * rounded up to the next 10. §4's "an empty number field is a bug" applies to
 * goal creation too — nobody should face a blank target.
 */
export function suggestTarget(repo: Repo, exerciseId: string, reps: number, unit: Unit): number {
  const sets = repo.allSets().filter(s => s.exerciseId === exerciseId && s.reps >= reps);
  // Checked directly and found missing, the same gap `pr.ts` and `goals.ts`
  // both had this round: a set is in its SESSION's unit, not necessarily
  // `unit`, so a raw max across mixed-unit history could suggest a target
  // far too easy for someone who trains in both — a real ~220 lb (100 kg) PR
  // read as a raw "100" suggests 110 as a starting target.
  const sessionUnits = repo.sessionUnits();
  const best = sets.reduce((m, s) => {
    const from = sessionUnits.get(s.sessionId) ?? unit;
    const w = from === unit ? s.weight : convertWeight(s.weight, from, unit);
    return Math.max(m, w);
  }, 0);
  const step = unit === 'lb' ? 10 : 5;
  if (best <= 0) return unit === 'lb' ? 135 : 60;
  return Math.ceil((best * 1.05) / step) * step;
}

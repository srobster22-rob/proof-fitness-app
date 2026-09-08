import type { LoggedSet, Exercise, Unit } from './types.ts';
import { convertWeight } from './types.ts';
import { e1rm, MAX_PR_REPS } from './pr.ts';
import { t, fill, MONTHS_TREND, type Language } from './i18n.ts';

/**
 * Goals. PROMPT.md §5 screen 3.
 *
 * The spec is blunt about why this screen is allowed to exist: goals must EARN
 * their place by feeding the output, or they are dead weight — a screen with no
 * job, which is exactly what they were in earlier drafts. So the primary export
 * here is not the progress bar, it is `narrativeLine()`.
 *
 *     "42 lb from a 315 squat"   is a story with a direction
 *     "18,420 lb of volume"      is a number
 *
 * The story is what travels. If goals stop feeding the shareable, cut the screen.
 */

/**
 * How many lifts you can be working toward at once.
 *
 * A hundred, and exactly a hundred — not a hundred plus the old twelve.
 *
 * This was 3, and §5 called it "a hard cap — a focusing constraint, not a
 * limitation to remove later". That was a deliberate stance and the product
 * owner has overruled it twice: the app is for improving EVERY lift and
 * tracking all of them, so a cap that forces you to drop one lift's target to
 * record another's is working against what it is for.
 *
 * A hundred is past the point where the cap is a design statement at all. It is
 * the number that stops a runaway, and the screen earns its keep by letting you
 * FILTER and SORT rather than by refusing the goal — see `ui/goal-filters.ts`.
 * One goal per exercise is still enforced, and with a 28-movement library plus
 * whatever the user invents, that is the constraint doing the real work.
 */
export const MAX_GOALS = 100;

export interface Goal {
  id: string;
  exerciseId: string;
  /** Target weight, in the goal's own unit. */
  targetWeight: number;
  /** Reps the target is claimed at — a 315 squat means nothing without this. */
  targetReps: number;
  /** Epoch ms. Advisory: a missed date does not delete the goal. */
  targetDate: number;
  unit: Unit;
  createdAt: number;
}

export interface GoalProgress {
  goal: Goal;
  exerciseName: string;
  /** Best weight achieved at or above the goal's rep count. 0 if never trained. */
  current: number;
  /** Where they were when the goal was set — the baseline progress is measured from. */
  start: number;
  remaining: number;
  /** 0..1 of the distance from `start` to target, not from zero. */
  fraction: number;
  achieved: boolean;
  daysLeft: number;
  /** On pace to hit it by the target date, judged on progress so far. */
  onPace: boolean | null;
}

/*
 * One pass, no copy. This used to `filter` the whole history to apply `before`
 * and hand the copy to `bestWeightAtReps`, which is two full scans and a fresh
 * array per call — and it is called twice per goal. Measured after the cap went
 * to a hundred: 100 goals against 20,000 sets took 48ms per render on a desktop,
 * which is a visible stall on a phone, and the screen recomputes on every add
 * and every delete. Same answer, same rules as `bestWeightAtReps`.
 *
 * `sessionUnits` converts every set into the GOAL's own unit before comparing —
 * checked directly and found missing: a goal is compared by raw `s.weight`
 * against `goal.targetWeight` with no regard for what unit either is actually
 * in. A `LoggedSet` carries no unit of its own (the session owns it, per
 * `types.ts`), so a "Bench Press 225 lb" goal, trained at a genuine ~220 lb
 * (100 kg) after switching Settings to kilos, read as 44% progress rather than
 * essentially done — the exact bug `now-model.ts`'s `historyInSessionUnit`
 * already exists to prevent for the logging screen's own "last time" line,
 * simply never applied here. Missing from the map defaults to the goal's own
 * unit, which is the honest answer for a set logged before `sessions.unit`
 * existed at all.
 */
function bestAt(
  history: LoggedSet[], exerciseId: string, reps: number, unit: Unit,
  sessionUnits: Map<string, Unit>, before?: number
): number {
  let best = 0;
  for (const s of history) {
    if (s.exerciseId !== exerciseId) continue;
    if (before != null && s.at > before) continue;
    if (s.reps < reps) continue;
    const from = sessionUnits.get(s.sessionId) ?? unit;
    const weight = from === unit ? s.weight : convertWeight(s.weight, from, unit);
    if (weight > best) best = weight;
  }
  return best;
}

export function goalProgress(
  goal: Goal, history: LoggedSet[], exercises: Map<string, Exercise>, now: number,
  sessionUnits: Map<string, Unit> = new Map()
): GoalProgress {
  const current = bestAt(history, goal.exerciseId, goal.targetReps, goal.unit, sessionUnits);
  // Baseline is what they could do WHEN THE GOAL WAS SET. Measuring from zero
  // would show someone with a 300 lb squat as 95% of the way to 315 before
  // they had trained once, which makes the bar meaningless.
  const start = bestAt(history, goal.exerciseId, goal.targetReps, goal.unit, sessionUnits, goal.createdAt);

  const span = Math.max(0, goal.targetWeight - start);
  const gained = Math.max(0, current - start);
  const fraction = span === 0 ? (current >= goal.targetWeight ? 1 : 0)
                              : Math.min(1, gained / span);

  const daysLeft = Math.ceil((goal.targetDate - now) / 86_400_000);
  const elapsed = (now - goal.createdAt) / 86_400_000;
  const total = Math.max(1, (goal.targetDate - goal.createdAt) / 86_400_000);

  // Have they had a go at it yet? Pace is a judgement about how the training is
  // going, and before any training there is nothing to judge.
  const trainedSince = history.some(
    s => s.exerciseId === goal.exerciseId && s.at > goal.createdAt
  );

  const achieved = current >= goal.targetWeight;
  /**
   * Null means "no claim", and it is the honest answer far more often than it
   * was being given.
   *
   * `elapsed` used to be floored at a whole day, which made a goal set five
   * seconds ago one day old with zero progress — `0 >= 1/90` is false, so the
   * card read **"behind pace" from the moment it was created**. (That floor
   * also made the `elapsed <= 0 -> null` branch below it unreachable, so the
   * intent to stay quiet early was already there and never fired.) Telling
   * someone they are behind on a goal they set seconds ago is both wrong and
   * the opposite of why they set it.
   *
   * Waiting for real training rather than for a grace period is what makes this
   * a fact instead of a guess: someone who lifts weekly is "behind" six days in
   * seven on any linear reading of the calendar, and saying so is noise.
   */
  const onPace = achieved ? true
    : !trainedSince ? null
    // Measured on the running app: "Not trained yet  ·  130 days left  ·
    // behind pace", on one card, in one sentence. Both halves were true under
    // DIFFERENT definitions of trained — `trainedSince` counts any set on the
    // lift, while `current` counts only sets at the goal's rep count, and a
    // lifter rowing 8s against a x10 goal satisfies the first and not the
    // second. The judgement then had nothing behind it: `fraction` is derived
    // from `current`, so "behind pace" was a reading of an absence.
    //
    // Pace is judged on what the card can show. If the card says the lift has
    // not been trained, there is nothing to be behind on.
    : current <= 0 ? null
    : fraction >= (elapsed / total);

  return {
    goal,
    exerciseName: exercises.get(goal.exerciseId)?.name ?? goal.exerciseId,
    current,
    start,
    remaining: Math.max(0, goal.targetWeight - current),
    fraction,
    achieved,
    daysLeft,
    onPace
  };
}

/**
 * The line the recap and the weekly card carry. This is the reason the screen
 * exists (§5), so it is written to be read aloud, not parsed:
 *
 *   "42 lb from a 315 squat"
 *   "Squat: 315 × 5. Done."
 *
 * Returns null when there is nothing honest to say — an untouched goal produces
 * no line rather than a fake one.
 */
export function narrativeLine(p: GoalProgress, lang: Language = 'en'): string | null {
  const unit = p.goal.unit;
  const name = p.exerciseName.toLowerCase();

  if (p.achieved) {
    return `${p.exerciseName}: ${p.goal.targetWeight} × ${p.goal.targetReps}. ${t(lang, 'goalDone')}`;
  }
  if (p.current <= 0) return null;          // never trained it — say nothing
  if (p.remaining <= 0) return null;
  if (p.fraction <= 0) return null;         // no movement since setting it

  // A pattern, because English puts the number before the lift and Spanish
  // after it. See `goalGap` in the table.
  return fill(t(lang, 'goalGap'), {
    gap: Math.round(p.remaining), unit, target: p.goal.targetWeight, lift: name
  });
}

/**
 * What the GOALS SCREEN says about a goal — which is not what a shareable says.
 *
 * `narrativeLine` is deliberately silent unless there has been movement since
 * the goal was set, because a recap that claims progress which did not happen
 * is worse than one that says nothing. On the Goals screen that rule is wrong:
 * you are looking at the list precisely to see where you stand, and silence
 * there reads as "nothing is happening".
 *
 * It read worse than that. The card treated a null line as "Not trained yet",
 * and null has three causes — never trained it, already past it, or no gain
 * since you set it. Walked with five weeks of real history: setting a 160 lb
 * bench goal produced "Not trained yet" for a lifter who had been benching 145
 * for over a month. The one thing they wanted to know — 15 lb to go — was the
 * one thing the card would not say.
 */
export function goalCardLine(p: GoalProgress, lang: Language = 'en'): string | null {
  const shared = narrativeLine(p, lang);
  if (shared) return shared;
  // Genuinely never trained: the bar has no baseline and nothing to report.
  if (p.current <= 0) return null;
  // Trained, but no gain since the goal was set. State the gap, which is a
  // fact about right now rather than a claim about progress.
  return fill(t(lang, 'goalStalled'), {
    gap: Math.round(p.remaining), unit: p.goal.unit, current: p.current
  });
}

/**
 * The progress bar's own accessibility label — a bar with a fill and no
 * label is silent to a screen reader, the visual equivalent of the row
 * `bestSetA11y`/`trendA11y` (progress-model.ts, R292/R293) closed on Progress.
 *
 * `goal.createdAt` is on `GoalProgress` in full already — `elapsed`/`total`
 * inside `goalFor` already read it to compute pace — and nothing between
 * there and the screen ever asked for it as a DATE rather than an interval.
 * "60 days left" is checkable against today on its own; "set on Aug 1" is
 * the fact a countdown alone cannot recover once some of the days have
 * passed — a card opened on day 40 of 90 says how much is left, never when
 * the 90 started.
 */
export function goalBarA11y(p: GoalProgress, lang: Language = 'en'): string {
  const pct = Math.round(p.fraction * 100);
  const d = new Date(p.goal.createdAt);
  const when = `${MONTHS_TREND[lang][d.getMonth()]} ${d.getDate()}`;
  return fill(t(lang, 'goalBarA11y'), { pct, when });
}

/**
 * The single goal worth putting on a shareable: closest to done among those
 * actually moving. Achieved goals lead — finishing one is the best thing that
 * happens on this screen and it should be what gets sent.
 *
 * **But only while it is news.** Without `since`, a goal hit thirty days ago
 * still won every recap after it: a bench-only Tuesday went out carrying
 * "Squat: 225 × 5. Done.", which is not what happened that day, and it crowded
 * out the live goal that was actually moving. `since` is the start of the
 * session being recapped; a goal already achieved before it does not headline
 * at all. Not merely deprioritised — if an old trophy is the only goal there
 * is, the honest line is no line, and §5 already says an absent goal line beats
 * an invented one.
 *
 * @param since Epoch ms of the session being recapped. Omit only where there is
 *              no session context; every achieved goal then counts as fresh.
 * @param trained Exercise ids this workout touched. Passed explicitly rather
 *              than derived from `since`, because a session's `startedAt` is not
 *              reliably earlier than its own sets — several fixtures start a
 *              session at `now` and log into it retroactively, and a time window
 *              silently matched nothing for them.
 */
export function headlineGoal(
  goals: Goal[], history: LoggedSet[], exercises: Map<string, Exercise>, now: number,
  sessionUnits: Map<string, Unit> = new Map(), since?: number, trained?: string[]
): GoalProgress | null {
  const earlier = since == null ? null : history.filter(s => s.at < since);

  const scored = goals
    .filter(g => earlier === null || !isAchieved(g, earlier, sessionUnits))
    .map(g => goalProgress(g, history, exercises, now, sessionUnits))
    .filter(p => narrativeLine(p) !== null);
  if (!scored.length) return null;

  /*
   * A goal on a lift THIS workout touched outranks one that is merely further
   * along.
   *
   * `since` already stopped an old trophy from headlining, for the reason
   * above — the card has to be about the day it is on. The same flaw survived
   * for goals still in progress, because "closest to done" ignores what was
   * trained: a bench-only Tuesday with a squat sitting at 97% went out saying
   * "10 lb from a 315 squat", which is no more what happened that day than the
   * stale trophy was.
   *
   * Survivable while the cap was three and a goal was likely to be on something
   * you were doing. The cap is now twelve, so the goal furthest along is usually
   * one you did not touch, and it became the normal case.
   *
   * A preference and not a filter, deliberately: when nothing you trained has a
   * goal on it, the best untrained goal still reaches the shareable rather than
   * vanishing from it. §5 says goals earn their place by feeding the output, and
   * `shareText` already puts the work first, so it follows the session's lifts
   * rather than opening the message.
   */
  const touched = new Set(trained ?? []);
  scored.sort((a, b) => {
    if (a.achieved !== b.achieved) return a.achieved ? -1 : 1;
    const at = touched.has(a.goal.exerciseId), bt = touched.has(b.goal.exerciseId);
    if (at !== bt) return at ? -1 : 1;
    return b.fraction - a.fraction;
  });
  return scored[0];
}

export type GoalError = 'too_many' | 'duplicate' | 'target_below_current' | 'bad_reps' | 'date_in_past';

/**
 * Guard rails on creation. A goal you have already beaten, or one at 20 reps,
 * is not a goal — and letting either through means the Progress bar lies on
 * day one.
 */
/**
 * Has this goal already been met? The same comparison `goalProgress` makes,
 * without needing the exercise names or a clock.
 */
export function isAchieved(
  goal: Goal, history: LoggedSet[], sessionUnits: Map<string, Unit> = new Map()
): boolean {
  return bestAt(history, goal.exerciseId, goal.targetReps, goal.unit, sessionUnits) >= goal.targetWeight;
}

/**
 * The goals that still count against §5's cap of three.
 *
 * The cap counts things you are working TOWARD. A goal you have
 * already hit is a result, not a commitment, and counting it meant that after
 * three wins the app demanded you **delete a trophy before you could set a new
 * target** — punishing exactly the user it was supposed to be for.
 */
export function activeGoals(
  goals: Goal[], history: LoggedSet[], sessionUnits: Map<string, Unit> = new Map()
): Goal[] {
  /*
   * Bucketed for the same reason `rankGoals` is, and this was the half that
   * kept scanning. `isAchieved` reads only the goal's own exercise, so handing
   * every goal the whole history made this O(goals x sets) — and unlike
   * `rankGoals`, which the Goals screen calls once, this is on the path of
   * `canAddGoal`, `goalLifts`, `validateNewGoal` and `Repo.saveGoal`.
   *
   * Measured at the size the stress harness builds — 14,000 sets, 100 goals:
   * `listGoals` (bucketed) 1.76ms, `canAddGoal` 14.57ms and `goalLifts`
   * 15.97ms, both of which are almost entirely this function. The 48ms figure
   * `rankGoals` carries is long stale; the cost had moved next door.
   */
  if (goals.length < 2) return goals.filter(g => !isAchieved(g, history, sessionUnits));

  const byExercise = new Map<string, LoggedSet[]>();
  for (const s of history) {
    const bucket = byExercise.get(s.exerciseId);
    if (bucket) bucket.push(s);
    else byExercise.set(s.exerciseId, [s]);
  }
  // Identical answers: each goal sees exactly the sets `bestAt` would have kept.
  return goals.filter(g => !isAchieved(g, byExercise.get(g.exerciseId) ?? [], sessionUnits));
}

/**
 * @param editing The id of the goal being amended, if this is an edit rather
 *   than a new goal. It is taken out of `existing` before the cap and the
 *   duplicate check run — otherwise every edit fails as a duplicate of itself,
 *   and an edit made at the cap fails as one goal too many.
 */
export function validateNewGoal(
  goal: Goal, existing: Goal[], history: LoggedSet[], now: number,
  sessionUnits: Map<string, Unit> = new Map(), editing?: string
): GoalError | null {
  if (editing !== undefined) existing = existing.filter(g => g.id !== editing);
  if (activeGoals(existing, history, sessionUnits).length >= MAX_GOALS) return 'too_many';
  // `activeGoals`, not `existing`, for the same reason the cap above uses it —
  // and this was the half R39 missed. Hitting a 225 squat and then wanting 275
  // is the single most likely next thing a user does, and the app answered
  // "You already have a goal for this lift", offering no way forward but
  // deleting the trophy. One live goal per lift keeps the screen and the
  // narrative unambiguous; a finished one is a result and blocks nothing.
  if (activeGoals(existing, history, sessionUnits).some(g => g.exerciseId === goal.exerciseId)) {
    return 'duplicate';
  }
  if (goal.targetReps < 1 || goal.targetReps > MAX_PR_REPS) return 'bad_reps';
  if (goal.targetDate <= now) return 'date_in_past';
  if (bestAt(history, goal.exerciseId, goal.targetReps, goal.unit, sessionUnits) >= goal.targetWeight) {
    return 'target_below_current';
  }
  return null;
}

/** Ranking for the screen: live goals by how close they are, achieved at the end. */
export function rankGoals(
  goals: Goal[], history: LoggedSet[], exercises: Map<string, Exercise>, now: number,
  sessionUnits: Map<string, Unit> = new Map()
): GoalProgress[] {
  /*
   * Index once, not once per goal. Every read `goalProgress` makes of the
   * history is scoped to that goal's own exercise, so handing it the whole
   * list made the screen O(goals x sets) — fine at a cap of three, quadratic
   * at a hundred. Bucketing first makes it O(sets), and the numbers are
   * identical because each goal sees exactly the sets it would have kept.
   */
  const byExercise = new Map<string, LoggedSet[]>();
  for (const s of history) {
    const bucket = byExercise.get(s.exerciseId);
    if (bucket) bucket.push(s);
    else byExercise.set(s.exerciseId, [s]);
  }

  return goals
    .map(g => goalProgress(g, byExercise.get(g.exerciseId) ?? [], exercises, now, sessionUnits))
    .sort((a, b) => {
      if (a.achieved !== b.achieved) return a.achieved ? 1 : -1;
      return b.fraction - a.fraction;
    });
}

/** Estimated 1RM against the goal, for the Progress screen's secondary readout. */
export function goalE1rmGap(p: GoalProgress): number {
  return e1rm(p.goal.targetWeight, p.goal.targetReps) - e1rm(p.current, p.goal.targetReps);
}

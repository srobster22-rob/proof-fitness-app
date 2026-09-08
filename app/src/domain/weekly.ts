import type { LoggedSet, Exercise, Unit } from './types.ts';
import type { Measurement } from './measure.ts';
import { bestWeightAtReps, MAX_PR_REPS } from './pr.ts';
import { t, type Language } from './i18n.ts';

/**
 * §10's weekly comparison — the one thing this app has to say on a rest day.
 *
 * §10 asks for "one auto-surfaced comparison per week: *your squat is up 15 lb
 * since four weeks ago* — generated, not requested, and already formatted as a
 * postable card", and §5 names the same artifact when it says a goal must feed
 * "the recap AND the weekly card". Nothing had ever built it: the app opened
 * mid-workout, said nothing between workouts, and §10 is explicit that an app
 * with no rest-day surface has no habit hook.
 *
 * This is the claim, not the card and not the schedule. Keeping it pure means
 * the rule that decides what is TRUE can be tested without a clock, a renderer
 * or a notification permission — the same split every other claim in this
 * codebase uses.
 */

/** Four weeks, which is §10's own example and long enough to clear a bad week. */
export const LOOKBACK_DAYS = 28;

const DAY = 86_400_000;

export interface WeeklyComparison {
  exerciseId: string;
  /** The lift's display name, resolved here so the caller needs no map. */
  lift: string;
  /** The rep count the comparison is made AT — both sides are like-for-like. */
  reps: number;
  /** Best load now, and the best on or before the cutoff. */
  now: number;
  then: number;
  /** `now - then`, always positive: a comparison that is not progress is not surfaced. */
  gain: number;
  /** How far back the baseline is, in whole days. */
  days: number;
}

/**
 * Load comparisons are unit-aware and bodyweight-aware because `bestWeightAtReps`
 * is. A `LoggedSet` carries no unit — the SESSION owns it — so anything
 * comparing weights ACROSS sessions needs `sessionUnits`, and five separate
 * bugs of exactly this shape have been found in this codebase already.
 */
export function weeklyComparison(
  allSets: readonly LoggedSet[],
  exercises: Map<string, Exercise>,
  now: number,
  unit: Unit = 'lb',
  measurements: readonly Measurement[] = [],
  sessionUnits: Map<string, Unit> = new Map(),
  lookbackDays: number = LOOKBACK_DAYS
): WeeklyComparison | null {
  const cutoff = now - lookbackDays * DAY;
  const recent = allSets.filter(s => s.at > cutoff);
  const older = allSets.filter(s => s.at <= cutoff);
  if (!recent.length || !older.length) return null;

  let best: WeeklyComparison | null = null;

  for (const id of new Set(recent.map(s => s.exerciseId))) {
    /*
     * Compare at the rep count they are ACTUALLY working in now — the heaviest
     * set of the recent window — rather than at a fixed number. A lifter who
     * has moved from fives to eights has still improved, and a comparison
     * pinned to fives would either miss it or invent it.
     *
     * `bestWeightAtReps` counts a set at that rep count OR MORE on both sides,
     * which is the same rule `findPRs` uses, so the two can never disagree
     * about what was beaten.
     */
    const mine = recent.filter(s => s.exerciseId === id && s.reps >= 1 && s.reps <= MAX_PR_REPS);
    if (!mine.length) continue;
    const reps = mine.reduce((top, s) => (s.reps < top ? s.reps : top), MAX_PR_REPS);

    const nowBest = bestWeightAtReps(mine as LoggedSet[], id, reps, measurements, unit, sessionUnits);
    const thenBest = bestWeightAtReps(older as LoggedSet[], id, reps, measurements, unit, sessionUnits);

    /*
     * A baseline of zero is not a baseline. Without this a lift first trained
     * three weeks ago reads "up 185 lb since four weeks ago", which is the
     * cry-wolf failure §8 forbids for PRs, told about a month the user did not
     * train it. Same reason the goal tag says "108 TO 108" rather than a gap
     * when nothing is on the board yet.
     */
    if (thenBest <= 0 || nowBest <= thenBest) continue;

    const gain = Math.round((nowBest - thenBest) * 100) / 100;
    const oldest = mine.reduce((m, s) => Math.min(m, s.at), Infinity);
    const cand: WeeklyComparison = {
      exerciseId: id,
      lift: exercises.get(id)?.name ?? id,
      reps,
      now: nowBest,
      then: thenBest,
      gain,
      // Whole days back to the baseline, from the window rather than the set,
      // so the sentence says "since four weeks ago" and means it.
      days: Math.max(1, Math.round((now - cutoff) / DAY))
    };

    /*
     * Biggest absolute gain wins, and a tie goes to the lift trained most
     * recently. Absolute rather than relative on purpose: "up 25 lb" is the
     * sentence a lifter repeats, and a percentage flatters the accessories —
     * a curl going 20 to 30 is +50% and nobody posts it over a squat going
     * 300 to 325.
     */
    if (!best || gain > best.gain || (gain === best.gain && oldest > 0 && cand.now > best.now)) {
      best = cand;
    }
  }

  return best;
}

/**
 * §10's comparison as a card the user can post, not just a line they can read.
 *
 * "Already formatted as a postable card" is the part of §10 that makes this a
 * retention feature rather than a statistic: a rest-day claim nobody can send
 * is a rest-day claim that does no work. §5 names the same artifact — a goal
 * earns its place by feeding "the recap AND the weekly card".
 *
 * Deliberately the SAME payload shape the recap renderer already draws, with
 * `kind: 'weekly'` switching three things: the hero label, the sign on the
 * hero, and an empty stat row. A second layout would be a second set of
 * layout bugs, and the shape this produces — no claim slab, one lift — is the
 * case the safe-box tests already cover.
 *
 * `sets`, `duration` and `streak` are absent on purpose. There is no session
 * behind this card, and a stat row reading "0 SETS · 1 MIN" would be three
 * numbers about a workout that never happened (§16).
 */
export function weeklyCard(
  c: WeeklyComparison, unit: Unit, watermark = 'PROOF', lang?: string
): Record<string, unknown> {
  const weeks = Math.max(1, Math.round(c.days / 7));
  return {
    kind: 'weekly',
    ...(lang && lang !== 'en' ? { lang } : {}),
    title: c.lift.toUpperCase(),
    // Translated here, not in the renderer: this field is produced app-side,
    // so R221's LABELS table never saw it and a Spanish card read "SUBIO ... 4
    // WEEKS" — half translated, on the artifact that leaves the device.
    date: `${weeks} ${t((lang ?? 'en') as Language, weeks === 1 ? 'cardWeekOne' : 'cardWeeks')}`,
    volume: c.gain,
    unit,
    watermark,
    // The two numbers the gain is derived from, so it is checkable (§16) —
    // "+20" alone is a claim the reader has to take on trust.
    lifts: [[c.lift, `${c.then} → ${c.now}`, true]] as Array<[string, string, boolean]>
  };
}

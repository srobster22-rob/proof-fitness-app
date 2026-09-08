import {
  type LoggedSet, type Exercise, type PersonalRecord, type Unit, MIN_INCREMENT, convertWeight
} from './types.ts';
import { realLoad, CARRIES_BODYWEIGHT } from './measure.ts';
// Separate line, not an inline `type` specifier: the browser-bundle builder
// parses value imports straight out of the source and would try to resolve a
// type name out of its registry.
import type { Measurement } from './measure.ts';

/**
 * Personal record detection. PROMPT.md §8.
 *
 * The PR is the emotional payload of the whole product, so the rule has one job
 * above all others: NEVER CRY WOLF. An app that awards a PR every session has
 * made the word worthless, and nobody shares a worthless badge.
 *
 * The rule a lifter would actually agree with:
 *
 *     more weight than ever before, for the same or more reps.
 *
 * That is unambiguous, concrete, and cannot overclaim — which is why it is the
 * primary rule rather than estimated 1RM.
 *
 * e1RM (Epley) is used only to RANK candidate sets inside one session, never to
 * award. Awarding on e1RM would call 230x5 a miss when the previous best was
 * 275x2, even though no lifter alive would agree they hadn't just PR'd.
 */

/**
 * What a set counts as when it is being compared with another one.
 *
 * For every ordinary lift this is the number on the bar and nothing here
 * changes. For the four movements whose load is the lifter it is bodyweight
 * plus whatever was added, because comparing pull-ups by ADDED weight is
 * comparing them by the smallest part of the load — and it broke this module
 * in two separate ways that no test caught for 140 rounds:
 *
 * 1. **An unweighted pull-up could never set a PR at all.** `e1rm(0, reps)` is
 *    0, so `bestE1rm` was 0, so the e1RM branch hit its `bestPrior <= 0` guard
 *    and returned. Somebody going from 8 strict pull-ups to 15 — one of the
 *    most visible strength gains there is — got nothing, for ever.
 * 2. **A record could be earned by gaining weight.** Adding real load fixes (1)
 *    and immediately introduces this, which is why `findPRs` also carries a
 *    guard: see the branch that awards on weight.
 *
 * Falls back to the bar when there is no reading, so every existing caller
 * that passes no measurements gets exactly the answers it got before.
 *
 * `sessionUnits` converts the set's own weight into `unit` FIRST, before
 * anything else touches it — checked directly and found missing: comparing
 * `s.weight` straight across `history` with no regard for which session it
 * came from let a genuine ~220 lb (100 kg) history read as a mere 100, so a
 * later 205 lb set — 15 lb LIGHTER than the real best — was awarded "Heaviest
 * 5-rep bench press". §8's one rule is never to cry wolf, and this is exactly
 * that: a false PR announced to the one artifact this whole app exists to
 * produce. `realLoad` trusts `set.weight` is already in `unit` (see its own
 * comment on why bodyweight and load must never be added across two
 * different units), so the conversion has to land before that call, not
 * after it — converting the SUM would silently double-convert the bodyweight
 * half of it.
 */
export function loadOf(
  set: LoggedSet, measurements: readonly Measurement[], unit: Unit,
  sessionUnits: Map<string, Unit> = new Map()
): number {
  const from = sessionUnits.get(set.sessionId) ?? unit;
  const weight = from === unit ? set.weight : convertWeight(set.weight, from, unit);
  if (!measurements.length) return weight;
  return realLoad({ ...set, weight }, measurements, unit)?.load ?? weight;
}

export const MAX_PR_REPS = 12;
export const MIN_SESSIONS_BEFORE_PR = 3;
/** e1RM improvement required when there is no comparable set to beat directly. */
export const E1RM_MARGIN = 0.01;

/** What a record should be ranked and compared by — see `realWeight`. */
export function rank(pr: PersonalRecord): number {
  return pr.realWeight ?? pr.weight;
}

/** Epley. Only meaningful at low reps, hence MAX_PR_REPS. */
export function e1rm(weight: number, reps: number): number {
  return weight * (1 + reps / 30);
}

/** Distinct sessions in which this exercise was trained. */
function sessionCount(history: LoggedSet[], exerciseId: string): number {
  const ids = new Set<string>();
  for (const s of history) if (s.exerciseId === exerciseId) ids.add(s.sessionId);
  return ids.size;
}

/**
 * Best weight ever lifted for AT LEAST `reps` reps.
 * Returns 0 when there is no comparable set.
 */
export function bestWeightAtReps(
  history: LoggedSet[], exerciseId: string, reps: number,
  measurements: readonly Measurement[] = [], unit: Unit = 'lb',
  sessionUnits: Map<string, Unit> = new Map()
): number {
  let best = 0;
  for (const s of history) {
    if (s.exerciseId !== exerciseId) continue;
    if (s.reps < reps) continue;
    const w = loadOf(s, measurements, unit, sessionUnits);
    if (w > best) best = w;
  }
  return best;
}

/**
 * The heaviest weight ever moved on this lift, at ANY rep count.
 *
 * Deliberately unfiltered by reps, unlike `bestWeightAtReps`: "heaviest ever"
 * is a claim about the bar, and a 275 x 3 counts against it even though 3 reps
 * is not comparable to today's 10. The recap used to assert "heaviest ever" on
 * every PR, so a 200 x 10 that beat a 225 x 5 only on e1RM went out claiming to
 * be the heaviest ever when it was 25 lb lighter than the user's best.
 */
export function heaviestEver(
  history: LoggedSet[], exerciseId: string,
  measurements: readonly Measurement[] = [], unit: Unit = 'lb',
  sessionUnits: Map<string, Unit> = new Map()
): number {
  let best = 0;
  for (const s of history) {
    if (s.exerciseId !== exerciseId) continue;
    const w = loadOf(s, measurements, unit, sessionUnits);
    if (w > best) best = w;
  }
  return best;
}

/**
 * The actual heaviest set at or above `reps` — the set itself, not a weight.
 *
 * `bestWeightAtReps` answers "how much" and is right for PR comparison, but
 * anything that DISPLAYS a best set needs the real rep count too. Showing the
 * weight beside the threshold reps produces "105 × 5" for a set that was
 * actually 105 × 8 — a set the user never performed.
 */
export function bestSetAtReps(
  history: LoggedSet[], exerciseId: string, reps: number,
  measurements: readonly Measurement[] = [], unit: Unit = 'lb',
  sessionUnits: Map<string, Unit> = new Map()
): LoggedSet | null {
  let best: LoggedSet | null = null;
  let bestLoad = 0;
  for (const s of history) {
    if (s.exerciseId !== exerciseId) continue;
    if (s.reps < reps) continue;
    // Heavier wins; at equal weight, more reps is the better set. "Heavier"
    // means what the set actually moved, so a pull-up done at a heavier
    // bodyweight is not ranked as a lighter set than one done at a lighter one.
    const load = loadOf(s, measurements, unit, sessionUnits);
    if (!best || load > bestLoad || (load === bestLoad && s.reps > best.reps)) {
      best = s;
      bestLoad = load;
    }
  }
  return best;
}

/** Highest e1RM ever recorded for an exercise, counting only scoring reps. */
export function bestE1rm(
  history: LoggedSet[], exerciseId: string,
  measurements: readonly Measurement[] = [], unit: Unit = 'lb',
  sessionUnits: Map<string, Unit> = new Map()
): number {
  let best = 0;
  for (const s of history) {
    if (s.exerciseId !== exerciseId) continue;
    if (s.reps > MAX_PR_REPS || s.reps < 1) continue;
    const v = e1rm(loadOf(s, measurements, unit, sessionUnits), s.reps);
    if (v > best) best = v;
  }
  return best;
}

/**
 * Find the PR in one session, if any.
 *
 * @param sessionSets sets logged in the session being evaluated
 * @param history     every set logged BEFORE this session
 *
 * At most one PR per exercise per session: a top set followed by a better one
 * is a single achievement, not two. Returns them ranked by e1RM so a caller
 * that wants a single headline takes the first.
 */
export function findPRs(
  sessionSets: LoggedSet[],
  history: LoggedSet[],
  exercises: Map<string, Exercise>,
  unit: Unit = 'lb',
  measurements: readonly Measurement[] = [],
  sessionUnits: Map<string, Unit> = new Map()
): PersonalRecord[] {
  const increment = MIN_INCREMENT[unit];
  const bestPerExercise = new Map<string, PersonalRecord>();

  for (const set of sessionSets) {
    // Above ~12 reps the set is conditioning, not a strength record.
    if (set.reps > MAX_PR_REPS || set.reps < 1) continue;

    // Cold-start guard (§6): without this, every new movement is an instant PR
    // and the app discredits itself in week one.
    if (sessionCount(history, set.exerciseId) < MIN_SESSIONS_BEFORE_PR) continue;

    const exercise = exercises.get(set.exerciseId);
    const name = exercise ? exercise.name : set.exerciseId;
    // Two scales, both needed. `previous` is what the set has to beat and is
    // measured in real load; `previousAdded` is the number the lifter typed,
    // which is what the record REPORTS and what `gain` is computed from.
    // For every ordinary lift they are the same number.
    //
    // `previousAdded` passes no measurements on purpose — see `loadOf` — but
    // still has to pass `unit` and `sessionUnits`: `loadOf` converts a set's
    // weight into `unit` before it ever looks at `measurements.length`, so
    // omitting `unit` here would compare TODAY's set (in its own session's
    // real unit) against yesterday's forced into lb regardless of what either
    // one actually is.
    const previous = bestWeightAtReps(history, set.exerciseId, set.reps, measurements, unit, sessionUnits);
    const previousAdded = bestWeightAtReps(history, set.exerciseId, set.reps, [], unit, sessionUnits);
    const lifted = loadOf(set, measurements, unit, sessionUnits);

    let claim: string;

    if (previous > 0) {
      // There is a directly comparable set. Beat it on weight, full stop.
      // e1RM deliberately does NOT gate here: with a prior 275x2 on the books,
      // e1RM would reject 230x5, and every lifter alive calls that a 5-rep PR.
      if (lifted < previous + increment) continue;
      /*
       * The other half of counting a pull-up honestly.
       *
       * This branch holds reps constant-or-better and lets weight decide, so on
       * a bodyweight movement the ONLY way real load can rise without the
       * lifter doing anything is the lifter getting heavier. "Heaviest 8-rep
       * pull-up" because you put on ten pounds is the purest cry-wolf in the
       * app (§8): it is a badge for eating.
       *
       * So a record here has to hold on both scales — more total load AND more
       * added weight than ever before. At an unchanged bodyweight the two agree
       * exactly, which is why this costs a real lifter nothing; they diverge
       * only when the scale, not the training, moved the number.
       */
      if (CARRIES_BODYWEIGHT.has(set.exerciseId) && set.weight <= previousAdded) continue;
      claim = `Heaviest ${set.reps}-rep ${name.toLowerCase()}`;
    } else {
      // Never trained this exercise at this many reps, so nothing to beat
      // directly. Require it to be the strongest set ever by e1RM instead —
      // otherwise a light high-rep set (135x12 against a 225x5 history) would
      // sail through unopposed and the app starts crying wolf.
      const bestPrior = bestE1rm(history, set.exerciseId, measurements, unit, sessionUnits);
      if (bestPrior <= 0) continue;
      if (e1rm(lifted, set.reps) < bestPrior * (1 + E1RM_MARGIN)) continue;
      /*
       * No weight-gain guard here, and that is deliberate rather than an
       * oversight. Reaching this branch means no set in history ever reached
       * this many reps, so the rep count is a personal best on its own terms
       * and the bodyweight is not what did the work. Applying the guard anyway
       * would re-break the thing this round exists to fix: added weight is 0 on
       * a strict pull-up, and 0 can never beat 0.
       */
      claim = `Best ${name.toLowerCase()} set yet`;
    }

    const record: PersonalRecord = {
      exerciseId: set.exerciseId,
      exerciseName: name,
      setId: set.id,
      sessionId: set.sessionId,
      weight: set.weight,
      reps: set.reps,
      previousWeight: previousAdded,
      realWeight: measurements.length
        ? (realLoad(set, measurements, unit)?.load ?? null)
        : null,
      claim
    };

    const held = bestPerExercise.get(set.exerciseId);
    if (!held || e1rm(lifted, set.reps) > e1rm(rank(held), held.reps)) {
      bestPerExercise.set(set.exerciseId, record);
    }
  }

  // Ranked by what was actually moved, so a session containing both a squat and
  // a pull-up PR does not headline the pull-up at "25".
  return [...bestPerExercise.values()]
    .sort((a, b) => e1rm(rank(b), b.reps) - e1rm(rank(a), a.reps));
}

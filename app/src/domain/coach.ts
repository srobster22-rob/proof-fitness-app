import type { LoggedSet, Unit } from './types.ts';
import { MIN_INCREMENT } from './types.ts';

/**
 * The suggestion line. OWNER.md #2.
 *
 * "For this day, you did 185 lb the last two weeks — I suggest going up a
 * little." One line, about the lift in front of you, from your own history.
 *
 * A LOCAL RULE ENGINE, deliberately. The owner asked for it that way and the
 * reasons hold on their own: it works in a basement with no signal, it costs
 * nothing per use, it cannot leak a training log to anybody, and it is
 * testable — every line below can be shown to be right or wrong against a
 * fixture, which is not true of a model's answer. `SEAM` at the bottom of this
 * file is where a model call would attach if the owner ever asks for one;
 * OWNER.md says not to add it unasked, so it is not added.
 *
 * The governing rule is §8's "never cry wolf", and it is why this returns
 * `null` so readily. A coach that speaks up when it does not know is worse
 * than one that stays quiet: the lifter cannot tell the confident guesses from
 * the good ones, so they stop believing all of it. Silence is always available
 * and always honest.
 */

/**
 * What the lifter is training FOR. OWNER.md asks the suggestion to be tuned to
 * this.
 *
 * Nothing stores it yet — `Repo.setPref` is a general key/value store and can
 * hold it the day a setting exists, with no migration. Until then callers get
 * the default, and the default is `size` because it is the middle of the three:
 * a strength lifter told to add 5 lb when they wanted 10 has lost a little, and
 * so has a hypertrophy lifter told to add 10 when they wanted 5, but neither is
 * given advice that is wrong in kind.
 */
export type TrainingGoal = 'strength' | 'size' | 'consistency';

export type SuggestionKind = 'increase' | 'hold' | 'deload';

export interface Suggestion {
  kind: SuggestionKind;
  /** The weight to try, in the unit the history is in. */
  weight: number;
  /** What they have been doing, which is the evidence for the advice. */
  recentWeight: number;
  /** How many sessions in the window back that up. */
  sessions: number;
  /**
   * An i18n KEY plus its values, never a sentence.
   *
   * This module is not allowed to produce English. The app ships in two
   * languages and §16 requires both to say the same thing, so the screen
   * renders `t(lang, key)` with `fill(...)`; a string built here would be
   * English on a Spanish phone and no test would notice.
   */
  key: string;
  params: Record<string, string | number>;
}

/** The window the owner named: "the last two weeks of history". */
export const WINDOW_DAYS = 14;

/**
 * How many sessions of this lift must sit in the window before the coach says
 * anything at all.
 *
 * Two, not one. One session is not a pattern — "you did 185 once, try 190" is
 * a guess wearing the clothes of evidence, and the line's whole value is that
 * it can point at what you actually did. Two sessions at the same weight is the
 * smallest thing that is genuinely a trend.
 */
export const MIN_SESSIONS = 2;

/**
 * Sessions at the same weight, with reps not improving, before it is a plateau.
 *
 * Three. Two identical sessions is a lifter repeating a weight, which is
 * normal and often correct; three is the point where "you are stuck here" is
 * more useful than "keep going".
 */
export const PLATEAU_SESSIONS = 3;

interface TopSet { sessionId: string; at: number; weight: number; reps: number; }

/**
 * The heaviest set of this exercise in each session, most recent first.
 *
 * The TOP set rather than the average, because that is the one a lifter is
 * asking about when they ask what to lift today — warm-ups and back-offs are
 * not the thing being progressed, and including them would drag every
 * suggestion down toward the warm-up.
 */
function topSets(history: LoggedSet[], exerciseId: string, now: number): TopSet[] {
  const cutoff = now - WINDOW_DAYS * 86_400_000;
  const best = new Map<string, TopSet>();
  for (const s of history) {
    if (s.exerciseId !== exerciseId) continue;
    if (s.at < cutoff || s.at > now) continue;
    const cur = best.get(s.sessionId);
    if (!cur || s.weight > cur.weight || (s.weight === cur.weight && s.reps > cur.reps)) {
      best.set(s.sessionId, { sessionId: s.sessionId, at: s.at, weight: s.weight, reps: s.reps });
    }
  }
  return [...best.values()].sort((a, b) => b.at - a.at);
}

/**
 * How much to add, per goal, as a multiple of the unit's smallest increment.
 *
 * Strength moves in bigger steps on fewer reps; size moves in smaller steps
 * because the work is being added as volume rather than as load. Consistency
 * never adds — see `coachSuggestion`.
 *
 * Expressed in MIN_INCREMENT so it is right in both units without a second
 * table: 5 lb and 2.5 kg are the same rung of the same ladder, and hard-coding
 * 5 would silently mean "5 kg" on a metric phone, which is double the jump.
 */
const STEP: Record<TrainingGoal, number> = { strength: 5, size: 2.5, consistency: 0 };

/** Target reps per goal — the rep count a set should reach before load moves. */

/**
 * The largest single-session increase that still counts as CLIMBING, as a
 * fraction of the weight climbed from.
 *
 * Ten per cent, and the number matters less than the existence of a bound.
 * Real progression moves in 2.5-10% steps; anything past that in one session
 * is a different event — a new lift, a corrected entry, a machine that loads
 * differently, or a genuinely exceptional day. Treating it as a trend and
 * extrapolating produced the defect this constant exists to stop: two
 * sessions, 185 then 320, and the coach said "320 and climbing — try 455".
 * Even +45 came out as "try 275", which no bencher would read as advice.
 *
 * The fix is NOT to cap the number and keep the sentence. A 73% jump is not
 * evidence of a repeatable increment, so "keep climbing" is the wrong KIND of
 * advice, not merely the wrong size — and the engine already has the honest
 * thing to say about a weight you have hit once: repeat it before adding.
 */
export const MAX_CLIMB_FRACTION = 0.1;
const TARGET_REPS: Record<TrainingGoal, number> = { strength: 5, size: 8, consistency: 8 };

/**
 * What to lift today, and why — or nothing.
 *
 * @param history every logged set; this filters to `exerciseId` itself
 * @param unit    the unit the history is recorded in, which sets the step size
 */
export function coachSuggestion(
  history: LoggedSet[],
  exerciseId: string,
  now: number,
  opts: { goal?: TrainingGoal; unit: Unit; base?: number }
): Suggestion | null {
  const goal = opts.goal ?? 'size';
  const sets = topSets(history, exerciseId, now);
  if (sets.length < MIN_SESSIONS) return null;

  const step = STEP[goal] * MIN_INCREMENT[opts.unit];
  const target = TARGET_REPS[goal];
  const latest = sets[0];

  // Sessions at the top of the window that share the most recent weight. This
  // is "what you have been doing", and it is the evidence the line cites.
  let atSameWeight = 0;
  for (const s of sets) {
    if (s.weight !== latest.weight) break;
    atSameWeight++;
  }

  /*
   * DELOAD first, because it is the only branch that protects the lifter.
   *
   * Reps falling at a constant weight across the window is the shape of
   * accumulated fatigue, and the answer to it is less, not more. Checked
   * before progress so a lifter grinding out a bad week is never told to add
   * weight on top of it.
   */
  const declining = atSameWeight >= PLATEAU_SESSIONS &&
    sets[0].reps < sets[atSameWeight - 1].reps;
  if (declining) {
    /*
     * FLOORED AT THE EMPTY IMPLEMENT (R541).
     *
     * Ten percent off is right until the lifter is already at the bottom.
     * `coldstart.ts` states the floor — "the empty version of each thing: a bar
     * with no plates, the lightest dumbbell, the first pin on a stack. The
     * floor a suggestion can never go below" — and this engine, added later,
     * had never heard of it. Measured: three sessions of bench at 45 with reps
     * falling produced "45 is grinding — back off to 41", and there is no way
     * to load a barbell to 41. §16 asks every number to be checkable against a
     * rack; this one could not be.
     *
     * `base` is optional and defaults to 0, so a caller that does not know the
     * equipment gets exactly the old arithmetic rather than a wrong floor.
     */
    const base = opts.base ?? 0;
    const back = Math.max(base, roundTo(latest.weight * 0.9, MIN_INCREMENT[opts.unit]));
    /*
     * At the floor there is nothing to back off TO, and the branches below
     * must not get the question: with reps falling and three sessions at one
     * weight, PLATEAU fires and says "try 46" — telling somebody grinding out
     * a bad week to add weight, which is the exact thing this branch exists to
     * prevent. So the protection stays and only the ACTION changes: hold, and
     * say why, because "back off to 45" said at 45 is not advice.
     */
    if (back >= latest.weight) {
      return {
        kind: 'hold', weight: latest.weight, recentWeight: latest.weight,
        sessions: atSameWeight, key: 'coachDeloadFloor',
        params: { weight: latest.weight, n: atSameWeight }
      };
    }
    return {
      kind: 'deload', weight: back, recentWeight: latest.weight,
      sessions: atSameWeight, key: 'coachDeload',
      params: { weight: latest.weight, suggest: back, n: atSameWeight }
    };
  }

  /*
   * CONSISTENCY never changes the number.
   *
   * The goal is showing up, and a lifter who is told to add weight every time
   * they come in eventually stops coming in. So the line reports the streak of
   * same-weight sessions and leaves the load alone — which is also the honest
   * reading of what they have been doing.
   */
  if (goal === 'consistency') {
    return {
      kind: 'hold', weight: latest.weight, recentWeight: latest.weight,
      sessions: atSameWeight, key: 'coachHold',
      params: { weight: latest.weight, n: Math.max(atSameWeight, sets.length) }
    };
  }

  /*
   * PLATEAU. Same weight for three sessions with reps not improving is a
   * signal that the next session at that weight will look like the last three.
   * Nudging the load is the standard answer and the one a lifter can act on
   * immediately.
   */
  if (atSameWeight >= PLATEAU_SESSIONS && sets[0].reps <= sets[atSameWeight - 1].reps) {
    const up = latest.weight + step;
    return {
      kind: 'increase', weight: up, recentWeight: latest.weight,
      sessions: atSameWeight, key: 'coachPlateau',
      params: { weight: latest.weight, suggest: up, n: atSameWeight }
    };
  }

  /*
   * PROGRESS. Two or more sessions at this weight, and the last one reached
   * the rep target, so the weight is no longer the limiting thing.
   */
  if (atSameWeight >= MIN_SESSIONS && latest.reps >= target) {
    const up = latest.weight + step;
    return {
      kind: 'increase', weight: up, recentWeight: latest.weight,
      sessions: atSameWeight, key: 'coachIncrease',
      params: { weight: latest.weight, suggest: up, n: atSameWeight }
    };
  }

  /*
   * A weight they have used exactly ONCE in the window — which is what a
   * lifter on linear progression looks like every single session, because they
   * move up every time they train.
   *
   * Found by running this against the app's own seeded history rather than
   * against fixtures, and it is the reason to do that. Every fixture in the
   * test file holds the weight constant across sessions, so `atSameWeight` was
   * always >= 2 and this case never arose in a test. On real data it is the
   * COMMON case, and it produced '235 last 1 — stay here and add a rep': a
   * count of one read as a streak, and 'stay here' said to somebody who had
   * added weight every session for three months.
   *
   * The honest line differs in kind, not just in wording. A weight you have hit
   * once is not yet a weight you own, so the advice is to repeat it — the same
   * ACTION as `hold` for a completely different reason, and the reason is the
   * half the owner asked for.
   */
  /*
   * CLIMBING. The weight has gone up every session in the window, so the
   * lifter is on linear progression and it is working.
   *
   * This is checked before `settle` because they look identical from
   * `atSameWeight` alone — both are "one session at this weight" — and the
   * right advice is opposite. R518 found it through an existing fixture: four
   * weekly squat sessions at 200, 205, 210, 215, and the engine said "first
   * time at 215, repeat it before adding" to somebody who had added five
   * pounds a week for a month and made every one of them. Conservative advice
   * given to a lifter with a working plan is still wrong advice, and it is the
   * kind that makes a coach worth ignoring.
   *
   * The step is THEIR step, not the table's, and it OUTRANKS the stated goal
   * (R519). A strength lifter climbing in 2.5s is told 2.5, not 5.
   *
   * That looks like the setting failing and is the opposite. Overriding a plan
   * that is demonstrably working, because of a preference, is the same mistake
   * R517 and R518 each fixed once — conservative advice to a lifter whose plan
   * works, and eager advice to a tired one — pointed at a setting instead of
   * at a default. Their own evidence beats a constant chosen here. The goal
   * decides the step in every branch where there is no working increment to
   * read, which is every other branch in this function.
   *
   * A lifter climbing in 5s is told
   * to try 5 more; one climbing in 10s is told 10. OWNER.md asks for the app
   * to be personalised to the person, and their own recent increment is a
   * better answer than a constant chosen here.
   */
  if (sets.length >= MIN_SESSIONS && atSameWeight === 1) {
    let rising = true;
    for (let i = 0; i + 1 < sets.length; i++) {
      const from = sets[i + 1].weight, to = sets[i].weight;
      // Up, and up by a believable amount. A step past MAX_CLIMB_FRACTION is
      // not a rung on a ladder, so the whole run stops being a climb.
      if (to <= from || to - from > from * MAX_CLIMB_FRACTION) { rising = false; break; }
    }
    if (rising) {
      const theirStep = sets[0].weight - sets[1].weight;
      const up = latest.weight + theirStep;
      return {
        kind: 'increase', weight: up, recentWeight: latest.weight,
        sessions: sets.length, key: 'coachClimbing',
        params: { weight: latest.weight, suggest: up, n: sets.length }
      };
    }
  }

  if (atSameWeight < MIN_SESSIONS) {
    return {
      kind: 'hold', weight: latest.weight, recentWeight: latest.weight,
      sessions: atSameWeight, key: 'coachSettle',
      params: { weight: latest.weight, reps: latest.reps }
    };
  }

  /*
   * Otherwise: hold. They are mid-climb at this weight and have not yet hit
   * the rep target, which is exactly when the answer is "same again" — the
   * most common honest answer, and the one a coach that only ever says "go up"
   * would never give.
   */
  return {
    kind: 'hold', weight: latest.weight, recentWeight: latest.weight,
    sessions: atSameWeight, key: 'coachHold',
    params: { weight: latest.weight, n: atSameWeight }
  };
}

/** Round to the unit's own granularity, so no suggestion is unloadable. */
function roundTo(value: number, increment: number): number {
  return Math.round(value / increment) * increment;
}

/*
 * SEAM for a model-backed version.
 *
 * OWNER.md: "a real model call is a later owner decision (cost, key, privacy)
 * — leave a seam for it, do not add it unasked." So the shape is stated here
 * and nothing calls it:
 *
 *   a provider takes the same (history, exerciseId, now, opts) and returns
 *   Promise<Suggestion | null>; the screen keeps rendering `key` + `params`
 *   through i18n, so a model would have to choose among the SAME keys rather
 *   than write prose. That keeps both languages correct, keeps the line
 *   testable, and means a network failure degrades to this function rather
 *   than to a blank space.
 *
 * Adding it needs a decision this file cannot make: what it costs per user,
 * where the key lives, and whether a training log may leave the device.
 */

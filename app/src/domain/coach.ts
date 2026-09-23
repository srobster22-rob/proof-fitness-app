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
   * The reps the call asks for at `weight` (R682), so a set can be seen to
   * make it (`callMade`). Absent on a deload: backing off is not a number
   * to beat, and a lifter who does it has not "made" anything.
   */
  reps?: number;
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
 *
 * One exception (R687): a single session whose OWN sets are a pattern. Two or
 * more sets at its top weight, every one at the goal's reps, is the standard
 * linear-progression signal to add weight, and it is something the lifter did
 * several times over, not once. Anything less from one session stays silent:
 * no "first time" claims, which a break makes false (PT1).
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
function topSets(history: LoggedSet[], exerciseId: string, now: number, live?: string): TopSet[] {
  const cutoff = now - WINDOW_DAYS * 86_400_000;
  const best = new Map<string, TopSet>();
  for (const s of history) {
    if (s.exerciseId !== exerciseId || s.sessionId === live) continue;
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
/*
 * NOT A SUGGESTION, AND SO NOT ON THE GRID (R551).
 *
 * R548 through R550 put every weight the app SUGGESTS onto loadable plates, and
 * this is the one bare fraction left in the file — which makes it the obvious
 * next thing to "fix". Do not. It is a TEST applied to weights the lifter has
 * already lifted, asking whether a jump is believable; it never reaches the
 * screen and no plate has to make it. Rounding it would only move the
 * threshold, and the threshold is deliberately soft.
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
  opts: {
    goal?: TrainingGoal; unit: Unit; base?: number; grid?: number; jump?: number;
    /**
     * The session the call is FOR (R682). Its own sets are never evidence: a
     * lifter who makes "try 210" must not be told "try 215" by the set that
     * made it. And the two weeks are counted back from when it STARTED, not
     * from `now`: a weekly lifter's oldest session would otherwise slide out
     * of the window mid-lift, and the call with it (R682 review). So the call
     * they walk in with holds until the workout is over.
     */
    live?: { id: string; startedAt: number };
  }
): Suggestion | null {
  const goal = opts.goal ?? 'size';
  const sets = topSets(history, exerciseId, opts.live ? Math.min(now, opts.live.startedAt) : now, opts.live?.id);
  if (!sets.length) return null;

  const step = STEP[goal] * MIN_INCREMENT[opts.unit];
  /*
   * THE SMALLEST CHANGE THE LIFTER CAN ACTUALLY MAKE (R548).
   *
   * `MIN_INCREMENT` is the resolution of the DATA - 1 lb, 0.5 kg - and using it
   * to round advice produced numbers nobody can put on a bar. Measured: a
   * plateaued lifter on the size goal was told "stuck at 60 for 3 - try 61.25",
   * and 1.25 kg total means 0.625 kg a side, which is not a plate. In pounds it
   * said 137.5, off the app's own 5 lb stepper, so the lifter cannot even dial
   * the suggestion in without typing it.
   *
   * The caller passes its stepper's increment (`WEIGHT_STEP`), the same number
   * the + and - buttons move by, so every weight the coach names is one the
   * lifter can reach in the app AND load on the bar. Defaults to
   * Defaults to NO snapping at all - not to `MIN_INCREMENT` - and the
   * difference is not cosmetic. Defaulting to `MIN_INCREMENT` looks like "the
   * old behaviour" and is not: the plateau branch never rounded, so a caller
   * passing nothing started getting 61.5 where it used to get 61.25. A test
   * pinning the default caught that, which is the whole reason to pin one.
   * Same contract as `base`, which defaults to a floor of zero.
   */
  const grid = opts.grid ?? 0;
  const snap = (w: number) => (grid > 0 ? roundTo(w, grid) : w);
  /*
   * A snapped weight that is still an INCREASE (R549).
   *
   * `roundTo` goes to the nearest multiple, which can round DOWN past the
   * weight being climbed from — 191 plus a 1 lb step is 192, and 192 on a 5 lb
   * grid is 190. The line would then read "climbing, try 190" to somebody who
   * just lifted 191, which is the advice inverted rather than rounded.
   *
   * Reachable exactly when the current weight is off-grid, and that is not an
   * odd case: a converted history is off-grid by construction, because 86 kg is
   * 189.5 lb. So every branch that says "go up" goes through here.
   */
  const raise = (from: number, target: number): number => {
    const at = snap(target);
    if (grid <= 0 || at > from) return at;
    return roundTo(from + grid, grid) > from ? roundTo(from + grid, grid) : from + grid;
  };
  /*
   * OR A WHOLE NUMBER OF THE LIFTER'S OWN JUMPS FROM WHERE THEY STAND (R671).
   *
   * `grid` is the stepper's, so every number on it is one the + and - buttons
   * dial in by pressing. A lifter with their own plate jump has a second line
   * of numbers just as easy to reach -- the plate button, pressed from the
   * weight they are on -- and when that line passes nearer the goal's target it
   * is the better answer. Rounding to multiples of the jump counted from ZERO,
   * as R592 did, lands on neither: a plateau at 85 kg with a 1.5 kg jump said
   * "try 87", while the plate button goes 86.5, 88 and the stepper 87.5, 90.
   * The caller passes `jump` only where the plate button really does move by
   * exactly that from here, never for a weight it would snap first.
   */
  const ownJump = opts.jump ?? 0;
  const nearer = (from: number, target: number, onGrid: number, up: boolean): number => {
    if (!(ownJump > 0)) return onGrid;
    const n = Math.round((target - from) / ownJump);
    const theirs = from + (up ? Math.max(1, n) : Math.min(-1, n)) * ownJump;
    return Math.abs(theirs - target) < Math.abs(onGrid - target) - 1e-9 ? theirs : onGrid;
  };
  const target = TARGET_REPS[goal];
  const latest = sets[0];

  // Nothing to call at bodyweight with no load added: "0×12 for 3 sets — try
  // 5" tells a lifter to strap on a plate the first time a push-up set goes
  // well (R687 review). Until the coach can count reps as progress, it waits.
  if (latest.weight <= 0) return null;

  /*
   * The latest session's OWN sets as the evidence (R687, D6): two or more at
   * its top weight, every one at the goal's reps, is the linear-progression
   * signal to add weight. It speaks from one session, and it also comes before
   * "repeat it before adding": a lifter who took "try 35" and did 35×8 for
   * 3 was told to repeat it, because a 5 lb step on a 30 lb lift is too big to
   * count as climbing (R687 review). The consistency goal never adds weight.
   */
  const ownSetsCall = (): Suggestion | null => {
    if (goal === 'consistency') return null;
    const atTop = history.filter(s =>
      s.sessionId === latest.sessionId && s.exerciseId === exerciseId && s.weight === latest.weight);
    if (atTop.length < 2 || atTop.some(s => s.reps < target)) return null;
    const up = nearer(latest.weight, latest.weight + step, raise(latest.weight, latest.weight + step), true);
    return {
      kind: 'increase', weight: up, recentWeight: latest.weight,
      sessions: atSameWeightOf(sets), key: 'coachAllSets', reps: target,
      params: { weight: latest.weight, reps: Math.min(...atTop.map(s => s.reps)), n: atTop.length, suggest: up }
    };
  };
  // One session in the window: a call only when its own sets say so (see
  // MIN_SESSIONS).
  if (sets.length < MIN_SESSIONS) return ownSetsCall();

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
    const tenOff = roundTo(latest.weight * 0.9, MIN_INCREMENT[opts.unit]);
    const back = Math.max(base, nearer(latest.weight, tenOff, snap(tenOff), false));
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
      sessions: atSameWeight, key: 'coachHold', reps: latest.reps + 1,
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
    const up = nearer(latest.weight, latest.weight + step, raise(latest.weight, latest.weight + step), true);
    return {
      kind: 'increase', weight: up, recentWeight: latest.weight,
      sessions: atSameWeight, key: 'coachPlateau', reps: Math.min(latest.reps, target),
      params: { weight: latest.weight, suggest: up, n: atSameWeight }
    };
  }

  /*
   * PROGRESS. Two or more sessions at this weight, and the last one reached
   * the rep target, so the weight is no longer the limiting thing.
   */
  if (atSameWeight >= MIN_SESSIONS && latest.reps >= target) {
    const up = nearer(latest.weight, latest.weight + step, raise(latest.weight, latest.weight + step), true);
    return {
      kind: 'increase', weight: up, recentWeight: latest.weight,
      sessions: atSameWeight, key: 'coachIncrease', reps: Math.min(latest.reps, target),
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
    /*
     * A climb needs the reps to hold (R691). 200×5 then 205×3 is a miss, not a
     * rung: "try 215" after it told a lifter to add weight to a set they had
     * just failed (PT2, and R690's blind re-score). The call is the same
     * weight again, for the reps asked of it.
     *
     * Asked, not merely done before: the bar is the fewer of last session's
     * reps and the goal's target. 100×10 then 105×8 on SIZE made the call
     * "try 105" asked for, and it is a climb, not "105 again — make 10"
     * (R691 review).
     */
    const asked = Math.min(sets[1].reps, target);
    if (rising && sets[0].reps < asked) {
      return {
        kind: 'hold', weight: latest.weight, recentWeight: latest.weight,
        sessions: 1, key: 'coachMissed', reps: asked,
        params: { weight: latest.weight, reps: asked }
      };
    }
    if (rising) {
      const theirStep = sets[0].weight - sets[1].weight;
      /*
       * Their own increment, landed on plates (R549).
       *
       * R518 established that a working increment outranks the goal table, and
       * that still holds — this changes where the number lands, not which
       * number it comes from. But "their own increment" is not always something
       * they loaded: with one session logged in kilos, 86 kg reads as 189.5 lb
       * and the step reads as 4.5, so the app said "189.5 and climbing — TRY
       * 194". They never lifted 4.5 lb of anything; the conversion did.
       *
       * `recentWeight` stays exact on purpose. 189.5 is what they actually
       * lifted and §16 wants that reported honestly; it is only the SUGGESTION
       * that has to exist in a rack.
       */
      /*
       * A step that is a whole number of the lifter's own plate jumps IS their
       * plates, and is taken as it is (R669). Dumbbells by 7: 175 -> 182 says
       * "try 189", which their + button reaches; snapped to the 5 lb stepper it
       * said 190, which nothing they own weighs. Every other branch keeps the
       * stepper grid, because a goal's step is the table's number, not theirs.
       * The caller passes `jump` only for weights the lifter loaded -- a
       * converted step can land on a multiple by rounding alone.
       */
      const jumps = opts.jump ? theirStep / opts.jump : 0;
      const theirPlates = jumps >= 1 && Math.abs(jumps - Math.round(jumps)) < 1e-9;
      const up = theirPlates ? latest.weight + theirStep : raise(latest.weight, latest.weight + theirStep);
      return {
        kind: 'increase', weight: up, recentWeight: latest.weight,
        sessions: sets.length, key: 'coachClimbing', reps: Math.min(latest.reps, target),
        params: { weight: latest.weight, suggest: up, n: sets.length }
      };
    }
  }

  if (atSameWeight < MIN_SESSIONS) {
    const own = ownSetsCall();
    if (own) return own;
    return {
      kind: 'hold', weight: latest.weight, recentWeight: latest.weight,
      sessions: atSameWeight, key: 'coachSettle', reps: latest.reps,
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
    sessions: atSameWeight, key: 'coachHold', reps: latest.reps + 1,
    params: { weight: latest.weight, n: atSameWeight }
  };
}

/**
 * The set that made the call, or null (R682): the first one that did what it
 * asked. The first, so the moment belongs to one set. An increase is made at
 * its weight or above, for its reps: 205 for 8 is not "try 210" made, and
 * neither is 210 for 4. A hold ("repeat it before adding", "stay here and add
 * a rep") is made only AT its weight, since a heavier set is the thing it
 * said not to do yet. `sets` must be in the call's unit.
 */
export function callMade(call: Suggestion | null, sets: readonly LoggedSet[]): LoggedSet | null {
  if (!call || call.reps === undefined) return null;
  const reps = call.reps;
  const atWeight = (w: number) => call.kind === 'hold'
    ? Math.abs(w - call.weight) < 1e-9
    : w >= call.weight - 1e-9;
  return sets.find(s => atWeight(s.weight) && s.reps >= reps) ?? null;
}

/** How many sessions, newest first, share the latest session's top weight. */
function atSameWeightOf(sets: readonly TopSet[]): number {
  let n = 0;
  while (n < sets.length && sets[n].weight === sets[0].weight) n++;
  return n;
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

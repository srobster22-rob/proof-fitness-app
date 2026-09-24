/**
 * The line under the lift: last time, the coach's call, "made it", and the goal's tail.
 *
 * Moved verbatim out of now-model.ts (R697); the model imports it from here.
 */
import type { LoggedSet } from '../domain/types.ts';
import { callMade, type Suggestion } from '../domain/coach.ts';
import { loadLabel } from '../domain/types.ts';
import { t, fill, type Language } from '../domain/i18n.ts';

/**
 * The line under the lift name. §4 — last session's numbers for this exact
 * lift, visible with no interaction at all.
 *
 * It used to have a fourth state: a single space. Three branches said something
 * and the fallthrough rendered `' '`, which is 20px of empty gap directly under
 * the app's title — and the way to reach it was to **log your first ever set**.
 * "Somewhere to start" was there a second earlier, so a beginner's very first
 * tap deleted the only encouraging line on the screen. A user who invented
 * their own movement got the gap from the first frame, having never seen
 * anything else. The space was load-bearing for layout and empty as content;
 * this keeps the layout and gives the content back.
 *
 * Order is the point:
 *
 * 1. **An earlier session wins.** That is what §4 is actually asking for, and
 *    it is the number that decides what to load. Nothing outranks it.
 * 2. **Otherwise, this session.** With no earlier session there is nothing to
 *    compare against, but the set just logged is still the answer to "what am I
 *    about to repeat" — which is exactly what the hero is prefilled with.
 * 3. **Otherwise it is the first time.** This used to read "Somewhere to
 *    start", which described a guessed starting weight the app no longer
 *    makes — the bar opens empty now, so there is no "somewhere" being
 *    suggested and the line was describing a feature that had been removed.
 */
export function lastTimeLine(input: LastTimeInput): string {
  const p = lastTimeParts(input);
  return p.head + p.tail;
}

export interface LastTimeInput {
  /** Most recent set of this lift in an EARLIER session, or null. */
  previous: LoggedSet | null;
  /** Sets of this lift logged in THIS session, oldest first. */
  thisSession: readonly LoggedSet[];
  /** The live goal on this lift, if there is one. See `goalTail`. */
  goal?: GoalHint | null;
  /**
   * The coach's advice, when it has any (OWNER.md #2). Outranks `previous`,
   * never `thisSession` — see `lastTimeParts`.
   */
  coach?: Suggestion | null;
  /**
   * The weight the APP chose for a lift never trained (prefill source seed or
   * fallback), or null when the number is the lifter's own. Owner, 2026-09-10:
   * day one should say the 45 is a starting point, not something they did.
   */
  start?: number | null;
}

/**
 * The same line, split where the screen needs to change colour.
 *
 * `lastTimeLine` stays the composed string — it is what the tests assert on and
 * what any caller that just wants text should use. The split exists for one
 * reason: hitting a goal earns the volt, and a nested `Text` is the only way to
 * colour half a line.
 */
export function lastTimeParts(input: LastTimeInput, lang: Language = 'en'): {
  head: string; tail: string; hit: boolean; made: boolean; justMade: boolean;
} {
  const { previous, thisSession, goal, coach, start } = input;
  /*
   * The coach outranks "Last time", and ONLY that. It never displaces "Just
   * did" — that line is the confirmation that the set you just logged landed,
   * and swapping advice in on top of it would answer a question the lifter is
   * not asking mid-set. In practice the two never collide anyway: `previous`
   * already wins over `thisSession`, and the coach needs at least one earlier
   * session in the window (two, or one whose sets all reached the goal: D6),
   * which is a strict superset of having a `previous` at all.
   */
  /*
   * A call the lifter has made says so, for the rest of the workout (R682).
   * The coach no longer reads the live session, so the call holds still while
   * they chase it, and it can be finished. `justMade`: the set that made it is
   * the last one logged, which LOG SET reads for the success tap (an UNDO can
   * leave it true, but nothing plays a tap on UNDO). A miss changes nothing:
   * the call stays up, grey, and nothing turns red.
   */
  const made = callMade(coach ?? null, thisSession);
  // The set that made it, not the call: 210 for 8 on "try 210" says 210×8.
  const head = made
    ? fill(t(lang, 'coachMade'), { weight: loadLabel(made.weight), reps: made.reps })
    : coach
    ? fill(t(lang, coach.key as never), coach.params)
    : previous ? `${t(lang, 'lastTime')}  ${loadLabel(previous.weight)} × ${previous.reps}`
    : thisSession.length
      ? `${t(lang, 'justDid')}  ${loadLabel(thisSession[thisSession.length - 1].weight)} × ` +
        `${thisSession[thisSession.length - 1].reps}`
      : start ? fill(t(lang, 'firstTimeStart'), { w: loadLabel(start) })
      : t(lang, 'firstTime');
  return {
    head, tail: goalTail(goal, lang), hit: goal?.justHit === true,
    made: made !== null, justMade: made !== null && made === thisSession[thisSession.length - 1]
  };
}

/** What the Now screen needs to know about a goal: the gap and the target. */
export interface GoalHint {
  remaining: number;
  targetWeight: number;
  targetReps: number;
  /** Met by a set logged in THIS session — see `goalTail`. */
  justHit?: boolean;
}

/**
 * The goal, on the screen where the lift is actually being trained.
 *
 * Goals lived on their own screen and on the recap, so while you were under the
 * bar the app said nothing about the target you set for that exact lift — the
 * one moment the number can change what you do next. It rides the "last time"
 * line rather than taking one of its own: §4's logging path must not scroll,
 * R94 and R95 were both fights over vertical space, and a new row would have
 * bought this at the cost of the day rail on a short phone.
 *
 * Format matches the Progress row ("97 TO 222") rather than the goal card's
 * sentence, because this is a glance and not a read. The rep count is printed
 * because a gap to "185" means nothing without it — a 20 lb gap at five reps is
 * not a 20 lb gap at ten, and the user may well be doing eights right now.
 *
 * An achieved goal prints nothing, with ONE exception: the set that hit it.
 *
 * Hitting a target you chose months ago is the most postable thing that happens
 * in this app, and on the logging screen it passed in complete silence — the
 * line simply stopped saying anything, next session. The recap tells the story
 * afterwards; this says it in the moment, for the price of the words, with no
 * new row, no tap and no interruption to the set you are in the middle of.
 *
 * Only in the session that did it. A goal hit last month is not news, and a
 * line that says "goal hit" every time you touch the lift for the rest of the
 * year is exactly the crying wolf §8 forbids of the PR badge.
 */
export function goalTail(goal: GoalHint | null | undefined, lang: Language = 'en'): string {
  if (!goal) return '';
  if (goal.justHit) return `   ·   ${t(lang, 'goalHit')}: ${goal.targetWeight} × ${goal.targetReps}`;
  if (goal.remaining <= 0) return '';
  /*
   * With nothing on the board at the goal's rep count, `remaining` IS the
   * target, and the line came out as "142 to 142 × 3" — measured on a lift the
   * user had never trained. It reads as a bug because it is one: a gap is the
   * distance from somewhere, and there is no somewhere yet. Say the target.
   */
  if (goal.remaining >= goal.targetWeight) {
    return `   ·   ${t(lang, 'goalShort')} ${goal.targetWeight} × ${goal.targetReps}`;
  }
  return `   ·   ${Math.round(goal.remaining)} ${t(lang, 'to')} ` +
    `${goal.targetWeight} × ${goal.targetReps}`;
}

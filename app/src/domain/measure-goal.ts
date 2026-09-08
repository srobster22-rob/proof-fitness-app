import {
  KINDS, readingAt, convertMeasure, formatMeasure,
  type MeasurementKind, type MeasureUnit, type Measurement
} from './measure.ts';
import { t, fill, MONTHS_SHORT, type Language, type Key } from './i18n.ts';

/**
 * A goal about the lifter rather than about a lift.
 *
 * Everything in `goals.ts` assumes a target you climb toward and a best you
 * keep once you have it. Neither assumption survives contact with a bodyweight,
 * and the two failures are different in kind:
 *
 * 1. **Direction.** `goalProgress` computes `target - start` and clamps at
 *    zero, so a target BELOW the baseline has a span of 0 and reads as either
 *    0% or 100% forever. Half the bodyweight goals anyone would set go down.
 *
 * 2. **A lift is a thing you did; a bodyweight is a thing you are.** A 315
 *    squat is yours the moment you stand it up and no later session takes it
 *    away, which is why exercise goals are measured on the BEST set ever. Being
 *    175 lb in June does not make you 175 lb in August. Measuring a bodyweight
 *    goal on the best reading would let the app congratulate someone on a state
 *    they are no longer in — the same cry-wolf §8 forbids, in a place §8 never
 *    thought to look.
 *
 * So progress is measured on the LATEST reading, and `reachedAt` carries the
 * first time they got there separately. Both are true and they answer different
 * questions: "are you there" and "did you ever get there".
 *
 * ## What this deliberately does not do
 *
 * There is no pace judgement, and its absence is the decision rather than an
 * omission. Exercise goals grade you against the clock because pushing a lifter
 * to add weight is what the app is for. Telling somebody they are "behind pace"
 * on losing weight is the same sentence pointed somewhere this app has no
 * business pointing it — it would be an app with no knowledge of the person
 * urging them to lose faster. Distance and direction are facts. A grade is an
 * opinion, and this one is not ours to have.
 *
 * For the same reason the bounds here are `plausible()`'s bounds and nothing
 * more: they exist to catch a target typed into the wrong unit box, not to
 * approve or reject anybody's plan.
 */
export interface MeasureGoal {
  id: string;
  kind: MeasurementKind;
  /** In the goal's own unit, which need not be the unit readings are taken in. */
  target: number;
  unit: MeasureUnit;
  /** Advisory, like every other target date here: missing it deletes nothing. */
  targetDate: number;
  createdAt: number;
}

export interface MeasureGoalProgress {
  goal: MeasureGoal;
  /** Which way this goal points, decided once at creation and never re-read. */
  direction: 'down' | 'up';
  /** The reading when the goal was set, in the goal's unit. Null if there was none. */
  start: number | null;
  /** The latest reading, in the goal's unit. Null until they weigh in. */
  current: number | null;
  /** Still to go, never negative. Null when there is nothing to measure from. */
  remaining: number | null;
  /** 0..1 of the distance from `start` to `target`. Null when undecidable. */
  fraction: number | null;
  /** Are they there NOW. See the note above about states versus achievements. */
  achieved: boolean;
  /** When they FIRST got there, which can be true while `achieved` is false. */
  reachedAt: number | null;
  daysLeft: number;
}

export type MeasureGoalError =
  | 'implausible'
  | 'already-there'
  | 'no-reading'
  | 'past-date'
  | 'duplicate';

/**
 * Which way the goal points.
 *
 * Fixed at creation from the reading that existed then, and deliberately not
 * recomputed: someone who sets out to lose weight and gains a little has not
 * changed their mind, and a goal that silently reversed direction would show
 * them as making progress in the direction they are trying to leave.
 */
export function directionOf(goal: MeasureGoal, all: readonly Measurement[]): 'down' | 'up' {
  const at = readingAt(goal.kind, all, goal.createdAt);
  if (!at) return 'up';
  return goal.target < inGoalUnit(goal, at) ? 'down' : 'up';
}

/** A reading expressed in the goal's unit, so nothing compares kilos with pounds. */
function inGoalUnit(goal: MeasureGoal, m: Measurement): number {
  return convertMeasure(goal.kind, m.value, m.unit, goal.unit);
}

/**
 * Close enough to count.
 *
 * The kind's own noise floor, because 175.4 against a 175 target is not a miss,
 * it is the scale — and an app that says "0.4 lb to go" about a number it has
 * already admitted it cannot resolve to a tenth is arguing with itself (§16).
 */
function within(goal: MeasureGoal, value: number): boolean {
  const noise = convertMeasure(goal.kind, KINDS[goal.kind].noise, KINDS[goal.kind].units[0], goal.unit);
  return Math.abs(value - goal.target) < noise;
}

function isThere(goal: MeasureGoal, direction: 'down' | 'up', value: number): boolean {
  if (within(goal, value)) return true;
  return direction === 'down' ? value <= goal.target : value >= goal.target;
}

export function measureGoalProgress(
  goal: MeasureGoal, all: readonly Measurement[], now: number
): MeasureGoalProgress {
  const direction = directionOf(goal, all);
  const startReading = readingAt(goal.kind, all, goal.createdAt);
  const latest = readingAt(goal.kind, all, now);

  const start = startReading ? inGoalUnit(goal, startReading) : null;
  const current = latest ? inGoalUnit(goal, latest) : null;

  // The first reading on or after the goal was set that is on the target side
  // of the line. Ordered oldest-first by `measurements()`, so the first hit is
  // the earliest one.
  let reachedAt: number | null = null;
  for (const m of all) {
    if (m.kind !== goal.kind || m.at < goal.createdAt) continue;
    if (isThere(goal, direction, inGoalUnit(goal, m))) { reachedAt = m.at; break; }
  }

  const span = start === null ? null : Math.abs(goal.target - start);
  const moved = start === null || current === null ? null
    : direction === 'down' ? start - current : current - start;

  return {
    goal,
    direction,
    start,
    current,
    remaining: current === null ? null
      : Math.round(Math.max(0, direction === 'down' ? current - goal.target
                                                    : goal.target - current) * 10) / 10,
    fraction: span === null || moved === null ? null
      : span === 0 ? 1
      : Math.max(0, Math.min(1, moved / span)),
    achieved: current !== null && isThere(goal, direction, current),
    reachedAt,
    daysLeft: Math.ceil((goal.targetDate - now) / 86_400_000)
  };
}

/**
 * Whether a goal can be created, and if not, which sentence to say.
 *
 * One goal per kind, like one per exercise: two bodyweight targets at once is
 * two answers to "what am I doing", and the screen has room to show one.
 */
export function validateMeasureGoal(
  goal: MeasureGoal, all: readonly Measurement[], existing: readonly MeasureGoal[], now: number
): MeasureGoalError | null {
  const k = KINDS[goal.kind];
  if (!Number.isFinite(goal.target) || goal.target <= 0) return 'implausible';
  const base = convertMeasure(goal.kind, goal.target, goal.unit, k.units[0]);
  if (base < k.min || base > k.max) return 'implausible';

  if (existing.some(g => g.kind === goal.kind && g.id !== goal.id)) return 'duplicate';
  if (goal.targetDate <= now) return 'past-date';

  // Without a reading there is no direction and no distance, so the goal would
  // be a number with nothing to say. Better to ask for the weigh-in first than
  // to store a target that renders as blanks.
  const startReading = readingAt(goal.kind, all, goal.createdAt);
  if (!startReading) return 'no-reading';
  if (within(goal, inGoalUnit(goal, startReading))) return 'already-there';

  return null;
}

/**
 * Why a target was refused, as a sentence.
 *
 * A function rather than the `Record<MeasureGoalError, string>` this used to
 * be: a plain record can only hold one language, and this reaches the user
 * directly — the TargetSheet's error line on the YOU screen, which the
 * screen's static labels were translated but this dynamic one was not, for
 * the same reason `recordMeasurement`'s error escaped the earlier sweep — it
 * is returned from a function, not written as a `<Text>` literal.
 */
export function measureGoalMessage(err: MeasureGoalError, lang: Language = 'en'): string {
  const KEY: Record<MeasureGoalError, Key> = {
    implausible: 'mgImplausible',
    'already-there': 'mgAlreadyThere',
    'no-reading': 'mgNoReading',
    'past-date': 'mgPastDate',
    duplicate: 'mgDuplicate'
  };
  return t(lang, KEY[err]);
}

/**
 * The sentence, which is the whole reason this is allowed to exist.
 *
 * §5 makes goals earn their place by feeding the output, and that obligation
 * does not lapse because the goal is about the lifter. "4.2 lb to 175" is a
 * story with a direction; "175 lb" is a number.
 *
 * Null rather than a sentence when there is nothing honest to say, same rule as
 * `narrativeLine`: a goal nobody has weighed in against says nothing.
 */
export function measureGoalLine(
  p: MeasureGoalProgress, lang: Language = 'en'
): string | null {
  if (p.current === null || p.start === null) return null;
  const target = formatMeasure(p.goal.target, p.goal.unit);
  if (p.achieved) return fill(t(lang, 'targetThere'), { target });
  if (p.remaining === null || p.remaining === 0) return null;
  /*
   * Reached it once, is not there now.
   *
   * `p.achieved` is false here — the branch above already returned if it
   * weren't — but `reachedAt` can still be set: a weight-loss goal dipped
   * under target in August and drifted back by September, for instance.
   * "10 lb to 175 lb" alone re-baselines that lifter to someone who has never
   * been there, which is exactly the state the app has no business asserting
   * (see the file header — a grade is an opinion, this one is not the app's
   * to have). Naming the date is not a grade, just a fact it already has.
   */
  if (p.reachedAt !== null) {
    const d = new Date(p.reachedAt);
    return fill(t(lang, 'targetReachedThenLeft'), {
      target, when: `${MONTHS_SHORT[lang][d.getMonth()]} ${d.getDate()}`,
      gap: formatMeasure(p.remaining, p.goal.unit)
    });
  }
  // The distance, not the grade. See the note at the top of this file.
  return fill(t(lang, 'targetToGo'), {
    gap: formatMeasure(p.remaining, p.goal.unit), target
  });
}

/** Core domain types. Pure data — no React, no storage, no platform. */

export type Unit = 'lb' | 'kg';

export interface LoggedSet {
  id: string;
  sessionId: string;
  exerciseId: string;
  /** In the session's unit. Never mixed within a session. */
  weight: number;
  reps: number;
  /** Epoch ms of when the set was logged. */
  at: number;
  /**
   * What it was done on. Absent on every set logged before this existed, and on
   * anything the user has not answered for — an unanswered set is unanswered,
   * not a barbell.
   */
  equipment?: Equipment;
  /**
   * WHICH machine, when `equipment` is 'machine' — "Arsenal", "Hammer
   * Strength". Free text on purpose: the machines in one gym are not the
   * machines in another, and a fixed list would be wrong everywhere.
   */
  machine?: string;
  /**
   * Whatever the lifter wanted to record about this set — RIR, tempo, which
   * machine, how it felt. Free text on purpose: see MIGRATION_NOTES.
   * Undefined for every set logged before notes existed, which is not the same
   * as an empty note and is not displayed as one.
   */
  note?: string | null;
}

/**
 * On the SET rather than the exercise: "Lateral Raise" is dumbbells one week
 * and the machine the next, and pinning it to the exercise would rewrite
 * history every time somebody switched.
 */
/**
 * How a movement is loaded.
 *
 * `bodyweight` was added because the library had no pull-up, chin-up, dip or
 * push-up — four of the most common movements in any gym, in an app whose owner
 * asked for common ones and no niche ones. Without a kit that starts at zero
 * they could not be represented at all: `startingWeight` floors every lift at
 * its equipment's empty weight, so a pull-up would have opened at 45 lb.
 *
 * For these, `weight` means weight ADDED to the body — 0 is a plain pull-up and
 * 25 is one with a belt. That is honest and needs nothing the app does not
 * already know, but it has a limit worth stating: the app never learns what the
 * lifter weighs, so a bodyweight set contributes nothing to total volume and
 * cannot set a weight PR by adding reps. Fixing that properly means asking for
 * a bodyweight, which is a question §4 would rather not ask.
 */
export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'bodyweight';

export const EQUIPMENT: Equipment[] = ['barbell', 'dumbbell', 'machine', 'bodyweight'];

export interface Session {
  id: string;
  startedAt: number;
  /** Null while live. Set explicitly or by the idle rule. */
  endedAt: number | null;
  unit: Unit;
  /**
   * When this row itself last changed — not a set inside it, the row. Reopen
   * touches this and nothing else; see `isStale`'s own note on why the idle
   * rule needs it.
   */
  updatedAt: number;
}

export interface Exercise {
  id: string;
  name: string;
}

/**
 * A personal record, as the app will claim it.
 *
 * `claim` is the sentence shown to the user. It is deliberately concrete —
 * "heaviest 5-rep bench press" — and never an estimate, because an app that
 * announces "estimated 1RM 262 lb" has told the user it is guessing. See §8.
 */
export interface PersonalRecord {
  exerciseId: string;
  exerciseName: string;
  setId: string;
  sessionId: string;
  weight: number;
  reps: number;
  /** The weight this beat, at the same or higher rep count. */
  previousWeight: number;
  /**
   * What the set actually moved, for the four movements whose load is the
   * lifter — bodyweight plus whatever was added. Null for every ordinary lift
   * and for a bodyweight lift with no reading on record.
   *
   * Deliberately a SECOND field rather than a redefinition of `weight`: the
   * award is decided on this, because 25 is not what a +25 pull-up weighed,
   * while `weight` and `previousWeight` stay in the numbers the lifter typed,
   * because those are the ones they can recognise and check (§16) — and
   * because `gain` is their difference, so mixing the two scales would print
   * a pull-up PR as "-160 LB".
   */
  realWeight: number | null;
  claim: string;
}

/** Smallest weight change that counts as progress rather than a typo. */
export const MIN_INCREMENT: Record<Unit, number> = { lb: 1, kg: 0.5 };

/**
 * A load, as a lifter would say it.
 *
 * Zero means bodyweight — a plain pull-up, dip or push-up — and printing "0"
 * for it reads as a bug or as nothing at all. Every surface that shows a weight
 * goes through here so the card, the share message, the logged-set chips and
 * the hero cannot disagree about what a set with no added weight is called.
 *
 * Not unit-aware on purpose: "BW" needs no unit, and everywhere else already
 * prints the unit separately.
 */
export function loadLabel(weight: number): string {
  return weight === 0 ? 'BW' : String(weight);
}

/**
 * Pounds to kilos and back, for DISPLAY only.
 *
 * Every set is stored in the unit it was logged in and that never changes — a
 * 225 lb bench stays 225 lb in the database for ever. Converting on write would
 * mean rewriting history the first time somebody changed a preference, and
 * round-tripping through a float twice would quietly turn 225 into 224.9.
 *
 * So the stored number is the fact and this is the presentation. It rounds to
 * the nearest half unit, because a barbell does not load to two decimal places
 * and "102.0582 kg" is a number nobody can check against a rack (§16).
 */
export const LB_PER_KG = 2.20462262;

export function convertWeight(weight: number, from: Unit, to: Unit): number {
  if (from === to || weight === 0) return weight;
  const raw = to === 'kg' ? weight / LB_PER_KG : weight * LB_PER_KG;
  return Math.round(raw * 2) / 2;
}

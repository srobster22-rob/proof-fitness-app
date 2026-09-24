/**
 * The Now screen's steppers: how far one press moves the weight and the reps, the plate
 * buttons and their custom jumps, and a weight typed on the keyboard.
 *
 * Moved verbatim out of now-model.ts (R697); the model imports it from here.
 */
import type { Unit } from '../domain/types.ts';

/** Stepper granularity. Plate maths, not round numbers. */
export const WEIGHT_STEP: Record<Unit, number> = { lb: 5, kg: 2.5 };

/**
 * The big jump: one plate.
 *
 * Unit-aware rather than a flat 45, for the same reason weights are stored in
 * the unit they were entered in and never converted (`schema.ts`): the big
 * plate on a metric bar is 20 kg, and 45 is not a number a kg gym has. Showing
 * "+45" to a metric user would be the imperial leak §8 exists to prevent —
 * 20.41 kg would be worse still, because nobody loads that.
 */
export const PLATE: Record<Unit, number> = { lb: 45, kg: 20 };

/** The big jump for reps — a set of five, the unit lifters actually count in. */
export const REP_JUMP = 5;

/**
 * The jump amounts are DEFAULTS, not constants.
 *
 * A plate is 45 lb in most gyms and 20 kg in the rest, and five reps is the
 * step between the two schemes people alternate — but neither is true for
 * everyone. Someone running microplates wants 2.5, someone on a fixed-dumbbell
 * rack wants 10, and the app has no business insisting. Both are editable from
 * the control they change, and stored per user (`repo.getPref`), because §9
 * bans a settings SCREEN rather than banning preferences.
 */
export const MAX_JUMP: Record<Unit, number> = { lb: 500, kg: 250 };
export const MAX_REP_JUMP = 12;

/**
 * A typed jump amount, or null when it is not one the app should accept.
 *
 * Shares its shape with the goal sheet's `customReps` for the same reason: the
 * field holds TEXT while it is being typed, so every half-typed and junk state
 * has to be a clean "not yet" rather than a number. Committing "1" on the way
 * to "10" would silently reset someone's plate to a pound.
 */
export function customJump(raw: string, unit: Unit): number | null {
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > MAX_JUMP[unit]) return null;
  // Quarter-unit resolution: microplates go to 1.25 kg and 0.25 lb, and
  // nothing finer than that is a plate anyone owns.
  return Math.round(n * 100) / 100;
}

export function customRepJump(raw: string): number | null {
  const n = Number(raw.trim());
  if (!Number.isInteger(n)) return null;
  if (n < 1 || n > MAX_REP_JUMP) return null;
  return n;
}

/** The most characters the typed-weight field will hold — "999.99" is past any plate. */
const TYPED_MAX = 6;

/**
 * One keystroke in the typed-weight field.
 *
 * §4 says steppers, not a keyboard, and that is right for the common case where
 * the next set is the last set. It is wrong for a jump: 45 to 225 is 36 taps.
 * Tapping the hero number opens a field, and this is what every character in it
 * means.
 *
 * It lives in the model rather than in the component because it *is* the
 * feature. The commit rule — write through on every character, never on blur —
 * is the fix for a stuck state where typing a number and then tapping LOG SET
 * logged the OLD weight, because the two handlers raced and the user had no way
 * to see which won. With no commit step there is nothing to lose the race with:
 * what is on screen is what gets logged.
 *
 * `text` is what to display; `weight` is what to commit, or null to leave the
 * working weight alone. Null covers blank and half-typed input, because
 * clearing someone's working weight mid-set is worse than not having the
 * feature at all. When `weight` is not null it always equals `parseFloat(text)`
 * — the number on screen and the number that gets logged cannot disagree.
 *
 * `MAX_TYPED_WEIGHT` is the same typo guard `plausible()` runs for a
 * bodyweight reading, applied here for the same reason: with only a
 * SIX-CHARACTER cap and no value ceiling, "999999" typed just as fast as
 * "225" committed on every keystroke — no confirmation step, no LOG SET
 * tap needed — and silently became the working weight a set could be
 * logged against. 1500 is generous in either unit (it is more than triple
 * the heaviest raw deadlift ever recorded, in lb; in kg it is wider still)
 * so no real lifter is ever told they are wrong, and it still catches the
 * fat-fingered extra digit the cap on length alone could not.
 */
export const MAX_TYPED_WEIGHT = 1500;

export function typedWeight(raw: string): { text: string; weight: number | null } {
  let text = '';
  let dotted = false;
  for (const ch of raw) {
    if (text.length >= TYPED_MAX) break;
    if (ch >= '0' && ch <= '9') { text += ch; continue; }
    // A second decimal point is dropped rather than kept: "22..5" would parse
    // as 22 while still reading as 22.5 on screen, and that gap is exactly the
    // kind of silent disagreement this function exists to rule out.
    if (ch === '.' && !dotted) { text += ch; dotted = true; }
  }
  const value = parseFloat(text);
  const plausible = Number.isFinite(value) && value > 0 && value <= MAX_TYPED_WEIGHT;
  return { text, weight: plausible ? value : null };
}

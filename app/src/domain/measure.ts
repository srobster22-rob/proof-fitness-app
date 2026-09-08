import type { Unit } from './types.ts';

/**
 * Measurements of the lifter.
 *
 * Every other number in this app is a fact about a LIFT. These are facts about
 * the person doing it, and they exist for two reasons that are worth keeping
 * separate:
 *
 * 1. **They make existing data correct.** Four movements in the library —
 *    pull-up, chin-up, dip, push-up — log at weight 0, because the load is the
 *    lifter. A 200 lb person doing weighted pull-ups at +25 has their hardest
 *    set recorded as "25", so volume, PRs and e1RM are all wrong for those
 *    lifts. Bodyweight is the missing operand.
 *
 * 2. **They are the record.** Height does nothing computational and is worth
 *    keeping anyway: somebody who grows wants to see where they started, which
 *    is the same thing every other number on this screen is for. That is the
 *    whole product thesis applied to the lifter rather than the lift — and it
 *    is why this is a MEASUREMENT with a date rather than a field in a profile.
 *
 * A profile field is set once and forgotten. A measurement has a history, and
 * history is what this app is.
 */

export type MeasurementKind = 'bodyweight' | 'height';

/** Height is not weight, so `Unit` cannot describe it. */
export type LengthUnit = 'cm' | 'in';
export type MeasureUnit = Unit | LengthUnit;

export interface Measurement {
  id: string;
  kind: MeasurementKind;
  value: number;
  /** Stored as entered and never rewritten — see MIGRATION_MEASUREMENTS. */
  unit: MeasureUnit;
  at: number;
  note?: string | null;
}

export interface KindProfile {
  label: string;
  /** The units this kind can be recorded in. The first is the default. */
  units: readonly MeasureUnit[];
  /**
   * How long a window has to be before a trend means anything.
   *
   * Bodyweight moves week to week; height moves over years. Charting both on
   * the same axis makes one look like noise and the other look like a flat
   * line that failed to load, so each kind carries its own cadence.
   */
  windowDays: number;
  /**
   * Smallest change worth calling a change.
   *
   * Bodyweight swings a kilo across a day on water alone, so a 0.2 kg
   * "increase" is not information — it is the scale. Below this the trend
   * reports flat rather than inventing a direction (§16).
   */
  noise: number;
  /** Sensible bounds, for rejecting a typo rather than for judging anybody. */
  min: number;
  max: number;
}

export const KINDS: Record<MeasurementKind, KindProfile> = {
  bodyweight: {
    label: 'Bodyweight',
    units: ['lb', 'kg'],
    windowDays: 90,
    // ~1 lb. A day's water is more than this, but a week's trend is not.
    noise: 1,
    /*
     * 40 to 700 lb. Wide enough that no real user is ever told they are wrong,
     * narrow enough to still catch the mistake it exists for: at a 1000 lb
     * ceiling, "400" typed into a kilos field converts to 881 lb and sails
     * through, which made the guard decorative.
     */
    min: 40,
    max: 700
  },
  height: {
    label: 'Height',
    units: ['cm', 'in'],
    // Three years, because that is the scale on which the answer is interesting.
    windowDays: 1095,
    // Half a centimetre is within how differently two people hold a tape.
    noise: 0.5,
    min: 50,
    max: 260
  }
};

export function kindOf(kind: MeasurementKind): KindProfile {
  return KINDS[kind];
}

/** Whether a number is plausible for its kind — a typo guard, not a judgement. */
export function plausible(kind: MeasurementKind, value: number, unit: MeasureUnit): boolean {
  if (!Number.isFinite(value) || value <= 0) return false;
  // Bounds are stated in the kind's FIRST unit, so convert before comparing.
  const k = KINDS[kind];
  const base = toBase(kind, value, unit);
  return base >= k.min && base <= k.max;
}

/** cm and lb are the base units the bounds are written in. */
export function toBase(kind: MeasurementKind, value: number, unit: MeasureUnit): number {
  if (kind === 'height') return unit === 'in' ? value * 2.54 : value;
  return unit === 'kg' ? value * 2.20462262 : value;
}

export function convertMeasure(
  kind: MeasurementKind, value: number, from: MeasureUnit, to: MeasureUnit
): number {
  if (from === to || value === 0) return value;
  const base = toBase(kind, value, from);
  const out = kind === 'height'
    ? (to === 'in' ? base / 2.54 : base)
    : (to === 'kg' ? base / 2.20462262 : base);
  // Both kinds are read off a scale or a tape, neither of which resolves past a
  // tenth. Rounding here stops "70.30729 kg" reaching a screen (§16).
  return Math.round(out * 10) / 10;
}

export interface Trend {
  /** Oldest and newest inside the kind's window, or null when there is one point. */
  from: Measurement | null;
  to: Measurement | null;
  /** Newest minus oldest, in the NEWEST reading's unit. Null when undecidable. */
  change: number | null;
  /** Up, down, or flat — flat covers "inside the noise floor". */
  direction: 'up' | 'down' | 'flat' | null;
  /** How many readings the window holds. */
  count: number;
}

/**
 * What has happened to this measurement lately.
 *
 * Compares the newest reading against the oldest INSIDE the kind's own window,
 * not against the first ever: a lifter three years in does not want their
 * bodyweight trend measured from the day they started, and somebody who has
 * grown does. That is what `windowDays` is for.
 *
 * The change is expressed in the newest reading's unit, because that is the one
 * the user is currently thinking in — someone who switched to kilos does not
 * want to be told they gained four pounds.
 */
export function trendOf(
  kind: MeasurementKind, all: readonly Measurement[], now: number
): Trend {
  const k = KINDS[kind];
  const mine = all
    .filter(m => m.kind === kind && m.at <= now)
    .sort((a, b) => a.at - b.at);
  if (mine.length === 0) return { from: null, to: null, change: null, direction: null, count: 0 };

  const cutoff = now - k.windowDays * 86_400_000;
  const inWindow = mine.filter(m => m.at >= cutoff);
  // Everything is older than the window: the trend is over, but the reading
  // still stands. Report the value with no direction rather than nothing.
  const span = inWindow.length >= 2 ? inWindow : mine.slice(-1);

  const to = span[span.length - 1];
  const from = span.length >= 2 ? span[0] : null;
  if (!from) return { from: null, to, change: null, direction: null, count: mine.length };

  const change = Math.round((to.value - convertMeasure(kind, from.value, from.unit, to.unit)) * 10) / 10;
  const noise = convertMeasure(kind, k.noise, k.units[0], to.unit);
  return {
    from, to, change,
    direction: Math.abs(change) < noise ? 'flat' : change > 0 ? 'up' : 'down',
    count: mine.length
  };
}

/**
 * The reading to use for a calculation on a given day.
 *
 * People weigh themselves more than once, and the app stores every reading
 * rather than deciding which one was true. When something needs ONE number —
 * the real load of a pull-up, say — it wants the most recent reading at or
 * before that moment, which is the last thing the lifter actually knew about
 * themselves at the time.
 */
export function readingAt(
  kind: MeasurementKind, all: readonly Measurement[], at: number
): Measurement | null {
  const before = all
    .filter(m => m.kind === kind && m.at <= at)
    .sort((a, b) => a.at - b.at);
  return before.length ? before[before.length - 1] : null;
}

/** "82.5 kg", "5'11\"" — the number as a person would say it. */
export function formatMeasure(value: number, unit: MeasureUnit): string {
  if (unit === 'in') {
    const feet = Math.floor(value / 12);
    const inches = Math.round((value - feet * 12) * 10) / 10;
    // Under a foot is not a height; it is somebody typing inches they meant as
    // centimetres, and printing 0'9" would dress that up as an answer.
    if (feet > 0) return `${feet}'${inches}"`;
  }
  const n = Math.round(value * 10) / 10;
  return `${n % 1 === 0 ? n : n.toFixed(1)} ${unit}`;
}

/**
 * The four movements whose load is the lifter.
 *
 * `coldstart` marks these `kit: 'bodyweight'` and seeds them at 0, which is
 * right for the INPUT — a pull-up starts at nothing added, and opening the
 * screen at 45 lb would be a lie about the bar. It is wrong for everything
 * downstream: a 200 lb person doing weighted pull-ups at +25 has that set
 * recorded as "25", so volume, PRs and estimated 1RM all treat their hardest
 * pulling work as their lightest.
 *
 * Kept as a set of ids rather than read from `EQUIPMENT_BASE` because the
 * equipment on a SET is what the user chose that day, and these four are
 * bodyweight movements whether or not anyone tapped a chip.
 */
export const CARRIES_BODYWEIGHT: ReadonlySet<string> = new Set([
  'pullup', 'chinup', 'dip', 'pushup'
]);

/**
 * What a set actually weighed.
 *
 * For an ordinary lift this is the number on the bar. For the four above it is
 * the number on the bar PLUS whatever the lifter weighed at the time — using
 * the reading that applied on that day, not today's, because a set done at
 * 190 lb bodyweight does not become heavier because you gained weight since.
 *
 * Returns null rather than a guess when there is no reading to work from. That
 * is the honest answer and it is why this returns a nullable instead of
 * falling back to the bar: a pull-up recorded as 25 lb is wrong, and silently
 * calling it 25 lb again while pretending to know better would be worse.
 *
 * A push-up is deliberately included and deliberately imprecise — the real
 * share of bodyweight moved is nearer two thirds — because a consistent
 * overstatement still ranks a lifter's own push-up sets against each other
 * correctly, which is what PRs and trends actually need. It is not offered as
 * a physiological claim.
 *
 * Returning null for a set logged before the first-ever reading is deliberate
 * and tested (`real-load.test.ts`): the app does not know what they weighed
 * then and will not invent it. What was NOT intended is what happens to that
 * null downstream — `sessionStats` does `real?.load ?? s.weight`, and for a
 * bodyweight movement `s.weight` is 0, so an abstention becomes the assertion
 * "you moved nothing". See `volumeKnown` there.
 */
export function realLoad(
  set: { exerciseId: string; weight: number; at: number },
  measurements: readonly Measurement[],
  unit?: Unit
): { load: number; unit: MeasureUnit } | null {
  if (!CARRIES_BODYWEIGHT.has(set.exerciseId)) return null;
  const bw = readingAt('bodyweight', measurements, set.at);
  if (!bw) return null;
  // A set is in its SESSION'S unit and a reading is in whatever the lifter
  // stepped on the scale in, and nothing forces those to agree. Adding 25 (lb,
  // off the belt) to 84 (kg, off the scale) produced 109 and labelled it kg —
  // a number nobody could check against anything (§16). Callers that know the
  // session's unit say so; the reading's own unit is the default because that
  // is what every caller was implicitly getting before.
  const out = unit ?? bw.unit;
  const body = convertMeasure('bodyweight', bw.value, bw.unit, out);
  return { load: Math.round((body + set.weight) * 10) / 10, unit: out };
}

/**
 * A lift as a multiple of what the lifter weighs — "2× bodyweight squat".
 *
 * The milestone people actually chase, and the one number here that says
 * something a raw weight cannot: 315 means nothing without knowing who lifted
 * it. Null when there is no bodyweight to divide by, for the same reason as
 * above.
 *
 * Rounded to two decimals because "1.7×" is the claim and "1.7243×" is
 * arithmetic showing off (§16).
 */
export function bodyweightMultiple(
  weight: number, unit: MeasureUnit, measurements: readonly Measurement[], at: number
): number | null {
  const bw = readingAt('bodyweight', measurements, at);
  if (!bw || bw.value <= 0) return null;
  const lifted = toBase('bodyweight', weight, unit);
  const body = toBase('bodyweight', bw.value, bw.unit);
  return Math.round((lifted / body) * 100) / 100;
}

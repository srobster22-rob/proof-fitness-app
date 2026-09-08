import type { Repo } from '../data/repo.ts';
import {
  KINDS, trendOf, plausible, formatMeasure, convertMeasure,
  type Measurement, type MeasurementKind, type MeasureUnit, type Trend
} from '../domain/measure.ts';
import {
  measureGoalProgress, validateMeasureGoal, measureGoalLine, measureGoalMessage,
  type MeasureGoal, type MeasureGoalProgress
} from '../domain/measure-goal.ts';
import { t, fill, languageOf, MONTHS_TREND, KIND_KEY, type Language } from '../domain/i18n.ts';
import { displayUnit } from './display-unit.ts';

/**
 * The Measurements screen, as rules rather than as React.
 *
 * Same split as every other `*-model.ts` here: what the screen SAYS is decided
 * in a file that runs under `node --test`, and the `.tsx` binds it to views.
 */

export interface KindRow {
  kind: MeasurementKind;
  label: string;
  /** The newest reading, said the way a person would. Null when there is none. */
  current: string | null;
  /** "down 4.2 lb since May", or null when there is nothing true to say. */
  line: string | null;
  trend: Trend;
  /** The unit a new entry should default to — theirs, not the app's. */
  unit: MeasureUnit;
  /** The target for this kind, and how it is going. Null when there is none. */
  goal: MeasureGoalProgress | null;
  /** "10 lb to 175 lb", or null. §5: a goal earns its place by saying something. */
  goalLine: string | null;
  /**
   * The last few readings, oldest first, normalised 0..1 — same shape as
   * Progress's own per-lift trend. The NUMBER already says "down 4 lb since
   * May"; this is the same history in a form a glance can compare, which a
   * sentence cannot be. Empty until there are at least two readings to draw
   * a line between.
   */
  spark: number[];
}

/** Same window as Progress's own sparkline — enough to read a shape, not a chart. */
export const MEASURE_SPARK_POINTS = 10;

// Month names live in the table with every other string — see MONTHS_TREND.

/**
 * What has happened, in a sentence.
 *
 * Deliberately says WHEN it is measuring from. "Down 4 lb" invites the
 * question "since when", and a trend whose baseline you cannot see is a number
 * you cannot check (§16) — especially here, where the window is 90 days for
 * one kind and three years for another and nothing on screen would otherwise
 * say so.
 *
 * Returns null rather than filler when there is only one reading. "No change
 * yet" is not information, and the number itself is already on the row.
 */
export function trendLine(
  kind: MeasurementKind, trend: Trend, lang: Language = 'en'
): string | null {
  if (!trend.to || !trend.from || trend.change === null || trend.direction === null) return null;
  const since = new Date(trend.from.at);
  const when = `${MONTHS_TREND[lang][since.getMonth()]} ${
    since.getFullYear() !== new Date(trend.to.at).getFullYear() ? since.getFullYear() : ''
  }`.trim();

  if (trend.direction === 'flat') return fill(t(lang, 'trendFlat'), { when });
  return fill(t(lang, trend.direction === 'up' ? 'trendUp' : 'trendDown'), {
    change: formatMeasure(Math.abs(trend.change), trend.to.unit), when
  });
}

/**
 * One row per kind, whether or not it has ever been recorded.
 *
 * An empty kind still gets a row: this screen is the only place the app says
 * bodyweight exists, and a kind that only appears once you have already used
 * it cannot be discovered. The row simply has nothing to report yet.
 */
export function measureRows(repo: Repo, now: number): KindRow[] {
  const all = repo.measurements();
  const goals = repo.measureGoals();
  const lang = languageOf(repo);
  // §4: a kind nobody has recorded yet still has to guess a system, and
  // `KINDS[kind].units[0]` guesses the SAME one for every kind regardless of
  // who is asking — 'lb' for bodyweight, 'cm' for height, so an imperial
  // lifter's first-ever height entry opened on centimetres while their
  // weight entries opened on pounds. `displayUnit` is the one place the app
  // already knows which system this person is in; a kind whose own units
  // don't include a weight `Unit` (height's are cm/in) is translated across.
  const system = displayUnit(repo);
  return (Object.keys(KINDS) as MeasurementKind[]).map(kind => {
    const trend = trendOf(kind, all, now);
    const mine = goals.find(g => g.kind === kind);
    const goal = mine ? measureGoalProgress(mine, all, now) : null;
    const fresh = KINDS[kind].units.includes(system)
      ? system
      : (system === 'lb' ? 'in' : 'cm');
    const unit = trend.to?.unit ?? fresh;
    return {
      kind,
      label: KINDS[kind].label,
      current: trend.to ? formatMeasure(trend.to.value, trend.to.unit) : null,
      line: trendLine(kind, trend, lang),
      trend,
      // Their last choice, then a guess that matches the system they already
      // record weight in — not a hardcoded default (§4).
      unit,
      goal,
      goalLine: goal ? measureGoalLine(goal, lang) : null,
      spark: sparkFor(all, kind, unit)
    };
  });
}

/**
 * Oldest-to-newest, normalised within the window — a bodyweight history is
 * the same "how has this actually moved" question a lift's is, so it earns
 * the same shape Progress already draws. Every reading is converted into the
 * ROW's own unit first: a history that switched from lb to kg partway
 * through must not draw 84 (kg) as a cliff below 185 (lb) — the row already
 * shows one unit for everything else, and the chart has to agree with it.
 */
function sparkFor(all: Measurement[], kind: MeasurementKind, unit: MeasureUnit): number[] {
  const mine = all.filter(m => m.kind === kind).sort((a, b) => a.at - b.at);
  const window = mine.slice(-MEASURE_SPARK_POINTS);
  if (window.length < 2) return [];
  const values = window.map(m => convertMeasure(kind, m.value, m.unit, unit));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  return values.map(v => (span === 0 ? 0.5 : (v - lo) / span));
}

/** The readings for one kind, newest first — what the history list shows. */
export function readingsFor(
  repo: Repo, kind: MeasurementKind, limit = 30
): Measurement[] {
  return repo.measurements()
    .filter(m => m.kind === kind)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

export interface SaveResult { ok: boolean; error?: string }

/**
 * Which kinds the screen offers a target for.
 *
 * Bodyweight only, and the restriction is the product being honest rather than
 * the domain being limited: `measure-goal.ts` handles any kind, but a target is
 * a thing you work TOWARD, and effort does not move an adult's height. The one
 * person whose height is moving — a growing teenager — does not need a target
 * to grow, and offering one would put a deadline on puberty. Tracking height is
 * the record; targeting it would be a promise nobody can train for.
 */
export const TARGETABLE: ReadonlySet<MeasurementKind> = new Set(['bodyweight']);

/**
 * Record a reading.
 *
 * The only validation is the typo guard, and the message says what is wrong
 * with the NUMBER rather than what is wrong with the person — "that does not
 * look like a bodyweight" and never anything about what a bodyweight should
 * be.
 */
export function recordMeasurement(
  repo: Repo, kind: MeasurementKind, raw: string, unit: MeasureUnit, now: number,
  note?: string
): SaveResult {
  const value = Number(String(raw).trim());
  if (!plausible(kind, value, unit)) {
    const lang = languageOf(repo);
    // The kind's own translated name, lowercased for mid-sentence — the same
    // word the card's own heading uses, so this error and that heading are
    // never one language apart. `KINDS[kind].label` was English straight from
    // the domain, invisible to the sweep that caught the rest of this screen
    // because it is returned from a function rather than written as `<Text>`.
    const name = t(lang, KIND_KEY[kind]).toLowerCase();
    return { ok: false, error: fill(t(lang, 'notAMeasurement'), { kind: name, unit }) };
  }
  repo.saveMeasurement({
    id: `m_${now.toString(36)}_${Math.round(value * 10)}`,
    kind,
    value: Math.round(value * 10) / 10,
    unit,
    at: now,
    ...(note?.trim() ? { note: note.trim() } : {})
  });
  return { ok: true };
}

/**
 * A starting value for the input, so it is never blank (§4).
 *
 * The last reading in the unit being entered — because the commonest entry is
 * "about what it was last time", and typing a whole bodyweight from scratch
 * every week is three digits the app already knows.
 */
export function prefillFor(
  repo: Repo, kind: MeasurementKind, unit: MeasureUnit, now: number
): string {
  const t = trendOf(kind, repo.measurements(), now);
  if (!t.to) return '';
  const v = convertMeasure(kind, t.to.value, t.to.unit, unit);
  return String(v % 1 === 0 ? v : Math.round(v * 10) / 10);
}

/**
 * Set or change a target.
 *
 * Validation stays in the domain — this only mints the id, times the goal, and
 * turns a `MeasureGoalError` into a sentence. Same division as `saveGoalFrom`
 * on the Goals screen, and for the same reason: a rule that lives in a `.tsx`
 * is a rule no test can reach.
 *
 * `createdAt` is preserved when editing, because progress is measured from
 * what they weighed WHEN THEY SET IT. Losing it re-baselines the goal to today
 * and empties the bar the moment somebody adjusts their target by a pound.
 */
/**
 * `n` calendar months from `at`, clamped to the end of the month it lands in.
 *
 * The target sheet's chips say "3 MO", "6 MO" and "12 MO", and the date under
 * them was `now + months * 30 * DAY` rendered as a bare month name — so the
 * chip and the date contradicted each other and nothing on the row let a
 * reader reconcile them. Measured across a year of start dates: 3 MO names the
 * wrong month on 20 of 365, 6 MO on 37, and **12 MO on 60** — a one-year
 * bodyweight target set on 1 January displayed "Dec 2026", a month inside the
 * year the lifter was already in. `targetDate` is SAVED, so this was the real
 * deadline and the pace it drives, not only a label (R489).
 *
 * Deliberately NOT a change to `goals-model.ts`'s `DAYS_PER`, which keeps its
 * nominal 30-day month and says why in its own comment. The two are different
 * questions and the difference is disclosure: on Goals the user TYPES a number
 * and a unit and is shown "90 days — 2 Dec 2026", so the nominal rule is on
 * screen and checkable (§16). Here the user picks a chip that says MONTHS and
 * is shown a month, so months is what it has to mean. Stated rather than
 * drifted into: `test/measure-horizon.test.ts` pins both behaviours.
 *
 * The clamp is the reason the nominal version was chosen originally — 31
 * January plus one month has no 31st to land on. JavaScript rolls that into
 * March; `setDate(0)` walks back to the last day of the month that was meant,
 * so it lands on 28 or 29 February instead of overshooting the month entirely.
 */
export function monthsFrom(at: number, months: number): number {
  const from = new Date(at);
  const day = from.getDate();
  const out = new Date(from.getFullYear(), from.getMonth() + months, day,
    from.getHours(), from.getMinutes(), from.getSeconds(), from.getMilliseconds());
  if (out.getDate() !== day) out.setDate(0);
  return out.getTime();
}

export function saveMeasureGoal(
  repo: Repo, kind: MeasurementKind, rawTarget: string, unit: MeasureUnit,
  targetDate: number, now: number
): SaveResult {
  const target = Number(String(rawTarget).trim());
  const existing = repo.measureGoals();
  const mine = existing.find(g => g.kind === kind);
  const goal: MeasureGoal = {
    id: mine?.id ?? `mg_${kind}_${now.toString(36)}`,
    kind,
    target: Math.round(target * 10) / 10,
    unit,
    targetDate,
    createdAt: mine?.createdAt ?? now
  };
  const error = validateMeasureGoal(goal, repo.measurements(), existing, now);
  if (error) return { ok: false, error: measureGoalMessage(error, languageOf(repo)) };
  repo.saveMeasureGoal(goal);
  return { ok: true };
}

export function clearMeasureGoal(repo: Repo, kind: MeasurementKind): void {
  const mine = repo.measureGoals().find(g => g.kind === kind);
  if (mine) repo.deleteMeasureGoal(mine.id);
}

/**
 * A starting target for the input, so it is never blank (§4).
 *
 * An existing target if there is one; otherwise a round number a short way from
 * where they are, in the direction most people are heading — deliberately close
 * rather than ambitious, because the app suggesting somebody lose thirty pounds
 * is the app having an opinion it is not qualified to have. It is a starting
 * point for the stepper, not advice.
 */
export function suggestTarget(
  repo: Repo, kind: MeasurementKind, unit: MeasureUnit, now: number
): string {
  const mine = repo.measureGoals().find(g => g.kind === kind);
  if (mine) return String(convertMeasure(kind, mine.target, mine.unit, unit));
  const t = trendOf(kind, repo.measurements(), now);
  if (!t.to) return '';
  const current = convertMeasure(kind, t.to.value, t.to.unit, unit);
  const step = unit === 'kg' ? 5 : 10;
  return String(Math.round((current - step) / step) * step);
}

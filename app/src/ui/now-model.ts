import type { LoggedSet, Session, Exercise, Unit, Equipment } from '../domain/types.ts';
import { Repo } from '../data/repo.ts';
import { prefillFor, pickerFor, unitForNewSession, type Prefill } from '../domain/coldstart.ts';
import { nextCandidates, openingLift } from '../domain/predict.ts';
import { autoEnd, isStale, lastSetAt, sessionStats } from '../domain/session.ts';
import { restSince, type RestState } from '../domain/rest.ts';
import { PREF_UNIT } from './display-unit.ts';
import { weekStreak } from '../domain/session.ts';
import {
  sessionDay, sessionPlanDay, groupBySplit, companionFor, dayOf, inPlanDay, planOf,
  PLAN_DAYS, PLAN_DAY_COVERS,
  type SplitDay, type SplitGroup, type SplitPlan, type PlanDay
} from '../domain/split.ts';
import { coachSuggestion, type Suggestion } from '../domain/coach.ts';
import { trainingGoal } from './training-goal.ts';
import { PHONE_MAX } from './column.ts';
import { loadLabel, convertWeight } from '../domain/types.ts';
import { goalProgress, isAchieved } from '../domain/goals.ts';
import { recommendNext } from '../domain/muscles.ts';
import { t, fill, languageOf, type Language } from '../domain/i18n.ts';

/**
 * The Now screen, as a pure state machine. PROMPT.md §5 screen 1.
 *
 * All the logic, none of React: the component that renders this is a thin
 * binding, and every rule with teeth — tap counts, prefills, what happens on
 * launch — is asserted in tests that run on any machine without a simulator.
 *
 * The tap budget this exists to protect (§4):
 *   repeat last set        1 tap   -> log()
 *   change weight, log     3 taps  -> bumpWeight() x2 + log()
 *   next exercise          swipe   -> next()
 *   pick from the list     1 tap   -> selectExercise()
 */

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

/** §4 — every target is at least this, for a sweaty thumb, one-handed. */
export const HIT = 56;

/** The height the Now screen's spacing was drawn against. */
const DESIGNED_FOR = 780;

/**
 * The widest the column gets — an iPhone Pro Max, the largest screen this is
 * built for (§5 is iOS-first).
 *
 * Past it the layout does not improve, it just stretches: on a 1280px preview
 * pane the two weight steppers sat 1200px apart with the number marooned in
 * the middle. Letterboxing means the browser shows the app at the shape it will
 * actually ship in, which is the entire point of previewing it.
 */
// The column cap lives in `column.ts` so the other three screens and every
// sheet read the same number. It used to be private here, which is exactly why
// they did not.

/**
 * How tall the Now screen's furniture is allowed to be, given the viewport.
 *
 * The screen is a fixed column with NO scroll, on purpose — §4 keeps LOG SET
 * reachable without one, and a logging path you have to scroll to is not a
 * one-tap logging path. The cost of that decision is that the column has to
 * fit, and it did not: at full size it spends about 660px before TODAY gets a
 * single row, so on anything shorter than a phone the footer fell off the
 * bottom. UP NEXT and FINISH were rendered at y 590–630 in a 600px viewport
 * with no way to reach them. Nothing in the app was broken; it was simply cut
 * off, which looks identical to broken.
 *
 * So the vertical rhythm scales with the height it actually has. Two floors are
 * deliberate:
 *   - LOG SET never goes below `HIT`, because a shorter screen does not make
 *     the thumb smaller
 *   - the hero is capped by height as well as width, since a number sized off
 *     the width alone is what ate the space in the first place
 *
 * TODAY collapses fastest (`s²`) because it is the one scrollable region — it
 * loses rows, everything else would lose its meaning.
 *
 * At 780px and above this returns exactly the numbers the screen was drawn
 * with, so no phone-sized layout changes.
 */
export interface NowLayout {
  /** How wide the column is allowed to get. */
  column: number;
  hero: number;
  headerGap: number;
  repsGap: number;
  logGap: number;
  logHeight: number;
  restGap: number;
  todayGap: number;
  todayMin: number;
  footerGap: number;
  /** Horizontal gap inside the stepper rows — see `layoutFor`. */
  rowGap: number;
  /** True when the column cannot be reached without scrolling — see `layoutFor`. */
  scrolls: boolean;
  /** The day-rail row — see `buildRail`. */
  railHeight: number;
}

/**
 * What the hero row spends on things that are not the number: the root's
 * horizontal padding, both 56px steppers, and the unit — counted TWICE.
 *
 * The unit is counted ONCE even though the digits are centred without it.
 *
 * The digits used to sit 17.8px left of every other element on the screen —
 * lift name, "last time", the hint, the reps and LOG SET all measured dead
 * centre — because `heroNumbers` held the number AND the unit, so the row
 * centred the pair rather than the number. §15 makes the number the hero, and a
 * hero that does not line up with its own screen is the one thing on it you
 * cannot help noticing.
 *
 * The first fix was a mirrored invisible unit on the left. It centred the
 * digits and cost far too much: reserving the unit twice took a three-digit
 * weight on a 375px phone from 113px to **89px**, a fifth off the hero to
 * straighten it. So the unit is out of flow instead (`position: absolute`),
 * which centres the digits for nothing — and this constant still reserves its
 * width once, because the space to the right of the number has to stay clear
 * for it to hang in.
 */
const HERO_CHROME = 40 + 2 * HIT + 36;

/**
 * How wide the hero's digits actually are, measured off the running app rather
 * than guessed: 0.5991 of the font size in the 900-weight system font, minus
 * the 3px of negative letter-spacing the style applies to every character.
 *
 * Checked against a real render: "95" at 113px measured 129px, and
 * 2 x (0.5991 x 113 - 3) = 129.4.
 */
const DIGIT_RATIO = 0.5991;
const LETTER_SPACING = -3;

/** What the hero number occupies at a given size. */
export function heroWidth(fontSize: number, chars: number): number {
  return chars * (DIGIT_RATIO * fontSize + LETTER_SPACING);
}

export function layoutFor(width: number, height: number, heroChars = 3): NowLayout {
  const s = Math.min(1, Math.max(0.55, height / DESIGNED_FOR));
  const column = Math.min(width, PHONE_MAX);
  // The number must fit BETWEEN the steppers. `typedWeight` allows six
  // characters, and at six the row was 135px wider than a 320px phone — the
  // page itself scrolled sideways and the + stepper sat off the screen. Sizing
  // the hero from the viewport alone cannot see that; it has to know how many
  // characters it is being asked to draw.
  // Solve `heroWidth(f, chars) <= column - HERO_CHROME` for the font size.
  const chars = Math.max(1, heroChars);
  const fitsBetweenSteppers = ((column - HERO_CHROME) / chars - LETTER_SPACING) / DIGIT_RATIO;
  // `scrolls` is decided after `fixedHeight` can be measured; the base only
  // needs to satisfy the type until then.
  const base: NowLayout = {
    scrolls: false,
    column,
    // FLOOR, not round: rounding a fit-driven size up puts it back over the
    // edge it was computed to stay inside — six characters on a 320px phone
    // came out 1.2px too wide that way.
    // `height * 0.15 * s`, not `height * 0.15`. The hero was the one measure
    // that scaled with the viewport but not with the rhythm around it, so on a
    // short pane it kept a phone-sized share of a screen that no longer had it
    // to give.
    //
    // This is unchanged at s = 1, which is height >= 780 — a 6/7/8-class iPhone
    // and up. It is NOT every phone: an SE is 667 tall, so s = 0.855 and the SE
    // really does get a smaller number than a 15 does. That is the intended
    // trade on a screen 145px shorter, but it is a trade, not a no-op, and an
    // earlier version of this comment claimed otherwise.
    hero: Math.max(24, Math.floor(Math.min(120, column * 0.3, height * 0.15 * s, fitsBetweenSteppers))),
    headerGap: Math.round(28 * s),
    repsGap: Math.round(18 * s),
    logGap: Math.round(30 * s),
    logHeight: Math.max(HIT, Math.round(72 * s)),
    restGap: Math.round(12 * s),
    todayGap: Math.round(12 * s),
    todayMin: 0,   // filled in below, once the rest of the column is known
    footerGap: Math.round(26 * s),
    /*
     * The gap inside the stepper rows.
     *
     * `repsRow` is `justifyContent: 'center'` with a fixed 14px gap, and its
     * children come to about 217px before gaps: two 40px jump buttons, two
     * steppers and the number. On a 281px-wide pane that leaves 24px for four
     * gaps, so at 14 the row overflowed by 32px — and centring split it both
     * ways, putting the −5 button at x −6, half off the screen. The same shape
     * of bug as the column itself.
     */
    rowGap: column < 340 ? 6 : 14,
    /*
     * Derived from the rail's contents, never guessed at.
     *
     * This was `max(40, round(58 * s))`, a number picked to look right, and it
     * was smaller than the thing it had to contain: the chips are a fixed 44,
     * over 8px of padding, under a 14px label — 66px that does not scale,
     * because a touch target that shrinks is a target you miss. Measured at
     * 375x568 the wrapper came out 42px tall around a chip running to 543, so
     * the bottom 14px of every chip on the rail was sliced off. A horizontal
     * ScrollView clips rather than overflows, so it looked like a design.
     *
     * The heading is counted on every screen size. It was dropped on short ones
     * to buy back 14px, which was the wrong thing to cut: it is the line that
     * says the row beneath it is what comes NEXT, and without it the chips are
     * a row of names with no stated purpose. TODAY gives up the 14px instead,
     * because TODAY scrolls and this does not.
     */
    railHeight: RAIL_PAD + RAIL_CHIP + RAIL_LABEL + RAIL_WHY
  };

  /*
   * TODAY takes what is left, never more than it was designed for.
   *
   * It used to be `90 * s * s`, a curve tuned until the fit test passed — and
   * because `fixedHeight` was understating the ±45 row by 28px, what it was
   * tuned against was not the real screen. The list is the one part that can
   * honestly give: it scrolls, and every set in it is also on the recap. So it
   * is computed last, from the space that actually remains.
   *
   * On a phone this is not the binding constraint and TODAY gets its full 90.
   * On a short pane it shrinks, and below a certain height it reaches 0 and the
   * column simply cannot fit — which is a fact about the screen, and better said
   * out loud by `columnHeight` than hidden by shrinking a touch target.
   */
  /*
   * If everything unshrinkable still does not fit, the RAIL is what goes.
   *
   * Measured at 281x460 with a set logged: CLEAR and FINISH landed at y498 on a
   * 460px screen — off the bottom, so the workout could be started and never
   * finished. Something has to give at that size and the order is not a
   * judgement call: losing the rail costs discoverability of the day's other
   * lifts, which the picker still provides; losing FINISH costs the ability to
   * complete a workout at all.
   *
   * Dropped by setting its height to zero, so `fixedHeight` stops budgeting for
   * it and the screen stops rendering it from the same number — there is no
   * second flag to keep in step.
   */
  /*
   * Keyed on the device, not on `fixedHeight`, because the estimate is
   * conservative and the estimate was wrong about the case that matters.
   *
   * The model puts a 375x568 screen 46px over with the rail budgeted. Measured
   * on the running app at exactly that size, with a set logged and the rail up:
   * everything renders and FINISH sits at y549-566, inside the screen. Dropping
   * the rail there would have cost a shipping device a feature on the strength
   * of an arithmetic error.
   *
   * So the rail is kept for every phone that ships — the shortest is the SE at
   * 568 — and only goes below that, where something genuinely has to. The order
   * is not a judgement call: losing the rail costs discoverability of the day's
   * other lifts, which the picker still provides, while losing FINISH costs the
   * ability to complete a workout at all.
   */
  /*
   * Nothing is sacrificed any more — the screen scrolls instead.
   *
   * This used to drop the RAIL below 568 so CLEAR and FINISH could not be
   * pushed off the bottom. That was right while the column could only ever be a
   * fixed height, and it cost the day's other lifts on any window shorter than
   * an SE. A window that short is not a phone, and §4's "the logging path does
   * not scroll" is a rule about phones — on one this stays a fixed column and
   * never scrolls, which `scrolls` below encodes.
   */
  const fitted: NowLayout = base;

  const todayMin = Math.max(0, Math.min(Math.round(90 * s * s), height - fixedHeight(fitted)));

  /*
   * Whether the column has to scroll to be reachable at all.
   *
   * Measured against the parts that cannot shrink once TODAY has given up
   * everything. The 48px allowance is the model's own conservatism, measured:
   * it puts a 375x568 screen 46px over while the real one fits, with LOG SET at
   * y364-390 and FINISH at y549-566. Without the allowance every iPhone SE
   * would scroll a screen that does not need to.
   */
  return { ...fitted, todayMin, scrolls: fixedHeight(fitted) > height + 48 };
}

/**
 * What that layout costs vertically before TODAY shows a second row.
 *
 * The constants are the parts that do NOT scale — text at a legible size, the
 * stepper rows, the footer. They are duplicated from the stylesheet, which is
 * the price of being able to assert "it fits" without a browser; the layout
 * test measures the real thing to keep the two honest.
 */
/**
 * The day-rail's height, shared by the fit math and the stylesheet.
 *
 * `columnHeight` duplicates the stylesheet's constants by necessity — it has to
 * assert "it fits" without a browser — and every duplicated number is a chance
 * for the two to drift. This one is declared once and imported by both.
 */
/**
 * How many lifts the rail will show. §7 — the logging path is a prediction, not
 * a library; the picker is where the library lives.
 *
 * Twelve, not eight. Eight was the first guess and it was wrong in the way that
 * matters: a push day has ten built-in movements, so the cap fell inside a real
 * day and cut Tricep Extension and Tricep Pushdown — two of the three the user
 * named when they asked for this. The number that needs capping is a FULL BODY
 * plan, which covers push, pull and legs at once and offers all 28. Twelve
 * clears every single day whole and still refuses to be a library.
 */
export const RAIL_MAX = 12;

/** The chip itself. Never scales — a target that shrinks is a target you miss. */
export const RAIL_CHIP = 44;
/** Gap above the chips, and the height of the day label when there is room for it. */
/**
 * "Do not ask which machine again."
 *
 * Someone who trains at one gym answers "which machine" with the same word
 * every time, and the second step of the equipment sheet becomes a tap they
 * pay on every machine set for information the app already has. With this set,
 * choosing MACHINE records the kit and closes, exactly like barbell and
 * dumbbell do.
 *
 * A preference rather than a guess: the app cannot tell "always the same
 * machine" from "has not varied it yet" without waiting months, and §4's rule
 * is that it must not ASK what it can answer — not that it must guess at what
 * it cannot.
 */
export const PREF_SKIP_MACHINE = 'pref.skipMachineName';
/**
 * The unit they picked in Settings, which outranks the unit they last trained
 * in. Lives here rather than in `app/settings.tsx` because this file is what
 * ACTS on it — a preference key owned by the screen that writes it, and read by
 * nothing, is how it came to have no effect at all.
 */
export { PREF_UNIT } from './display-unit.ts';

export const RAIL_PAD = 8, RAIL_LABEL = 14;
/**
 * The band once held a second line, under the heading, explaining why the
 * suggested lift was suggested. It is gone — too much text on the one path §4
 * keeps bare, and the rail already answers the question by putting that chip
 * first. Kept as a zero so the arithmetic below still names what it counts, and
 * as a reminder that anything drawn inside a FIXED-height band has to be
 * counted here: when the line went in without being counted, it cut 2px off
 * the bottom of the very chip it was describing.
 */
export const RAIL_WHY = 0;

export function columnHeight(l: NowLayout): number {
  return fixedHeight(l) + l.todayMin;
}

/**
 * Everything the column costs EXCEPT the TODAY list.
 *
 * Split out because TODAY is the one part that is allowed to give: it scrolls,
 * every set in it is also in the recap, and the note this file has always
 * carried says it "collapses fastest, because it is the part that scrolls".
 * Making that explicit lets `layoutFor` hand TODAY whatever is genuinely left
 * over, so the column fits by construction instead of by a number someone tuned
 * until the test went green.
 *
 * The constants are the parts that do NOT scale — text at a legible size, the
 * stepper rows, the footer. They are duplicated from the stylesheet, which is
 * the price of being able to assert "it fits" without a browser.
 */
function fixedHeight(l: NowLayout): number {
  // STEP_HINT was 12, budgeting for a bare line of text. The row that actually
  // renders there is the ±45 / ±5 jump buttons, measured at 40px on the running
  // app — so this function quietly promised 28px it did not have, on every
  // screen, since before the rail existed. Every fit test passed anyway,
  // because they check this arithmetic against itself rather than the app.
  /*
   * HEADER_TEXT was 58 and measures 79 on the running app at the design size:
   * the lift name (30), the last-time line (20), the equipment line (14) and the
   * gaps between them. A 21px error at every screen size, in the optimistic
   * direction — which is how `columnHeight` came to report an exact fit at
   * 275x595 for a column that overflowed.
   *
   * Every constant here is duplicated from the stylesheet, which is the price of
   * asserting "it fits" without a browser. That makes measuring them against the
   * real thing a periodic job, not a one-off — STEP_HINT was 12 against a real
   * 40 until R81.
   */
  /*
   * R512: ROOT_PAD was 8 against a real 16 — for one round, and by my own
   * hand. R511 raised `root.paddingTop` to give the screen air and did not
   * update this copy of it, which is the third time this exact thing has
   * happened here and the second sentence of the comment above predicts it.
   * `no-drift.test.ts` now reads these out of the stylesheet, so the fourth
   * time fails the suite instead of quietly promising 8px the column does not
   * have.
   */
  const ROOT_PAD = 8, TOP_BAR = 31, HEADER_TEXT = 79, STEP_HINT = 40;
  const REPS_ROW = 53, REST_ROW = 20, FOOTER = 40;
  /*
   * The heading over the logged-set list — "THIS WORKOUT". Measured at 14px of
   * text over an 8px margin on the running app.
   *
   * Budgeted here rather than left to be discovered later, because a row added
   * to the column without telling this function is exactly the mistake the
   * comments above record twice: STEP_HINT was 12 against a real 40, and
   * HEADER_TEXT was 58 against a real 79. Both were silent, both understated
   * the column, and both made `columnHeight` promise a fit that the screen did
   * not deliver. Adding 22 here means TODAY — the part that scrolls — gives up
   * the space, which is the rule this whole function exists to enforce.
   */
  const TODAY_HEADING = 18;
  const heroRow = Math.max(HIT, Math.round(l.hero * 1.33));
  return ROOT_PAD + TOP_BAR + HEADER_TEXT + l.headerGap + heroRow + STEP_HINT
    + l.repsGap + REPS_ROW + l.logGap + l.logHeight + l.restGap + REST_ROW
    // The rail sits in its own band inside the TODAY block now, with a rule
    // under it and room either side — flush against a scroller its half-cut
    // top row read as two things overlapping. The band costs 16px more than
    // the rail itself, and nothing at all when there is no rail.
    /*
     * +22 for the band around the rail, not +16.
     *
     * The band adds a 6px top margin, 12px of bottom padding and a 1px rule of
     * its own, none of which are in `railHeight` — that constant describes what
     * is INSIDE the band. The reserve only has to be generous (it decides
     * whether the column fits, and being a few pixels pessimistic costs
     * nothing), but being SHORT is what put the chips through the rule.
     */
    + l.todayGap + l.footerGap + (l.railHeight ? l.railHeight + 22 : 0) + l.restGap
    + TODAY_HEADING + FOOTER;
}



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
  head: string; tail: string; hit: boolean;
} {
  const { previous, thisSession, goal, coach } = input;
  /*
   * The coach outranks "Last time", and ONLY that. It never displaces "Just
   * did" — that line is the confirmation that the set you just logged landed,
   * and swapping advice in on top of it would answer a question the lifter is
   * not asking mid-set. In practice the two never collide anyway: `previous`
   * already wins over `thisSession`, and the coach needs two sessions in the
   * window, which is a strict superset of having a `previous` at all.
   */
  const head = coach
    ? fill(t(lang, coach.key as never), coach.params)
    : previous ? `${t(lang, 'lastTime')}  ${loadLabel(previous.weight)} × ${previous.reps}`
    : thisSession.length
      ? `${t(lang, 'justDid')}  ${loadLabel(thisSession[thisSession.length - 1].weight)} × ` +
        `${thisSession[thisSession.length - 1].reps}`
      : t(lang, 'firstTime');
  return { head, tail: goalTail(goal, lang), hit: goal?.justHit === true };
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

/**
 * Where TODAY has to be scrolled for the lift you are training to be on screen.
 * Returns null when no scroll is needed — see rule 2.
 *
 * TODAY is a fixed-height box inside a column that must not scroll (§4), so
 * once a session runs past two lifts its content is taller than the space it
 * has. It scrolls, but it never scrolled *itself*: on the third lift of the
 * seeded push day the block for the lift being trained — the one with the volt
 * dot marking it current, its logged sets, and R38's per-lift UNDO — sat 20px
 * below the bottom of a 218px viewport with `scrollTop` still at 0, and
 * `showsVerticalScrollIndicator={false}` meant nothing on screen suggested
 * there was more. The section's whole claim is that "what have I done so far"
 * never requires leaving the screen you log on, and at three lifts it did.
 *
 * Two rules, and the second is why this is a function rather than a
 * `scrollToEnd()` call:
 *
 * **1. The current lift is not always last.** `buildToday` orders blocks by
 * when each lift first appeared in the session and only appends the current one
 * if it has no sets yet — so switching *back* to a lift trained earlier makes
 * the block you need the FIRST one. `scrollToEnd` would confidently scroll away
 * from it.
 *
 * **2. Do not scroll when it is already visible.** The common case is logging
 * set after set on one lift, and a list that jumps on every tap is worse than
 * one that sits still. Returning null for "already in view" is what keeps the
 * fix from becoming a twitch on the hot path.
 */
export function revealOffset(input: {
  /** Each block's offset and height within the scroller's content. */
  blocks: readonly { y: number; h: number }[];
  /** Index into `blocks` of the lift being trained. */
  current: number;
  /** The scroller's visible height. */
  viewport: number;
  /** Total content height. */
  content: number;
  /** Where the scroller is now. */
  scrollTop: number;
}): number | null {
  const { blocks, current, viewport, content, scrollTop } = input;
  // Nothing measured yet — onLayout has not run. Scrolling on a guess would
  // move the list to an offset computed from zeros.
  if (viewport <= 0) return null;
  const block = blocks[current];
  if (!block) return null;

  const max = Math.max(0, content - viewport);
  if (max === 0) return null;

  const top = block.y, bottom = block.y + block.h;
  if (top >= scrollTop && bottom <= scrollTop + viewport) return null;

  // A block taller than the viewport cannot be fully shown, so show its head:
  // the lift's name and its first sets, not its tail.
  const target = block.h >= viewport || top < scrollTop ? top : bottom - viewport;
  const clamped = Math.min(max, Math.max(0, target));
  return clamped === scrollTop ? null : clamped;
}

/**
 * Split the picker into the day you are training and everything else.
 *
 * §7 makes exercise selection a prediction problem, and the strongest predictor
 * is the DAY: on push day a leg movement is not a near-miss, it is noise — rows
 * to scroll past to reach the handful that could plausibly be next. So the
 * sheet opens on the day and the other days sit behind one deliberate tap.
 *
 * Two rules keep that from becoming a cage:
 *
 *   - **Movements the user invented are never hidden.** They have no day
 *     (`group.day === null`, the YOURS group), and inventing one is already
 *     going out of your way; burying it afterwards would be the R32 trap —
 *     telling someone their movement exists and then never showing it again.
 *   - **When the day is not knowable, nothing is hidden.** Before anything is
 *     logged `sessionDay` can return null, and narrowing to an arbitrary third
 *     of the library would be worse than not narrowing at all.
 */
export function splitPickerGroups(
  groups: SplitGroup[], day: PlanDay | null
): { thisDay: SplitGroup[]; others: SplitGroup[] } {
  // A plan-day can cover more than one PPL group: "upper" is push AND pull,
  // and "full body" is everything — which is how a non-PPL split narrows
  // correctly without a second set of groupings.
  const covers = day ? PLAN_DAY_COVERS[day] : [];
  const thisDay = groups.filter(g => g.day === null || (g.day && covers.includes(g.day)));
  // Only the day-less YOURS group matched, so there is no day to narrow to.
  if (!thisDay.some(g => g.day !== null)) return { thisDay: groups, others: [] };
  return { thisDay, others: groups.filter(g => !thisDay.includes(g)) };
}

/** One lift on the day's rail. */
export interface RailLift {
  id: string;
  name: string;
  /** Already trained in this session — dimmed, but still reachable. */
  done: boolean;
  /** The lift on screen right now. */
  current: boolean;
  /** The one the predictor would have put in the old NEXT LIFT button. */
  suggested: boolean;
  /**
   * Why this one, in the app's own words — "finishes what your compound
   * started", "same muscles as your last lift". Empty for movements the app
   * has no profile for, and for chips it has nothing to say about.
   */
  reason: string;
}

export interface NowState {
  session: Session;
  exercise: Exercise;
  /** What the steppers currently show — never blank (§4). */
  weight: number;
  reps: number;
  /** Where those numbers came from, so the UI can only claim "last time" truthfully. */
  prefillSource: Prefill['source'];
  /**
   * The line under the lift name, split at the point the colour changes.
   * Never blank — see `lastTimeParts`.
   */
  lastTime: { head: string; tail: string; hit: boolean };
  /** What language to draw the chrome in. See `NowModel.lang`. */
  lang: Language;
  /** Which routine they are running. Chosen once, changed in Settings. */
  plan: SplitPlan;
  /** The day of that plan in force — chosen if they said, inferred otherwise. */
  planDay: PlanDay | null;
  /**
   * Whether they actually SAID which day it is.
   *
   * Separate from `planDay` because the app can infer a day from the lift it
   * happens to be showing, and that inference must not count as an answer —
   * gating the question on `planDay` meant it was never asked at all.
   */
  dayChosen: boolean;
  /** Whether they have been put in front of the day question for this workout. */
  dayAsked: boolean;
  /** What this lift is being done on, carried over from last time. */
  equipment: Equipment | null;
  /** Which machine, when `equipment` is 'machine'. */
  machine: string | null;
  /** Machines already logged for THIS lift, most recent first. */
  knownMachines: string[];
  /** What the +/- jump buttons add, in this session's unit. User-settable. */
  plateJump: number;
  /** What the +/- rep jump buttons add. User-settable. */
  repJump: number;
  /** Sets logged for this exercise in this session. */
  loggedThisExercise: LoggedSet[];
  /** Every set in the session, in order. */
  loggedThisSession: LoggedSet[];
  /** The lift after this one, or null at the end of the predicted session. */
  upNext: Exercise | null;
  /**
   * Every lift belonging to today, in the order you are likely to want them.
   *
   * NEXT LIFT offered exactly one guess, in a small button sharing a row with
   * CLEAR and FINISH. That answers "what does the app think is next" but not the
   * question a lifter actually has between exercises, which is "what else is on
   * push day" — and the answer to that is a list, not a guess. Tricep
   * extensions and chest flys were always in the library and always one tap
   * away through the picker; nothing on screen said so.
   */
  dayRail: RailLift[];
  /** What the picker offers right now — their lifts, or the starting twelve. */
  picker: Exercise[];
  /** The same list, grouped by split day, with the day being trained first. */
  pickerGroups: SplitGroup[];
  /** Which day this workout is, judged by what has been logged. Null until it is knowable. */
  day: SplitDay | null;
  /**
   * Whether there is a workout to finish.
   *
   * FINISH used to be offered from the moment the app opened. Tapping it with
   * nothing logged pushed a recap reading "Nothing logged yet" with a BACK
   * button — a round trip to a dead end — and ended a session containing no
   * sets, leaving a phantom row behind for every launch someone opened and did
   * not train. You cannot finish a workout you have not started.
   */
  canFinish: boolean;
  /** Time since the last set in this session (§8b). Null before the first one. */
  rest: RestState;
  /**
   * §10: "a streak, visible on launch, that counts training days not app
   * opens". It reached the recap and the shared card and never the screen the
   * app actually opens on, which is the one place §10 asks for it — an app
   * opened only mid-workout has no habit hook, and this is half of what §10
   * offers as one.
   *
   * The raw count. Whether it is worth SHOWING is `streakWorthShowing`'s call
   * (>= 2), and it stays the recap's call so the two surfaces cannot start
   * disagreeing about what counts as a streak.
   */
  streak: number;
  /**
   * Nothing has ever been logged on this device.
   *
   * §6 requires that first launch *show the twelve* rather than silently pick
   * one — a beginner who came to squat should not have to discover that the
   * exercise name is tappable.
   */
  firstEver: boolean;
  /**
   * The whole workout so far, in the order it was trained.
   *
   * The screen used to show only the CURRENT exercise's sets, which made a
   * session feel like a series of unrelated taps rather than a record being
   * built. This is the thing you are actually making while you train.
   */
  today: SessionLift[];
  /** Every set logged today, across all lifts. */
  totalSets: number;
  /** Running volume for the session, in the session's unit. */
  totalVolume: number;
  /**
   * Whether `totalVolume` is a total or a floor — see `SessionStats.volumeKnown`.
   *
   * False for bodyweight work with no reading behind it, where the sum is 0
   * because the weight ADDED was 0. The fifth surface to carry this same
   * claim, found by grepping `sessionStats(` rather than waiting for a later
   * round to trip over it — and the only one that is LIVE, printing "1 set
   * 0 lb" under the logged sets while the lifter is still in the gym.
   */
  totalVolumeKnown: boolean;
}

export interface SessionLift {
  exerciseId: string;
  name: string;
  sets: LoggedSet[];
  /** True for the lift currently open, so the screen can mark where you are. */
  current: boolean;
}

let counter = 0;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`;

/** Readable, stable ids for user-created exercises — "Hack Squat" -> "hack_squat". */
function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return base || `ex_${Date.now().toString(36)}`;
}

/**
 * A free slug.
 *
 * Necessary because slugification is lossy: "Hack-Squat" and "Hack Squat" both
 * reduce to `hack_squat`. Without this, the second one would collide and
 * `addExercise`'s upsert would silently RENAME the first — quietly merging two
 * different movements' history into one.
 */
function freeSlug(taken: Set<string>, name: string): string {
  const base = slugify(name);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${Date.now().toString(36)}`;
}

export class NowModel {
  repo: Repo;
  now: () => number;
  private locale: string | null;
  private session: Session;
  private exerciseId: string;
  /**
   * Lifts this session has been ON, logged or not — the exclusion behind UP
   * NEXT. Not persisted and not part of `trained`: it shapes the suggestion
   * only, never the day inference or anything written down.
   */
  private visited = new Set<string>();
  /**
   * What the current lift is being done on. Carried over from the last set of
   * this exercise the same way weight and reps are: the equipment almost never
   * changes between sessions, so asking again every time would be the app
   * asking a question it could answer (§4).
   */
  private equipment: Equipment | null = null;
  private machine: string | null = null;
  private weight = 0;
  private reps = 0;
  private source: Prefill['source'] = 'seed';

  constructor(repo: Repo, now: () => number = Date.now, locale?: string | null) {
    this.repo = repo;
    this.now = now;
    this.locale = locale ?? null;

    // §4: cold launch goes to the active workout if one is running, never a
    // home screen. A session left open from days ago is closed first, backdated
    // to its last set — otherwise the user resumes a workout they finished on
    // Tuesday.
    const live = repo.liveSession();
    if (live) {
      const sets = repo.setsInSession(live.id);
      if (isStale(live, sets, now())) {
        const closed = autoEnd(live, sets, now());
        repo.endSession(closed.id, closed.endedAt!);
        this.session = this.begin();
      } else {
        this.session = live;
      }
    } else {
      this.session = this.begin();
    }

    this.exerciseId = this.openingExercise();
    this.visited.add(this.exerciseId);
    this.loadPrefill();
  }

  /**
   * Start a session in the right unit.
   *
   * This used to read `liveSession()?.unit ?? 'lb'` — which is called precisely
   * when there is NO live session, so it always fell through to pounds. Every
   * metric user silently got imperial sessions, and §8's "infer from locale" was
   * never actually wired up.
   */
  private begin(): Session {
    const unit = unitForNewSession(
      this.repo.lastUsedUnit(),
      this.locale,
      (this.repo.getPref(PREF_UNIT) as Unit | null) ?? null
    );
    return this.repo.startSession(newId('s'), unit);
  }

  /**
   * What to open on. The predicted session's first lift if there is history
   * (§7), otherwise the head of the starting twelve (§6). Anything already
   * logged this session is skipped, so relaunching mid-workout resumes rather
   * than restarting.
   */
  private openingExercise(): string {
    const done = this.repo.setsInSession(this.session.id).map(s => s.exerciseId);
    if (done.length) return done[done.length - 1];

    const history = this.repo.allSets();
    return openingLift(history, this.now(), new Date(this.now()).getDay())
      ?? pickerFor(history, this.now())[0].id;
  }

  /**
   * History with every weight expressed in THIS session's unit.
   *
   * A `LoggedSet` carries no unit — the session owns it — so any function that
   * reads `set.weight` against a different session's unit is off by 2.2.
   * Nothing hit that while the unit could never change; the moment the Settings
   * control started working, it did: a lifter with 195 lb squats who switched
   * to kilos was offered **195 kg** as their next set. That is 430 lb, prefilled
   * as "same as last time" (§4).
   *
   * Converted for READING only. Nothing is written back — a 195 lb set stays
   * 195 lb in the database for ever (schema.ts), and rounding to the half unit
   * is what `convertWeight` is for.
   */
  private historyInSessionUnit(): LoggedSet[] {
    const all = this.repo.allSets();
    const units = this.repo.sessionUnits();
    const mine = this.session.unit;
    // The common case by far: nothing was ever logged in another unit, so the
    // whole array passes through untouched and unallocated.
    if (!all.some(x => (units.get(x.sessionId) ?? mine) !== mine)) return all;
    return all.map(x => {
      const from = units.get(x.sessionId) ?? mine;
      return from === mine ? x : { ...x, weight: convertWeight(x.weight, from, mine) };
    });
  }

  private loadPrefill(): void {
    const all = this.historyInSessionUnit();
    const p = prefillFor(this.exerciseId, all, this.session.unit);
    this.weight = p.weight;
    this.reps = p.reps;
    this.source = p.source;

    // Equipment carries over the same way the numbers do — the last set of
    // this lift is the best guess at how the next one will be done, and §4
    // says the app never asks a question it could answer. Null when it has
    // never been answered for this lift, which is not the same as "barbell".
    let last: LoggedSet | null = null;
    for (const set of all) {
      if (set.exerciseId !== this.exerciseId) continue;
      if (!set.equipment) continue;
      if (!last || set.at > last.at) last = set;
    }
    /*
     * A choice they made outranks a set they logged.
     *
     * History alone only remembers equipment that made it onto a LOGGED set, so
     * telling the app "this one is dumbbells" and then switching lifts and
     * coming back lost the answer — it fell back to the barbell on last week's
     * set and quietly contradicted them. `setEquipment` now writes the choice
     * down the moment it is made, and that is what gets read first. The set
     * history is still the fallback, for the lifts they have never answered
     * for, and null when neither knows — which is not the same as "barbell".
     */
    // `null` is "never answered"; `''` is "answered, and the answer is none".
    // Collapsing the two made CLEAR fail to stick — it wrote the empty string
    // and the next read treated it as no answer at all and went back to the
    // barbell on last week's set.
    const chosen = this.repo.getPref(`kit.${this.exerciseId}`);
    if (chosen !== null) {
      const [kit, ...rest] = chosen.split(':');
      this.equipment = (kit || null) as Equipment | null;
      this.machine = kit === 'machine' ? (rest.join(':') || null) : null;
    } else {
      this.equipment = last?.equipment ?? null;
      this.machine = last?.equipment === 'machine' ? (last.machine ?? null) : null;
    }
  }

  // ---- reads ---------------------------------------------------------------

  state(): NowState {
    const exercises = this.repo.exercises();
    const sessionSets = this.repo.setsInSession(this.session.id);
    const liveStats = sessionStats(this.session, sessionSets, this.repo.measurements());
    // "Up next" means what follows the lift you are ON, so the current exercise
    // is excluded alongside anything already trained. Without it the suggestion
    // is the exercise you are already looking at, and the swipe target reads as
    // empty until you have logged something.
    const trained = [...new Set([...sessionSets.map(s => s.exerciseId), this.exerciseId])];
    /*
     * UP NEXT must not offer somewhere you have already been, even if you
     * logged nothing there. With an empty session `trained` is just the current
     * lift, so the suggestion was whatever pairs with it — and pressing UP NEXT
     * made the lift you just left the pair again. It ping-ponged: bench, press,
     * bench, press, forever, two of twelve movements reachable.
     *
     * `visited` is deliberately kept OUT of `trained`. `trained` also decides
     * `sessionDay`, and merely looking at Squat must not turn a push day into
     * leg day.
     */
    const seen = [...new Set([...trained, ...this.visited])];
    const candidates = nextCandidates(
      this.repo.allSets(), seen, this.now(), new Date(this.now()).getDay()
    );

    const exercise = exercises.get(this.exerciseId) ?? { id: this.exerciseId, name: this.exerciseId };

    // The whole library goes in, so a movement the user created is offered even
    // before it has been trained — without it, adding a lift and switching away
    // lost it for good.
    const library = [...exercises.values()];
    let picker = pickerFor(
      this.repo.allSets(), this.now(), new Date(this.now()).getDay(), 12, library
    );
    // `pickerFor` ranks by history, so a lift with none — anything picked out
    // of the starting twelve after history exists — is absent from its own
    // picker, and the sheet opens with nothing marked as selected. Whatever is
    // currently open always belongs in the list.
    if (!picker.some(e => e.id === this.exerciseId)) picker = [exercise, ...picker];

    // The split is PRIOR knowledge and loses to evidence: `suggestNext` reads
    // their actual history, and only when it has nothing to say — which on a
    // first-ever workout is always, since ranking the history and removing what
    // is already done leaves the empty set — does the conventional companion
    // for the day fill in. UP NEXT used to be blank for exactly the beginner
    // who did not know what came next.
    const day = sessionDay(trained, dayOf(this.exerciseId));
    /**
     * History ranks; the split keeps it on today's workout.
     *
     * `predictSession` orders by typical position within a session, and on a
     * push/pull/legs routine EVERY day's opener has position 0 — so with twelve
     * weeks of real data the app suggested **Squat** immediately after Bench
     * Press, sending the user to a different day's lift mid-workout. Ranking by
     * their own history is still right; it just has no idea the days exist.
     *
     * So the highest-ranked candidate that belongs to the day being trained
     * wins. Their evidence still decides the order — this only rules out
     * answers that are on the wrong day, and only when a same-day answer exists
     * at all. `companionFor` remains the last resort, for the beginner with no
     * history to rank.
     */
    /*
     * The plan the user is running, and the day of it they said they are on.
     * The chosen day WINS over the inferred one — they told us, and §4's rule
     * is that the app does not argue with an answer it asked for. When they
     * have not said, the inferred day is COUNTED in their vocabulary — not
     * counted in push/pull/legs and translated afterwards, which is a
     * different answer and was the one this line took.
     *
     * R498. `planDayFor(day, plan)` tallies at the push/pull/legs level first,
     * and `sessionPlanDay`'s own comment says why that is wrong: an
     * upper/lower lifter's upper day is push AND pull, so bench + row + squat
     * reads as a 1-1-1 tie at the narrow level and the tie-break sends it to
     * whatever they are standing on. Counted at the level the lifter actually
     * has, it is 2 upper against 1 lower and not a tie at all. Measured: that
     * session, with the user on squat, titled LOWER here and UPPER on the
     * recap — `sessionTitle` has always called `sessionPlanDay` directly. One
     * session, two names, on two screens of the same app a minute apart.
     *
     * `day` stays a `SplitDay` because `groupBySplit` and `companionFor` still
     * want the narrow question; only the day shown to the LIFTER changes.
     */
    const plan = this.plan();
    const planDay = this.chosenDay() ?? sessionPlanDay(trained, plan, dayOf(this.exerciseId));

    /*
     * R496. Filtered by the day of THEIR plan, not by push/pull/legs.
     *
     * `day` is a `SplitDay`, and `DAY_OF` files bench under push and row under
     * pull. That is right for push/pull/legs and a category error for
     * UPPER/LOWER — a split this app offers in its own picker, where bench and
     * row are the same day. Measured on fourteen weeks of it: the lifter
     * benches, their own history says ROW next, and UP NEXT said OHP, because
     * this line skipped past row looking for something filed as push. The app
     * knew what they do and recommended something else.
     *
     * `planDay` is already computed three lines up and `inPlanDay` already
     * exists for exactly this comparison — `sessionPlanDay` carries the same
     * argument about why counting at the push/pull/legs level is wrong for a
     * lifter whose day spans two of them. This was the one place still asking
     * the narrower question. For a PPL lifter the plan day IS the split day, so
     * nothing about that case changes.
     */
    const onThisDay = planDay ? candidates.find(id => inPlanDay(id, planDay)) : null;
    const upNextId = onThisDay ?? candidates[0] ?? companionFor(day, seen, picker);

    return {
      session: this.session,
      exercise,
      weight: this.weight,
      reps: this.reps,
      prefillSource: this.source,
      plan,
      planDay,
      dayChosen: this.chosenDay() !== null,
      dayAsked: this.chosenDay() !== null || this.repo.getPref(`split.asked.${this.session.id}`) === '1',
      equipment: this.equipment,
      machine: this.machine,
      knownMachines: this.repo.knownMachines(this.exerciseId),
      plateJump: this.plateJump(),
      repJump: this.repJump(),
      lang: this.lang(),
      /*
       * The coach line (OWNER.md #2) takes over this slot rather than getting
       * one of its own.
       *
       * Not a compromise — the right place. The slot's head says "Last time
       * 185 x 5" for any lift with history, and the coach line is that same
       * fact plus what to do about it: "185 for 2 sessions - try 190". It is a
       * strict improvement on what was there, in the position a lifter already
       * looks for it, directly under the exercise name.
       *
       * And it is the only place it could go. R512 measured the shortest
       * shipping phone at 624px of unshrinkable content against 568px of
       * screen, and R511 put LOG SET below the fold by adding EIGHT pixels of
       * padding. A new row costs about twenty. Reusing a row that is already
       * budgeted in `fixedHeight`'s HEADER_TEXT costs nothing at all.
       *
       * `historyInSessionUnit`, not `allSets`: a LoggedSet carries no unit
       * (HANDOFF trap 9), so raw history would compare kilos against pounds
       * and suggest a jump in the wrong currency.
       */
      lastTime: lastTimeParts({
        previous: this.lastTime(),
        thisSession: sessionSets.filter(s => s.exerciseId === this.exerciseId),
        goal: this.goalHint(),
        coach: coachSuggestion(
          this.historyInSessionUnit(), this.exerciseId, this.now(),
          { unit: this.session.unit, goal: trainingGoal(this.repo) }
        )
      }, this.lang()),
      loggedThisExercise: sessionSets.filter(s => s.exerciseId === this.exerciseId),
      loggedThisSession: sessionSets,
      dayRail: this.buildRail(planDay, candidates, sessionSets, exercises),
      upNext: upNextId && upNextId !== this.exerciseId
        ? exercises.get(upNextId) ?? { id: upNextId, name: upNextId }
        : null,
      picker,
      // The group you are IN leads. That is the session's day normally, and
      // `yours` when the lift being trained is one the user invented, since
      // those have no day and would otherwise sit below the fold.
      pickerGroups: groupBySplit(picker, dayOf(this.exerciseId) ? day : 'yours'),
      day,
      canFinish: sessionSets.length > 0,
      // Measured across the whole session, not per exercise: the rest that
      // matters is since you last did work, whatever the work was.
      rest: restSince(lastSetAt(sessionSets), this.now()),
      streak: weekStreak(this.repo.allSets(), this.now()),
      firstEver: this.repo.allSets().length === 0,
      today: this.buildToday(sessionSets, exercises),
      totalSets: sessionSets.length,
      // The third hand-rolled copy of this sum, and the third one to disagree
      // with the recap the moment a pull-up learned to weigh something. Through
      // `sessionStats` now, so the running total on the logging screen, the
      // history on Progress and the shareable at the end cannot say three
      // different things about one workout.
      // ...and `volumeKnown` off the same call, so the fourth thing it could
      // disagree about — whether the total is knowable at all — cannot be
      // expressed either.
      totalVolume: liveStats.volume,
      totalVolumeKnown: liveStats.volumeKnown
    };
  }

  /**
   * Group the session's sets by lift, in the order they were first trained.
   *
   * The lift currently open is always included even with no sets yet, so
   * switching to a new exercise shows you where you are in the workout rather
   * than making it appear only after you commit a set.
   */
  private buildToday(sessionSets: LoggedSet[], exercises: Map<string, Exercise>): SessionLift[] {
    const order: string[] = [];
    const byExercise = new Map<string, LoggedSet[]>();
    for (const set of sessionSets) {
      if (!byExercise.has(set.exerciseId)) { byExercise.set(set.exerciseId, []); order.push(set.exerciseId); }
      byExercise.get(set.exerciseId)!.push(set);
    }
    if (!byExercise.has(this.exerciseId)) { byExercise.set(this.exerciseId, []); order.push(this.exerciseId); }

    return order.map(id => ({
      exerciseId: id,
      name: exercises.get(id)?.name ?? id,
      sets: byExercise.get(id) ?? [],
      current: id === this.exerciseId
    }));
  }

  /**
   * The live goal on the lift being trained, or null.
   *
   * Live, not any: an achieved goal is a trophy and says nothing useful while
   * you are training — see `goalTail`. `goalProgress` measures `remaining` at
   * the goal's OWN rep count, which is the same number the goal card and the
   * Progress row show, so the three screens cannot disagree about how far away
   * a target is.
   */
  private goalHint(): GoalHint | null {
    const goal = this.repo.goals().find(g => g.exerciseId === this.exerciseId);
    if (!goal) return null;
    const all = this.repo.allSets();
    const p = goalProgress(goal, all, this.repo.exercises(), this.now(), this.repo.sessionUnits());
    /*
     * The goal is measured in ITS own unit and shown in the SESSION'S.
     *
     * A goal carries the unit it was set in, and `goalProgress` compares it
     * against a history in that same unit, so the arithmetic is already
     * self-consistent — it is only the two numbers that reach the screen that
     * have to be moved. Converting the goal before scoring it would round the
     * target twice and drift the thing the whole card is measured against.
     *
     * Without this, a kg session under an lb goal printed "30 to 225 × 5"
     * beneath a hero reading kilos: a target the user cannot compare to the
     * number directly above it (§16).
     */
    const show = (w: number) =>
      goal.unit === this.session.unit ? w : convertWeight(w, goal.unit, this.session.unit);
    const base = { targetWeight: show(goal.targetWeight), targetReps: goal.targetReps };
    if (!p.achieved) return { ...base, remaining: show(p.remaining) };

    /*
     * Met. Whether that is news depends on WHEN: the same history without this
     * session's sets is the state the user walked in with, so if the goal was
     * already met then, nothing happened today and the line stays quiet.
     */
    const before = all.filter(x => x.sessionId !== this.session.id);
    if (isAchieved(goal, before, this.repo.sessionUnits())) return null;
    return { ...base, remaining: 0, justHit: true };
  }

  /**
   * "Last time: 225 × 5" — the line §5 says must be visible without interaction.
   *
   * Read through `historyInSessionUnit`, because this line sits directly under
   * the hero and the two describe the SAME set. With a kg session over an lb
   * history the hero said 88.5 and this said "Last time 195 × 5": one set, two
   * numbers, neither labelled, on the one comparison §5 puts on screen without
   * being asked.
   */
  /**
   * The language every string on this screen is drawn in.
   *
   * Read here rather than passed in, because the setting can change while this
   * model is alive — Settings is a route pushed over the logging screen, and
   * coming back must not need a remount to speak the language they just chose.
   */
  lang(): Language {
    return languageOf(this.repo, this.locale);
  }

  lastTime(): LoggedSet | null {
    const previous = this.historyInSessionUnit().filter(
      s => s.exerciseId === this.exerciseId && s.sessionId !== this.session.id
    );
    return previous.length ? previous[previous.length - 1] : null;
  }

  // ---- writes --------------------------------------------------------------

  /**
   * Repeat a lift's last set, from the list rather than from the hero.
   *
   * The hero logs the lift you are ON. Adding another set of something further
   * up the session meant switching to it, checking the steppers landed on the
   * right numbers, logging, and switching back — four moves and a chance to log
   * the wrong weight, for the commonest action in a workout. The numbers come
   * from that lift's own last set in this session, so it repeats what happened
   * rather than what the steppers happen to be showing.
   *
   * Returns null when the lift has nothing to repeat yet.
   */
  addSetTo(
    exerciseId: string,
    patch?: { weight?: number; reps?: number; note?: string | null }
  ): LoggedSet | null {
    this.startNextIfFinished();
    const mine = this.repo.setsInSession(this.session.id)
      .filter(x => x.exerciseId === exerciseId);
    const last = mine[mine.length - 1];
    if (!last) return null;
    /*
     * The last set is the DEFAULT, not the answer.
     *
     * It used to log the copy outright, which is fast and wrong: the commonest
     * reason to add a set to a lift further up the session is that it was
     * different — heavier, fewer reps, a note about the machine. Copying
     * silently recorded a set that never happened and left the user to notice
     * and fix it. The patch is what the sheet collected; without one it still
     * repeats, which is what `undo` and the tests rely on.
     */
    const set: LoggedSet = {
      ...last,
      id: newId('x'),
      at: this.now(),
      ...(patch?.weight !== undefined ? { weight: patch.weight } : {}),
      ...(patch?.reps !== undefined ? { reps: patch.reps } : {}),
      ...(patch?.note !== undefined ? { note: patch.note?.trim() || null } : {})
    };
    this.repo.logSet(set);
    return set;
  }

  /** The set a `+` on this lift would start from, for the sheet to prefill. */
  lastSetOfInSession(exerciseId: string): LoggedSet | null {
    const mine = this.repo.setsInSession(this.session.id)
      .filter(x => x.exerciseId === exerciseId);
    return mine.length ? mine[mine.length - 1] : null;
  }

  /**
   * Fix a set that is already logged, instead of destroying it.
   *
   * Removing and re-logging moved the set to the END of the session and gave it
   * a new `at`, so correcting a mistyped middle set silently reordered the
   * workout. This keeps its id, its time and its place.
   */
  editSet(id: string, patch: { weight?: number; reps?: number; note?: string | null }): boolean {
    return this.repo.updateSet(id, patch);
  }

  /** THE one-tap action. Everything else on this screen exists to serve it. */
  log(): LoggedSet {
    // A set can never land in a workout that is already over, whatever the
    // navigation did to get back here. See `startNextIfFinished`.
    this.startNextIfFinished();
    const set: LoggedSet = {
      id: newId('x'),
      sessionId: this.session.id,
      exerciseId: this.exerciseId,
      weight: this.weight,
      reps: this.reps,
      at: this.now(),
      ...(this.equipment ? { equipment: this.equipment } : {}),
      ...(this.equipment === 'machine' && this.machine ? { machine: this.machine } : {})
    };
    this.repo.logSet(set);
    // Deliberately does NOT reset the steppers: the overwhelmingly common next
    // action is the same set again, and clearing them would cost a tap.
    this.source = 'history';
    return set;
  }

  bumpWeight(steps: number): void {
    const step = WEIGHT_STEP[this.session.unit];
    this.weight = Math.max(0, Math.round((this.weight + steps * step) / step) * step);
  }

  bumpReps(steps: number): void {
    this.reps = Math.max(1, this.reps + steps);
  }

  /**
   * Choose what this lift is being done on.
   *
   * The machine name is dropped when the equipment is not a machine, because
   * "Arsenal" against a barbell set is a fact about nothing.
   */
  /**
   * Record how this lift is done, and remember it.
   *
   * Stored per exercise rather than globally: bench is a barbell and lateral
   * raises are a machine, and one answer for the whole app would be wrong for
   * most of it. Written immediately rather than at log time, because the user
   * has already told us — waiting for a set to be logged means an answer given
   * and then abandoned is an answer thrown away.
   */
  setEquipment(equipment: Equipment | null, machine?: string | null): void {
    this.equipment = equipment;
    this.machine = equipment === 'machine' ? (machine?.trim() || null) : null;
    this.repo.setPref(
      `kit.${this.exerciseId}`,
      equipment === null ? '' : this.machine ? `${equipment}:${this.machine}` : equipment
    );
  }

  setWeight(w: number): void { this.weight = Math.max(0, w); }

  /** Which routine they are running. PPL until they say otherwise. */
  plan(): SplitPlan {
    return planOf(this.repo);
  }

  setPlan(plan: SplitPlan): void {
    this.repo.setPref('split.plan', plan);
    // A day of the old plan may not exist in the new one.
    const day = this.chosenDay();
    if (day && !PLAN_DAYS[plan].includes(day)) this.repo.setPref(`split.day.${this.session.id}`, '');
  }

  /**
   * The day they picked for THIS workout, or null if they have not been asked.
   *
   * Stored per session rather than globally: "today is pull day" is a fact
   * about one workout, and carrying it to the next one would have the app
   * insisting on Monday's answer all week.
   */
  chosenDay(): PlanDay | null {
    const saved = this.repo.getPref(`split.day.${this.session.id}`);
    if (!saved) return null;
    return PLAN_DAYS[this.plan()].includes(saved as PlanDay) ? (saved as PlanDay) : null;
  }

  setDay(day: PlanDay): void {
    this.repo.setPref(`split.day.${this.session.id}`, day);
    // Open on something that belongs to the day they just named, unless they
    // are already on one — switching the lift out from under them would undo
    // an answer they gave two taps ago.
    if (!inPlanDay(this.exerciseId, day)) {
      const first = pickerFor(this.repo.allSets(), this.now(), undefined, 12,
        [...this.repo.exercises().values()]).find(e => inPlanDay(e.id, day));
      if (first) this.selectExercise(first.id);
    }
  }

  /**
   * Remember that they were asked and did not answer.
   *
   * Without this the chooser reopens on every remount — leaving the screen for
   * Progress and coming back put the same question in front of somebody who had
   * already declined it once. §4's rule is that the app never asks a question it
   * could answer; asking one it has already been refused is worse than that.
   *
   * Per session, like the answer itself, so a skip on Monday does not silence
   * the question for the rest of the week.
   */
  skipDay(): void {
    this.repo.setPref(`split.asked.${this.session.id}`, '1');
  }

  /**
   * The day's lifts, ordered so the useful ones are reachable without scrolling.
   *
   * Order is: the lift you are on, then the predictor's ranking, then everything
   * else that belongs to the day. Lifts already trained this session stay on the
   * rail rather than dropping off it — you often come back for a second round,
   * and a chip that vanishes the moment you use it makes the rail feel like it
   * is losing your work.
   *
   * `planDay` not `day`, so an upper/lower lifter gets the whole upper body and
   * not just the push half. When there is no day at all — no plan, nothing
   * inferred — the rail is empty rather than a list of everything, because "all
   * 28 movements" is the picker's job and §7 is explicit that the logging path
   * never shows a library.
   */
  private buildRail(
    planDay: PlanDay | null,
    candidates: string[],
    sessionSets: LoggedSet[],
    exercises: Map<string, Exercise>
  ): RailLift[] {
    if (!planDay) return [];
    const done = new Set(sessionSets.map(x => x.exerciseId));
    /*
     * The day, plus two things that belong on it regardless.
     *
     * A movement the user invented has no split day — `DAY_OF` only knows the
     * built-ins — so filtering on the day alone silently hid exactly the lifts
     * they cared enough to create. And the lift on screen stays on its own rail
     * even when it is off the day, because a chip row that does not contain
     * where you are standing reads as broken.
     */
    const onDay = [...exercises.values()].filter(e =>
      inPlanDay(e.id, planDay) || dayOf(e.id) === null || e.id === this.exerciseId);

    /*
     * Only about three chips fit across a phone before the row has to scroll,
     * so the first three have to be the three worth having. Measured with the
     * first ordering — current lift first, then the predictor's ranking — the
     * visible three were the lift already on screen and two alphabetical
     * accidents, while the app's own recommendation sat off the right edge
     * where nobody would find it.
     *
     * So the order is what you would actually reach for: the suggestion, then
     * the rest of the day by how likely you are to want it, then the ones you
     * have already trained, then the one you are standing on. The last two
     * groups stay on the rail — you often come back for a second round — they
     * just do not spend the space that gets seen without scrolling.
     */
    /*
     * Order is deliberately blind to which lift is selected.
     *
     * The first version scored the current lift last, to stop it spending the
     * one slot that is visible without scrolling. That worked, and it also made
     * the rail rearrange itself every time you touched it: tapping a chip made
     * that chip current, which threw it to the back, which slid every other chip
     * left under your finger. A row that moves when you use it is worse than a
     * row in the wrong order.
     *
     * Both properties are available at once, because the rail only exists once a
     * set is logged (`canFinish`) and at that moment the lift you are on is by
     * definition DONE — so it sorts to the back anyway, without `current` ever
     * entering the comparison. `done` and `candidates` change only when you LOG,
     * never when you tap, so the order is stable exactly as long as it should be.
     */
    /*
     * The predictor says what this user usually does next; `recommendNext` says
     * what makes sense to do next given what they have ALREADY done today. Both
     * are needed and they answer different questions — habit will happily hand
     * you a second heavy horizontal press straight after the first, because
     * that is what you did last week too.
     *
     * They are blended rather than one overriding the other: the predictor's
     * position is the base, and the recommendation shifts it. A movement the
     * app has no muscle profile for scores 0 and therefore does not move, which
     * is the right behaviour for something the user invented — see `MUSCLES`.
     */
    const advice = new Map(
      recommendNext(candidates, sessionSets, this.lang()).map(r => [r.exerciseId, r])
    );
    const rank = new Map<string, number>();
    candidates.forEach((id, i) => {
      /*
       * 6 places per point. Measured at 3 and it was not enough: after a bench
       * press the rail still opened on OVERHEAD PRESS — habit outvoting the
       * recommendation by a nose, on the exact pairing the evidence argues
       * against. Enough to move a good next choice past several habitual ones,
       * not enough to bury a lift they always do.
       */
      rank.set(id, i - (advice.get(id)?.score ?? 0) * 6);
    });
    const UNRANKED = 500, DONE = 800;
    const score = (e: Exercise) =>
      done.has(e.id) ? DONE : rank.has(e.id) ? rank.get(e.id)! : UNRANKED;

    const ordered = onDay.sort(
      (a, b) => score(a) - score(b) || a.name.localeCompare(b.name)
    );

    /*
     * §7: the logging path never shows a library. Without a cap it did — a FULL
     * BODY plan covers push, pull AND legs, so `inPlanDay` matched every built-in
     * movement and the rail became all 28 of them; upper/lower gave 20. The cap
     * keeps the ranking's best few and never drops a lift you have already
     * trained today or the one you are standing on, both of which you need to be
     * able to get back to.
     */
    const kept = ordered.filter((e, i) =>
      i < RAIL_MAX || done.has(e.id) || e.id === this.exerciseId);

    /*
     * The tag the NEXT LIFT button used to be. Derived from the rail itself
     * rather than from `upNext`, which is chosen across the whole library and so
     * could name a lift that is not on this rail at all — leaving the row with no
     * NEXT on it and the user with no steer.
     */
    const suggestedId = kept.find(e => !done.has(e.id) && !this.visited.has(e.id))?.id;

    /*
     * `visited`, not just `!== exerciseId`, and this is load-bearing.
     *
     * Skipping only the current lift makes the tag point BACKWARDS: move from
     * bench to fly without logging, and neither is done, so the rail turns round
     * and tags bench — "next" is the lift you just walked away from. Walked as a
     * swipe it does not merely read oddly, it never terminates: bench -> fly ->
     * bench -> fly, forever, which is the exact loop R50 fixed in `upNext` and
     * which this rail was written without.
     *
     * The current lift is always in `visited`, so it stays excluded for free.
     * Once everything on the rail has been visited the tag goes away, which is
     * the honest answer — there is nothing left to steer anyone to.
     */

    return kept.map(e => ({
      id: e.id,
      name: e.name,
      done: done.has(e.id),
      current: e.id === this.exerciseId,
      suggested: e.id === suggestedId,
      // Only the suggestion explains itself. A reason on every chip is a wall
      // of text on a row meant to be read at a glance mid-set.
      reason: e.id === suggestedId ? (advice.get(e.id)?.reason ?? '') : ''
    }));
  }

  /** The plate jump this user has chosen, or the default for their unit. */
  plateJump(): number {
    const saved = this.repo.getPref(`jump.${this.session.unit}`);
    const n = saved === null ? null : customJump(saved, this.session.unit);
    return n ?? PLATE[this.session.unit];
  }

  /** The rep jump this user has chosen, or five. */
  repJump(): number {
    const saved = this.repo.getPref('jump.reps');
    const n = saved === null ? null : customRepJump(saved);
    return n ?? REP_JUMP;
  }

  /** Store a jump amount. Rejects anything `customJump` will not accept. */
  /*
   * `setPlateJump` / `setRepJump` were here and are gone (R238).
   *
   * They wrote `jump.<unit>` and `jump.reps` — exactly what `app/settings.tsx`
   * does directly — so they were a second way to do one thing, and the tests
   * were the only caller either had ever had. Worse, they keyed off
   * `this.session.unit` while the Settings screen reads the DISPLAY unit
   * (`display-unit.ts`), so wiring one up would have written the preference
   * where the screen that shows it does not look.
   *
   * The validation they wrapped, `customJump` and `customRepJump`, is exported
   * and is what Settings actually calls.
   */

  /**
   * Add or strip a plate. Signed like `bumpWeight`, and routed through
   * `setWeight` so it inherits the same floor — stripping a plate off 20 lb
   * lands on 0, never below.
   */
  bumpPlate(steps: number): void {
    this.setWeight(this.weight + steps * this.plateJump());
  }

  /**
   * Jump either way by the chosen amount. `setReps` floors at 1, so dropping
   * five from a triple lands on 1 rather than a negative set.
   */
  jumpReps(steps: number): void { this.setReps(this.reps + steps * this.repJump()); }
  setReps(r: number): void { this.reps = Math.max(1, Math.round(r)); }

  selectExercise(exerciseId: string): void {
    this.exerciseId = exerciseId;
    this.visited.add(exerciseId);
    this.loadPrefill();
  }

  /**
   * Add a movement the library does not have, and switch to it. §7 — search is
   * the *add a new exercise* path, and this is it.
   *
   * `addExercise` before anything else is not optional: `sets` carries a foreign
   * key to `exercises`, so logging against an unregistered id fails the write.
   * Returns the id so the caller can confirm what it landed on.
   */
  addCustomExercise(name: string): string | null {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) return null;

    const all = [...this.repo.exercises().values()];
    const existing = all.find(e => e.name.toLowerCase() === clean.toLowerCase());
    if (existing) {                       // don't create a second "Hack Squat"
      this.selectExercise(existing.id);
      return existing.id;
    }

    const id = freeSlug(new Set(all.map(e => e.id)), clean);
    this.repo.addExercise(id, clean);
    this.selectExercise(id);
    return id;
  }

  /**
   * Undo a custom exercise added by mistake. `repo.removeExercise` already
   * refuses a built-in or anything ever logged against — this only adds the
   * one rule that belongs at the UI layer: never remove the lift currently
   * open, so the screen never has to decide what to show in its place.
   */
  removeCustomExercise(id: string): boolean {
    if (id === this.exerciseId) return false;
    return this.repo.removeExercise(id);
  }

  /**
   * Swipe. Advances to the lift the rail is pointing at, if there is one.
   *
   * Reads `dayRail`'s suggestion, NOT `upNext`. They are different answers on
   * purpose: `upNext` ranks the whole library, the rail ranks the few movements
   * it can actually show, and `buildRail` already refuses to tag a suggestion
   * that is not on the rail for exactly that reason. Taking `upNext` here would
   * let a swipe land on a lift the rail never named — the user would see NEXT
   * beside one chip, swipe, and arrive somewhere else. Two controls for one
   * decision have to agree about what the decision was.
   *
   * Latent until now only because nothing called this.
   */
  next(): boolean {
    const target = this.state().dayRail.find(l => l.suggested);
    if (!target) return false;
    this.selectExercise(target.id);
    return true;
  }

  /**
   * Undo the last set of a lift — a mis-tap must cost one tap to fix.
   *
   * `exerciseId` defaults to the one being trained, but any lift in the session
   * can be named, and that is the point. Undo used to work ONLY on the current
   * lift, so a set logged wrong and then moved on from was stranded: it sat
   * there in TODAY, plainly visible, with the fix three taps away behind
   * realising you had to switch back to it first. The mistake was on screen and
   * the way to fix it was not.
   */
  undo(exerciseId = this.exerciseId): boolean {
    const mine = this.repo.setsInSession(this.session.id)
      .filter(s => s.exerciseId === exerciseId);
    if (!mine.length) return false;
    this.repo.deleteSet(mine[mine.length - 1].id);
    return true;
  }

  /**
   * Throw away today's workout and start it over. Returns how many sets went.
   *
   * Scoped to the LIVE session on purpose: this clears what you are doing, not
   * what you have done. Yesterday's training, the streak behind it and every
   * goal are untouched, which is the whole difference between this and the
   * erase control on Progress.
   *
   * The session itself is kept open rather than ended — you are starting the
   * workout again, not abandoning it, and ending it would push an empty recap
   * and leave a phantom row behind (see `finish`).
   */
  clearWorkout(): number {
    const mine = this.repo.setsInSession(this.session.id);
    for (const set of mine) this.repo.deleteSet(set.id);
    this.loadPrefill();
    return mine.length;
  }

  /**
   * Remove one specific set from this session.
   *
   * Scoped to the live session on purpose: this screen shows today's work, and
   * reaching back into history from the logging path is how you delete
   * something you cannot see. A set that is not in this session is refused
   * rather than silently ignored.
   */
  removeSet(setId: string): boolean {
    const mine = this.repo.setsInSession(this.session.id);
    if (!mine.some(s => s.id === setId)) return false;
    this.repo.deleteSet(setId);
    return true;
  }

  finish(): Session {
    const sets = this.repo.setsInSession(this.session.id);
    // Nothing to finish, so nothing is ended. The session stays open and gets
    // reused on the next launch instead of leaving an empty ended row behind
    // for every time someone opened the app and did not train.
    if (!sets.length) return this.session;
    const endedAt = sets[sets.length - 1].at;
    this.repo.endSession(this.session.id, endedAt);
    this.session = { ...this.session, endedAt };
    return this.session;
  }

  /**
   * Roll onto a fresh workout if the one this model holds is over.
   *
   * The recap is `router.push`ed on top of Now, so DONE is a `router.back()` and
   * the Now screen underneath was never unmounted — the model came back still
   * pointing at the session it had just ended. That left the user inside a
   * finished workout: TODAY listing the sets they had been congratulated on, a
   * running rest clock, FINISH offered again. And logging from there **wrote
   * into a closed session**, whose `endedAt` was by then earlier than sets
   * inside it, so its duration and any recap quoting it were both wrong.
   *
   * Returning to the logging screen after finishing means the next workout, so
   * that is what this starts. It is called on focus so the screen is clean
   * immediately, and again inside `log()` — a write must never be able to land
   * in an ended session whatever the navigation did.
   *
   * Returns true if a new session was started, so a caller can tell whether
   * anything changed.
   */
  /**
   * Take up a newly chosen unit, if the workout has not started yet.
   *
   * `unitForNewSession` now honours the Settings choice, which fixes the unit
   * for the NEXT session — and leaves the commonest path still broken. Opening
   * the app starts a session immediately; going to Settings, switching to kg,
   * and coming back lands on that same lb session, so the setting appears to do
   * nothing a second time and the lifter logs the whole workout in the unit
   * they just rejected.
   *
   * Safe precisely while the session is EMPTY. A session with sets in it has
   * numbers whose meaning is fixed — 100 logged in pounds is not 100 kilos, and
   * this app never rewrites a weight it was given (see schema.ts). So an
   * untouched session is restarted in the new unit, and a session with a single
   * set in it keeps the unit it was born with until it is finished.
   *
   * Returns true if the session was replaced.
   */
  adoptChosenUnit(): boolean {
    const chosen = this.repo.getPref(PREF_UNIT) as Unit | null;
    if (!chosen || chosen === this.session.unit) return false;
    if (this.repo.setsInSession(this.session.id).length > 0) return false;
    const live = this.repo.session(this.session.id);
    if (!live || live.endedAt != null) return false;

    // End the empty shell rather than leaving it open: two live sessions is a
    // state `liveSession()` cannot describe, and an abandoned empty one would
    // show up in nothing but still hold the "most recent unit".
    this.repo.endSession(this.session.id, this.now());
    this.session = this.begin();
    this.loadPrefill();
    return true;
  }

  /**
   * End a session the §8 idle rule says is over, and start a fresh one.
   *
   * The constructor already does this, so a COLD launch never resumes a
   * workout finished on Tuesday. But a cold launch is the rare path: a phone
   * does not relaunch the app, it wakes it. Lock the screen mid-workout, leave
   * the gym, come back to it two hours later, and iOS restores the process with
   * this model still holding the same live session — so the next set joins a
   * workout that started before lunch, and the recap reports `TIME 137 MIN`.
   * That is precisely the "phone left on a bench" case §8's ninety minutes
   * exist to prevent, arriving by the route nobody checked.
   *
   * Backdated to the last set by `autoEnd`, exactly as the constructor does, so
   * the abandoned workout keeps the duration it actually had.
   *
   * Returns whether anything changed, so the caller can avoid a redraw.
   */
  closeIfStale(): boolean {
    const live = this.repo.session(this.session.id);
    if (!live || live.endedAt != null) return false;
    const sets = this.repo.setsInSession(live.id);
    if (!isStale(live, sets, this.now())) return false;
    const closed = autoEnd(live, sets, this.now());
    this.repo.endSession(closed.id, closed.endedAt!);
    this.session = this.begin();
    this.exerciseId = this.openingExercise();
    this.visited.clear();
    this.visited.add(this.exerciseId);
    this.loadPrefill();
    return true;
  }

  startNextIfFinished(): boolean {
    /*
     * Also covers the session having been ERASED underneath us.
     *
     * `eraseAll` on Progress deletes the row this model is holding, and it used
     * to keep right on pointing at it: the screen showed the weight from a set
     * that no longer existed, and the next log would have failed the foreign
     * key against a session that had been deleted. A session that is gone and
     * one that is finished want the same answer — start a new one.
     */
    const live = this.repo.session(this.session.id);
    if (live && live.endedAt == null) return false;
    this.session = this.begin();
    // A new workout has been nowhere yet, so UP NEXT starts over with it.
    this.visited = new Set();
    this.exerciseId = this.openingExercise();
    this.visited.add(this.exerciseId);
    this.loadPrefill();
    return true;
  }
}

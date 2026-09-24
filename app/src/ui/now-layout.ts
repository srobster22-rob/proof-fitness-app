/**
 * The Now screen's layout arithmetic: the hero's size on a given phone, the column's
 * height, the rail's geometry, and how far to scroll to reveal a block.
 *
 * Moved verbatim out of now-model.ts (R697); the model imports it from here.
 */
import { PHONE_MAX } from './column.ts';

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
 * cleared every single day whole and still refused to be a library.
 *
 * Since R678 a day runs to about twenty movements, so the cap now keeps the
 * twelve the ranking puts first. Every lift the user has trained ranks ahead
 * of every one they have not (see `railOrder`), and the rest are one tap away
 * in the picker.
 */
export const RAIL_MAX = 12;

/** The chip itself. Never scales — a target that shrinks is a target you miss. */
export const RAIL_CHIP = 44;

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

  // A block taller than the viewport cannot be fully shown, so show its TAIL:
  // the latest set, with the UNDO and + a thumb goes to next. Its head is the
  // lift's name, which the screen already shows as its title. Showing the
  // head left a 375x812 phone's first set half under CLEAR / FINISH, its +
  // beyond a thumb (PT1). A block that fits and sits above the fold still
  // aligns to its top.
  const target = block.h >= viewport ? bottom - viewport : top < scrollTop ? top : bottom - viewport;
  const clamped = Math.min(max, Math.max(0, target));
  return clamped === scrollTop ? null : clamped;
}

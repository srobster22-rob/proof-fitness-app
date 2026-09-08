/**
 * The type scale, in one place.
 *
 * The screens drifted. Counted across Now, Goals and Settings there were five
 * sizes doing the job of "small body text" — 12, 12.5, 13, 14 and 15 — and
 * three doing "uppercase section label": 10, 10.5 and 11. None of the
 * differences meant anything; they accumulated one screen at a time, each
 * reasonable on its own, and the result was that the same KIND of text was set
 * differently depending on which screen you were looking at. That is what makes
 * an app feel unfinished even when every individual screen looks fine.
 *
 * Six roles, chosen so each is unmistakably a step from its neighbour rather
 * than a nudge — a scale whose steps are too close reads as a mistake, and a
 * half-point difference is always a mistake.
 *
 * The hero number is deliberately absent: it is solved against the viewport by
 * `layoutFor`, because it is the one piece of type on the logging path whose
 * job is to be as large as the screen allows (§15).
 */
export const TYPE = {
  /** Screen titles: GOALS, PROGRESS, SETTINGS. */
  title: 20,
  /** The lift being trained, and anything else naming the subject of a screen. */
  subject: 22,
  /** The line that leads a screen or a card — the sentence you actually read. */
  lead: 15,
  /** Ordinary body copy: card lines, help text, empty states. */
  body: 14,
  /** Supporting detail: counts, dates, pace, the second line of a card. */
  meta: 12,
  /** Uppercase section labels and chip text. Always with `labelSpacing`. */
  label: 11,
  /** Small uppercase labels above a control. */
  micro: 10
} as const;

/**
 * Letter-spacing for the uppercase roles.
 *
 * Uppercase text set at its natural spacing reads as shouting; opening it up
 * turns it into a label. The two values track the two label sizes so a `micro`
 * label does not end up more widely spaced than a `label` twice its size.
 */
export const SPACING = {
  label: 1.5,
  micro: 2
} as const;

/**
 * Every size the app is allowed to set, so the drift cannot come back.
 *
 * It had reached **28 distinct font sizes**, eight of them half-points — 8.5,
 * 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5. A half-point difference is never a
 * decision anyone made; it is what happens when each screen is nudged on its
 * own. Collapsed to seven text steps and the numerals.
 *
 * The numerals are a separate list because they are a different kind of thing:
 * a weight, a rep count, a target. They are still too many and collapsing them
 * needs the hero's fit maths re-checked, which is a round of its own — but
 * listing them here means a NEW arbitrary size fails the test rather than
 * quietly becoming the twenty-ninth.
 */
export const TEXT_SCALE = [10, 11, 12, 14, 15, 20, 22] as const;

/** Weights, rep counts, targets, steppers, and the hero's unit. */
export const NUMERAL_SCALE = [16, 18, 24, 26, 30, 34, 38, 40, 42, 62] as const;

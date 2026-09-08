/**
 * The size a thing you tap has to be.
 *
 * Its own module, and pure, because the rule is worth a test and `press.ts`
 * imports react-native — which does not load under `node --test`, so anything
 * living there can only ever be checked by reading the source as a string.
 */

/** §4's minimum, duplicated from `HIT` in now-model to avoid a cycle. */
export const TARGET = 56;

/**
 * Touch slop that brings a short control up to the app's own minimum.
 *
 * §4 asks for 56px targets — "for a sweaty thumb, one-handed" — which is
 * stricter than Apple's 44 and is the number `HIT` has encoded since R8. An
 * audit of the running app found that the LAYOUT honours it and the individual
 * controls mostly do not: measured on a 390px screen, the ±45 and ±5 jump
 * buttons are 40x40 with no slop at all, the logged-set chips and UNDO are 36
 * tall, the add-a-set + is 34, and CLEAR and **FINISH** — the control that ends
 * a workout — are 40. Nine distinct controls under the app's own rule.
 *
 * Slop is the right instrument because it costs no layout: the boxes stay
 * exactly where they were drawn and only the touchable region grows.
 *
 * Vertical and horizontal are computed separately, and that is the whole point.
 * Every one of these is height-limited with room to spare on its own row, but
 * some sit in tight pairs — UNDO and + are 6px apart, CLEAR and FINISH 12 —
 * and slop that overlaps a neighbour does not make a target bigger, it makes
 * two targets ambiguous and hands the tap to whichever the responder resolves
 * first. So horizontal slop is capped at half the real gap, and where that is
 * not enough to reach 56 the honest answer is that it cannot be: the fix there
 * would be a wider button, not a wider guess.
 *
 * @param height the control's drawn height
 * @param gapX   pixels to the nearest horizontal neighbour, 0 when alone
 */
export function slop(height: number, gapX = 0): {
  top: number; bottom: number; left: number; right: number;
} {
  const v = Math.max(0, Math.ceil((TARGET - height) / 2));
  // Leave 2px of no-man's-land between neighbours rather than butting the two
  // touchable regions up against each other.
  const h = gapX > 0 ? Math.max(0, Math.floor((gapX - 2) / 2)) : v;
  return { top: v, bottom: v, left: h, right: h };
}


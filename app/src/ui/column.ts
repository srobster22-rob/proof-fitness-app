/**
 * The column every screen is drawn in.
 *
 * PROOF is an iOS-first app, so every screen was laid out against a phone and
 * only the Now screen was ever told so — `layoutFor` capped its content and the
 * other three surfaces did not, because the cap lived as a private constant
 * inside `now-model.ts` where nothing else could reach it.
 *
 * Measured in a 1024px-wide window: Now drew a tidy 335px column in the middle
 * while Progress put its title in the far top-left and DONE in the far
 * top-right, Goals set a line of body text 976px wide, and every modal sheet
 * stretched the full 984px across a screen whose content sat in a phone column
 * behind it. Nothing was clipped and nothing overflowed — it simply did not
 * look like one app, which is what "it doesn't fit the screen" means.
 *
 * So the cap lives here, in one place, and everything imports it: the four
 * screens, and every sheet that opens over them.
 */

/**
 * Wider than any iPhone in circulation (the Pro Max is 430pt), so on a real
 * device this never binds and the layout is exactly what it always was. It only
 * does anything on a window bigger than a phone, which is the case it exists
 * for.
 */
export const PHONE_MAX = 430;

/**
 * What a full-bleed container needs to become that column.
 *
 * `width: '100%'` with `maxWidth` rather than a fixed width, so a 320px phone
 * still gets all 320: the cap is a ceiling, never a floor. `alignSelf` centres
 * it once it stops filling its parent.
 */
export const COLUMN = {
  width: '100%' as const,
  maxWidth: PHONE_MAX,
  alignSelf: 'center' as const
};

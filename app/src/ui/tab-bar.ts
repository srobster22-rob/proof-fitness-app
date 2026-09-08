/**
 * The bottom tab bar, as an EXPERIMENT the owner has not chosen yet.
 *
 * OWNER.md, 2026-09-08: "the bottom tab bar — BUILD BOTH and show me... Do not
 * ship either as the default until I have chosen." So this is a flag, it is
 * off, and the app a lifter opens is unchanged.
 *
 * The question is not whether a tab bar looks more like a fitness app. It does;
 * every well-known one has it. The question is what it COSTS, because R512
 * measured the shortest shipping phone at 624px of unshrinkable content against
 * 568px of screen — the column is already 56px over before anything is added,
 * and R511 pushed LOG SET below the fold with eight pixels of padding.
 *
 * So the variant is built to be measured, not admired: it removes the top link
 * row it replaces and adds the bar, and the arithmetic of that trade is what
 * the owner asked to see.
 */
export const PREF_TAB_BAR = 'pref.tabBar';

/**
 * Height of the bar itself, excluding the safe-area inset a device adds under
 * it. 56 is the smallest that still gives each destination a 44pt target with
 * a label under the glyph; below that the label goes and it stops being a tab
 * bar and becomes a row of icons.
 */
export const TAB_BAR_HEIGHT = 56;

/** Off unless explicitly turned on. Neither variant is the default yet. */
export function tabBarOn(repo: { getPref(key: string): string | null }): boolean {
  return repo.getPref(PREF_TAB_BAR) === '1';
}

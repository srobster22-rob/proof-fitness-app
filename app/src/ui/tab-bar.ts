/**
 * The bottom tab bar. Shipped R640 on the owner's word (2026-09-10: "ship the
 * tab bar, move the streak to the exercise line"). It replaced the
 * PROGRESS / GOALS / gear row at the top of Now, and the streak that rode in
 * that row now sits beside the lift's name.
 */

/**
 * Height of the bar itself, excluding the safe-area inset a device adds under
 * it. 56 is the smallest that still gives each destination a 44pt target with
 * a label under the glyph; below that the label goes and it stops being a tab
 * bar and becomes a row of icons.
 */
export const TAB_BAR_HEIGHT = 56;

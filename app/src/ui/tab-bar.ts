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

export type Tab = 'now' | 'progress' | 'goals' | 'settings';

/** Route for each tab. NOW is the root; the others are its siblings. */
export const TAB_ROUTE: Record<Tab, string> = {
  now: '/', progress: '/progress', goals: '/goals', settings: '/settings'
};

/**
 * Where a tab tap goes. Pure, so it can be tested without a renderer.
 *
 * NOW pops back to the root Now when there is one underneath: `replace('/')`
 * swapped the top of the stack for a second Now, and every trip through
 * another tab left one more live Now screen below (R646, measured 1 -> 2 -> 3).
 * But the app can be opened straight onto another tab -- a refresh, a deep
 * link -- and then nothing is underneath and popping to the top does nothing
 * (R648, measured: still on /progress after tapping NOW). So pop when it can,
 * replace when it cannot.
 *
 * The other three are siblings one deep, so `replace` keeps the stack short.
 */
export function goTab(
  router: { canGoBack: () => boolean; dismissAll: () => void; replace: (h: never) => void },
  tab: Tab
): void {
  if (tab === 'now' && router.canGoBack()) router.dismissAll();
  else router.replace(TAB_ROUTE[tab] as never);
}

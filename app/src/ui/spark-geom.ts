/**
 * The sparkline's geometry, in a module with no `react-native` import.
 *
 * Same split, and the same reason, as `press-style.ts`: react-native's entry
 * point is Flow syntax Node cannot parse, so anything importing it is
 * unreachable from `node --test`. `Spark.tsx` has to import `View`; these
 * numbers do not, and the row-fits arithmetic in
 * `test/progress-row-fits.test.ts` needs to READ them.
 *
 * That test used to regex them out of `progress.tsx`'s StyleSheet, which is
 * what a source-reading test does when the value it wants is trapped behind a
 * component import. It is also what made the numbers look like they belonged
 * to Progress, and part of why a second copy of the sparkline could drift for
 * so long without anything noticing (R475). Now there is one definition, both
 * screens render from it, and the budget test does arithmetic on the real
 * values instead of on a regex's opinion of them.
 */

/*
 * Grow-and-cap, so all ten bars stay on screen at every width. At 390pt the
 * bars sit at their full 14; at 320pt they compress to about 8 rather than the
 * row shoving a number off the screen. `MIN_BAR` stops a compressed bar from
 * vanishing into a hairline — and it is a real floor, so flexbox refuses to
 * shrink the sparkline past what its bars actually need rather than letting
 * them silently overlap the goal tag.
 */
export const MIN_BAR = 5;
export const MAX_BAR = 14;
export const GAP = 4;

/** The height of the tallest bar, plus the baseline it is read against. */
export const HEIGHT = 33;

/** What `n` bars need before anything in the row has to give. */
export const sparkFloor = (n: number) => n * MIN_BAR + Math.max(0, n - 1) * GAP;

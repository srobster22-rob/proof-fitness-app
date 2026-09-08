import * as Haptics from 'expo-haptics';

/**
 * What the app feels like, named by what happened rather than how hard it buzzes.
 *
 * Haptics existed on exactly one screen. The logging path buzzed on every
 * meaningful action — twelve calls — and Goals, Progress and Settings had
 * **none**, so you could wipe all thirty-one of your targets and feel nothing
 * while stepping a rep count by one buzzed. The app's sense of touch stopped at
 * the edge of one file.
 *
 * Four verbs, because there are four kinds of moment worth feeling and naming
 * them by intent is what stops the next screen picking an intensity at random:
 *
 * - `chose` — a selection landed: a chip, a filter, a toggle. The lightest tick
 *   the platform has.
 * - `did` — something was created or committed: a set logged, a goal set.
 * - `undid` — a reversal. Deliberately the same weight as `did`, because undo
 *   is not a smaller action than the thing it undoes.
 * - `destroyed` — something is gone: a set removed, goals wiped, data erased.
 *   The heaviest, and the only one that should ever make you pause.
 *
 * Every call is swallowed. A phone that cannot buzz — or a browser, where
 * expo-haptics is a no-op that can still reject — is not a reason to lose a
 * set, and this is called from the middle of write paths.
 */
function safely(fn: () => Promise<unknown>): void {
  try {
    void fn()?.catch?.(() => {});
  } catch {
    /* a phone that cannot buzz is not a reason to lose a set */
  }
}

export const buzz = {
  chose: () => safely(() => Haptics.selectionAsync()),
  did: () => safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  undid: () => safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  destroyed: () => safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy))
};

/** The raw escape hatch, for the Now screen's existing calls. */
export { safely as feedback };

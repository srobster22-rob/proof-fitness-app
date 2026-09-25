/**
 * What the Now screen's components share: their strings, colours and measures, and the
 * haptic a logged set plays.
 *
 * Moved verbatim out of NowScreen.tsx (R698).
 */
import { t, languageOf } from '../domain/i18n.ts';
import { getRepo } from '../data/db.ts';

/**
 * Every visible string on this screen, in the chosen language.
 *
 * Module scope, like the other screens. It was bound inside the component from
 * `state.lang` at first, which is tidier and reaches only half the file: the
 * edit sheet, the equipment sheet and the day chooser are separate components,
 * and every string in them stayed English. A sweep of every rendered `<Text>`
 * found twenty of those across four files — the reason this is a module
 * constant is that a `T` prop is something a new sub-component can forget.
 *
 * `state.lang` still exists and is still what the MODEL uses to assemble the
 * strings it owns; this is only for the ones the screen writes itself.
 */
export const T = (k: Parameters<typeof t>[1]) => t(languageOf(getRepo()), k);

/**
 * How far a drag has to travel before it is a swipe and not a slipped tap.
 *
 * 48pt, twice the platform tap slop, because this control has no undo of its
 * own: an accidental swipe moves the lift under a lifter who is mid-set, and
 * getting back costs a trip to the rail.
 */
export const SWIPE_MIN = 48;

/**
 * Screen 1 — Now. PROMPT.md §5.
 *
 * Deliberately thin: every rule with teeth lives in NowModel, which is tested
 * without a simulator. This file only renders and forwards taps, so a change in
 * behaviour is a change in a tested file rather than in a component nobody can
 * run on CI.
 *
 * The number is the hero. No nav chrome, no cards inside cards, no keyboard.
 */

export const VOLT = '#CCFF00';
export const BG = '#08090A';

/*
 * The rail's right-edge fade, left to right. Five steps is enough to read as a
 * fade at this width; fewer banded visibly when tried at three.
 */
export const RAIL_FADE = [0.12, 0.3, 0.55, 0.8, 1];
export const MUTED = '#7C8792';
/** The line under the lift name: one row, 20px, as measured on the running app (R684). */
export const LAST_TIME_LINE = 20;

/**
 * Fire-and-forget feedback that can never break a write.
 *
 * §8b states the rule for the Live Activity — "every write goes to the database
 * first and the presentation second" — and it applies to haptics for the same
 * reason. `impactAsync` is unsupported on some platforms and can throw
 * synchronously OR reject; either one, called before the write, silently costs
 * the user their set. So: swallow both, and never call this before `model.log()`.
 */
/** Namespaced so releasing ours never cancels somebody else's hold. */
export const KEEP_AWAKE_TAG = 'proof-workout';

export function feedback(fn: () => Promise<unknown>): void {
  try {
    void fn()?.catch?.(() => {});
  } catch {
    /* a phone that cannot buzz is not a reason to lose a set */
  }
}

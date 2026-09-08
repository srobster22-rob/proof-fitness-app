import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, View, type ModalProps, type ViewStyle } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useReducedMotion } from './press.ts';

/**
 * A `Modal` that leaves with the screen that opened it, and arrives like it
 * came from somewhere.
 *
 * React Native's Modal is not a child of the tree that renders it. On
 * react-native-web it is mounted through `createPortal` into a div appended to
 * `document.body`; on iOS it is a separate native window presented over the
 * app. Either way it sits OUTSIDE the view the navigator hides when you move to
 * another screen — and the navigator's only mechanism for hiding a screen is to
 * hide that view.
 *
 * So a modal outlives its screen. Measured on the running app: open the day
 * chooser on the logging screen, tap PROGRESS, and the chooser is still there —
 * painted over Progress, with `elementFromPoint` returning its PULL chip at
 * y700, so the day of a workout could be changed from a screen that has nothing
 * to do with workouts. Every sheet in this app had the same hole: the picker,
 * the equipment sheet, settings, the goal form, and both confirmations.
 *
 * The fix has to be structural rather than a guard added to each sheet, because
 * the bug is a property of Modal itself and the next sheet anyone writes would
 * have it too. This unmounts on blur and remounts on focus, which is also the
 * behaviour the sheets already want: everything in this app renders its modals
 * conditionally rather than toggling `visible`, precisely so reopening never
 * shows last time's half-typed state.
 *
 * `useFocusEffect` rather than `useIsFocused` so nothing new is imported —
 * §12, and the logging screen already pulls it from expo-router.
 *
 * ## The entrance, and why it is not `Animated`
 *
 * Every sheet passes `animationType="none"`, for a good reason: react-native-web's
 * built-in "slide" is a keyframe with `animation-fill-mode: none`, so the sheet
 * REVERTS to `translateY(100%)` when the animation ends and parks one full
 * viewport below the screen. Turning it off was right and left the wrong
 * result — measured one frame after the tap, the equipment sheet was already at
 * its final position, full opacity, no transform. Every sheet teleported.
 *
 * The obvious fix is `Animated`, and it was written that way first. It is
 * wrong, and the reason is worth keeping: **`Animated` is driven by
 * `requestAnimationFrame`, which does not fire while the page is hidden.**
 * Measured: 0 rAF frames in 500ms with `document.hidden === true`, and the
 * wrapper sat at its start value — `opacity: 0, translateY(12)` — indefinitely.
 * The sheet was not slow, it was INVISIBLE, and it would be invisible for any
 * user whose frames stall at the wrong moment. An entrance animation must never
 * be the thing that decides whether the content can be seen.
 *
 * So the resting style is the VISIBLE one, and the entrance is a transient
 * "entering" state removed on a `setTimeout` — which fires whether or not the
 * page is compositing. Worst case, on a platform that ignores CSS transitions
 * or a tab that never gets a frame, the sheet simply appears. That is exactly
 * what it did before this file changed, so the failure mode of the animation is
 * the old behaviour rather than a blank screen.
 *
 * The transition properties are react-native-web's; React Native ignores them,
 * so **native currently gets the instant appear it always had**. Giving native
 * the same entrance needs `Animated` and a device to verify it on — a round of
 * its own, and one that cannot be checked from here.
 *
 * ## The exit, and why most callers still don't have one
 *
 * A Modal unmounts the instant its caller stops rendering it — there is no
 * "about to close" moment for CSS to animate through unless the CALLER keeps
 * rendering it a little longer. `exiting` is that hook: pass it true and this
 * component holds the entrance's hidden style (rather than reversing INTO it,
 * since the resting style is already the visible one and there is nothing to
 * transition FROM if the sheet is fading out from full opacity — the two
 * states are the same shape, entering and exiting, which is why one `entering
 * || exiting` check covers both). The caller is still the one that has to
 * keep the component mounted for `EXIT_MS` after the user's tap and only then
 * flip its own state to actually remove it — see `ConfirmSheet` for the
 * pattern. Every other sheet in the app still unmounts instantly; wiring this
 * up everywhere would mean six more call sites doing the same delayed-unmount
 * dance, and it is not free of risk — see the entrance's own history above.
 */

type Web = ViewStyle & {
  transitionProperty?: string;
  transitionDuration?: string;
  transitionTimingFunction?: string;
};

/** 220ms is the top of the taste range for a transition; a sheet earns it. */
const RISE = 12;

/**
 * How long a caller doing its own exit animation (see `exiting` above) must
 * keep this mounted after the user's tap, in milliseconds. Exported so that
 * number lives in exactly one place — a caller's own `setTimeout` drifting
 * from this component's actual transition duration would either cut the
 * animation off mid-flight or leave a dead sheet sitting at zero opacity.
 */
export function exitMs(reducedMotion: boolean): number {
  return reducedMotion ? 110 : 220;
}

/**
 * The "defer the real action until the exit animation lands" pattern every
 * sheet in this app needs — was `const [closing, setClosing] = useState(...);
 * const leave = (fire) => { if (closing) return; setClosing(true); timer.current
 * = setTimeout(fire, exitMs(...)); }`, copy-pasted identically into FOUR
 * places in NowScreen.tsx alone (the day-ask sheet, the set-edit sheet, the
 * exercise picker, the equipment picker) plus ConfirmSheet's own original
 * version of the same code.
 *
 * `closing` read as `useState` is a snapshot from the last render — two real
 * pointerdown/mousedown/pointerup/mouseup/click sequences dispatched at the
 * same screen coordinates, with no gap between them, land on the same
 * pre-render DOM node, so both calls to `leave` read the same stale
 * `closing === null` and both pass the guard (R386, found in ConfirmSheet;
 * R388 found the identical bug in all four of NowScreen's own copies). A
 * `useRef`, checked and set synchronously outside any render, is the thing
 * actually fast enough — and clearing any existing timer before scheduling a
 * new one closes the second half of the same bug: the old code reassigned
 * `timer.current` without cancelling what was already pending, so a guard
 * that let a second call through left an orphaned timer that could still
 * fire later, on whatever was on screen by then.
 *
 * One shared hook instead of five copies means the fix landed once, and the
 * next sheet gets it by construction rather than by remembering to paste it
 * correctly again.
 */
export function useExitOnce(reducedMotion: boolean) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Returns whether this call actually started closing, so a caller with its
  // own synchronous work to do first (NowScreen's exercise picker clears its
  // typed name immediately, not deferred to the exit timer) can gate that
  // work on the same guard rather than duplicating the check.
  const leave = useCallback((fire: () => void): boolean => {
    if (closingRef.current) return false;
    closingRef.current = true;
    setClosing(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(fire, exitMs(reducedMotion));
    return true;
  }, [reducedMotion]);

  return { closing, leave };
}

export function ScreenModal(props: ModalProps & { exiting?: boolean }) {
  // Starts true: a sheet only ever renders because its screen just rendered it,
  // and focus effects do not run until after the first commit. Starting false
  // would blank every sheet for a frame on the way up.
  const [focused, setFocused] = useState(true);
  const [entering, setEntering] = useState(true);
  const still = useReducedMotion();
  const { exiting, ...modalProps } = props;

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );

  useEffect(() => {
    // `setTimeout`, not `requestAnimationFrame` — see the note above. A hidden
    // tab still runs timers, so the sheet always reaches its resting state.
    const id = setTimeout(() => setEntering(false), 0);
    return () => clearTimeout(id);
  }, []);

  if (!focused) return null;

  const style: Web = {
    flex: 1,
    transitionProperty: 'opacity, transform',
    transitionDuration: `${exitMs(still)}ms`,
    transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
    ...(entering || exiting
      // Reduced motion loses the rise and keeps the fade: a sheet appearing out
      // of nowhere (or vanishing into one) is the thing being fixed.
      ? { opacity: 0, ...(still ? null : { transform: [{ translateY: RISE }] }) }
      : { opacity: 1 })
  };

  return (
    <Modal {...modalProps}>
      {/* `flex: 1` so the backdrop underneath still fills the screen. The whole
          overlay rises, which keeps this agnostic about which child a given
          caller considers "the sheet". */}
      <View style={style as ViewStyle}>{modalProps.children}</View>
    </Modal>
  );
}

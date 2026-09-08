import React, { useEffect, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from './press.ts';

/**
 * Something that has just appeared, appearing.
 *
 * Logging a set is the action this whole app exists for, and its only on-screen
 * consequence — the chip landing in TODAY — happened between two frames with no
 * transition at all. The set you just did looked exactly like the four before
 * it, so the moment of it arriving was the one moment the interface said
 * nothing.
 *
 * Built the same way `ScreenModal`'s entrance is, and for the same hard-won
 * reason: **the resting style is the visible one.** `Animated` is driven by
 * `requestAnimationFrame`, which does not fire while the page is hidden —
 * measured at 0 frames in 500ms — so an entrance built on it can strand its
 * content invisible. Here the "arriving" style is a transient state cleared on
 * a `setTimeout`, which fires regardless. If the transition never runs, the
 * child is simply there.
 *
 * Only NEW children animate. `arrived` is keyed on the child's identity by the
 * caller through `key`, so React mounts a fresh instance for a fresh set and
 * reuses the existing ones — the four chips already on screen do not re-enter
 * every time a fifth is added, which would turn one arrival into a flock.
 */

type Web = ViewStyle & {
  transitionProperty?: string;
  transitionDuration?: string;
  transitionTimingFunction?: string;
};

/** Short: this is a confirmation, not a performance. */
const MS = 160;
const RISE = 6;

export function Arrive({ style, children }: {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const [arriving, setArriving] = useState(true);
  const still = useReducedMotion();

  useEffect(() => {
    const id = setTimeout(() => setArriving(false), 0);
    return () => clearTimeout(id);
  }, []);

  const motion: Web = {
    transitionProperty: 'opacity, transform',
    transitionDuration: `${still ? 90 : MS}ms`,
    // Ease-out: the arrival lands immediately and settles, rather than creeping
    // in and snapping.
    transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
    ...(arriving
      ? { opacity: 0, ...(still ? null : { transform: [{ translateY: RISE }] }) }
      : { opacity: 1 })
  };

  return <View style={[style, motion as ViewStyle]}>{children}</View>;
}

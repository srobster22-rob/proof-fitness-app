import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * The `react-native`-dependent half of press feedback.
 *
 * Everything that does not need `AccessibilityInfo` lives in `press-style.ts`
 * — pure style computation, testable under `node --test` — because importing
 * `react-native` at all, even for a type, crashes that test run: its own
 * entry point is Flow syntax Node cannot parse. This file re-exports that
 * module so every existing `from './press.ts'` call site is unchanged.
 */
export {
  slop, TARGET, SELECTED, SELECTED_TEXT, onState, PRESS_IN, PRESS_OUT,
  pressStyle, dangerPressStyle,
  type PressKind, type PressState
} from './press-style.ts';

/**
 * Whether the system has asked for less motion.
 *
 * `AccessibilityInfo` is the cross-platform answer and react-native-web wires
 * it to the `prefers-reduced-motion` media query, so one call covers both. It
 * is read once and subscribed to, because the setting can change while the app
 * is open and a stale answer is the one case where honouring it looks broken.
 */
export function useReducedMotion(): boolean {
  const [still, setStill] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then(v => { if (alive) setStill(!!v); })
      .catch(() => { /* platform cannot say; assume motion is fine */ });
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', v => setStill(!!v));
    return () => { alive = false; sub?.remove?.(); };
  }, []);
  return still;
}


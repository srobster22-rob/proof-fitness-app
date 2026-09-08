/**
 * The pure half of `press.ts` — style computation with no `react-native`
 * import.
 *
 * Split out (R272) because `press.ts` importing `react-native` for
 * `AccessibilityInfo` made every export in the file untestable under
 * `node --test`: react-native's own entry point is Flow syntax
 * (`import typeof * as … from './index.js.flow'`), which Node's type-stripping
 * cannot parse, so loading ANYTHING from `press.ts` — even a pure function
 * that never touches `AccessibilityInfo` — crashed the whole test file at
 * import time. `press.ts` re-exports everything here, so no call site changes.
 *
 * Style values are typed loosely (`AnyStyle`) rather than as `StyleProp<ViewStyle>`,
 * for the same reason: importing that TYPE from 'react-native' is enough to
 * trigger the same crash, even though types are erased at runtime. React
 * Native accepts a wide range of style shapes, so the looser type costs
 * nothing real — the call sites still hold the precise RN types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStyle = any;

/** Re-exported so a screen imports one module for its interaction concerns. */
export { slop, TARGET } from './target.ts';

/**
 * What a control does while your finger is on it.
 *
 * The app had 158 `Pressable`s and four of them acknowledged a press. LOG SET —
 * the one control this whole product exists to serve — was measured mid-press
 * and every computed property was identical to its resting state: same
 * background, same opacity, no transform. You tap the most important button in
 * the app and nothing happens until the state changes a beat later, which on a
 * slow frame reads as a missed tap and gets tapped again.
 *
 * Three kinds, because there are three kinds of control here and giving them
 * all the same response would flatten the hierarchy §15 spends its one accent
 * establishing:
 *
 * - `primary` — the filled volt buttons. They take a real dip: a scale down
 *   plus a darker fill, because they are the thing you came to press.
 * - `surface` — chips, steppers, cards, anything with a border and a dark
 *   fill. The fill lifts. No scale: a row of chips that individually shrink
 *   looks like it is being poked rather than used.
 * - `quiet` — text-only controls: nav links, UNDO, WIPE, CHANGE. Opacity only.
 *   A background appearing under a word that never had one reads as a bug.
 *
 * Timing is a web-only detail and deliberately so. `transitionDuration` is a
 * react-native-web style prop with no React Native counterpart, so the cast
 * below is the honest way to say "this is for the browser": native gets the
 * same states, applied instantly, which is what a native press already feels
 * like because the platform is doing its own rasterisation.
 */

/** ~120ms in, faster out. A press should feel answered, not animated. */
const IN = 120, OUT = 90;

type Web = Record<string, unknown> & {
  transitionDuration?: string;
  transitionProperty?: string;
  transitionTimingFunction?: string;
  outlineStyle?: string;
  outlineWidth?: number;
  outlineColor?: string;
  outlineOffset?: number;
};

/**
 * Where the keyboard is.
 *
 * Measured: every one of the 35 controls on the logging screen is tabbable, and
 * **not one of them showed focus** — `outline: none`, no box-shadow, and zero
 * `:focus` rules in the whole stylesheet. react-native-web resets the browser's
 * outline on every Pressable and nothing put one back, so a keyboard user could
 * tab through the entire app with no idea what they were about to press.
 *
 * The accent earns its place here more than anywhere: "where am I" is exactly
 * the question one loud colour should answer. Offset by 2 so it reads as a ring
 * around the control rather than a change to the control.
 *
 * `outline*` are react-native-web style props with no React Native counterpart.
 * Native ignores them, which is right — there is no focus ring to draw on a
 * touchscreen.
 */
const FOCUS: Web = {
  outlineStyle: 'solid',
  outlineWidth: 2,
  outlineColor: '#CCFF00',
  outlineOffset: 2
};

/**
 * The accent, and the one rule that keeps it worth having.
 *
 * §15 asks for ONE volt accent on near-black, and by R137 it had thirty-odd
 * distinct jobs: press this, you are here, do this next, you did it, this is
 * selected, the keyboard is here. All of them true, and between them they meant
 * the colour had stopped saying anything — a screen with six volt things on it
 * has no accent, it has a palette.
 *
 * So the accent is split by WEIGHT rather than by hue, and the rule is:
 *
 *     A FILLED volt block is an action. There is at most one per screen.
 *     Everything else that deserves the accent gets it as light on dark.
 *
 * The rule is about CONTROLS. A goal's progress bar is a 6px hairline of volt
 * and stays that way: it is not something you press, it is the thing the screen
 * is about, and at that weight it reads as data rather than as a button.
 *
 * The recap forced the general form of it. A personal record deserves the fill
 * — it is the most important thing on the card and dimming it to satisfy a rule
 * about chips would be the rule running the product — but it was drawn as the
 * same rounded rectangle as SHARE, directly above SHARE, and bigger. So the
 * distinction is geometry:
 *
 *     SHAPE carries pressability. COLOUR carries importance.
 *
 * The record is a full-bleed square-cornered band; the button is an inset
 * rounded block. That is also why a checkbox may fill: it is shaped like a
 * checkbox, and nothing else in the app is.
 *
 * `SELECTED` is that second treatment: the volt kept as the border and the
 * text, over a ground tinted far enough toward it to read as lit rather than
 * merely outlined. The Now screen's lift rail already used exactly this for
 * "the lift you are on", which is what made the collision visible — the same
 * app was drawing "this is on" two completely different ways, and the louder of
 * the two was the one it also used for "press me".
 */
export const SELECTED = { backgroundColor: '#1A1F0A', borderColor: '#CCFF00' } as const;
/** The label inside a `SELECTED` control. Replaces black-on-volt. */
export const SELECTED_TEXT = { color: '#CCFF00' } as const;

/**
 * What `SELECTED` looks like to somebody who cannot see it.
 *
 * `SELECTED` is a colour swap, and colour is exactly what this audience does
 * not get — so a chip painted volt and a chip painted nothing were the same
 * control to a screen reader. Measured in the running app (R474): the Settings
 * chips for split, units and language all reported `aria-selected`,
 * `aria-checked` and `aria-pressed` as null while the chosen one of each three
 * was visibly lit, so the one screen whose whole job is showing current
 * settings could not say what any of them were.
 *
 * Two attributes, because no single one covers both platforms, and this is the
 * one place that has to know it:
 *
 *   - `aria-selected` is what React Native maps to the iOS "selected" trait
 *     (`View.js`: `selected: ariaSelected ?? accessibilityState?.selected`).
 *     It is NOT valid ARIA on `role="button"`, so the web ignores it.
 *   - `aria-pressed` is the valid web answer for a toggle button, and React
 *     Native maps nothing from it — it is inert on iOS.
 *
 * Each is dead weight on the platform that ignores it and correct on the one
 * that does not. Do NOT reach for `accessibilityState`: react-native-web 0.21
 * dropped it from the forwarded props entirely, which is why the three places
 * that used it announced nothing on web while looking perfectly correct in the
 * source.
 */
export const onState = (on: boolean) =>
  ({ 'aria-selected': on, 'aria-pressed': on }) as const;

const eased = (ms: number, ease: string): Web => ({
  transitionProperty: 'transform, opacity, background-color, border-color',
  transitionDuration: `${ms}ms`,
  transitionTimingFunction: ease
});

/**
 * Ease-OUT going in, ease-IN coming out.
 *
 * The press has to land immediately — most of the movement in the first few
 * milliseconds — and the release can trail. Reversed, the button feels like it
 * is resisting the finger.
 */
export const PRESS_IN = eased(IN, 'cubic-bezier(0.16, 1, 0.3, 1)');
export const PRESS_OUT = eased(OUT, 'cubic-bezier(0.4, 0, 1, 1)');

export type PressKind = 'primary' | 'surface' | 'quiet';

const HELD: Record<PressKind, Web> = {
  // Scale only, plus a fill one step down the volt. Never a layout property:
  // anything that re-lays-out stutters, and this is on the logging path.
  primary: { transform: [{ scale: 0.97 }], backgroundColor: '#B2DE00' },
  surface: { backgroundColor: '#161C22', borderColor: '#2E3841' },
  quiet: { opacity: 0.5 }
};

/** The same, with the movement taken out — see `useReducedMotion`. */
const HELD_STILL: Record<PressKind, Web> = {
  primary: { backgroundColor: '#B2DE00' },
  surface: HELD.surface,
  quiet: HELD.quiet
};

/**
 * React Native's own callback type only declares `pressed`; react-native-web
 * also passes `focused` and `hovered`. Widened here rather than cast at every
 * call site.
 */
export type PressState = { pressed: boolean; focused?: boolean; hovered?: boolean };

/**
 * A `Pressable` style function that responds to being held.
 *
 *   <Pressable style={pressStyle(s.logButton, 'primary')} …>
 *
 * `still` drops the transform for anyone who has asked the system for less
 * motion. The colour change stays: reduced motion means less MOVEMENT, not
 * less feedback, and taking the acknowledgement away would leave exactly the
 * users who most need it with the silent button this fixes.
 */
export function pressStyle(
  base: AnyStyle,
  kind: PressKind = 'surface',
  still = false
): (state: PressState) => AnyStyle {
  const held = (still ? HELD_STILL : HELD)[kind];
  return ({ pressed, focused }) => [
    base,
    pressed ? PRESS_IN : PRESS_OUT,
    pressed ? held : null,
    focused ? FOCUS : null
  ];
}

/**
 * `primary`'s press pattern — scale down, deepen the fill — applied to a
 * caller-supplied colour instead of volt.
 *
 * `HELD.surface` is a fixed neutral grey, which is right for a bordered button
 * that has no colour of its own to lose. It is wrong for `ConfirmSheet`'s
 * destructive CONFIRM button: that control is red on purpose (§ ConfirmSheet
 * — "the destructive button is styled as the exception"), and pressing it
 * going flat grey would wipe the one signal the button exists to carry, on
 * the one tap in the app most worth feeling answered.
 */
export function dangerPressStyle(
  base: AnyStyle, heldColor: string, still = false
): (state: PressState) => AnyStyle {
  const held: Web = still
    ? { backgroundColor: heldColor }
    : { transform: [{ scale: 0.97 }], backgroundColor: heldColor };
  return ({ pressed, focused }) => [
    base,
    pressed ? PRESS_IN : PRESS_OUT,
    pressed ? held : null,
    focused ? FOCUS : null
  ];
}

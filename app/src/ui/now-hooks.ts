/**
 * What the Now screen does that is not drawing. `NowScreen` calls each of
 * these once, in the order they stand in this file, which is the order their
 * effects have always run in.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, PanResponder, AppState } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import * as KeepAwake from 'expo-keep-awake';
import type { NowModel } from './now-model.ts';
import type { NowState } from './now-state.ts';
import { revealOffset, type NowLayout } from './now-layout.ts';
import { typedWeight } from './now-steppers.ts';
import { KEEP_AWAKE_TAG, SWIPE_MIN, feedback } from './now-kit.ts';
import { s } from './now-styles.ts';

/** The phone stays lit while a workout is on. */
export function useAwakeWhileWorking(state: NowState): void {
  /*
   * The screen stays lit while a workout is on.
   *
   * §4's whole claim is that this is the fastest way to record a set, and the
   * phone locking during a 3-minute rest undoes it on every set after the
   * first: you come back to a lock screen, unlock, and only then are you where
   * you already were. It costs one API call and the dependency was already in
   * package.json, unused.
   *
   * Gated on `canFinish` — a session with at least one set logged — rather than
   * on the screen being mounted. `useKeepAwake()` would hold the lock any time
   * the app is open, including while it sits on the logging screen untouched,
   * which is a battery cost for nothing. It releases on FINISH, on leaving the
   * screen, and on unmount.
   */
  const working = state.canFinish;
  useEffect(() => {
    if (!working) return;
    feedback(() => KeepAwake.activateKeepAwakeAsync(KEEP_AWAKE_TAG));
    return () => { feedback(() => KeepAwake.deactivateKeepAwake(KEEP_AWAKE_TAG)); };
  }, [working]);
}

/** A left swipe across the logging area moves to the next lift. */
export function useSwipeToNext(model: NowModel, sync: () => void) {
  /*
   * §5's swipe to the next exercise, and the last thing standing between the app
   * and §4's zero-tap claim for moving on.
   *
   * On the ROOT rather than on the hero, because responder negotiation already
   * sorts out who should get it: the vertical ScrollView below claims anything
   * vertical, the rail claims anything horizontal that starts on the rail, and
   * what reaches here is a horizontal drag across the logging area. The
   * predicate insists on that — twice as horizontal as it is vertical, and past
   * a real distance — so a slightly-slanted scroll is never read as a swipe.
   *
   * Left only. There is no `prev()`, and a right-swipe that silently did nothing
   * would be worse than one that was never offered; the rail is the way back,
   * and it is also the accessible path, since a gesture is not one.
   *
   * `model.next()` returns false when the rail has nothing left to point at. No
   * haptic then: §8's cry-wolf rule is about not signalling an event that did
   * not happen, and a confirmation buzz for a swipe that moved nothing is
   * exactly that.
   */
  const swipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) =>
      g.dx < -SWIPE_MIN && Math.abs(g.dx) > Math.abs(g.dy) * 2,
    onPanResponderRelease: () => {
      if (!model.next()) return;
      sync();
      feedback(() => Haptics.selectionAsync());
    }
  }), [model, sync]);
  return swipe;
}

/** TODAY's list keeps the lift being trained in view; `TodaySets` reports where each block sits. */
export function useTodayReveal(state: NowState, L: NowLayout) {
  /*
   * Keep the lift being trained inside TODAY's viewport.
   *
   * TODAY is a fixed box in a column that must not scroll (§4), so past two
   * lifts its content is taller than its space. It scrolled, but never itself:
   * on the third lift the current block sat below the fold with `scrollTop` at
   * 0 and no scroll indicator to say so, taking its sets and its UNDO with it.
   *
   * Everything decidable is `revealOffset`, which is tested. These four refs
   * are only the measurements a layout engine has to hand back.
   */
  const todayScroller = useRef<ScrollView>(null);
  const blockLayouts = useRef(new Map<string, { y: number; h: number }>());
  const todayMetrics = useRef({ viewport: 0, content: 0, scrollTop: 0 });

  /*
   * Called from the state effect AND from every measurement callback, and that
   * is not belt-and-braces.
   *
   * `onLayout` and `onContentSizeChange` are driven by a ResizeObserver, so
   * they land AFTER the effect for the render that caused them. Reading the
   * metrics only in the effect meant computing against the previous render's
   * content height: on the second lift, 238px of content against a cached 119,
   * which is `max === 0`, which is "nothing to scroll". The list sat at 0 with
   * the current block 20px short, exactly as before the fix.
   *
   * So the reveal runs whenever either input changes — the state or the
   * measurements. Running it repeatedly is free: `revealOffset` returns null
   * for a block already in view, which is the same rule that keeps it from
   * twitching on every logged set.
   */
  const stateRef = useRef(state);
  stateRef.current = state;

  const revealCurrent = useCallback(() => {
    const { viewport, content } = todayMetrics.current;
    // Where the list really is, on web. The cached `scrollTop` comes from
    // onScroll, a frame behind the browser, which also moves the list by itself
    // (scroll anchoring) when a chip reflows onto the line above (R686).
    const node = (todayScroller.current as { getScrollableNode?: () => HTMLElement } | null)
      ?.getScrollableNode?.();
    const scrollTop = typeof node?.scrollTop === 'number' ? node.scrollTop : todayMetrics.current.scrollTop;
    const today = stateRef.current.today;
    const to = revealOffset({
      blocks: today.map(l => blockLayouts.current.get(l.exerciseId) ?? { y: 0, h: 0 }),
      current: today.findIndex(l => l.current),
      viewport, content, scrollTop
    });
    if (to !== null) todayScroller.current?.scrollTo({ y: to, animated: true });
  }, []);

  // Covers switching lift, which can change which block is current without
  // changing a single measurement.
  useEffect(() => { revealCurrent(); }, [state, revealCurrent]);

  // No scroll anchoring on web: when the fourth set's chip joins the line
  // above, Chrome scrolled the list UP 42px to keep that chip still, which
  // hid the set just logged and its UNDO and + (R686). The list decides where
  // it sits (`revealCurrent`), not the browser.
  useEffect(() => {
    const node = (todayScroller.current as { getScrollableNode?: () => HTMLElement } | null)
      ?.getScrollableNode?.();
    if (node?.style) node.style.setProperty('overflow-anchor', 'none');
  }, [L.scrolls]);

  /*
   * TODAY's set list scrolls inside TODAY while the column is fixed, and is a
   * plain View when the column itself scrolls (R652). In scroll mode the outer
   * ScrollView owns the scrolling: a ScrollView has no natural height, so the
   * nested list collapsed to 0 and TODAY shrank to nothing -- at 375x440 the
   * set counter, the day rail and the logged sets were absent at every scroll
   * position. The ref and scroll handlers belong to the scroller only, so
   * todayScroller.current is null in scroll mode and ?.scrollTo stays safe.
   */
  const TodayList: any = L.scrolls ? View : ScrollView;
  const todayListProps = L.scrolls ? {} : {
    ref: todayScroller,
    style: s.todayScroll,
    showsVerticalScrollIndicator: false,
    scrollEventThrottle: 16,
    onScroll: (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      todayMetrics.current.scrollTop = e.nativeEvent.contentOffset.y;
    },
    onLayout: (e: { nativeEvent: { layout: { height: number } } }) => {
      todayMetrics.current.viewport = e.nativeEvent.layout.height; revealCurrent();
    },
    onContentSizeChange: (_w: number, h: number) => {
      todayMetrics.current.content = h; revealCurrent();
    }
  };
  return { blockLayouts, revealCurrent, TodayList, todayListProps };
}

/** LOG SET, the steppers and the typed weight, each guarded against one tap landing twice. */
export function useSetEntry({ model, sync, setState, setTyping, setTypingReps }: {
  model: NowModel;
  sync: () => void;
  setState: (next: NowState) => void;
  setTyping: (text: string | null) => void;
  setTypingReps: (text: string | null) => void;
}) {
  // Same-tick double-fire guard, NOT a cooldown: two real presses spaced even
  // 50ms apart are two intentional sets and both must land — that is the whole
  // point of a one-tap logger you can hit again immediately. What must not
  // land twice is two events from the SAME physical tap (see
  // useGuardedPush/useExitOnce for the mechanism). A rAF-cleared guard was
  // tried first and rejected: rAF never fires while the screen isn't
  // compositing (backgrounded, mid-transition), which would leave LOG SET
  // permanently dead until the next paint — setTimeout clears on a real clock
  // instead, the same choice already made by every other guard in this file.
  const loggingRef = useRef(false);
  // Same shape as loggingRef, for the same reason: model.undo() re-queries and
  // deletes whatever IS the last set at call time, so two same-tick calls
  // delete the two most recent sets instead of undoing one mistake. One
  // shared ref is enough — a single physical tap can only ever land on one
  // lift's UNDO at a time.
  const undoingRef = useRef(false);
  const log = useCallback(() => {
    if (loggingRef.current) return;
    loggingRef.current = true;
    setTimeout(() => { loggingRef.current = false; }, 50);
    model.log();                       // the write, first and unconditionally
    setTyping(null);                   // logging always exits the typed fields
    setTypingReps(null);
    const next = model.state();
    setState(next);
    // The set that makes the coach's call gets the success tap (R682); every
    // other set the usual thud. A miss is silent, never an error buzz.
    feedback(() => next.lastTime.justMade
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
  }, [model]);

  const bump = useCallback((fn: () => void) => {
    fn();
    // A stepper closes the typed field. On web the tap blurs it anyway, but on
    // a phone the keyboard stays up — and then the field goes on showing the
    // typed string while the model's weight steps underneath it, so the hero
    // number stops being what would get logged.
    setTyping(null);
    setTypingReps(null);
    sync();
    feedback(() => Haptics.selectionAsync());
  }, [sync]);

  /**
   * Typed weight commits on every keystroke, not on blur. The rule and the
   * reasons live in `typedWeight` in now-model.ts, where they are tested.
   */
  const typeWeight = useCallback((raw: string) => {
    const { text, weight } = typedWeight(raw);
    setTyping(text);
    if (weight === null) return;
    model.setWeight(weight);
    sync();
  }, [model, sync]);
  return { undoingRef, log, bump, typeWeight };
}

/** Redraws the rest clock once a second, only while this screen is the one looked at. Returns the last set's time. */
export function useRestTick(state: NowState) {
  // The rest clock ticks every second, but it must NOT re-run `model.state()` —
  // that re-queries the database (sets, history, picker, prediction) and doing it
  // once a second would get slower the longer someone has used the app. Instead
  // the tick only invalidates the render and rest is recomputed from the last
  // set's timestamp, which is already in hand.
  const [, tick] = useState(0);
  const lastAt = state.loggedThisSession.length
    ? state.loggedThisSession[state.loggedThisSession.length - 1].at
    : null;

  /*
   * Only while this screen is the one being looked at (R491).
   *
   * The effect depended on `[lastAt]` alone, and `lastAt` does not change when
   * the workout ends or when another screen opens over this one — and this
   * screen stays MOUNTED in both cases, which is the same fact R485 turned up
   * about Progress. Measured by counting live 1000ms intervals through the real
   * flow: log a set and there is one, tap FINISH and there is still one, with
   * the recap on top. So the clock went on re-rendering the whole Now tree once
   * a second behind the recap the lifter is reading and sharing — the screen
   * they sit on longest after a workout — and behind Progress or Goals if they
   * check either mid-session.
   *
   * Nothing was ever WRONG on screen, which is why it survived: `restSince` is
   * computed from the last set's timestamp and `Date.now()`, so it is right
   * whenever it does render, and a suspended app stops the timer anyway. This
   * is only waste — but it is exactly the waste this effect's own comment above
   * was written to avoid, and gating it on focus costs one hook.
   */
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  useEffect(() => {
    if (lastAt == null || !focused) return;
    const id = setInterval(() => tick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [lastAt, focused]);
  return lastAt;
}

/** What the screen redoes when someone comes back to it: from another screen, or by waking the phone. */
export function useResumeOnReturn(model: NowModel, sync: () => void, finishedRef: { current: boolean }): void {
  /**
   * Everything this screen has to redo when the user comes back to it.
   *
   * Coming back from the recap means the next workout, not the one just
   * finished. The recap is pushed ON TOP of this screen, so it was never
   * unmounted and the model returns still holding the session it ended — see
   * `startNextIfFinished`. Doing it on arrival rather than on the next tap
   * means the user never sees a finished workout presented as a live one.
   *
   * Extracted because there are TWO ways back and they were not the same. See
   * the AppState effect below for the one that was missing.
   */
  const resume = useCallback(() => {
    /*
     * The idle rule, on the path it actually fires on.
     *
     * §8 ends a workout after ninety minutes of nothing, and the model does
     * that in its CONSTRUCTOR — which only runs on a cold launch. A phone
     * wakes far more often than it relaunches, so the common way to abandon a
     * workout is to lock the screen and come back to it, and that path never
     * checked. Checked first, because a stale session must be closed before
     * anything below decides what to show for it.
     */
    model.closeIfStale();
    model.startNextIfFinished();
    // A fresh workout can be finished again — see the FINISH button's own
    // guard below for why this needs resetting anywhere but there.
    finishedRef.current = false;
    // And pick up a unit chosen in Settings, which is the other way this
    // screen can be holding a session the user has moved on from.
    model.adoptChosenUnit();
    /*
     * Then re-read, unconditionally.
     *
     * It used to sync only when a finished session had rolled over, so
     * anything the OTHER screens changed was invisible until the next tap
     * here: saving a jump amount in Settings left the buttons still labelled
     * with the old one, and a restore — or an erase — on Progress left this
     * screen showing numbers for sets that no longer existed. This screen
     * does not own that data, so it cannot assume it is still what it was.
     */
    sync();
  }, [model, sync]);

  useFocusEffect(resume);

  /**
   * The other way back, and the one the idle rule was actually written for.
   *
   * `useFocusEffect` subscribes to navigation's `focus` and `blur` events and
   * to nothing else — read it in `@react-navigation/core`, it adds exactly two
   * listeners. Navigation focus does not move when the phone sleeps: lock the
   * screen mid-workout with Now on top and it is still the focused screen two
   * hours later, so nothing above re-runs and the next set joins a workout that
   * started before lunch. That is the case `closeIfStale`'s own comment names —
   * "a phone does not relaunch the app, it wakes it" — and the hook it was
   * wired to is the one hook that cannot see it.
   *
   * Waking the app is the same event as returning to the screen, so it runs the
   * same work rather than a second copy of it.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') resume();
    });
    return () => sub.remove();
  }, [resume]);

  /*
   * What focus deliberately does NOT do: reload the prefill.
   *
   * The constructor calls `loadPrefill`, and so does anything that changes the
   * session — `closeIfStale`, `startNextIfFinished`, `adoptChosenUnit`,
   * `selectExercise`, `clearWorkout`. Focus does not, and that is not an
   * oversight of the same kind R248 fixed.
   *
   * `weight` and `reps` are model state, so they survive a trip to Progress and
   * back. Refreshing them on focus would throw away a weight the user had
   * dialled in and not yet logged — walk to the rack, glance at Progress, come
   * back and find your 225 replaced by last week's 185. Losing input the user
   * can see is worse than the case it would fix: a backup restored mid-session
   * that contains a NEWER set for the lift currently open, which leaves the
   * "last time" line one set behind until the next tap.
   *
   * Erasing everything IS covered — the session goes with it, so
   * `startNextIfFinished` fires and reloads.
   */
}

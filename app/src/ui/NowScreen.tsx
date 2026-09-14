import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, TextInput, useWindowDimensions,
  PanResponder, AppState
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import * as KeepAwake from 'expo-keep-awake';
import {
  NowModel, WEIGHT_STEP, PLATE, REP_JUMP, typedWeight, MAX_TYPED_WEIGHT, layoutFor, revealOffset, splitPickerGroups, HIT,
  type NowState
, RAIL_CHIP, PREF_SKIP_MACHINE
} from './now-model.ts';
import { restSince } from '../domain/rest.ts';
import { EQUIPMENT, loadLabel, type Equipment, type LoggedSet, type Unit } from '../domain/types.ts';
import {
  SPLIT_PLANS, PLAN_DAYS,
  type SplitPlan, type PlanDay
} from '../domain/split.ts';
import { ConfirmSheet } from './ConfirmSheet.tsx';
import type { Repo } from '../data/repo.ts';
import { COLUMN } from './column.ts';
import { TabBar } from './TabBar.tsx';
import { ScreenModal, useExitOnce } from './ScreenModal.tsx';
import { useDragScroll } from './drag-scroll.ts';
import { Arrive } from './Arrive.tsx';
import { TYPE, SPACING } from './type.ts';
import { streakWorthShowing } from './recap-model.ts';
import { pressStyle, useReducedMotion, slop, onState, SELECTED, SELECTED_TEXT } from './press.ts';
import { t, fill, languageOf, number, PLAN_KEY, PLAN_BLURB_KEY, DAY_KEY, DAY_HEADING_KEY, DAY_TITLE_KEY, KIT_KEY } from '../domain/i18n.ts';
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
const T = (k: Parameters<typeof t>[1]) => t(languageOf(getRepo()), k);

/**
 * How far a drag has to travel before it is a swipe and not a slipped tap.
 *
 * 48pt, twice the platform tap slop, because this control has no undo of its
 * own: an accidental swipe moves the lift under a lifter who is mid-set, and
 * getting back costs a trip to the rail.
 */
const SWIPE_MIN = 48;

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

const VOLT = '#CCFF00';
const BG = '#08090A';

/*
 * The rail's right-edge fade, left to right. Five steps is enough to read as a
 * fade at this width; fewer banded visibly when tried at three.
 */
const RAIL_FADE = [0.12, 0.3, 0.55, 0.8, 1];
const MUTED = '#7C8792';

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
const KEEP_AWAKE_TAG = 'proof-workout';

function feedback(fn: () => Promise<unknown>): void {
  try {
    void fn()?.catch?.(() => {});
  } catch {
    /* a phone that cannot buzz is not a reason to lose a set */
  }
}

export function NowScreen({
  repo, locale, onFinish, onOpenProgress, onOpenGoals, onOpenSettings
}: {
  repo: Repo;
  /** Device locale tag, used only to pick lb/kg for a first-ever session (§8). */
  locale?: string | null;
  onFinish?: () => void;
  onOpenProgress?: () => void;
  onOpenGoals?: () => void;
  onOpenSettings?: () => void;
}) {
  const model = useMemo(() => new NowModel(repo, Date.now, locale), [repo, locale]);
  const [state, setState] = useState<NowState>(() => model.state());
  // §6 — "first launch shows a short list of the most common movements; tap one
  // and you are logging." Opening it here is not onboarding: there is nothing to
  // dismiss and nothing to read, it is the choice the app would otherwise make
  // silently on the user's behalf. Every later launch opens straight to logging.
  const [pickerOpen, setPickerOpen] = useState(false);
  /*
   * The day question, asked before the workout rather than guessed after it.
   *
   * It opens when a session has nothing logged and no day named — once per
   * WORKOUT, and never again after the first set. It replaces the exercise
   * sheet that used to auto-open on a first-ever launch: asking "what are you
   * training" is a better first question than "pick one of twelve movements",
   * and the answer narrows that list to the day anyway.
   *
   * ## Derived, not stored
   *
   * This was `useState(() => ...)` and the comment above it already claimed
   * "once per workout, not once per launch" — the code did the opposite. A lazy
   * initializer runs exactly once, this screen is the stack's entry route and
   * is never unmounted (recap and progress are pushed ON TOP of it), and the
   * only other calls were `setDayOpen(false)`. So the chooser opened for the
   * first workout after a cold launch and for no other, ever: finish, tap DONE,
   * and the fresh session `startNextIfFinished` creates was never asked. Every
   * workout but the first ran day-less, the picker lost its grouping and the
   * rail fell back to inference — precisely what asking first was built to
   * prevent.
   *
   * The model already persists the answer per session (`split.asked.<id>` and
   * `split.day.<id>`, keyed on the session precisely so it does not carry to
   * the next workout), so there was never anything for the component to
   * remember. Deriving it means the question follows the session rather than
   * the mount, and there is no second copy of the answer to keep in step.
   */
  const dayOpen = !state.dayAsked && state.loggedThisSession.length === 0;
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

  // Typed weight entry. §4 says steppers, not a keyboard — and that is right for
  // the common case, where the next set is the last set. It is wrong for a jump:
  // 45 to 225 is 36 taps. Tapping the number opens the one field in this screen.
  const [typing, setTyping] = useState<string | null>(null);
  /** The logged set being edited, or null. See `EditSetSheet`. */
  const [editingSet, setEditingSet] = useState<LoggedSet | null>(null);
  /** The lift a new set is being added to from its own block, or null. */
  const [addingTo, setAddingTo] = useState<string | null>(null);
  // Honour the system's reduced-motion setting — see `useReducedMotion`.
  const still = useReducedMotion();
  /* The day rail drags with a held mouse button, not just a wheel — see
     `useDragScroll`. On a phone this changes nothing; touch already worked. */
  const railDrag = useDragScroll<any>();
  // The one destructive control on this screen, so it asks first.
  const [confirmClear, setConfirmClear] = useState(false);
  /*
   * Editing the jump amounts. Opened from the hint line that describes them,
   * which is the only honest home for it: §9 bans a settings SCREEN, and a
   * preference set from the control it changes never needs one.
   */
  // Type the weight and reps straight in, without walking there on the
  // steppers. The hero already opens a weight field on tap (R29); this is the
  // same idea for both numbers at once, and the only way to type reps at all.
  // Typing the reps, mirroring the weight's own typed field. The numbers are
  // the control: tap either to set it exactly instead of walking there.
  const [typingReps, setTypingReps] = useState<string | null>(null);
  // What the lift is being done on. Carried over from last time, so this is
  // almost never opened — it is here for the week you switch.
  const [editKit, setEditKit] = useState(false);
  // The column does not scroll (§4), so it has to fit. `layoutFor` scales the
  // vertical rhythm to the viewport it actually has — without it the footer
  // rendered below the fold on anything shorter than a phone, unreachable.
  const { width, height } = useWindowDimensions();
  // The hero's size depends on WHAT it is showing, not just the viewport: six
  // characters at a three-character size is 135px wider than a small phone.
  // What is DRAWN, not the raw number: a bodyweight set shows "BW", and sizing
  // the hero off "0" would give two characters' worth of room to one.
  const heroChars = (typing ?? loadLabel(state.weight)).length;
  const L = useMemo(() => layoutFor(width, height, heroChars), [width, height, heroChars]);

  // A single commit point, so no interaction can forget to refresh.
  const sync = useCallback(() => setState(model.state()), [model]);

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
  // Guards FINISH against a same-tick double tap pushing /recap twice — see
  // the button's own onPress for the measured failure this closes.
  const finishedRef = useRef(false);

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
    const { viewport, content, scrollTop } = todayMetrics.current;
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
    sync();
    feedback(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
  }, [model, sync]);

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

  const rest = restSince(lastAt, Date.now());

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

  return (
    <View style={[s.root, { maxWidth: L.column }]} {...swipe.panHandlers}>
      {/* §15 bans nav chrome competing with content, but Progress and Goals have
          to be reachable mid-week or they may as well not exist. Compromise:
          two muted words at the very top, far from the hero number, styled so
          they read as a footer that happens to sit above rather than as a tab
          bar. If this ever grows a third item, it has become a tab bar and the
          rule has been broken.

          This row is IN FLOW, deliberately. It used to be absolutely positioned
          at `top: 6` while the header below started at the container's
          `paddingTop: 8` — the same band — so the two were only ever separated
          by the exercise name being short enough. "TRICEP EXTENSION" printed
          straight through "PROGRESS". Laying it out normally means the header
          cannot reach it no matter how long the lift's name is. */}
      {/*
        Even gaps, not even columns.

        Reported as "a lot of empty space next to them", and measured on a 375px
        screen it was exactly that: PROGRESS and GOALS clustered from x20 to
        x157, the gear alone at x342, and **185px of nothing** between them —
        more empty space than content, in the first row of the app.

        Equal thirds were tried first and are the wrong fix, which the ruler
        says plainly: with each item aligned inside its own cell the gaps came
        out **75px and 132px**, because a 13px glyph hugging the right edge of
        its cell sits much further from its neighbour than a centred word does.
        Even columns do not produce even spacing when the things inside them are
        different sizes.

        The eye reads the GAPS, so space those. Three items under
        `space-between` divide the leftover width equally between them —
        measured at **103.5px on both sides**, with PROGRESS still on the left
        margin and the gear still on the right. The column is capped at
        PHONE_MAX so this cannot stretch into a spread-out desktop tab bar.

        The pair still reads as a pair: that distinction is carried by two WORDS
        against one glyph, not by how tightly they were bunched.
      */}

      {/*
        A fixed column on a phone, a scrolling one on a window too short to hold
        it.

        §4 says the logging path does not scroll, and on every device that ships
        it still does not — `L.scrolls` is false for an iPhone SE and up. But the
        rule is about phones. On an 800x450 pane the column cannot physically
        fit, and the choice is between scrolling it and throwing parts of it
        away: this used to drop the day rail so CLEAR and FINISH could not be
        pushed off, which cost a feature to a constraint that scrolling answers
        properly.

        `flexGrow: 1` on the content container so `todayWrap`'s `flex: 1` still
        has something to fill when there IS room — without it the column
        collapses to its content and the spacer logic stops working.
      */}
      <ColumnWrap scrolls={L.scrolls} tight={L.todayMin === 0}>
      <View style={[s.header, { marginBottom: L.headerGap }]}>
        {/* Tapping the name opens the picker. It is not DRAWN as a button
            because it must not look like one — §7 makes selection a prediction
            problem, so the common case is never touching this at all.
            
            It is announced as one, though. `accessibilityRole` changes what
            assistive technology says, not what is painted, and the a11y tree
            was reporting the only way to change exercise as an unlabelled
            "generic" — invisible to VoiceOver rather than merely quiet. */}
        <View style={s.exerciseLine}>
        <Pressable
          onPress={() => setPickerOpen(true)}
          hitSlop={14}
          style={pressStyle(s.exerciseTap, 'quiet', still)}
          accessibilityRole="button"
          accessibilityLabel={fill(T('changeExerciseA11y'), { name: state.exercise.name })}
        >
          {/*
            The caret is the whole point of this change.

            Tapping the lift's name opens the picker, and nothing said so — the
            name looked exactly like the screen's heading, because it IS the
            screen's heading. The app already has a word for "this opens
            something": the ▾ on the goal sheet's unit control. Reusing that mark
            rather than inventing a hint line keeps §4's no-tutorial rule and
            costs one glyph.

            The name keeps `flexShrink` and `numberOfLines`, so a long movement
            still ellipsizes rather than pushing the caret off the screen — the
            mark has to survive exactly the case that makes it worth having.
          */}
          <View style={s.exerciseRow}>
            <Text style={s.exercise} numberOfLines={1}>{state.exercise.name.toUpperCase()}</Text>
            <Text style={s.exerciseCaret}>▾</Text>
          </View>
        </Pressable>
          {/*
            The streak, moved here when the tab bar took the top row it used to
            share with the gear (owner, 2026-09-10: "move the streak to the
            exercise line"). Still a STATUS -- outside the pressable, no role --
            so it cannot read as part of the control that opens the picker
            (§15). Still `streakWorthShowing`, so this screen and the recap agree.
          */}
          {streakWorthShowing(state.streak) && (
            <Text style={s.streak}
              accessibilityLabel={fill(T('streakA11y'), { n: state.streak })}>
              {state.streak} {T('weekShort')}
            </Text>
          )}
        </View>
        {/* §4: last session's numbers are visible with no interaction at all.
            The label only says "Last time" when the numbers really are theirs —
            and it is never blank. Composed in `lastTimeLine()` rather than here,
            because the branch that mattered was the one that rendered a space
            and nothing in a .tsx could have caught it. */}
        {/* One line, always. R104 gave this line a second clause — the goal on
            the lift being trained — and the column's height model treats it as
            exactly one row: wrapping on a narrow phone would push the hero down
            by 18px with nothing in the fit math expecting it. Truncating drops
            the goal before the last-time numbers, which is the right order. */}
        <Text style={s.lastTime} numberOfLines={1}>
          {state.lastTime.head}
          {/* Volt only for the set that just hit the goal. §15 spends the accent
              on what matters right now, and for the length of one set that is
              this — it is a different size class from the hero, so it draws the
              eye without competing with the number. A gap still to close stays
              grey: it is information, not news. */}
          {state.lastTime.tail !== '' && (
            <Text style={state.lastTime.hit ? s.lastTimeHit : undefined}>
              {state.lastTime.tail}
            </Text>
          )}
        </Text>

        {/* Equipment, under the numbers rather than over them. It changes maybe
            once a month — carried over from the last set of this lift — so it
            reads as a label until you need it, and never competes with the
            weight. Unanswered shows a prompt rather than guessing "barbell":
            a default here would put a fact into the record that nobody chose. */}
        <Pressable
          onPress={() => setEditKit(true)}
          /*
           * `slop`, not a flat 10. Measured on the running app: this tag draws
           * **22pt** tall, so a flat 10 gave it a 42pt target — under §4's
           * ≥44pt floor and far under the app's own TARGET of 56, on a control
           * that sits on the logging path. It was the one small control
           * `touch-targets.test.ts` never named; that file's own comment says
           * its five sites are "the five that were found", and this was the
           * sixth. It sits alone on its row, so it can grow in both directions
           * without reaching a neighbour.
           */
          hitSlop={slop(22)}
          style={pressStyle(null, 'quiet', still)}
          accessibilityRole="button"
          accessibilityLabel={T('changeEquipmentA11y')}
        >
          <Text style={s.kitTag}>
            {state.equipment === 'machine' && state.machine
              ? state.machine.toUpperCase()
              : state.equipment
                ? T(KIT_KEY[state.equipment])
                : T('equipment')}
          </Text>
        </Pressable>
      </View>

      {/* The hero. Steppers, never a keyboard. */}
      {/*
        The logging controls get a surface, drawn BEHIND them rather than
        around them.

        The screen was one flat field with everything floating on it, which is
        most of what OWNER.md means by 'too together' and 'not app-appropriate'
        — nothing grouped the three rows that are one control into one thing.
        The app already owns the vocabulary for this (#111417 on #2A323A at
        radius 12-14, on the plan chooser); it had simply never been applied to
        the control the screen exists for.

        A normal card would pad its contents and that is exactly what this
        column cannot afford: R512 measured the 568px phone at 624px of
        unshrinkable content against 568 of screen, so eight pixels of top
        padding was enough to put LOG SET below the fold. So the panel is an
        ABSOLUTE child with negative insets — it reaches out past the rows to
        look like padding, and contributes no height at all. Same trick as
        R514's rail fade, pointed the other way.
      */}
      <View style={s.logPanel}>
        <View style={s.logPanelSurface} pointerEvents="none" />
      <View style={[s.heroRow, { gap: L.rowGap }]}>
        <Stepper label="−" what="weight" onPress={() => bump(() => model.bumpWeight(-1))} />
        <View style={s.heroNumbers}>
          {typing !== null ? (
            <TextInput
              style={[s.weight, s.weightInput, { fontSize: L.hero }]}
              value={typing}
              onChangeText={typeWeight}
              onBlur={() => setTyping(null)}
              onSubmitEditing={() => setTyping(null)}
              keyboardType="decimal-pad"
              returnKeyType="done"
              selectTextOnFocus
              autoFocus
              accessibilityLabel={T('weight')}
              /*
               * R569 found this ALREADY HAD the exemption below and, not
               * having checked, added a second one above — a JSX element with
               * the same attribute twice, which `tsc --noEmit` flags but
               * nothing in this suite runs it, so it shipped. The Dynamic
               * Type reasoning R569 wrote is still correct and belongs on the
               * prop that was already here: L.hero is the same already-fitted
               * value the resting <Text> exempts a few lines below — Dynamic
               * Type multiplies on top of a fontSize regardless of which
               * element carries it, and this is not paragraph text, it is the
               * same dial in its editable form.
               */
              allowFontScaling={false}
            />
          ) : (
            <Pressable onPress={() => setTyping(String(state.weight))}
              style={pressStyle(null, 'quiet', still)}
              accessibilityRole="button" accessibilityLabel={T('typeWeightA11y')}>
              {/*
                R339: `L.hero` is `layoutFor`'s OWN answer to "how big can this
                number be and still fit" — it already solves for the screen's
                width. Dynamic Type's system font scale multiplies on TOP of
                whatever fontSize a Text is given, so at 2.35x it was
                multiplying an already-fitted value again, on a number with
                nowhere left to grow into: measured overflowing the column by
                over 80pt, taking the +/- steppers off the right edge of the
                phone with it. `allowFontScaling={false}` is the standard
                exemption for a control that already has its own sizing
                logic — this number is not paragraph text a Dynamic Type user
                is reading, it is a dial layoutFor already made as large as
                the screen allows.
              */}
              <Text style={[s.weight, { fontSize: L.hero }]} allowFontScaling={false}>
                {loadLabel(state.weight)}
              </Text>
            </Pressable>
          )}
          {/* Out of flow, so `heroNumbers` measures the DIGITS alone and the
              row centres them. In flow it dragged the number 17.8px left of
              every other element on the screen. `HERO_CHROME` still reserves
              its width once, so there is always clear space for it to hang in. */}
          {/* "LB" beside a hero reading BW said the set weighed nothing in
              pounds, which is the opposite of what a bodyweight set is. When
              there is no added weight the label names the load instead of its
              unit — and it is set smaller, because it is a word rather than a
              two-letter unit and would otherwise crowd the number. */}
          {/* R339: `position: absolute` from a fixed anchor — the reserved
              space around it (`HERO_CHROME`) does not grow with Dynamic
              Type, only the text itself would, so a scaled "LB" grew into
              the "+" stepper beside it. Same exemption as the number it is
              anchored to; the two have to scale together or not at all. */}
          <Text style={[s.unit, s.unitFloat, state.weight === 0 && s.unitWord]} allowFontScaling={false}>
            {state.weight === 0 ? T('bodyweight') : state.session.unit.toUpperCase()}
          </Text>
        </View>
        <Stepper label="+" what="weight" onPress={() => bump(() => model.bumpWeight(1))} />
      </View>
      {/* The plate jump lives on the hint line rather than in the hero row on
          purpose: `layoutFor` solves the hero's font size against HERO_CHROME,
          which budgets for exactly two steppers. Adding a third control up
          there would shrink the number on every screen, and §15 makes the
          number the hero. */}
      <View style={s.hintRow}>
        <View style={s.jumpSlot}>
          <Jump
            label={`−${state.plateJump}`}
            hint={fill(T('takeOffUnit'), { n: state.plateJump, unit: state.session.unit })}
            onPress={() => bump(() => model.bumpPlate(-1))}
          />
        </View>
        {/* Nothing in the middle. The numbers themselves are the way in: tap
            the weight or the reps to type either directly. A separate control
            for it was a third thing to explain on the row that already has
            two. */}
        <View style={s.jumpSlot}>
          <Jump
            label={`+${state.plateJump}`}
            hint={fill(T('addUnit'), { n: state.plateJump, unit: state.session.unit })}
            onPress={() => bump(() => model.bumpPlate(1))}
          />
        </View>
      </View>

      {/*
        Steppers outside, jumps inside — the same order as the weight control.
        
        They were mirror-inverted. On the weight rows the outer buttons are the
        fine ±1 steppers and the ±45 jump sits inboard on its own row; on this
        row the outer buttons were the ±5 JUMP and the steppers were inboard. So
        the far-left button meant "one rep" on one row and "five reps" on the
        next, which is the kind of thing you only notice by getting it wrong
        mid-set. Measured before: −45/+45 at x320/374, −5/+5 at x228/474.
      */}
      <View style={[s.repsRow, { marginTop: L.repsGap, gap: L.rowGap }]}>
        <Stepper label="−" small what="reps" onPress={() => bump(() => model.bumpReps(-1))} />
        <View style={s.jumpSlot}>
          <Jump
            label={`−${state.repJump}`}
            hint={fill(T('takeOffUnit'), { n: state.repJump, unit: T('reps') })}
            onPress={() => bump(() => model.jumpReps(-1))}
          />
        </View>
        {typingReps !== null ? (
          <TextInput
            style={[s.reps, s.repsInput]}
            allowFontScaling={false}
            value={typingReps}
            onChangeText={t => {
              // Three digits, not two. Two capped the field at 99, which is
              // fine for sets and wrong for the people who count a whole
              // conditioning block, a run of bodyweight reps, or a timed carry
              // as one entry — they simply could not record what they did.
              const digits = t.replace(/[^0-9]/g, '').slice(0, 3);
              setTypingReps(digits);
              const n = Number(digits);
              if (Number.isInteger(n) && n >= 1) { model.setReps(n); sync(); }
            }}
            onBlur={() => setTypingReps(null)}
            onSubmitEditing={() => setTypingReps(null)}
            keyboardType="number-pad"
            returnKeyType="done"
            selectTextOnFocus
            autoFocus
            accessibilityLabel={T('reps')}
          />
        ) : (
          <Pressable onPress={() => setTypingReps(String(state.reps))}
            style={pressStyle(null, 'quiet', still)}
            accessibilityRole="button" accessibilityLabel={T('typeRepsA11y')}>
            <Text style={s.reps} allowFontScaling={false}>{state.reps}<Text style={s.repsLabel}>  {T('reps')}</Text></Text>
          </Pressable>
        )}
        <View style={s.jumpSlot}>
          <Jump
            label={`+${state.repJump}`}
            hint={fill(T('addUnit'), { n: state.repJump, unit: T('reps') })}
            onPress={() => bump(() => model.jumpReps(1))}
          />
        </View>
        <Stepper label="+" small what="reps" onPress={() => bump(() => model.bumpReps(1))} />
      </View>
      </View>

      {/* THE tap. One press logs the set exactly as shown. */}
      <Pressable
        style={pressStyle([s.logButton, { height: L.logHeight, marginTop: L.logGap }], 'primary', still)}
        onPress={log}
        accessibilityRole="button"
        accessibilityLabel={T('logSet')}
      >
        <Text style={s.logText}>{T('logSet')}</Text>
      </Pressable>

      <View style={[s.restRow, { marginTop: L.restGap }]}>
        {rest.label && (
          <Text style={[s.restText, rest.cold && s.restCold]}>
            {T('resting')} {rest.label}
          </Text>
        )}
      </View>

      {/* The workout as it accumulates — but led by what comes NEXT, not by
          what is done.
          The block still holds every lift trained today, in order, because that
          is where R38's per-lift UNDO and R48's set removal live: the mistake is
          shown here, so the fix belongs here. What changed is the emphasis. It
          used to open with "TODAY · 3 sets · 2,625 lb", which is a receipt —
          mid-workout the question is not what you have done, it is what you are
          about to do. So the head now names the set you are walking back to the
          bar for, and the totals stay available in the quiet style rather than
          leading. */}
      <View style={[s.todayWrap, { marginTop: L.todayGap, minHeight: L.todayMin }, L.scrolls && s.todayWrapScroll]}>
        <View style={s.todayHead}>
          <View style={s.nextGroup}>
            <Text style={s.todayLabel}>{T('next')}</Text>
            <Text style={s.nextSet}>
              {T('set')} {state.loggedThisExercise.length + 1}
            </Text>
          </View>
          {/* The volume is dropped, not zeroed, when the app cannot compute it
              — bodyweight work with no reading behind it. "1 set   0 lb" is the
              same false claim the recap and Progress both stopped making, and
              this one says it while the lifter is still in the gym looking at
              the sets they just did. */}
          {state.totalSets > 0 && (
            <Text style={s.todayTotals}>
              {state.totalSets} {T(state.totalSets === 1 ? 'setOne' : 'sets')}
              {state.totalVolumeKnown
                ? `   ${number(Math.round(state.totalVolume), languageOf(getRepo()))} ${state.session.unit}`
                : ''}
            </Text>
          )}
        </View>

        {/*
          The rail that replaced NEXT LIFT.

          NEXT LIFT earned its place by appearing only once a set was logged, and
          that rule was right — but it offered exactly ONE guess, in a small button
          sharing a row with CLEAR and FINISH. Between exercises the question is
          not "what does the app think is next", it is "what else is on push day",
          and the answer to that is a list. Tricep extensions and chest flys were
          always in the library and always reachable through the picker; nothing on
          the logging screen said so, so the honest report was that it "isn't clear
          what to click next".

          Same earning rule, same lifetime: it appears with the first logged set
          and stays until the workout is finished. The predictor's pick is still
          here — it is the chip tagged NEXT — so nothing that button did was lost.

          It sits directly under NEXT / SET n, not above the footer where it
          started. That header is the one place on the screen already answering
          "what now", so the day's other lifts belong with it rather than a
          block away next to CLEAR and FINISH — which is where the eye goes to
          END a workout, not to continue one.
        */}
        {/* The rail gets its own band, with a rule under it: flush against the
            set list — which is a SCROLLER, so its top row is routinely half-cut
            — a half-cut row immediately below the chips read as two things drawn
            on top of each other. The rule makes the boundary explicit and the
            clipping legible as scrolling rather than as breakage. */}
        {/*
          The band has NO explicit height.
          It used to be pinned to `L.railHeight + 10`, a number the model
          computed and the stylesheet had to match exactly — and it was wrong
          twice. Once when a line was added inside without the model being told,
          and once because the band's own margin, padding and rule are not in
          the model's arithmetic at all, so the chips ran past the bottom and
          came out with their lower edge shaved off. Sizing to content cannot be
          wrong: the band is exactly as tall as what is in it. `railHeight`
          stays in the model as the RESERVE the fit math budgets for, which only
          has to be generous, never exact.
        */}
        {state.canFinish && state.dayRail.length > 0 && L.railHeight > 0 && (
          <View style={s.railBand}>
            {/* Always shown, on every screen size.

                It was dropped on short viewports to buy back 14px, on the
                reasoning that the day chooser had already named the day. That
                was the wrong thing to cut: this line is what tells you the row
                beneath it is what comes NEXT, and without it the chips are just
                a row of lift names with no stated purpose. The 14px comes out
                of TODAY instead, which scrolls. */}
            <Text style={s.railLabel}>
              {T(state.planDay ? DAY_HEADING_KEY[state.planDay] : 'nextUpToday')}
            </Text>
            {/*
              The chips scroll, and until R514 nothing said so: the row simply
              stopped mid-word at the screen edge — 'DB Shoul' — which reads as
              broken rather than as more-to-come. A fade is the standard answer
              and a gradient is a dependency §12 does not allow, so this is a
              ramp of solid background slices instead: five Views of BG at
              rising opacity, absolutely positioned, `pointerEvents` none.

              Absolute on purpose. R512 established that this column has no
              vertical slack — the 568px phone was already 56px over budget —
              so anything added here has to cost zero layout height, and an
              overlay does.

              It needs no is-it-overflowing check: the slices are the SAME
              colour as the background, so when the chips do not reach the edge
              the fade is background drawn over background and cannot be seen.
            */}
            <View style={s.railScroller}>
            <ScrollView
              ref={railDrag}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.railRow}
            >
              {state.dayRail.map(lift => (
                <Pressable
                  key={lift.id}
                  style={pressState => [
                    s.railChip,
                    lift.current && s.railChipOn,
                    lift.done && !lift.current && s.railChipDone,
                    ...pressStyle(null, 'surface', still)(pressState)
                  ]}
                  {...onState(lift.current)}
                  onPress={() => {
                    model.selectExercise(lift.id);
                    sync();
                    feedback(() => Haptics.selectionAsync());
                  }}
                  accessibilityRole="button"
                  /* The reason the recommendation exists lives here rather
                     than on screen. It had its own line under the heading and
                     it was too much text on the one path §4 keeps bare — the
                     rail already answers "what next" by putting the chip
                     first, and a sentence explaining the ranking is a thing to
                     read mid-set. As an accessible name it costs no pixels and
                     is still there for anyone who cannot see the order. */
                  accessibilityLabel={
                    `${lift.name}${lift.done ? T('alreadyTrainedTodayA11y') : ''}` +
                    `${lift.suggested ? T('suggestedNextA11y') : ''}` +
                    `${lift.suggested && lift.reason ? fill(T('reasonColonA11y'), { reason: lift.reason }) : ''}`
                  }
                >
                  <Text
                    style={[
                      s.railText,
                      lift.current && s.railTextOn,
                      lift.done && !lift.current && s.railTextDone
                    ]}
                    numberOfLines={1}
                  >
                    {lift.name}
                  </Text>
                  {/* The old button's one job, kept as a tag rather than a screen
                      of its own. */}
                  {lift.suggested && <Text style={s.railNext}>{T('suggested')}</Text>}
                </Pressable>
              ))}
            </ScrollView>
              <View style={s.railFade} pointerEvents="none">
                {RAIL_FADE.map((opacity, i) => (
                  <View key={i} style={[s.railFadeSlice, { opacity }]} />
                ))}
              </View>
            </View>
          </View>
        )}

        {/*
          What you have done, said out loud.

          Reported: "the bottom should have a label that shows previous
          workouts". The list underneath is this session's sets, and it had NO
          heading at all — the nearest words above it were "NEXT ON PUSH DAY",
          which name the row of chips, so the only label anywhere near this list
          described something else entirely. A reader with no heading to go on
          reasonably assumes a list of lift names and weights is history.

          It is not history, so the label says what it is rather than what it
          was mistaken for. History lives on Progress under RECENT WORKOUTS, and
          two surfaces using one word for two different things is how the
          confusion started.

          Hidden until the first set, matching the list itself: a heading over
          nothing is the empty container this block was already careful to avoid.
        */}
        {state.totalSets > 0 && (
          <Text style={s.todayHeading}>{T('thisWorkout')}</Text>
        )}

        <TodayList {...todayListProps}>
          {/*
            Nothing at all until the first set lands.

            `state.today` always contains the lift you are ON, so before a
            single set existed this block rendered its name and the words "no
            sets yet" — a container, a heading and a sentence, all describing
            nothing, on the first screen a new user ever sees. The comment above
            already claimed "the slot is empty and the screen is about the set
            in front of you"; the code just did not do it.

            `todayWrap` keeps its `minHeight` either way, so the first set drops
            into reserved space rather than pushing the screen around.
          */}
          {(state.totalSets === 0 ? [] : state.today).map(lift => (
            <View
              key={lift.exerciseId}
              style={s.liftBlock}
              onLayout={e => {
                const { y, height } = e.nativeEvent.layout;
                blockLayouts.current.set(lift.exerciseId, { y, h: height });
                revealCurrent();
              }}
            >
              <View style={s.liftHead}>
                {lift.current && <View style={s.liftDot} />}
                <Text style={[s.liftName, lift.current && s.liftNameCurrent]} numberOfLines={1}>
                  {lift.name}
                </Text>
                {lift.sets.length > 0 && (
                  <Text style={s.liftCount}>{lift.sets.length}</Text>
                )}
              </View>

              {lift.sets.length === 0 ? (
                <Text style={s.liftEmpty}>{T('noSetsYet')}</Text>
              ) : (
                <View style={s.liftSets}>
                  {lift.sets.map((set, i) => (
                    /* Keyed on the set's id, so only a NEW chip mounts and
                       animates — the ones already on screen are reused and stay
                       put, which is what stops one arrival becoming a flock. */
                    <Arrive key={set.id}>
                    <Pressable
                      /* Tapping a set now EDITS it. It used to arm it for
                         destruction, so the only way to fix a mistyped weight
                         was to destroy the set and log another — which moved it
                         to the end of the session and changed its time. Removal
                         still exists, inside the editor, where it is a choice
                         rather than the only door. */
                      onPress={() => setEditingSet(set)}
                      accessibilityRole="button"
                      hitSlop={slop(36, 14)}
                      accessibilityLabel={
                        fill(T('setByRepsA11y'), { n: i + 1, weight: loadLabel(set.weight), reps: set.reps }) +
                        `${set.note ? fill(T('notedA11y'), { note: set.note }) : ''}` +
                        T('tapToEditA11y')
                      }
                      style={pressStyle(
                        [s.chip, state.prSetIds.includes(set.id) && s.chipPR],
                        'surface', still)}
                    >
                      <Text style={s.chipIndex}>{i + 1}</Text>
                      <Text style={[s.chipText, state.prSetIds.includes(set.id) && s.chipTextPR]}>
                        {loadLabel(set.weight)} × {set.reps}
                      </Text>
                      {/* OWNER.md #5: the moment a best is hit, marked where it
                          happens. One glyph and the accent, not a banner — §8
                          calls the PR the emotional payload and also forbids
                          crying wolf, and the recap is where it gets a sentence. */}
                      {state.prSetIds.includes(set.id)
                        ? <Text style={s.chipPRMark}>★</Text> : null}
                      {/* A note is worth nothing if the list does not admit it
                          is there. One glyph, so a whole session of notes does
                          not turn the list into prose. */}
                      {set.note ? <Text style={s.chipNote}>✎</Text> : null}
                    </Pressable>
                    </Arrive>
                  ))}
                  {/* Every lift with sets in it, not just the one being
                      trained. A set logged wrong and then moved on from used to
                      be stranded — visible in this list, with the only fix
                      three taps away behind realising you had to switch back to
                      it. The mistake is shown here, so the undo belongs here. */}
                  <Pressable accessibilityRole="button"
                    onPress={() => {
                      if (undoingRef.current) return;
                      undoingRef.current = true;
                      setTimeout(() => { undoingRef.current = false; }, 50);
                      model.undo(lift.exerciseId);
                      sync();
                      feedback(() => Haptics.selectionAsync());
                    }}
                    accessibilityLabel={fill(T('undoLastSetA11y'), { lift: lift.name })}
                    hitSlop={slop(36, 6)}
                    style={pressStyle(s.undo, 'quiet', still)}
                  >
                    <Text style={s.undoText}>{T('undo')}</Text>
                  </Pressable>
                  {/* Another set of THIS lift, without leaving the lift you are
                      on. Repeating a set further up the session used to mean
                      switching to it, checking the steppers, logging, and
                      switching back. It copies that lift's own last set, so it
                      repeats what happened rather than what the hero shows. */}
                  <Pressable accessibilityRole="button"
                    /* Asks before it logs. Copying the last set outright was
                       fast and wrong: the commonest reason to add a set to a
                       lift further up the session is that it was DIFFERENT, so
                       a silent copy recorded something that never happened. The
                       sheet opens on those numbers as a starting point. */
                    onPress={() => setAddingTo(lift.exerciseId)}
                    hitSlop={slop(34, 6)}
                    accessibilityLabel={fill(T('addAnotherSetA11y'), { lift: lift.name })}
                    style={pressStyle(s.addSet, 'surface', still)}
                  >
                    <Text style={s.addSetText}>+</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
        </TodayList>
      </View>

      {/*
        NEXT LIFT is back, but earning its place this time.
        It was removed as pointless when it sat there from launch, guessing at a
        lift before anything had happened — a second, vaguer way to do what the
        picker does precisely. It now appears only once the FIRST set is logged,
        which is the moment the question "what now" actually exists, and stays
        until the workout is finished. Before that the slot is empty and the
        screen is about the set in front of you.
      */}

      {/*
        Centred as a pair, not shoved against the right edge.
        A `flex: 1` spacer used to sit here, which put CLEAR and FINISH at
        x222-354 of a 390px screen with two hundred pixels of nothing to their
        left. Every other row on this screen is centred on the column — the
        hero, the steppers, the jumps, LOG SET — so the one row that was not
        read as crooked rather than as deliberate.
      */}
      <View style={[s.footer, { marginTop: L.restGap }]}>
        {state.canFinish && (
          <Pressable
            style={pressStyle(s.clear, 'quiet', still)}
            onPress={() => setConfirmClear(true)}
            accessibilityRole="button"
            hitSlop={slop(40, 12)}
            accessibilityLabel={T('clearWorkoutA11y')}
          >
            <Text style={s.clearText}>{T('clear')}</Text>
          </Pressable>
        )}

        {/* Only once there is something to finish. It used to be offered from
            the moment the app opened, and tapping it with nothing logged was a
            round trip to a recap reading "Nothing logged yet". */}
        {state.canFinish && (
          <Pressable accessibilityRole="button"
            style={pressStyle(s.finish, 'primary', still)}
            hitSlop={slop(40, 12)}
            accessibilityLabel={T('finishA11y')}
            onPress={() => {
              /*
               * `onFinish` pushes a new route — `router.push('/recap')` — and a
               * router push has no guard of its own against being called twice
               * in the same tick. Measured on the running app: two real
               * pointerdown/mouseup/click sequences dispatched at the exact same
               * screen coordinates both land on this SAME pre-render DOM node
               * (React had not yet repainted between them), so a check against
               * `state.canFinish` — a snapshot from the LAST render — cannot see
               * the second call coming any more than the first one could. Two
               * pushes landed two recaps on the stack, and DONE needed two taps
               * to actually leave, the second one dropping onto a screen that
               * had rolled a THIRD session over underneath. A `useRef`, not
               * state, because it has to be checked and set synchronously,
               * outside any render.
               */
              if (finishedRef.current) return;
              finishedRef.current = true;
              model.finish(); sync(); onFinish?.();
            }}
          >
            <Text style={s.finishText}>{T('finish')}</Text>
          </Pressable>
        )}
      </View>

      </ColumnWrap>
      {/* The bar -- shared with every tab it names, see TabBar.tsx. OUTSIDE the
          column (R651): inside it, a window short enough for ColumnWrap to become
          a ScrollView carried the bar with the content -- 4px of it showing at
          375x380 -- while every other tab pins its bar. Bleeds
          past the root padding so it reads as chrome, not content. */}
      <TabBar current="now" style={s.tabBleed}
        go={tab => (tab === 'progress' ? onOpenProgress : tab === 'goals' ? onOpenGoals : onOpenSettings)?.()} />

      {/* Rendered conditionally rather than toggled through Modal's `visible`.
          On react-native-web a transparent Modal stayed on screen after
          `visible` went false — the picker would not close after choosing a
          lift. Unmounting is platform-independent, and it also drops the
          sheet's own state, so reopening never shows a half-typed exercise
          name from last time. */}
      {dayOpen && (
        <DayChooser
          state={state}
          firstEver={state.firstEver}
          onPickPlan={p => { model.setPlan(p); sync(); }}
          onPickDay={d => {
            model.setDay(d);
            sync();
            feedback(() => Haptics.selectionAsync());
          }}
          // `skipDay` writes `split.asked.<session>`, which is what closes this
          // — the sheet has no separate idea of being dismissed to get wrong.
          onSkip={() => { model.skipDay(); sync(); }}
        />
      )}

      {editKit && (
        <EquipmentSheet
          state={state}
          skipMachine={repo.getPref(PREF_SKIP_MACHINE) === '1'}
          onSkipMachine={skip => { repo.setPref(PREF_SKIP_MACHINE, skip ? '1' : '0'); sync(); }}
          onClose={() => setEditKit(false)}
          onPick={(kit, machine) => {
            model.setEquipment(kit, machine);
            setEditKit(false);
            sync();
            feedback(() => Haptics.selectionAsync());
          }}
          // Machine records the kit but keeps the sheet up for the name.
          onApply={(kit, machine) => {
            model.setEquipment(kit, machine);
            sync();
            feedback(() => Haptics.selectionAsync());
          }}
        />
      )}

      {confirmClear && (
        <ConfirmSheet
          title={T('clearWorkoutTitle')}
          body={fill(T('clearWorkoutBody'), {
            n: state.totalSets,
            setWord: T(state.totalSets === 1 ? 'setOne' : 'sets')
          })}
          confirmLabel={T('clearLabel')}
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            model.clearWorkout();
            setTyping(null);
            setConfirmClear(false);
            sync();
            feedback(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
          }}
        />
      )}

      {addingTo && model.lastSetOfInSession(addingTo) && (
        <EditSetSheet
          adding
          set={model.lastSetOfInSession(addingTo)!}
          unit={state.session.unit}
          onClose={() => setAddingTo(null)}
          onSave={patch => {
            model.addSetTo(addingTo, patch);
            setAddingTo(null);
            feedback(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
            sync();
          }}
        />
      )}

      {editingSet && (
        <EditSetSheet
          set={editingSet}
          unit={state.session.unit}
          onClose={() => setEditingSet(null)}
          onSave={(patch) => {
            model.editSet(editingSet.id, patch);
            setEditingSet(null);
            sync();
          }}
          onRemove={() => {
            model.removeSet(editingSet.id);
            setEditingSet(null);
            feedback(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
            sync();
          }}
        />
      )}

      {pickerOpen && <ExercisePicker
        state={state}
        onClose={() => setPickerOpen(false)}
        onPick={id => {
          model.selectExercise(id);
          setPickerOpen(false);
          sync();
          feedback(() => Haptics.selectionAsync());
        }}
        onAdd={name => {
          const id = model.addCustomExercise(name);
          if (!id) return false;
          setPickerOpen(false);
          sync();
          feedback(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
          return true;
        }}
        onRemove={id => {
          const ok = model.removeCustomExercise(id);
          if (ok) { sync(); feedback(() => Haptics.selectionAsync()); }
          return ok;
        }}
      />}
    </View>
  );
}

/**
 * What are you training today?
 *
 * Asked once per workout, before anything is logged, and never again once a set
 * is in. The app used to infer the day from what you happened to train, which
 * works but is backwards for the thing it drives: the picker narrows to the
 * day, so it needs the answer BEFORE you choose a movement, not after.
 *
 * On a first-ever launch it asks the split first — offering "PUSH / PULL /
 * LEGS" days to somebody running upper/lower is the app imposing a routine
 * §5 says it must not. Afterwards the plan is remembered and only the day is
 * asked; changing the plan lives in Settings.
 *
 * SKIP is deliberate. §4 says the app never asks a question it could answer,
 * and it CAN answer this one badly-but-usefully by inference — so somebody who
 * does not think in splits can wave it away and the old behaviour takes over.
 */
function DayChooser({ state, firstEver, onPickPlan, onPickDay, onSkip }: {
  state: NowState;
  firstEver: boolean;
  onPickPlan: (plan: SplitPlan) => void;
  onPickDay: (day: PlanDay) => void;
  onSkip: () => void;
}) {
  const [choosingPlan, setChoosingPlan] = useState(firstEver);
  const still = useReducedMotion();
  // Whether the sheet is on its way out. `dayOpen` at the call site is
  // derived straight from `state.dayAsked`/`state.dayChosen`, so deferring
  // the CALL to `onSkip`/`onPickDay` — rather than deferring some local
  // "visible" flag — is what keeps this mounted for the animation: the
  // model does not change, so the derived flag does not either, until the
  // timer actually lands. See useExitOnce for why this is a shared hook now.
  const { closing, leave } = useExitOnce(still);
  const skip = () => leave(onSkip);
  const pickDay = (d: PlanDay) => leave(() => onPickDay(d));

  return (
    <ScreenModal visible animationType="none" transparent exiting={closing} onRequestClose={skip}>
      <Pressable style={s.backdrop} onPress={skip}>
        <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
          <View style={s.grabber} />

          {choosingPlan ? (
            <>
              <Text style={s.sheetTitle}>{T('howSplit')}</Text>
              {SPLIT_PLANS.map(p => {
                /*
                 * Nothing is selected on a first-ever launch.
                 *
                 * `state.plan` always has a value — it falls back to push/pull/
                 * legs — so the very first screen of the app rendered that row
                 * with a volt border, the same treatment a real choice gets. On
                 * the one launch where the user has chosen NOTHING, the app was
                 * showing them an answer and implying they had given it. The
                 * default is still the default; it just stops claiming to be a
                 * decision.
                 */
                const chosen = !firstEver && p === state.plan;
                return (
                <Pressable
                  key={p}
                  style={pressStyle([s.planRow, chosen && s.planRowOn], 'surface', still)}
                  onPress={() => { onPickPlan(p); setChoosingPlan(false); }}
                  accessibilityRole="button"
                  {...onState(chosen)}
                  accessibilityLabel={`${T(PLAN_KEY[p])}. ${T(PLAN_BLURB_KEY[p])}`}
                >
                  <View style={s.planHead}>
                    <Text style={[s.planText, chosen && s.planTextOn]}>
                      {T(PLAN_KEY[p])}
                    </Text>
                    {/* Selection said with a mark as well as a colour. Colour
                        alone is the one signal a colour-blind reader does not
                        get, and it was the ONLY signal here. */}
                    {chosen && <Text style={s.planTick}>{'✓'}</Text>}
                  </View>
                  {/* What it means, for someone who has never heard it called
                      a split. Without this the first screen of the app is a
                      vocabulary test. */}
                  <Text style={s.planBlurb}>{T(PLAN_BLURB_KEY[p])}</Text>
                </Pressable>
                );
              })}
              {/* A way past the question for someone who cannot answer it. The
                  day step has always had one; the split step did not, so a
                  beginner's only options were to guess or to close the app. */}
              <Pressable onPress={skip} hitSlop={12} style={pressStyle(s.skip, 'quiet', still)}
                accessibilityRole="button" accessibilityLabel={T('skipWorkItOutA11y')}>
                <Text style={s.skipText}>{T('notSureYet')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={s.dayHead}>
                <Text style={s.sheetTitle}>{T('todayIs')}</Text>
                <Pressable accessibilityRole="button" onPress={() => setChoosingPlan(true)} hitSlop={12}
                  style={pressStyle(null, 'quiet', still)}
                  accessibilityLabel={fill(T('changeSplitA11y'), { name: T(PLAN_KEY[state.plan]) })}>
                  <Text style={s.planSwap}>{T(PLAN_KEY[state.plan])}</Text>
                </Pressable>
              </View>
              <View style={s.dayRow}>
                {PLAN_DAYS[state.plan].map(d => (
                  <Pressable
                    key={d}
                    style={pressState => [
                      s.dayChip, PLAN_DAYS[state.plan].length === 1 && s.dayChipWide,
                      ...pressStyle(null, 'surface', still)(pressState)
                    ]}
                    onPress={() => pickDay(d)}
                    accessibilityRole="button"
                    accessibilityLabel={T(DAY_KEY[d])}
                  >
                    <Text style={s.dayChipText} numberOfLines={1}>{T(DAY_KEY[d])}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable onPress={skip} hitSlop={12} style={pressStyle(s.skip, 'quiet', still)}
                accessibilityRole="button" accessibilityLabel={T('skipWorkItOutA11y')}>
                <Text style={s.skipText}>{T('skipDay')}</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </ScreenModal>
  );
}

/**
 * The picker. §7: never a 200-item library on the logging path — `pickerFor()`
 * hands back their own lifts, ranked, or the starting twelve before there is
 * history. Search is the "add a new exercise" path and is deliberately not here.
 */
/**
 * Fixing a set that is already logged, and saying something about it.
 *
 * Two things live here because they are the same moment: you look back at a set
 * either because a number is wrong or because you want to record something the
 * numbers do not hold — which notch the machine was on, what the RIR felt like,
 * the tempo. Splitting them into two sheets would mean two ways in for one
 * intention.
 *
 * The note is one free-text field rather than fields for RIR, tempo and the
 * rest. The app cannot know what a lifter needs to write down, and guessing
 * gets three inputs that are empty 95% of the time plus the one thing they
 * actually wanted to say with nowhere to go.
 *
 * REMOVE is here and nowhere else now. Tapping a set used to arm it for
 * destruction, which made "I typed 145 instead of 155" cost the set its place
 * in the session — it came back at the END, with a new time.
 */
function EditSetSheet({
  set, unit, onClose, onSave, onRemove, adding
}: {
  set: LoggedSet;
  unit: Unit;
  onClose: () => void;
  onSave: (patch: { weight: number; reps: number; note: string | null }) => void;
  /** Absent when adding — a set that does not exist yet cannot be removed. */
  onRemove?: () => void;
  /** Collecting a NEW set rather than fixing one that is already logged. */
  adding?: boolean;
}) {
  const [weight, setWeight] = useState(String(set.weight));
  const [reps, setReps] = useState(String(set.reps));
  /* A new set starts with a blank note. Carrying the last one forward would
     put "RIR 2" on a set nobody has done yet, which is a made-up fact (§16). */
  const [note, setNote] = useState(adding ? '' : (set.note ?? ''));
  const still = useReducedMotion();
  const { closing, leave } = useExitOnce(still);
  const close = () => leave(onClose);
  const save = (patch: { weight: number; reps: number; note: string | null }) => leave(() => onSave(patch));
  const remove = onRemove ? () => leave(onRemove) : undefined;

  const w = Number(weight);
  const r = Number(reps);
  // A blank weight is legal — it is a bodyweight set. A blank rep count is not.
  // The ceiling matches the hero field's own typed-weight guard (§ typo
  // guard, not a judgement) — this field had none of its own, despite being
  // the one used to CORRECT a set, and a 6-character text cap alone still
  // allows "999999" to save.
  const ok = Number.isFinite(w) && w >= 0 && w <= MAX_TYPED_WEIGHT && Number.isInteger(r) && r >= 1;

  return (
    <ScreenModal visible animationType="none" transparent exiting={closing} onRequestClose={close}>
      <Pressable style={s.backdrop} onPress={close}>
        <Pressable style={s.editSheet} onPress={e => e.stopPropagation()}>
          <View style={s.grabber} />
          <Text style={s.editTitle}>{T(adding ? 'addASet' : 'editSet')}</Text>

          <View style={s.editRow}>
            <View style={s.editField}>
              <Text style={s.editLabel}>{fill(T('weightUnitLabel'), { unit: unit.toUpperCase() })}</Text>
              <TextInput
                style={s.editInput}
                value={weight}
                onChangeText={t => setWeight(t.replace(/[^0-9.]/g, '').slice(0, 6))}
                keyboardType="decimal-pad"
                selectTextOnFocus
                accessibilityLabel={T('weight')}
              />
            </View>
            <View style={s.editField}>
              <Text style={s.editLabel}>{T('repsLabel')}</Text>
              <TextInput
                style={s.editInput}
                value={reps}
                /* Three digits here too — see the hero's rep field. */
                onChangeText={t => setReps(t.replace(/[^0-9]/g, '').slice(0, 3))}
                keyboardType="number-pad"
                selectTextOnFocus
                accessibilityLabel={T('reps')}
              />
            </View>
          </View>

          <Text style={s.editLabel}>{T('note')}</Text>
          <TextInput
            style={s.editNote}
            value={note}
            onChangeText={setNote}
            placeholder={T('notePlaceholderSet')}
            placeholderTextColor="#7C8792"
            multiline
            maxLength={280}
            accessibilityLabel={T('noteForSetA11y')}
          />

          <Pressable
            accessibilityRole="button"
            style={pressState => [
              s.editSave, !ok && s.editSaveOff, ...pressStyle(null, 'primary', still)(pressState)
            ]}
            disabled={!ok}
            accessibilityLabel={T(adding ? 'logIt' : 'saveSet')}
            onPress={() => save({ weight: w, reps: r, note: note.trim() || null })}
          >
            <Text style={s.editSaveText}>{T(adding ? 'logIt' : 'saveSet')}</Text>
          </Pressable>

          {/* Destructive, so it is the quiet one and it is last. Absent when
              adding: there is nothing yet to remove. */}
          {remove && (
            <Pressable accessibilityRole="button" style={pressStyle(s.editRemove, 'quiet', still)}
              onPress={remove}
              accessibilityLabel={T('removeSet')}>
              <Text style={s.editRemoveText}>{T('removeSet')}</Text>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    </ScreenModal>
  );
}

function ExercisePicker({
  state, onPick, onAdd, onClose, onRemove
}: {
  state: NowState;
  onPick: (id: string) => void;
  onAdd: (name: string) => boolean;
  onClose: () => void;
  onRemove: (id: string) => boolean;
}) {
  const [adding, setAdding] = useState(false);
  // Set only on a refused removal (a lift with sets already logged against
  // it) — a successful one just makes the row disappear, which says enough.
  const [removeError, setRemoveError] = useState<string | null>(null);
  /*
   * Ids already removed this sheet-open. Measured live: two real
   * pointerdown/mousedown/pointerup/mouseup/click sequences at the × button's
   * exact screen coordinates, with no gap between them, land on the same
   * pre-render DOM node — the row has not yet disappeared to take the second
   * tap's target away. `onRemove`'s own repo-level guard makes the second
   * call harmless to the DATA (it correctly finds the row already gone and
   * returns false), but the UI could not tell "already gone" from "refused
   * because it has sets" and showed 'Can't remove it — it already has sets
   * logged' for an exercise that had, in fact, just been removed
   * successfully by the first tap. A `useRef` set, checked before either
   * call reaches `onRemove` at all, so the second tap is a no-op rather than
   * a false alarm.
   */
  const removedIds = useRef(new Set<string>());
  const [name, setName] = useState('');
  /*
   * The sheet opens on the day being trained. `pickerGroups` is already ordered
   * with that day first (R33), so "this day" is simply the groups that belong
   * to it — plus the day-less YOURS group, which is the user's own movements
   * and never something to hide from them.
   */
  const [allDays, setAllDays] = useState(false);
  const { thisDay, others: hidden } = splitPickerGroups(state.pickerGroups, state.planDay);
  const shown = allDays ? state.pickerGroups : thisDay;
  const still = useReducedMotion();
  const { closing, leave: exitLeave } = useExitOnce(still);
  // The extra reset (closing the inline "add a movement" field, if it was
  // open) still runs synchronously, exactly as before — only `fire` itself
  // is deferred to the exit animation's timer. Gated on exitLeave's own
  // return value so it only runs on the call that actually starts closing,
  // not on a same-tick repeat that the shared guard already rejected.
  const leave = (fire: () => void) => {
    if (exitLeave(fire)) { setAdding(false); setName(''); }
  };
  const close = () => leave(onClose);
  const pick = (id: string) => leave(() => onPick(id));
  /*
   * `onAdd` returns false only for a blank name — `addCustomExercise` returns
   * null for exactly that case and nothing else (a DUPLICATE name selects the
   * existing exercise and still succeeds). The submit button below is
   * already `disabled={!name.trim()}`, so the only way to reach a false here
   * is the return key on an empty field. Guarding on the same condition
   * BEFORE deferring means the deferred call can be unconditional — this
   * sheet never needs `onAdd`'s answer back synchronously, which is what
   * kept it out of the exit-animation pass everywhere else.
   */
  const submit = () => { if (name.trim()) leave(() => onAdd(name)); };

  return (
    // `animationType="none"`, and it is not a style preference.
    //
    // On react-native-web the "slide" animation is a 0.3s keyframe with
    // `animation-fill-mode: none`, so when it finishes the element REVERTS to
    // its base transform — `translateY(100%)`. The whole sheet then sits one
    // full viewport below the screen: measured `transform: matrix(1,0,0,1,0,812)`
    // on an 812px window, with `inset: 0` and nothing visible.
    //
    // It had been that way since the picker was built, because every check ran
    // on synthetic pointer events, and those hit an element whether or not a
    // human could see it. Thirty rounds of "verified live" never once looked.
    <ScreenModal visible animationType="none" transparent exiting={closing} onRequestClose={close}>
      <Pressable style={s.backdrop} onPress={close}>
        <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
          <View style={s.grabber} />
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>
              {state.loggedThisSession.length === 0 ? T('startWith') : T('switchTo')}
            </Text>
            {/* Naming the day is the app showing its work: the order of this
                sheet and the UP NEXT suggestion both follow from it, and an
                unexplained reordering is just a list that moved. */}
            {state.day && <Text style={s.sheetDay}>{T(DAY_TITLE_KEY[state.day])}</Text>}
          </View>

          {/* The indicator is ON here, alone in this screen, and it is not a
              style slip. This list genuinely outgrows the sheet — `pickerFor`
              returns up to twelve ranked movements plus every one the user
              invented, and four split headings on top — so it will always be
              able to run past any cap. A list cut off with no indicator does
              not read as "scroll me", it reads as the whole library, which is
              how an entire day's lifts went missing. §15 bans nav chrome
              competing with content; this is the content telling the truth
              about its own size. */}
          <ScrollView showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
            {/* Grouped by split day, the day being trained first. This is the
                whole of "show me what goes with what": a beginner opening the
                sheet mid-push-day sees the push movements together and at the
                top, instead of twelve names in an order with no reason behind
                it. The other days stay visible below — hiding them would make
                this a filter, and a filter is a mode to get stuck in. */}
            {shown.map(group => (
              <View key={group.label}>
                <Text style={[s.groupLabel, group.day === state.day && s.groupLabelLead]}>
                  {group.label}
                </Text>
                {group.exercises.map(ex => {
                  const current = ex.id === state.exercise.id;
                  // Only YOURS (day === null) ever offers removal — a
                  // built-in is not this user's to remove, and the current
                  // lift is excluded so this sheet never has to decide what
                  // to show in its place (see `removeCustomExercise`).
                  const removable = group.day === null && !current;
                  return (
                    <Pressable accessibilityRole="button"
                      key={ex.id}
                      accessibilityLabel={ex.name}
                      {...onState(current)}
                      onPress={() => pick(ex.id)}
                      style={({ pressed }) => [s.pickRow, pressed && { backgroundColor: '#12161A' }]}
                    >
                      <Text style={[s.pickName, current && s.pickCurrent]} numberOfLines={1}>
                        {ex.name}
                      </Text>
                      {current && <Text style={s.pickDot}>●</Text>}
                      {removable && (
                        <Pressable accessibilityRole="button"
                          // §4's 56px floor (`HIT`/`TARGET`) — the same rule
                          // `touch-targets.test.ts` measured six other controls
                          // against. Drawn at ~26pt (18pt line height + 8pt
                          // vertical padding); alone on the row's trailing
                          // edge like the equipment tag, so no neighbour gap
                          // to respect.
                          hitSlop={slop(26)}
                          accessibilityLabel={fill(T('removeExerciseA11y'), { name: ex.name })}
                          onPress={e => {
                            e.stopPropagation();
                            if (removedIds.current.has(ex.id)) return;
                            const ok = onRemove(ex.id);
                            if (ok) removedIds.current.add(ex.id);
                            setRemoveError(ok ? null : T('cannotRemoveExercise'));
                          }}
                          style={({ pressed }) => [s.pickRemove, pressed && { opacity: 0.5 }]}
                        >
                          <Text style={s.pickRemoveText}>×</Text>
                        </Pressable>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}

            {/* The other days, behind one deliberate tap.
                §7 makes selection a prediction problem, and the prediction is
                the DAY: on push day, leg movements are not near-misses, they
                are noise — twelve rows to scroll past to reach the four that
                could plausibly be next. Hiding them is not hiding the library;
                it is refusing to ask the user to filter it themselves every
                time they switch a lift mid-workout.

                Movements the user invented have no day and are never hidden:
                they are already "going out of your way to add". */}
            {hidden.length > 0 && (
              <Pressable
                onPress={() => setAllDays(v => !v)}
                style={({ pressed }) => [s.pickRow, pressed && { backgroundColor: '#12161A' }]}
                accessibilityRole="button"
                accessibilityLabel={allDays
                  ? T('onlyThisDay')
                  : fill(T('otherDaysCount'), { n: hidden.reduce((n, g) => n + g.exercises.length, 0) })}
              >
                <Text style={s.otherDays}>
                  {allDays
                    ? T('onlyThisDay')
                    : fill(T('otherDaysCount'), { n: hidden.reduce((n, g) => n + g.exercises.length, 0) })}
                </Text>
              </Pressable>
            )}

          </ScrollView>

          {/* §7 — the ONLY place a keyboard appears in this app, and it is
              behind a tap on the least-used control on the least-used sheet.
              Adding a movement is rare; logging is not.

              It sits BELOW the scroll rather than at the end of it. Inside the
              list it was the nineteenth row, measured at y 1068 on an 812px
              screen: to add a movement you first had to scroll past every
              movement you were not looking for. Grouping the list by split day
              added three headings and pushed it further down still. Pinned
              here it costs no space, never moves as the library grows, and
              stays as quiet as §7 wants it to be.
              */}
            {removeError && <Text style={s.removeError}>{removeError}</Text>}
            {adding ? (
              <View style={s.addRow}>
                <TextInput
                  style={s.addInput}
                  value={name}
                  onChangeText={setName}
                  placeholder={T('movementNamePlaceholder')}
                  placeholderTextColor="#7C8792"
                  autoFocus
                  autoCapitalize="words"
                  returnKeyType="done"
                  onSubmitEditing={submit}
                />
                <Pressable accessibilityRole="button" onPress={submit}
                  accessibilityLabel={T('addLabel')}
                  style={pressStyle(s.addGo, 'quiet', still)} disabled={!name.trim()}>
                  <Text style={[s.addGoText, !name.trim() && { color: '#7C8792' }]}>{T('addLabel')}</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable accessibilityRole="button" onPress={() => setAdding(true)}
                accessibilityLabel={T('somethingElse')}
                style={({ pressed }) => [s.pickRow, pressed && { backgroundColor: '#12161A' }]}>
                <Text style={s.addPrompt}>{T('somethingElse')}</Text>
              </Pressable>
            )}
        </Pressable>
      </Pressable>
    </ScreenModal>
  );
}

/**
 * Choose the equipment, and for a machine, which one.
 *
 * The machine field is free text because the machines in one gym are not the
 * machines in another — a fixed list would be wrong everywhere. Names already
 * used for THIS lift appear as chips, which is the whole of "save it for easy
 * access": the machines someone knows about are the ones they have logged, so
 * the list is the history rather than a second thing to maintain.
 */
/**
 * How this lift is done. No SAVE button.
 *
 * Tapping BARBELL or DUMBBELL is the whole answer, so it commits and the sheet
 * goes down — a confirm step after an unambiguous single choice is a tap spent
 * agreeing with yourself, which is exactly what §4's budget is about.
 *
 * MACHINE is the one answer that has a second half: the user asked to record
 * WHICH machine, "aka arsenal lateral raise", and to have it offered again next
 * time. So machine commits the kit immediately — the sheet is already correct at
 * that point — and stays up to offer the names it knows. Picking one, or typing
 * a new one and hitting return, closes it. Dismissing without naming one leaves
 * the kit set, which is a complete and truthful answer on its own.
 */
function EquipmentSheet({ state, onPick, onApply, onClose, skipMachine, onSkipMachine }: {
  state: NowState;
  /** Record it and close. */
  onPick: (kit: Equipment | null, machine?: string) => void;
  /** Record it and stay up — the machine-name step. */
  onApply: (kit: Equipment | null, machine?: string) => void;
  onClose: () => void;
  /** Whether the "which one" step is switched off — see PREF_SKIP_MACHINE. */
  skipMachine: boolean;
  onSkipMachine: (skip: boolean) => void;
}) {
  const [kit, setKit] = useState<Equipment | null>(state.equipment);
  const [machine, setMachine] = useState(state.machine ?? '');
  const still = useReducedMotion();
  // `onApply` and `onSkipMachine` never close the sheet — they land a value
  // and keep the machine-name step up — so only `onClose` and `onPick`
  // (every chip that is a COMPLETE answer) need the deferred leave.
  const { closing, leave } = useExitOnce(still);
  /*
   * A typed machine name is an answer, and an answer given and then abandoned
   * is an answer thrown away -- the rule the kit chips above already follow.
   * Owner, 2026-09-10: "save the machine name on tap away". Return was the only
   * commit, so typing "Arsenal" and dismissing the keyboard or tapping outside
   * kept MACHINE and silently dropped the name. Only when it changed, so an
   * untouched field neither re-records nor buzzes.
   */
  const keepName = () => {
    if (kit === 'machine' && machine.trim() !== (state.machine ?? '')) onApply('machine', machine);
  };
  const close = () => { keepName(); leave(onClose); };
  const pick = (k: Equipment | null, m?: string) => leave(() => onPick(k, m));

  return (
    <ScreenModal visible animationType="none" transparent exiting={closing} onRequestClose={close}>
      <Pressable style={s.backdrop} onPress={close}>
        <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
          <View style={s.grabber} />
          <Text style={s.sheetTitle}>{T('doneOn')}</Text>

          <View style={s.kitRow}>
            {EQUIPMENT.map(e => (
              <Pressable
                key={e}
                // Barbell and dumbbell are complete answers, so they land and
                // close. Machine lands too, then asks which one.
                /*
                 * Barbell and dumbbell are complete answers, so they land and
                 * close. Machine lands too, then asks which one — unless the
                 * user has said not to, in which case it behaves like the other
                 * two. Tapping MACHINE a second time when it is already the
                 * chosen kit turns the question back on: the control that
                 * silenced the step is the same one that restores it, which is
                 * the only place somebody would think to look.
                 */
                onPress={() => {
                  const already = kit === e;
                  setKit(e);
                  if (e !== 'machine') return pick(e);
                  if (already && skipMachine) { onSkipMachine(false); return; }
                  if (skipMachine) return pick(e, machine);
                  onApply(e, machine);
                }}
                style={pressState => [
                  s.kitChip, kit === e && s.kitChipOn, ...pressStyle(null, 'surface', still)(pressState)
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  e === 'machine' && skipMachine
                    ? T('machineTapAgain')
                    : T(KIT_KEY[e])
                }
                {...onState(kit === e)}
              >
                <Text style={[s.kitChipText, kit === e && s.kitChipTextOn]}>
                  {T(KIT_KEY[e])}
                </Text>
              </Pressable>
            ))}
          </View>

          {kit === 'machine' && skipMachine && (
            <Text style={s.kitHint}>
              {T('notAskingMachine')}
            </Text>
          )}

          {kit === 'machine' && !skipMachine && (
            <>
              <Text style={s.kitLabel}>{T('whichOne')}</Text>
              {state.knownMachines.length > 0 && (
                <View style={s.kitRow}>
                  {state.knownMachines.map(m => (
                    <Pressable
                      key={m}
                      accessibilityLabel={m}
                      // A machine you have used before is a finished answer.
                      onPress={() => { setMachine(m); pick('machine', m); }}
                      style={pressState => [
                        s.kitChip, machine === m && s.kitChipOn,
                        ...pressStyle(null, 'surface', still)(pressState)
                      ]}
                      accessibilityRole="button"
                      {...onState(machine === m)}
                    >
                      <Text style={[s.kitChipText, machine === m && s.kitChipTextOn]}>{m}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <TextInput
                style={s.kitInput}
                value={machine}
                onChangeText={setMachine}
                // Return commits and closes; losing focus (the keyboard
                // dismissed, a tap elsewhere on the sheet) commits and stays.
                onSubmitEditing={() => pick('machine', machine)}
                onBlur={keepName}
                returnKeyType="done"
                placeholder={T('machineNamePlaceholder')}
                placeholderTextColor="#7C8792"
                autoCapitalize="words"
                accessibilityLabel={T('machineNameA11y')}
              />

              {/* Offered where the cost is being paid, not buried in settings —
                  though it is in settings too, because a preference you can only
                  reach through a sheet you are trying to stop seeing is a
                  preference you cannot undo. */}
              <Pressable accessibilityRole="checkbox"
                aria-checked={skipMachine}
                accessibilityLabel={T('dontAskAgain')}
                style={pressStyle(s.kitCheck, 'quiet', still)}
                hitSlop={8}
                onPress={() => { onSkipMachine(true); pick('machine', machine); }}
              >
                <View style={s.kitBox} />
                <Text style={s.kitCheckText}>{T('dontAskAgain')}</Text>
              </Pressable>
            </>
          )}

          {/* CLEAR survives because it is the one thing tapping a chip cannot
              say: that this lift has no equipment recorded at all. SAVE does not
              — every chip above already saved. */}
          {state.equipment !== null && (
            <View style={s.kitActions}>
              <Pressable style={pressStyle(s.kitClear, 'surface', still)} onPress={() => pick(null)} accessibilityRole="button"
                accessibilityLabel={T('clearEquipmentA11y')}>
                <Text style={s.kitClearText}>{T('clear')}</Text>
              </Pressable>
            </View>
          )}
        </Pressable>
      </Pressable>
    </ScreenModal>
  );
}

function Jump({ label, onPress, hint }: { label: string; onPress: () => void; hint: string }) {
  const still = useReducedMotion();
  return (
    <Pressable
      onPress={onPress}
      /*
       * Was a flat 14 on every side, which is generous vertically and wrong
       * horizontally: the −45 and +45 buttons are drawn 14px apart, so 14 of
       * slop on each of them made their touchable regions OVERLAP across that
       * whole gap. An overlapped region is not a bigger target, it is an
       * ambiguous one — a tap in the middle goes to whichever the responder
       * resolves first, and on this row the two answers are "take 45 off" and
       * "put 45 on".
       *
       * `slop` splits the two axes: 8 above and below to reach the app's own
       * 56px minimum from a 40px box, and 6 either side, which is as much as
       * a 14px gap allows while leaving 2px between the two regions.
       */
      hitSlop={slop(40, 14)}
      accessibilityRole="button"
      accessibilityLabel={hint}
      style={pressStyle(s.jump, 'surface', still)}
    >
      {/* R339: same exemption as the steppers — a short label in a fixed-size
          chip, sized to the row it shares with them. */}
      <Text style={s.jumpText} allowFontScaling={false}>{label}</Text>
    </Pressable>
  );
}

/**
 * The logging column: a plain View on a phone, a ScrollView on a window that
 * cannot hold it.
 *
 * Split out rather than branched inline because the two need different props —
 * a ScrollView positions its children through `contentContainerStyle`, and
 * putting `flex: 1` on the ScrollView itself instead would collapse the column
 * to its content and break `todayWrap`'s ability to absorb slack.
 */
function ColumnWrap({ scrolls, tight, children }: {
  scrolls: boolean;
  tight: boolean;
  children: React.ReactNode;
}) {
  if (!scrolls) {
    return <View style={[s.content, tight && s.contentTight]}>{children}</View>;
  }
  return (
    <ScrollView
      style={s.contentScroll}
      contentContainerStyle={[s.content, s.contentTight, { flexGrow: 1 }]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

function Stepper({ label, onPress, small, what }: {
  label: string;
  onPress: () => void;
  small?: boolean;
  /** What is being stepped, so the four of them are not all "Increase". */
  what: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      // Without an explicit role these read as plain text to VoiceOver — the
      // a11y tree showed "generic" for every stepper, the typed-entry targets
      // and LOG SET itself.
      accessibilityRole="button"
      accessibilityLabel={fill(T(label === '+' ? 'increaseWord' : 'decreaseWord'), {
        what: (what === 'weight' ? T('weight') : T('reps')).toLowerCase()
      })}
      style={({ pressed }) => [
        s.stepper,
        small && s.stepperSmall,
        pressed && { backgroundColor: '#191D21' }
      ]}
    >
      {/* R339: a glyph in a fixed-size circular button, not paragraph text —
          the same exemption as the hero number, for the same reason: Dynamic
          Type has nowhere to put a bigger + or − than the button drawn
          around it. */}
      <Text style={[s.stepperText, small && { fontSize: 26 }]} allowFontScaling={false}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: {                                                 // maxWidth from layoutFor
    flex: 1, width: '100%', alignSelf: 'center',
    // 8, not more. R511 raised this to 16 for the breathing room OWNER.md asks
    // for, and R512 found what that cost: the shortest shipping phone (568px)
    // has no 8px to give — the unshrinkable column came to 624 against 568 and
    // LOG SET went below the fold. Air at the top has to come from layoutFor's
    // scaled gaps, which shrink on a short screen, not from a fixed padding
    // that does not.
    backgroundColor: BG, paddingHorizontal: 20, paddingTop: 8
  },
  /*
   * R339: found at 2.35x Dynamic Type (iOS's largest accessibility size) —
   * this row has no flexShrink and no wrap, so PROGRESS / GOALS / the streak
   * / the gear simply overflow the screen's right edge once their own text
   * grows past what `space-between` has room for. Nothing errors; the gear
   * — the only route to Settings from this screen — just renders off-screen
   * and becomes unreachable. `flexWrap` costs nothing at normal scale
   * (unchanged, still one line, still the exact spacing the comment above
   * measured) and turns "unreachable" into "a second line" at extreme scale.
   */
  /*
   * `flex-start`, not `center`.
   *
   * Centring was inert in the good case and actively harmful in the bad one.
   * `todayWrap` below is `flex: 1`, so it already absorbs every spare pixel —
   * there is never any free space left for `justifyContent` to distribute, and
   * centring changed nothing on a screen that fits.
   *
   * On a screen that does NOT fit, it decided where the overflow went, and it
   * split it both ways. Measured at 281x460: the column came to 401px in a 391px
   * container, and the 10px difference put the exercise name at y34 — above the
   * container's own top at y39 — drawing it straight over the PROGRESS / GOALS
   * links. Ten pixels of overflow produced overlapping text at the very top of
   * the screen, which is what "it doesn't fit" looks like.
   *
   * So the alignment follows whether there is room: centred while there is, and
   * top-aligned once there is not, where overflow can only go DOWNWARD into
   * `todayWrap`'s `overflow: hidden` and the footer — the two parts designed to
   * give. `flex-start` unconditionally was the first attempt and it was wrong in
   * the other direction: on a 375x812 phone the column collapsed to the top and
   * left 340px of dead space under it.
   *
   * `todayMin === 0` is the signal, and it is the model's own: `layoutFor`
   * hands TODAY whatever space remains after everything that cannot shrink, so
   * zero means the screen is already out of room.
   */
  content: { flex: 1, justifyContent: 'center' },
  contentTight: { justifyContent: 'flex-start' },
  contentScroll: { flex: 1 },
  header: { alignItems: 'center' },                       // marginBottom from layoutFor
  // The stretch has to be on the PRESSABLE, not on the Text inside it.
  // `numberOfLines={1}` can only ellipsize against a definite width, and the
  // header's `alignItems: center` sizes the Pressable to its content — so the
  // Text was measured inside an unbounded parent whatever was set on it.
  // "Romanian Deadlift From A Deficit" came out 491px wide on a 375px screen,
  // hanging off BOTH edges. `maxWidth: '100%'` on the Text did not bind either.
  exerciseTap: { flex: 1, minWidth: 0 },
  // The name keeps the width it had and the streak takes only what its own
  // text needs, so a long lift still ellipsizes instead of pushing it off.
  exerciseLine: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 12 },
  exerciseRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Sized off the name rather than the label scale: it belongs to the
  // heading it marks, not to the chrome around it.
  exerciseCaret: { color: '#7C8792', fontSize: 15, fontWeight: '700', marginTop: 2 },
  /*
   * R511, on the owner's note that the screen 'looks a little sloppy and
   * AI-generated'. This was 22px with letterSpacing 2 -- the exact treatment
   * used by `railLabel` and every other CHROME label on the screen,
   * only bigger. Wide tracking on a short all-caps string reads as a category
   * heading, so the one thing the screen is actually about was dressed as
   * furniture, and nothing on the page claimed the top of the hierarchy.
   *
   * A name, now: tracked at 0.6 rather than 2, which is where a title sits in
   * every fitness app worth comparing against. The labels around it keep their
   * wide tracking, so 'this is the thing' and 'this is a label' are told apart
   * by the TYPE rather than by size.
   *
   * The size deliberately does not move. 26 was tried and is wrong: `L.hero`
   * floors at 24, so on the smallest viewport a 26px name would outgrow the
   * weight itself and take the top of the hierarchy from the number §4 puts at
   * the centre of the screen. Anything at or above 24 is the same bug.
   */
  exercise: {
    color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: 0.6,
    textAlign: 'center'
  , flexShrink: 1},
  // `alignSelf: 'stretch'` for the same reason `exerciseTap` needs it:
  // numberOfLines can only ellipsize against a DEFINITE width, and a
  // shrink-to-fit Text in a centred column has none. `textAlign` keeps it
  // looking exactly as it did while it was shrink-to-fit and centred.
  /*
   * Volt, because a streak is the one thing on this screen that is news, and
   * small, because §15 spends the accent without letting it compete with the
   * hero. Sized at `label` so the row's height is still set by the gear.
   */
  streak: {
    color: VOLT, fontSize: TYPE.label, fontWeight: '900', letterSpacing: SPACING.label
  },
  lastTime: {
    color: MUTED, fontSize: TYPE.lead, marginTop: 8, fontWeight: '500',
    alignSelf: 'stretch', textAlign: 'center'
  },
  lastTimeHit: { color: VOLT, fontWeight: '800' },

  heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  /*
   * `flexShrink: 1, minWidth: 0` — the same fix, the fourth time this exact
   * bug has appeared (measure.tsx's entry field, goals.tsx's filterScroll,
   * and now here). `L.hero`'s font size is computed in layoutFor to fit the
   * COMMITTED weight's digit count, which is capped at 4 by domain rules
   * (MAX_TYPED_WEIGHT caps a committed value at 1500) — but the TYPED text
   * while the user is mid-entry can run to 6 raw digits (TYPED_MAX) before
   * `typedWeight` ever validates it, at the SAME large font size. Measured
   * live at a real 390px width: typing '999999' pushed the '+' weight
   * stepper to x944 — off the visible screen and completely untappable,
   * not merely visually wrong.
   */
  heroNumbers: { flexDirection: 'row', alignItems: 'baseline', flexShrink: 1, minWidth: 0 },
  weight: { color: '#fff', fontWeight: '900', letterSpacing: -3 },
  unit: { color: VOLT, fontSize: 24, fontWeight: '900', marginLeft: 6 },
  unitFloat: { position: 'absolute', left: '100%', bottom: 0 },
  // A word, not a unit: smaller, and left to wrap in the space the unit had.
  unitWord: { fontSize: 11, letterSpacing: 1, width: 62, marginLeft: 8 },
  stepHint: { color: '#7C8792', fontSize: 12, textAlign: 'center', marginTop: -4, letterSpacing: 1 },
  hintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  /** Fixed-width slot, so each row stays symmetrical about its number. */
  jumpSlot: { width: 40, alignItems: 'center' },
  jump: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 1, borderColor: '#242A30',
    alignItems: 'center', justifyContent: 'center'
  },
  jumpText: { color: MUTED, fontSize: 12, fontWeight: '800' },
  planRow: {
    paddingVertical: 18, paddingHorizontal: 16, borderRadius: 12, marginTop: 10,
    borderWidth: 1, borderColor: '#2A323A', backgroundColor: '#111417'
  },
  planRowOn: { borderColor: VOLT },
  planHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  planTick: { color: VOLT, fontSize: 15, fontWeight: '900' },
  planText: { color: '#E8EAED', fontSize: 15, fontWeight: '800', letterSpacing: 1.2 },
  /*
   * Two lines of room, always.
   *
   * Measured at 390px: the push/pull/legs and upper/lower blurbs wrap to two
   * lines and FULL BODY's fits on one, so the three options came out 100, 100
   * and 82px — a set of three choices where the last one looks like it did not
   * finish loading. Trimming the copy to one line each was the other option and
   * a worse one: these sentences exist so a beginner is not given a vocabulary
   * test, and "push, then pull, then legs" cannot explain push/pull/legs.
   *
   * So the blurb keeps its own height rather than the text deciding it. The
   * shortest option gets a little air under it, which reads as spacing; the
   * ragged set read as a bug.
   */
  planBlurb: {
    color: '#7C8792', fontSize: 12, lineHeight: 18, marginTop: 6, fontWeight: '500',
    minHeight: 36
  },
  planTextOn: { color: VOLT },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  planSwap: { color: '#9AA5AF', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  dayRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  dayChip: {
    flex: 1, height: 84, borderRadius: 14,
    borderWidth: 1, borderColor: '#2A323A', backgroundColor: '#111417',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6
  },
  dayChipWide: { height: 72 },
  dayChipText: { color: '#E8EAED', fontSize: 14, fontWeight: '900', letterSpacing: 1.2 },
  skip: { alignSelf: 'center', marginTop: 20, paddingVertical: 8 },
  skipText: { color: '#9AA5AF', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },

  kitTag: {
    color: '#9AA5AF', fontSize: 11, fontWeight: '800', letterSpacing: 1.6, marginTop: 7
  },
  kitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  kitChip: {
    paddingHorizontal: 14, height: 42, borderRadius: 12, justifyContent: 'center',
    borderWidth: 1, borderColor: '#2A323A', backgroundColor: '#111417'
  },
  kitChipOn: SELECTED,
  kitChipText: { color: '#C3CBD2', fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
  kitChipTextOn: SELECTED_TEXT,
  kitHint: { color: '#9AA5AF', fontSize: TYPE.meta, marginTop: 16, lineHeight: 18 },
  kitCheck: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16 },
  kitBox: {
    width: 20, height: 20, borderRadius: 5,
    borderWidth: 1.5, borderColor: '#7C8792'
  },
  kitCheckText: { color: '#9AA5AF', fontSize: TYPE.body, fontWeight: '600' },
  kitLabel: {
    color: MUTED, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginTop: 20
  },
  kitInput: {
    height: 48, paddingHorizontal: 14, marginTop: 12,
    backgroundColor: '#111417', borderRadius: 12,
    borderWidth: 1, borderColor: '#2A323A',
    color: '#fff', fontSize: 15, fontWeight: '600'
  },
  kitActions: { flexDirection: 'row', gap: 12, marginTop: 22, alignItems: 'stretch' },
  kitClear: {
    paddingHorizontal: 20, height: 54, borderRadius: 14,
    borderWidth: 1, borderColor: '#2A323A', alignItems: 'center', justifyContent: 'center'
  },
  kitClearText: { color: MUTED, fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },

  jumpEditRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  jumpInput: {
    width: 96, height: 48, paddingHorizontal: 14,
    backgroundColor: '#111417', borderRadius: 12,
    borderWidth: 1, borderColor: '#2A323A',
    color: '#fff', fontSize: 18, fontWeight: '800'
  },
  jumpEditUnit: { color: MUTED, fontSize: 14, fontWeight: '600' },
  save: {
    height: 54, borderRadius: 14, backgroundColor: VOLT,
    alignItems: 'center', justifyContent: 'center', marginTop: 22
  },
  saveText: { color: '#000', fontSize: 14, fontWeight: '900', letterSpacing: 2 },

  repsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 14                                   // 22 before the jump joined the row
  },
  reps: { color: '#fff', fontSize: 40, fontWeight: '800' },
  repsLabel: { color: MUTED, fontSize: 12, fontWeight: '600' },
  repsInput: { minWidth: 92, textAlign: 'center', padding: 0 },

  stepper: {
    width: HIT, height: HIT, borderRadius: HIT / 2, borderWidth: 1, borderColor: '#242A30',
    alignItems: 'center', justifyContent: 'center'
  },
  stepperSmall: { width: 48, height: 48, borderRadius: 24 },
  stepperText: { color: '#fff', fontSize: 30, fontWeight: '600', marginTop: -3 },

  clear: {
    paddingHorizontal: 16, height: 40, borderRadius: 12,
    borderWidth: 1, borderColor: '#242A30',
    alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end'
  },
  clearText: { color: '#9AA5AF', fontSize: 12, fontWeight: '800', letterSpacing: 1.6 },

  logButton: {                                            // height + marginTop from layoutFor
    backgroundColor: VOLT, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center'
  },
  logText: { color: '#000', fontSize: 20, fontWeight: '900', letterSpacing: 2 },

  weightInput: { padding: 0, minWidth: 120, flexShrink: 1, textAlign: 'center' },

  restRow: { minHeight: 20, alignItems: 'center' },       // marginTop from layoutFor
  restText: { color: '#9AA5AF', fontSize: 12, fontWeight: '800', letterSpacing: 1.6 },
  // Past the cold threshold it stops being neutral information and starts being
  // worth noticing. Still not a nag — a colour change, no alert, no sound.
  restCold: { color: '#7C8792' },

  // `overflow: hidden` and `minHeight: 0` are load-bearing, not tidiness. A
  // flex child's implicit min-height is its CONTENT, so on a short viewport
  // this refused to shrink and the set chips painted straight over UP NEXT and
  // FINISH. Clipping here is safe because the list inside scrolls.
  todayWrap: { flex: 1, overflow: 'hidden' },             // marginTop + minHeight from layoutFor
  // Scroll mode only (R652): natural height, so the column grows and scrolls
  // to TODAY instead of TODAY shrinking to nothing inside a scrolling column.
  todayWrapScroll: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
  todayHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#161B20'
  },
  todayLabel: { color: '#7C8792', fontSize: 10, fontWeight: '800', letterSpacing: 1.8 },
  nextGroup: { flexDirection: 'row', alignItems: 'baseline', gap: 9 },
  /** The one forward-looking thing in this block, so it gets the weight. */
  nextSet: { color: '#E8EAED', fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  todayTotals: { color: MUTED, fontSize: 12, fontWeight: '700' },
  todayScroll: { flex: 1, minHeight: 0 },

  liftBlock: { paddingVertical: 12 },
  liftHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liftDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: VOLT },
  liftName: { color: '#C7CED6', fontSize: 14, fontWeight: '800', letterSpacing: .2, flexShrink: 1 },
  liftNameCurrent: { color: '#E8EAED' },
  liftCount: { color: '#7C8792', fontSize: 11, fontWeight: '700', marginLeft: 'auto' },
  liftEmpty: { color: '#7C8792', fontSize: 12, marginTop: 5, fontStyle: 'italic' },
  liftSets: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7, alignItems: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#0F1113', borderRadius: 9, paddingVertical: 8, paddingHorizontal: 12, marginRight: 8
  },
  // Armed, not deleted: one tap lights the set, the second removes it. A chip
  // is small and sits beside four others, so a control that destroyed a real
  // set on a single stray tap would trade one mistake for another.
  chipArmed: { borderColor: '#FF6B6B', backgroundColor: '#2A1416' },
  chipArmedText: { color: '#FF6B6B' },
  /*
   * A set that broke a record. Volt on the border and the number, which is the
   * accent §15 allows one use of — and this is what it is for: not the loudest
   * thing on the screen, the truest.
   *
   * The chip already ARRIVES with motion (see `Arrive`), so a PR needs no
   * separate animation; it inherits the one the app already had and differs in
   * colour. That also keeps §12's rule intact — the resting style is the
   * visible one, so a chip that never animates is still marked.
   */
  chipPR: { borderWidth: 1, borderColor: VOLT, backgroundColor: '#14170D' },
  chipTextPR: { color: VOLT },
  chipPRMark: { color: VOLT, fontSize: 11, fontWeight: '900' },
  chipIndex: { color: '#7C8792', fontSize: 12, fontWeight: '700' },
  chipText: { color: '#E8EAED', fontSize: 15, fontWeight: '700' },
  undo: { paddingHorizontal: 12, paddingVertical: 10 },
  addSet: {
    // Same height as UNDO so the row reads as one strip of controls rather
    // than two things that happen to be adjacent.
    minWidth: 44, height: 34, paddingHorizontal: 12, borderRadius: 10,
    borderWidth: 1, borderColor: '#243039', backgroundColor: '#101519',
    alignItems: 'center', justifyContent: 'center'
  },
  addSetText: { color: VOLT, fontSize: 18, fontWeight: '900', marginTop: -2 },
  chipNote: { color: '#9AA5AF', fontSize: 11, marginLeft: 6 },

  editSheet: {
    ...COLUMN,
    backgroundColor: '#0C0E10', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 22, paddingTop: 10, paddingBottom: 28, maxHeight: '86%'
  },
  editTitle: { color: '#7C8792', fontSize: TYPE.label, fontWeight: '800', letterSpacing: SPACING.label, marginBottom: 14 },
  editRow: { flexDirection: 'row', gap: 12 },
  editField: { flex: 1 },
  editLabel: { color: '#7C8792', fontSize: TYPE.micro, fontWeight: '800', letterSpacing: SPACING.micro, marginTop: 14, marginBottom: 8 },
  editInput: {
    height: 56, paddingHorizontal: 14, backgroundColor: '#111417', borderRadius: 12,
    borderWidth: 1, borderColor: '#2A323A', color: '#fff', fontSize: 22, fontWeight: '800'
  },
  editNote: {
    minHeight: 72, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12,
    backgroundColor: '#111417', borderRadius: 12,
    borderWidth: 1, borderColor: '#2A323A', color: '#E8EAED', fontSize: 15, fontWeight: '500'
  },
  editSave: {
    backgroundColor: VOLT, borderRadius: 16, height: 58,
    alignItems: 'center', justifyContent: 'center', marginTop: 20
  },
  editSaveOff: { opacity: 0.35 },
  editSaveText: { color: '#000', fontSize: TYPE.lead, fontWeight: '900', letterSpacing: SPACING.micro },
  editRemove: { alignItems: 'center', paddingVertical: 16 },
  editRemoveText: { color: '#B87A7A', fontSize: TYPE.label, fontWeight: '800', letterSpacing: SPACING.label },

  undoText: { color: MUTED, fontSize: 12, fontWeight: '700', letterSpacing: 1 },

  footer: {
    flexDirection: 'row', alignItems: 'flex-end',
    justifyContent: 'center', gap: 12
  },  // marginTop from layoutFor
  railBand: {
    marginTop: 6, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#161B20'
  },
  railLabel: { color: '#7C8792', fontSize: TYPE.micro, fontWeight: '800', letterSpacing: SPACING.micro },
  // Same tier as `railLabel`, because they are the same kind of thing: the
  // name of the block beneath. Anything louder would compete with the lift
  // names it is introducing.
  todayHeading: {
    color: '#7C8792', fontSize: TYPE.micro, fontWeight: '800',
    // 4, not 8. See TODAY_HEADING in now-model: the extra four pixels put a
    // 568px SE over §4's no-scroll budget, and a heading sitting close to the
    // list it names is not a worse heading.
    letterSpacing: SPACING.micro, marginBottom: 4
  },
  railRow: { flexDirection: 'row', gap: 8, paddingTop: 8, paddingRight: 20 },
  // A plain wrapper so the fade has something to be absolute inside. It sets
  // no size of its own, so the band is still exactly as tall as its content —
  // the property the railBand comment insists on.
  // Positioning context only. No size of its own, so the rows inside stack
  // exactly as they did and `fixedHeight`'s arithmetic is untouched.
  logPanel: { position: 'relative' },
  /*
   * Negative insets, so it reads as padding and costs none. `bottom` is short
   * of `top` because LOG SET sits directly beneath with its own `logGap`, and
   * a panel that reached all the way down would crowd it.
   */
  logPanelSurface: {
    position: 'absolute', left: -10, right: -10, top: -14, bottom: -10,
    borderRadius: 18, backgroundColor: '#0D1014',
    borderWidth: 1, borderColor: '#181D23'
  },
  railScroller: { position: 'relative' },
  railFade: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 32, flexDirection: 'row' },
  railFadeSlice: { flex: 1, backgroundColor: BG },
  railChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: RAIL_CHIP, paddingHorizontal: 14, borderRadius: RAIL_CHIP / 2,
    borderWidth: 1, borderColor: '#242A30', backgroundColor: '#101316'
  },
  // The original of the treatment `SELECTED` now standardises.
  railChipOn: SELECTED,
  // Dimmed by colour alone. Stacking an opacity on top of an already-muted
  // label put the text near 2:1 against the chip — legible to nobody.
  railChipDone: { borderColor: '#1B2026', backgroundColor: '#0C0F12' },
  railText: { color: '#C7CED6', fontSize: 14, fontWeight: '700' },
  railTextOn: { color: VOLT },
  railTextDone: { color: '#79838D' },
  railNext: { color: VOLT, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  /*
   * The bottom bar -- shipped R640 on the owner's word (2026-09-10), replacing
   * the PROGRESS / GOALS / gear row that used to sit above the lift.
   *
   * A real bar rather than a mock — 56px, so each destination keeps a 44pt
   * target with a label under its glyph, which is what makes it a tab bar and
   * not a row of icons. Measuring the current screen against a fake would
   * answer nothing.
   *
   * `marginHorizontal: -20` cancels the root padding so the bar reaches both
   * edges, which is what makes it read as chrome rather than as content.
   */
  // TabBar is COLUMN-capped (width 100%). Inside Now's padded column that
  // 100% is the padded width, so the bleed only shifted it: measured 335px at
  // left 20 on a 375px phone (R650). Stretch restores the full-bleed width;
  // COLUMN's maxWidth still caps it at 430 on a wide window.
  tabBleed: { marginHorizontal: -20, alignSelf: 'stretch', width: 'auto' },
  finish: { paddingVertical: 12, paddingHorizontal: 16 },
  finishText: { color: MUTED, fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    // Capped and centred, like every other surface. A bottom sheet that
    // spans a 1024px window over a 430px app is not the same product.
    ...COLUMN,
    backgroundColor: '#0C0E10', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28,
    // 86%, the same cap R35 chose for the Goals sheet. This one was 72% and had
    // simply never been revisited: with the list grouped by split day (R33) and
    // one movement the user added, 174px of a 624px list was below the cut —
    // the whole LEGS group, with a 7px sliver of Deadlift as the only clue.
    // The extra 14% is free; it is backdrop nobody was using.
    maxHeight: '86%'
  },
  grabber: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: '#2A323A',
    alignSelf: 'center', marginBottom: 16
  },
  sheetHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6
  },
  sheetTitle: { color: MUTED, fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  sheetDay: { color: VOLT, fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  otherDays: { color: '#9AA5AF', fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  groupLabel: {
    color: '#7C8792', fontSize: 10, fontWeight: '800', letterSpacing: 1.8,
    marginTop: 14, marginBottom: 2, paddingHorizontal: 6
  },
  // The day being trained is the reason the sheet is in this order, so it is
  // the one label that is allowed to be loud.
  groupLabelLead: { color: VOLT },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: HIT, paddingHorizontal: 6, borderRadius: 10
  },
  pickName: { color: '#E8EAED', fontSize: 15, fontWeight: '600' },
  addPrompt: { color: MUTED, fontSize: 15, fontWeight: '600' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: HIT },
  addInput: {
    flex: 1, color: '#fff', fontSize: 15, fontWeight: '600',
    borderBottomWidth: 1, borderBottomColor: '#242A30', paddingVertical: 10, paddingHorizontal: 6
  },
  addGo: { paddingHorizontal: 12, paddingVertical: 12 },
  addGoText: { color: VOLT, fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  pickCurrent: { color: VOLT },
  pickDot: { color: VOLT, fontSize: 10 },
  pickRemove: { paddingHorizontal: 10, paddingVertical: 4 },
  pickRemoveText: { color: MUTED, fontSize: 18, fontWeight: '600', lineHeight: 18 },
  // Same red as Progress's own inline error (`weeklyShareError`) — this app's
  // one established colour for "that didn't work", not a bespoke grey.
  removeError: { color: '#FF8A8A', fontSize: TYPE.meta, paddingHorizontal: 6, paddingTop: 6 }
});

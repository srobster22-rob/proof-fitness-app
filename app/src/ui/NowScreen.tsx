import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  useWindowDimensions,
  PanResponder,
  AppState
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import * as KeepAwake from 'expo-keep-awake';
import { NowModel, PREF_SKIP_MACHINE } from './now-model.ts';
import { typedWeight } from './now-steppers.ts';
import { layoutFor, revealOffset } from './now-layout.ts';
import type { NowState } from './now-state.ts';
import { restSince } from '../domain/rest.ts';
import { loadLabel, type LoggedSet } from '../domain/types.ts';
import { ConfirmSheet } from './ConfirmSheet.tsx';
import type { Repo } from '../data/repo.ts';
import { TabBar } from './TabBar.tsx';
import { useDragScroll } from './drag-scroll.ts';
import { Arrive } from './Arrive.tsx';
import { streakWorthShowing } from './recap-model.ts';
import { pressStyle, useReducedMotion, slop, onState } from './press.ts';
import { t, fill, languageOf, number, DAY_HEADING_KEY, KIT_KEY } from '../domain/i18n.ts';
import { getRepo } from '../data/db.ts';
import { KEEP_AWAKE_TAG, RAIL_FADE, SWIPE_MIN, T, feedback } from './now-kit.ts';
import { s } from './now-styles.ts';
import { ColumnWrap, Jump, Stepper } from './NowControls.tsx';
import { DayChooser } from './DayChooser.tsx';
import { EditSetSheet } from './EditSetSheet.tsx';
import { ExercisePicker } from './ExercisePicker.tsx';
import { EquipmentSheet } from './EquipmentSheet.tsx';

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
   *
   * Not in the minutes after DONE (`justFinished`, R679). DONE begins the next
   * session at once, and the sheet then covered the tab bar: someone who had
   * just finished and wanted Progress or Goals had to answer for a workout they
   * had not started. It is asked when they come back to train.
   */
  const dayOpen = !state.dayAsked && !state.justFinished && state.loggedThisSession.length === 0;
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
            by 18px with nothing in the fit math expecting it.

            So the row is one line tall and wraps: the goal fits beside the
            numbers or drops whole onto a second line nobody sees. It used to
            be cut mid-number instead, "try 200 · 30 to 2…", which reads as a
            wrong number (PT1). The goal still goes before the numbers do. */}
        <View style={s.lastTime} role="status" aria-live="polite">
          {/* A made call (R682) in volt, for the rest of the workout. */}
          <Text style={[s.lastTimeText, state.lastTime.made && s.lastTimeHit]} numberOfLines={1}>
            {state.lastTime.head}
          </Text>
          {/* Volt only for the set that just hit the goal. §15 spends the accent
              on what matters right now, and for the length of one set that is
              this — it is a different size class from the hero, so it draws the
              eye without competing with the number. A gap still to close stays
              grey: it is information, not news. */}
          {state.lastTime.tail !== '' && (
            <Text style={[s.lastTimeText, s.lastTimeTail, state.lastTime.hit && s.lastTimeHit]} numberOfLines={1}>
              {state.lastTime.tail.trimStart()}
            </Text>
          )}
        </View>

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
                       put, which is what stops one arrival becoming a flock.

                       The LATEST set's slot also holds UNDO and +, and the list
                       wraps slots, never inside one: so the set just logged and
                       its two buttons always share a line. Wrapped apart, the
                       list's one-line window at 375x812 showed UNDO and + with no
                       set beside them after three sets (R685's blind re-score). */
                    <View key={set.id} style={i === lift.sets.length - 1 ? s.lastSetGroup : undefined}>
                    <Arrive>
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
                        (state.prSetIds.includes(set.id) ? T('personalRecordA11y') : '') +
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
                    {i === lift.sets.length - 1 && (<>
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
                    </>)}
                    </View>
                  ))}
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
        search={query => model.searchExercises(query)}
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

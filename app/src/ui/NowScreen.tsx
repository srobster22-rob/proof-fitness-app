import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  useWindowDimensions
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { NowModel, PREF_SKIP_MACHINE } from './now-model.ts';
import { layoutFor } from './now-layout.ts';
import type { NowState } from './now-state.ts';
import { restSince } from '../domain/rest.ts';
import { loadLabel, type LoggedSet } from '../domain/types.ts';
import { ConfirmSheet } from './ConfirmSheet.tsx';
import type { Repo } from '../data/repo.ts';
import { TabBar } from './TabBar.tsx';
import { useDragScroll } from './drag-scroll.ts';
import { pressStyle, useReducedMotion } from './press.ts';
import { fill, languageOf, number } from '../domain/i18n.ts';
import { getRepo } from '../data/db.ts';
import { T, feedback, type NowSection } from './now-kit.ts';
import { s } from './now-styles.ts';
import { ColumnWrap } from './NowControls.tsx';
import { DayChooser } from './DayChooser.tsx';
import { EditSetSheet } from './EditSetSheet.tsx';
import { ExercisePicker } from './ExercisePicker.tsx';
import { EquipmentSheet } from './EquipmentSheet.tsx';
import { useAwakeWhileWorking, useSwipeToNext, useTodayReveal, useSetEntry, useRestTick, useResumeOnReturn } from './now-hooks.ts';
import { NowHeader } from './NowHeader.tsx';
import { WeightRows, RepsRow } from './LogRows.tsx';
import { DayRail } from './DayRail.tsx';
import { TodaySets } from './TodaySets.tsx';
import { NowFooter } from './NowFooter.tsx';

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
  useAwakeWhileWorking(state);

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

  const swipe = useSwipeToNext(model, sync);

  const { blockLayouts, revealCurrent, TodayList, todayListProps } = useTodayReveal(state, L);

  // Guards FINISH against a same-tick double tap pushing /recap twice — see
  // the button's own onPress for the measured failure this closes.
  const finishedRef = useRef(false);

  const { undoingRef, log, bump, typeWeight } = useSetEntry({ model, sync, setState, setTyping, setTypingReps });

  const lastAt = useRestTick(state);

  useResumeOnReturn(model, sync, finishedRef);

  const rest = restSince(lastAt, Date.now());

  // What each section below is drawn from (see `NowSection`).
  const section: NowSection = { L, state, still, model, sync };

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
      <NowHeader {...section} setPickerOpen={setPickerOpen} setEditKit={setEditKit} />

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
      <WeightRows {...section} bump={bump} typing={typing} setTyping={setTyping} typeWeight={typeWeight} />

      {/*
        Steppers outside, jumps inside — the same order as the weight control.
        
        They were mirror-inverted. On the weight rows the outer buttons are the
        fine ±1 steppers and the ±45 jump sits inboard on its own row; on this
        row the outer buttons were the ±5 JUMP and the steppers were inboard. So
        the far-left button meant "one rep" on one row and "five reps" on the
        next, which is the kind of thing you only notice by getting it wrong
        mid-set. Measured before: −45/+45 at x320/374, −5/+5 at x228/474.
      */}
      <RepsRow {...section} bump={bump} typingReps={typingReps} setTypingReps={setTypingReps} />
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

        <DayRail {...section} railDrag={railDrag} />

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
          <TodaySets {...section} blockLayouts={blockLayouts} revealCurrent={revealCurrent}
            undoingRef={undoingRef} setEditingSet={setEditingSet} setAddingTo={setAddingTo} />
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
      <NowFooter {...section} setConfirmClear={setConfirmClear} finishedRef={finishedRef} onFinish={onFinish} />

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

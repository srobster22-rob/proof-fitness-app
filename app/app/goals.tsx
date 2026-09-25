import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useGuardedLeave } from '../src/ui/guarded-push.ts';
import { TabBar } from '../src/ui/TabBar.tsx';
import { goTab } from '../src/ui/tab-bar.ts';
import { getRepo } from '../src/data/db.ts';
import { t, fill, languageOf, dateLocale, FILTER_KEY, SORT_KEY, HORIZON_KEY } from '../src/domain/i18n.ts';
import { planOf } from '../src/domain/split.ts';

/**
 * Every visible string on this screen, in the chosen language.
 *
 * Module scope rather than a binding inside the route component, because this
 * file's chrome is spread across half a dozen sub-components — the goal card,
 * the sheet, the backup block — and threading a `T` prop through each is how
 * one of them ends up forgotten. `getRepo` is a lazily-read singleton, so
 * calling it per string costs a map lookup and always reflects a language
 * changed while the screen is mounted (Settings opens over the top of it).
 */
const T = (k: Parameters<typeof t>[1]) => t(languageOf(getRepo()), k);

import {
  listGoals, createGoal, editGoal, removeGoals, restoreGoals, canAddGoal, suggestTarget, targetBase,
  REP_CHOICES, customReps, horizonDays, HORIZON_UNITS, DAYS_PER, goalLifts,
  type HorizonUnit } from '../src/ui/goals-model.ts';
import { MAX_GOALS, goalCardLine, goalBarA11y } from '../src/domain/goals.ts';
import { PLATE } from '../src/ui/now-steppers.ts';
import { narrativeLine, type Goal, type GoalProgress } from '../src/domain/goals.ts';
import { pickerFor } from '../src/domain/coldstart.ts';
import { COLUMN } from '../src/ui/column.ts';
import { displayUnit } from '../src/ui/display-unit.ts';
import { ScreenModal } from '../src/ui/ScreenModal.tsx';
import { ConfirmSheet } from '../src/ui/ConfirmSheet.tsx';
import { buzz } from '../src/ui/haptics.ts';
import {
  filterGoals, filterCounts, goalFilters, GOAL_SORTS,
  lastView, rememberView, type GoalFilter, type GoalSort } from '../src/ui/goal-filters.ts';
import { TYPE, SPACING } from '../src/ui/type.ts';
import { pressStyle, useReducedMotion, onState, SELECTED, SELECTED_TEXT } from '../src/ui/press.ts';

/**
 * Screen 3 — Goals. PROMPT.md §5.
 *
 * Three, hard capped. The line under each bar is `narrativeLine()` — the same
 * string that goes on the recap — shown here so what the user sees on this
 * screen and what they end up sending are visibly the same sentence.
 */
export default function Goals() {
  const repo = getRepo();
  const router = useRouter();
  // Back, or home when there is nowhere back to — see useGuardedLeave.
  const leave = useGuardedLeave(router);
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  /** The goal being amended, or null. See `editGoal`. */
  const [editing, setEditing] = useState<GoalProgress | null>(null);

  /*
   * Wiping, and taking it back.
   *
   * `wiping` is the single goal awaiting a confirm; `wipeAllStep` counts the
   * three the WIPE ALL control asks for. `undo` holds what was actually removed
   * — see `removeGoals`, which returns it — so putting it back is handing the
   * same objects to `restoreGoals`, `createdAt` and all.
   */
  const [wiping, setWiping] = useState<GoalProgress | null>(null);
  const [wipeAllStep, setWipeAllStep] = useState(0);
  // Honour the system's reduced-motion setting — see `useReducedMotion`.
  const still = useReducedMotion();
  const [undo, setUndo] = useState<{ goals: Goal[]; label: string } | null>(null);

  /*
   * R581. `editing`, `wiping` and `undo` all hold a SNAPSHOT of goal data —
   * not just an id — and none of it was cleared on the way back to this
   * screen. Today that costs nothing: the only way off Goals is `leave`
   * (`router.back()`, a pop), and popping destroys this component's state
   * along with it, so none of these can outlive a trip to another screen.
   *
   * That safety is a property of the CURRENT stack navigation, not of this
   * code, and it is not guaranteed to stay true. Measured directly: with the
   * pop-based safety net set aside, `restoreGoals` — an upsert — happily
   * resurrects a wiped goal even after `eraseAll()`, which is the one action
   * in this app that explicitly promises "this cannot be undone." A future
   * navigation model that keeps this screen mounted alongside others (a tab
   * bar, OWNER.md's own open question, keeps every tab mounted rather than
   * popping) would make that reachable with nobody expecting it.
   *
   * `NowScreen` already has exactly this shape of problem solved via
   * `resume()`, called on `useFocusEffect` — re-sync stale UI state on
   * arrival rather than trust it survived whatever happened while this
   * screen was not the one on screen. Same idea, scoped to what this screen
   * actually holds.
   *
   * R583 found the sibling of this bug ONE ROUND LATER: `goals` itself
   * (`useMemo(() => listGoals(repo, now), [repo, tick])`) only recomputes
   * when `tick` changes, which only happens through this screen's OWN
   * actions — nothing here ever refreshed on arrival. The exact defect
   * `NowScreen.resume()`'s own comment names for a different screen ("a
   * restore — or an erase — on Progress left this screen showing numbers for
   * sets that no longer existed... this screen does not own that data, so it
   * cannot assume it is still what it was") had never been fixed here,
   * because until R581 nothing on Goals ran on focus at all. `setTick`
   * directly, not `refresh` — declared further down this function, after
   * this hook, and reordering unrelated code to reach it is a bigger change
   * than the fix itself.
   */
  useFocusEffect(useCallback(() => {
    setEditing(null);
    setWiping(null);
    setUndo(null);
    setTick(t => t + 1);
  }, []));

  const wipe = useCallback((ids: string[], label: string) => {
    const taken = removeGoals(repo, ids);
    if (taken.length) { setUndo({ goals: taken, label }); buzz.destroyed(); }
    setTick(t => t + 1);
  }, [repo]);

  const now = Date.now();
  const goals = useMemo(() => listGoals(repo, now), [repo, tick]);
  const refresh = useCallback(() => setTick(t => t + 1), []);

  /*
   * The cap is a hundred, so this screen has to assume the list is longer than
   * the window rather than shorter. Under five goals every chip would be a
   * control for hiding a card that is already on screen, so the bar only
   * appears once the list stops fitting in one glance — and `shownFilter`
   * makes sure a filter left over from a longer list cannot keep hiding goals
   * after the bar itself has gone away again.
   */
  const [filter, setFilter] = useState<GoalFilter>(() => lastView().filter);
  const [sort, setSort] = useState<GoalSort>(() => lastView().sort);
  useEffect(() => rememberView(filter, sort), [filter, sort]);
  // The chips speak the lifter's own split — see `goalFilters`.
  const plan = useMemo(() => planOf(repo), [repo, tick]);
  const filters = useMemo(() => goalFilters(plan), [plan]);
  const counts = useMemo(() => filterCounts(goals, plan), [goals, plan]);
  const showBar = goals.length > 4;
  /*
   * Falls back to OPEN whenever the chosen filter has nothing behind it. A chip
   * with a zero count cannot be tapped, so the only ways to land on an empty
   * one are removing the last goal it held, or arriving with a filter this
   * screen remembered from earlier in the session — and in both cases an empty
   * screen is the wrong answer to "show me my goals".
   */
  const shownFilter: GoalFilter = showBar && counts[filter] > 0 ? filter : 'open';
  const shown = useMemo(
    () => filterGoals(goals, shownFilter, sort), [goals, shownFilter, sort]);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Text style={s.title} role="heading">{T('goals')}</Text>
        <Pressable accessibilityRole="button" onPress={leave} hitSlop={16}
          style={pressStyle(null, 'quiet', still)} accessibilityLabel={T('done')}>
          <Text style={s.close}>{T('done')}</Text>
        </Pressable>
      </View>

      {/* `counts.done` has been computed since the filter bar was built —
          every trophy this screen ever earned, already counted. The bar
          itself already shows it, as the DONE chip's own count, but only
          once there are enough goals to need a bar at all (>4) — so anyone
          with a handful of goals, the common case, had a real trophy with
          no way to see the tally. Shown here ONLY while the bar is not
          already saying the same number; two places counting the same
          thing independently is exactly the shape that costs a round when
          they drift, not a risk worth taking for one line of text. */}
      {!showBar && counts.done > 0 && (
        <Text style={s.achievedLine}>
          {fill(T(counts.done === 1 ? 'goalsAchievedLineOne' : 'goalsAchievedLine'), { n: counts.done })}
        </Text>
      )}

      {showBar && (
        <View style={s.filterBar}>
          {/*
            Wraps, rather than scrolling sideways.
            Measured at 390px: the five chips need 405px and the row had 342,
            so it clipped mid-chip — PULL's count sheared in half at the edge
            and LEGS and DONE sat off-screen entirely, with no visible way to
            reach them. A row that hides two of its five options behind a
            gesture nobody can see is worse than a row that takes two lines.
            Wrapping adapts on its own: three across at 390, two on something
            narrower, all five plus the sort on a tablet.
          */}
          <View style={s.filterRow}>
            {filters.map(f => (
              <Pressable accessibilityRole="button"
                key={f}
                hitSlop={8}
                onPress={() => { setFilter(f); buzz.chose(); }}
                /* A chip that leads to an empty list still costs a tap to find
                   that out, and with a hundred goals there is no telling by
                   looking. The count says so, and zero declines the tap. */
                disabled={counts[f] === 0}
                {...onState(f === shownFilter)}
                accessibilityLabel={fill(T(counts[f] === 1 ? 'filterCountA11yOne' : 'filterCountA11y'), { label: T(FILTER_KEY[f]), n: counts[f] })}
                style={pressStyle([s.fChip, f === shownFilter && s.fChipOn, counts[f] === 0 && s.fChipOff], 'surface', still)}
              >
                <Text style={[s.fText, f === shownFilter && s.fTextOn]}>{T(FILTER_KEY[f])}</Text>
                <Text style={[s.fCount, f === shownFilter && s.fTextOn]}>{counts[f]}</Text>
              </Pressable>
            ))}

          {/* Cycles rather than opening a menu: three orders is not a list worth
              a sheet, and the label always says which one is on. */}
          <Pressable accessibilityRole="button"
            style={pressStyle(s.sortBtn, 'surface', still)}
            hitSlop={8}
            accessibilityLabel={fill(T('sortedByTapChange'), { sort: T(SORT_KEY[sort]) })}
            onPress={() => {
              setSort(GOAL_SORTS[(GOAL_SORTS.indexOf(sort) + 1) % GOAL_SORTS.length]);
              buzz.chose();
            }}
          >
            <Text style={s.sortCaret}>{'\u21C5'}</Text>
            <Text style={s.sortText}>{T(SORT_KEY[sort])}</Text>
          </Pressable>
          </View>
        </View>
      )}

      <ScrollView contentContainerStyle={[s.body, goals.length === 0 && s.bodyEmpty]}>
        {goals.length === 0 && (
          <Text style={s.empty}>{fill(T('pickLiftsUpTo'), { n: MAX_GOALS })}</Text>
        )}
        {shown.map(g => (
          <GoalCard
            key={g.goal.id}
            p={g}
            onEdit={() => setEditing(g)}
            onWipe={() => setWiping(g)}
          />
        ))}
      </ScrollView>

      {/* The reversal, offered where the eye already is after the thing it
          reverses. It stays until it is used or dismissed rather than timing
          out: a countdown makes the safe option the one you can miss. */}
      {undo && (
        <View style={s.undoBar}>
          <Text style={s.undoText} numberOfLines={1} role="status">{undo.label}</Text>
          <Pressable accessibilityRole="button" hitSlop={10}
            style={pressStyle(null, 'quiet', still)}
            accessibilityLabel={T('undo')}
            onPress={() => {
              const back = restoreGoals(repo, undo.goals);
              buzz.undid();
              setUndo(back === undo.goals.length ? null
                : { goals: [], label: fill(T('cappedComeBack'), { back, total: undo.goals.length }) });
              refresh();
            }}>
            <Text style={s.undoAction}>{T('undo')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" hitSlop={10} onPress={() => setUndo(null)}
            style={pressStyle(null, 'quiet', still)}
            accessibilityLabel={T('dismissA11y')}>
            <Text style={s.undoDismiss}>×</Text>
          </Pressable>
        </View>
      )}

      {/* Pinned, not the last row of the scroll. At the old cap of three the
          button was on screen no matter what; at a hundred it sits under five
          thousand pixels of cards, which is a control that exists and cannot
          be reached. */}
      <View style={s.footer}>
        {canAddGoal(repo) ? (
          <Pressable accessibilityRole="button" style={pressStyle(s.add, 'surface', still)}
            onPress={() => setAdding(true)} accessibilityLabel={T('addGoal')}>
            <Text style={s.addText}>{T('addGoal')}</Text>
          </Pressable>
        ) : (
          /* At the cap the button used to simply disappear. A control vanishing
             with no explanation is the worst of both worlds — the user cannot
             add a goal and is not told why, or what would let them. Saying it
             costs one line and answers both. */
          <Text style={s.capNote}>
            {MAX_GOALS} of {MAX_GOALS}. Hit one, or remove one, to add another.
          </Text>
        )}

        {/* Deliberately quiet and deliberately last. It is the one control on
            this screen that can destroy a year of targets in a tap, so it does
            not get a button's weight — and it asks three times. */}
        {goals.length > 0 && (
          <Pressable accessibilityRole="button" style={pressStyle(s.wipeAll, 'quiet', still)} hitSlop={8}
            onPress={() => setWipeAllStep(1)}
            accessibilityLabel={fill(T(goals.length === 1 ? 'wipeAllA11yOne' : 'wipeAllA11y'), { n: goals.length })}>
            {/* The count only means something when there is more than one to
                count. It used to be an unconditional concatenation, so a user
                with a single target read "WIPE ALL 1" — and "BORRAR TODAS 1"
                in Spanish, which is worse. The accessibility label beside it
                had already been given a singular variant (`wipeAllA11yOne`),
                so the invisible half of this control was correct English and
                the visible half was not. */}
            <Text style={s.wipeAllText}>
              {T('wipeAll')}{goals.length > 1 ? ` ${goals.length}` : ''}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Unmounted rather than hidden — see NowScreen's picker: a transparent
          react-native-web Modal does not reliably disappear when `visible`
          goes false. Unmounting also resets the draft, so a cancelled goal
          never reappears half-filled. */}
      {adding && (
        <AddGoal
          onClose={() => setAdding(false)}
          onCreated={() => { setAdding(false); refresh(); }}
        />
      )}

      {wiping && (
        <ConfirmSheet
          title={fill(T('wipeGoalTitle'), { lift: wiping.exerciseName })}
          body={
            `${wiping.goal.targetWeight} × ${wiping.goal.targetReps}, ` +
            (wiping.achieved
              ? T('wipeGoalHit')
              : wiping.daysLeft === 1 ? T('wipeGoalLeftOne') : fill(T('wipeGoalLeft'), { n: wiping.daysLeft })) +
            ` ${T('wipeGoalUndo')}`
          }
          confirmLabel={T('wipeItLabel')}
          onCancel={() => setWiping(null)}
          onConfirm={() => {
            wipe([wiping.goal.id], fill(T('goalWiped'), { lift: wiping.exerciseName }));
            setWiping(null);
          }}
        />
      )}

      {/* Three, because the ask was three — and because each one says something
          different. A confirm you can dismiss by reflex is not a confirm, so
          the wording escalates from what to how much to what it costs. */}
      {wipeAllStep === 1 && (
        <ConfirmSheet
          title={fill(T(goals.length === 1 ? 'wipeAllTitleOne' : 'wipeAllTitle'), { n: goals.length })}
          body={T('wipeAllBody')}
          confirmLabel={T('wipeAllLabel')}
          onCancel={() => setWipeAllStep(0)}
          onConfirm={() => setWipeAllStep(2)}
        />
      )}
      {wipeAllStep === 2 && (
        <ConfirmSheet
          title={T('wipeAll2Title')}
          body={fill(T('wipeAll2Body'), { open: counts.open, done: counts.done })}
          confirmLabel={T('wipeAll2Label')}
          onCancel={() => setWipeAllStep(0)}
          onConfirm={() => setWipeAllStep(3)}
        />
      )}
      {wipeAllStep === 3 && (
        <ConfirmSheet
          title={T('wipeAll3Title')}
          body={T('wipeAll3Body')}
          confirmLabel={T('wipeAll3Label')}
          onCancel={() => setWipeAllStep(0)}
          onConfirm={() => {
            wipe(goals.map(g => g.goal.id), goals.length === 1 ? T('goalsWipedOne') : fill(T('goalsWiped'), { n: goals.length }));
            setWipeAllStep(0);
          }}
        />
      )}

      {editing && (
        <AddGoal
          editing={editing}
          onClose={() => setEditing(null)}
          onCreated={() => { setEditing(null); refresh(); }}
        />
      )}
      <TabBar current="goals" go={tab => goTab(router, tab)} />
    </SafeAreaView>
  );
}

function GoalCard(
  { p, onEdit, onWipe }: { p: GoalProgress; onEdit: () => void; onWipe: () => void }
) {
  const still = useReducedMotion();
  // The screen's line, not the shareable's — see `goalCardLine`.
  const line = goalCardLine(p, languageOf(getRepo()));
  return (
    <View style={[s.card, p.achieved && s.cardDone]}>
      {/*
        The name gets the whole line.

        It used to share it with CHANGE and WIPE, which left 117pt of a 234pt
        row for the lift's own name on a 320pt phone — and measuring the real
        library at the rendered size, SIX of thirty-three names did not fit:
        Romanian Deadlift, Incline Bench Press, Machine Chest Press, DB
        Shoulder Press, Seated Cable Row and Bulgarian Split Squat, the widest
        needing 146pt. A card whose identity is a lift, truncating the lift.

        The controls moved to the footer instead of the name shrinking further,
        because they are secondary to the row and the name is the row.
      */}
      <View style={s.cardTop}>
        <Text style={s.cardLift} numberOfLines={1}>{p.exerciseName}</Text>
      </View>

      <Text style={[s.cardTarget, !line && s.cardTargetQuiet]}>
        {p.goal.targetWeight} <Text style={s.cardReps}>× {p.goal.targetReps}</Text>
      </Text>

      {/* A goal that has not moved yet has nothing to draw: an empty bar, a
          sentence saying so, and a countdown. That was fine at a cap of three.
          At twelve it is most of a 2,400px scroll spent on rows with no data in
          them, on the screen whose whole job is letting you see where your
          lifts are. So an untrained goal collapses to its name, its target and
          its deadline, and takes the full card back the moment it has a real
          number to show. */}
      {line !== null && (
        <>
          <View style={s.track}
            accessibilityLabel={goalBarA11y(p, languageOf(getRepo()))}>
            <View style={[s.fill, { width: `${Math.round(p.fraction * 100)}%` }]} />
          </View>

          {/* The same sentence that lands on the recap. */}
          <Text style={s.line}>{line}</Text>
        </>
      )}

      {/*
        The controls get their own line, right-aligned.

        Sharing the footer with the deadline was tried first and merely moved
        the squeeze: the names fitted, and then "Not trained yet · 62 days
        left" truncated instead, on 89 of 100 cards rather than 6 of 33. There
        is no arrangement in which a 234pt row holds a full sentence AND two
        controls at 320pt, so the honest answer is a line each. It costs about
        16pt of card height and nothing on the card is cut off at any width.
      */}
      {!p.achieved && (
          <Text style={[s.meta, !line && s.metaQuiet]}>
            {/* `goalCardLine` returns null only when the lift has genuinely
                never been trained — every other silent case now states the gap. */}
            {line === null ? `${T('notTrained')}  ·  ` : ''}
            {p.daysLeft > 0 ? `${p.daysLeft} ${T('daysLeft')}` : T('pastDate')}
            {/* Pace only means something while there is still time to keep it.
                A year-two walk turned up "Past the date  ·  behind pace", which
                says one thing twice and says the harsher half second.

                Coloured on the same rule the trend column already uses for
                up/down (VOLT/red) — "on pace" and "behind pace" said in the
                same grey as the day count is one fact wearing another's
                clothes; a pace call is a verdict, not a measurement. */}
            {p.daysLeft > 0
              ? (p.onPace === false
                  ? <Text style={s.paceBad}>{`  ·  ${T('behindPace')}`}</Text>
                  : p.onPace
                    ? <Text style={s.paceGood}>{`  ·  ${T('onPace')}`}</Text>
                    : '')
              : ''}
          </Text>
      )}
      <View style={s.cardFoot}>
        <View style={s.cardActions}>
          {/* An achieved goal is a record of something that happened. Editing
              it would rewrite the target it was met against, which is the one
              number that made it worth anything. */}
          {!p.achieved && (
            <Pressable accessibilityRole="button" onPress={onEdit} hitSlop={14}
              style={pressStyle(null, 'quiet', still)}
              accessibilityLabel={fill(T('changeExGoal'), { lift: p.exerciseName })}>
              <Text style={s.remove}>{T('change')}</Text>
            </Pressable>
          )}
          {/* One tap arms nothing and destroys nothing — it asks. */}
          <Pressable accessibilityRole="button" onPress={onWipe} hitSlop={14}
            style={pressStyle(null, 'quiet', still)}
            accessibilityLabel={fill(T('wipeExGoal'), { lift: p.exerciseName })}>
            <Text style={s.remove}>{T('wipe')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function AddGoal({
  onClose, onCreated, editing
}: { onClose: () => void; onCreated: () => void; editing?: GoalProgress }) {
  const still = useReducedMotion();
  const repo = getRepo();
  const now = Date.now();
  // See progress-model: a live session is the exception here, not the rule, so
  // reading the unit off it silently defaults every metric user to pounds.
  const unit = displayUnit(repo);
  // The library goes in for the same reason the Now picker takes it: a goal on
  // a movement the user created must be settable, and it must not be labelled
  // with its slug.
  const { trained, rest } = useMemo(() => goalLifts(repo, now), [repo, now]);
  const options = useMemo(() => [...trained, ...rest], [trained, rest]);

  const [exerciseId, setExerciseId] = useState(editing?.goal.exerciseId ?? options[0]?.id ?? 'squat');
  // Nothing left to set one on. The form below would still render, with a
  // suggested target for a lift the user cannot choose and a SET GOAL button
  // that can only refuse — so it does not render at all.
  const nothingLeft = !editing && options.length === 0;
  const [reps, setReps] = useState(editing?.goal.targetReps ?? 5);
  /*
   * An edit opens on the deadline the goal ALREADY has, expressed as days from
   * today. Opening on the default 3 months would silently move a March target
   * to November for anyone who came in to change the weight.
   */
  const [inDays, setInDays] = useState(
    editing ? Math.max(1, Math.ceil((editing.goal.targetDate - now) / DAY)) : 90);
  /*
   * "Other" on each row. The typed value is held as TEXT, not a number: a
   * half-typed "1" on the way to "12" must not snap the form to a 1-rep goal,
   * and an empty field must not read as 0. `customReps` / `customHorizonDays`
   * turn it into a value only once it is a legal one; until then the row stays
   * on OTHER with the last good value still committed.
   */
  const [repsOther, setRepsOther] = useState(false);
  const [repsText, setRepsText] = useState('');
  // BY is a number and a unit now, rather than a row of fixed horizons — the
  // deadline someone has in mind is "eight weeks" or "ninety days", not one of
  // four preset buttons.
  const [byText, setByText] = useState(
    editing ? String(Math.max(1, Math.ceil((editing.goal.targetDate - now) / DAY))) : '3');
  const [byUnit, setByUnit] = useState<HorizonUnit>(editing ? 'days' : 'months');
  const [unitOpen, setUnitOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // §4 — never a blank number. The suggestion tracks whichever lift is selected.
  const target = useMemo(
    () => suggestTarget(repo, exerciseId, reps, unit),
    [repo, exerciseId, reps, unit]
  );
  /*
   * The target the user has actually settled on, held rather than derived.
   *
   * It used to be `suggestTarget(...) + bump`, recomputed from the CURRENT rep
   * count — so every tap on the FOR (REPS) row threw the weight away and
   * re-suggested one. Someone who dialled 315 and then changed their mind about
   * whether it was for three or for five watched 315 turn back into 185. The
   * suggestion is a starting point, not a running opinion: it seeds this once
   * per lift, and after that the number is the user's.
   */
  const [bump, setBump] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  // 5 lb / 2.5 kg — the same increment the logging screen steps in, so the two
  // screens do not disagree about what one tap is worth.
  const step = unit === 'lb' ? 5 : 2.5;
  const finalTarget = (chosen ?? targetBase(editing?.goal, target)) + bump * step;

  const submit = () => {
    const draft = { exerciseId, targetWeight: finalTarget, targetReps: reps, inDays, unit };
    const r = editing
      ? editGoal(repo, editing.goal.id, draft, Date.now())
      : createGoal(repo, draft, Date.now());
    if (!r.ok) return setError(r.error ?? T('couldNotSave'));
    setError(null);
    setBump(0);
    buzz.did();
    onCreated();
  };

  return (
    // `animationType="none"` — the same trap the Now picker was in. On
    // react-native-web "slide" is a keyframe with `animation-fill-mode: none`,
    // so the sheet reverts to `translateY(100%)` the moment the animation ends
    // and sits one full viewport below the screen. This one was invisible for
    // exactly as long, and for the same reason nobody noticed: driving it with
    // synthetic pointer events works fine on something you cannot see.
    <ScreenModal visible animationType="none" transparent aria-label={editing ? T('editGoalA11y') : T('newGoalA11y')} onRequestClose={onClose}>
      <Pressable style={s.backdrop} tabIndex={-1} onPress={onClose}>
        <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
          <View style={s.grabber} />

          {nothingLeft && (
            <View style={s.noneLeft}>
              <Text style={s.noneTitle}>{T('everyLiftHasGoal')}</Text>
              {/* Says what would free one, in the two places it can come from.
                  A dead end with no exit is the same defect as the vanishing
                  add button this screen already fixed once. */}
              <Text style={s.noneBody}>
                {T('hitOrRemove')}
                exercise picker on the logging screen, and it can have its own.
              </Text>
              <Pressable accessibilityRole="button" style={pressStyle(s.save, 'primary', still)} onPress={onClose}
                accessibilityLabel={T('gotIt')}>
                <Text style={s.saveText}>{T('gotIt')}</Text>
              </Pressable>
            </View>
          )}

          {!nothingLeft && (<>
          {/* On an edit the lift is fixed and stated rather than chosen: a goal
              is a target ON a lift, so changing the lift makes it a different
              goal, and moving it would take the progress baseline with it. */}
          {editing && (
            <>
              <Text style={s.sheetLabel}>{T('changing')}</Text>
              <Text style={s.editingLift}>{editing.exerciseName}</Text>
            </>
          )}

          {/* The sheet is anchored to the bottom, so content taller than the
              viewport does not clip — it grows UPWARD, off the top of the
              screen. LIFT and TARGET were measured at y -885 and y -752. A
              `maxHeight` plus a scrolling body keeps the whole form reachable,
              and SET GOAL is deliberately outside it so the one control that
              commits is always on screen. */}
          <ScrollView style={s.sheetBody} showsVerticalScrollIndicator={false}>
          {/* Two categories, not one scroll. A goal is almost always about a
              lift you already train, so those lead and get their own heading;
              the library follows as the alternative. */}
          {!editing && trained.length > 0 && (
            <>
              <Text style={s.sheetLabel}>{T('yourLifts')}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={s.chipScroll}
                contentContainerStyle={s.chipScrollRow}
              >
                {trained.map(o => (
                  <Pressable accessibilityRole="button"
                    key={o.id}
                    accessibilityLabel={o.name}
                    {...onState(o.id === exerciseId)}
                    onPress={() => { setExerciseId(o.id); setBump(0); setChosen(null); setError(null); }}
                    style={pressState => [s.chip, s.chipAuto, o.id === exerciseId && s.chipOn, ...pressStyle(null, 'surface', still)(pressState)]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[s.chipText, s.chipTextSmall, o.id === exerciseId && s.chipTextOn]}
                    >{o.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}

          {!editing && (<>
          <Text style={s.sheetLabel}>{trained.length > 0 ? T('orAnythingElse') : T('lift')}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.chipScroll}
            contentContainerStyle={s.chipScrollRow}
          >
            {rest.map(o => (
              <Pressable accessibilityRole="button"
                key={o.id}
                accessibilityLabel={o.name}
                {...onState(o.id === exerciseId)}
                onPress={() => { setExerciseId(o.id); setBump(0); setChosen(null); setError(null); }}
                style={pressState => [s.chip, s.chipAuto, o.id === exerciseId && s.chipOn, ...pressStyle(null, 'surface', still)(pressState)]}
              >
                <Text
                  numberOfLines={1}
                  style={[s.chipText, s.chipTextSmall, o.id === exerciseId && s.chipTextOn]}
                >{o.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
          </>)}

          <Text style={s.sheetLabel}>{T('target')}</Text>
          <View style={s.targetRow}>
            {/* R347: same fixed-size-hero exemption the Now screen's weight
                stepper needed (R339) — found here too, at 2.35x Dynamic
                Type, the "+" stepper's right edge ran to x369 on a 320px
                phone. This row's own comment already named Now as the
                precedent; the fix follows it exactly. */}
            <Pressable accessibilityRole="button" style={pressStyle(s.step, 'surface', still)} onPress={() => setBump(b => b - 1)}
              accessibilityLabel={fill(T('decreaseWord'), { what: T('targetWord') })}><Text style={s.stepText} allowFontScaling={false}>−</Text></Pressable>
            {/* Ghosted twin of the unit, so the DIGITS sit centred rather than
                the digits-and-unit pair — the same fix the Now hero needed.

                Hidden from assistive technology, which `opacity: 0` does not
                do: the node is still in the accessibility tree, so VoiceOver
                read this row as "lb, 100, lb". An invisible thing that is only
                invisible to people who can see is not invisible. */}
            <View style={s.targetNumbers}>
              <Text
                style={[s.targetUnit, s.targetUnitGhost]}
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                allowFontScaling={false}
              >{unit}</Text>
              <Text style={s.targetValue} allowFontScaling={false}>{finalTarget}</Text>
              <Text style={s.targetUnit} allowFontScaling={false}> {unit}</Text>
            </View>
            <Pressable accessibilityRole="button" style={pressStyle(s.step, 'surface', still)} onPress={() => setBump(b => b + 1)}
              accessibilityLabel={fill(T('increaseWord'), { what: T('targetWord') })}><Text style={s.stepText} allowFontScaling={false}>+</Text></Pressable>
          </View>

          {/* The same big-jump pair the logging screen has. Reaching 315 from a
              suggested 245 was seven taps of the stepper; §4's tap budget is
              about the logging path, but a goal nobody can be bothered to set
              is a screen §5 would cut. */}
          <View style={s.targetJumps}>
            <Pressable accessibilityRole="button"
              style={pressStyle(s.jump, 'surface', still)}
              onPress={() => setBump(b => b - Math.round(PLATE[unit] / step))}
              accessibilityLabel={fill(T('takeOffUnit'), { n: PLATE[unit], unit })}
            >
              <Text style={s.jumpText} allowFontScaling={false}>−{PLATE[unit]}</Text>
            </Pressable>
            <Text style={s.targetHint} allowFontScaling={false}>±{step}</Text>
            <Pressable accessibilityRole="button"
              style={pressStyle(s.jump, 'surface', still)}
              onPress={() => setBump(b => b + Math.round(PLATE[unit] / step))}
              accessibilityLabel={fill(T('addUnit'), { n: PLATE[unit], unit })}
            >
              <Text style={s.jumpText} allowFontScaling={false}>+{PLATE[unit]}</Text>
            </Pressable>
          </View>

          <Text style={s.sheetLabel}>{T('forReps')}</Text>
          <View style={s.gridRow}>
            {REP_CHOICES.map(r => (
              <Pressable accessibilityRole="button"
                key={r}
                accessibilityLabel={r === 1 ? T('repsCountA11yOne') : fill(T('repsCountA11y'), { n: r })}
                {...onState(!repsOther && r === reps)}
                onPress={() => {
                  setChosen(finalTarget); setBump(0);
                  setReps(r); setRepsOther(false); setError(null);
                }}
                style={pressState => [s.chip, s.chipFifth, !repsOther && r === reps && s.chipOn, ...pressStyle(null, 'surface', still)(pressState)]}
              >
                <Text
                  numberOfLines={1}
                  style={[s.chipText, !repsOther && r === reps && s.chipTextOn]}
                >{r}</Text>
              </Pressable>
            ))}
            <Pressable accessibilityRole="button"
              accessibilityLabel={T('other')}
              {...onState(repsOther)}
              onPress={() => { setRepsOther(true); setError(null); }}
              style={pressState => [s.chip, s.chipFifth, repsOther && s.chipOn, ...pressStyle(null, 'surface', still)(pressState)]}
            >
              <Text
                numberOfLines={1}
                style={[s.chipText, s.chipTextSmall, repsOther && s.chipTextOn]}
              >{T('other')}</Text>
            </Pressable>
          </View>
          {repsOther && (
            <View style={s.otherRow}>
              <TextInput
                style={s.otherInput}
                value={repsText}
                onChangeText={t => {
                  setRepsText(t);
                  const n = customReps(t);
                  if (n !== null) { setChosen(finalTarget); setBump(0); setReps(n); }
                }}
                placeholder="1-12"
                placeholderTextColor="#7C8792"
                keyboardType="number-pad"
                accessibilityLabel={T('repsA11y')}
              />
              <Text style={s.otherUnit}>{T('repsWord')}</Text>
            </View>
          )}

          <Text style={s.sheetLabel}>{T('by')}</Text>
          <View style={s.byRow}>
            <TextInput
              style={s.byInput}
              value={byText}
              onChangeText={t => {
                setByText(t);
                const d = horizonDays(t, byUnit);
                if (d !== null) setInDays(d);
                setError(null);
              }}
              placeholder="3"
              placeholderTextColor="#7C8792"
              keyboardType="number-pad"
              accessibilityLabel={T('howLongA11y')}
            />
            {/* The unit, as a menu rather than four more chips: "eight weeks"
                and "ninety days" are the same control, and a row of presets
                could never hold both. */}
            <Pressable
              style={pressStyle(s.byUnitBtn, 'surface', still)}
              onPress={() => setUnitOpen(v => !v)}
              accessibilityRole="button"
              accessibilityLabel={fill(T('unitTapChange'), { unit: T(HORIZON_KEY[byUnit]) })}
              aria-expanded={unitOpen}
            >
              <Text style={s.byUnitText}>{T(HORIZON_KEY[byUnit]).toUpperCase()}</Text>
              <Text style={s.byCaret}>{unitOpen ? '▴' : '▾'}</Text>
            </Pressable>

          {unitOpen && (
            <View style={s.byMenu}>
              {HORIZON_UNITS.map(u => (
                <Pressable accessibilityRole="button"
                  key={u}
                  accessibilityLabel={T(HORIZON_KEY[u])}
                  {...onState(u === byUnit)}
                  style={pressState => [
                    s.byMenuItem, u === byUnit && s.byMenuItemOn,
                    ...pressStyle(null, 'surface', still)(pressState)
                  ]}
                  onPress={() => {
                    setByUnit(u);
                    setUnitOpen(false);
                    const d = horizonDays(byText, u);
                    if (d !== null) setInDays(d);
                    setError(null);
                  }}
                >
                  <Text style={[s.byMenuText, u === byUnit && s.byMenuTextOn]}>
                    {T(HORIZON_KEY[u]).toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          </View>

          {/* What that actually comes to. §16 — a number the user cannot check
              against anything is one they cannot trust, and "90 days" is easier
              to picture as a date on a calendar. */}
          <Text style={s.byPreview}>
            {horizonDays(byText, byUnit) === null
              ? fill(T('upToUnitDot'), { n: Math.floor(730 / DAYS_PER[byUnit]), unit: T(HORIZON_KEY[byUnit]) })
              : fill(T(inDays === 1 ? 'inDaysDashOne' : 'inDaysDash'), {
                  n: inDays,
                  date: new Date(Date.now() + inDays * 86400000)
                    .toLocaleDateString(dateLocale(languageOf(getRepo())), { day: 'numeric', month: 'short', year: 'numeric' })
                })}
          </Text>

          {error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
          </ScrollView>

          <Pressable accessibilityRole="button" style={pressStyle(s.save, 'primary', still)} onPress={submit}
            accessibilityLabel={editing ? T('saveChanges') : T('setGoal')}>
            <Text style={s.saveText}>{editing ? T('saveChanges') : T('setGoal')}</Text>
          </Pressable>
          </>)}
        </Pressable>
      </Pressable>
    </ScreenModal>
  );
}

const DAY = 86_400_000;
const VOLT = '#CCFF00';
const MUTED = '#7C8792';
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#08090A' },
  // R341: same header idiom found overflowing on Settings at 2.35x Dynamic
  // Type — DONE pushed past the screen's right edge by the title. Same fix.
  header: {
    ...COLUMN,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingTop: 8, paddingBottom: 18, flexWrap: 'wrap'
  },
  title: { color: '#fff', fontSize: TYPE.title, fontWeight: '900', letterSpacing: SPACING.micro },
  close: { color: MUTED, fontSize: TYPE.label, fontWeight: '800', letterSpacing: SPACING.label },
  achievedLine: {
    ...COLUMN, color: VOLT, fontSize: TYPE.micro, fontWeight: '800',
    letterSpacing: SPACING.micro, paddingHorizontal: 24, paddingBottom: 12
  },
  body: {
    ...COLUMN, paddingHorizontal: 24, paddingBottom: 20 },

  filterBar: { ...COLUMN, paddingHorizontal: 24, paddingBottom: 14 },
  /*
   * `minWidth: 0` is the whole fix, not decoration. A flex item will not shrink
   * below its own content width by default, so with five chips in it the
   * scroller kept its full natural width and the sort button was drawn straight
   * over the DONE chip: measured with the caret at x719 and DONE's label at
   * x764, on top of each other, and the button ending 12px past the column.
   */
  filterScroll: { flexGrow: 0, flexShrink: 1, minWidth: 0 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 40, paddingHorizontal: 13, borderRadius: 20,
    borderWidth: 1, borderColor: '#232A31'
  },
  fChipOn: SELECTED,
  fChipOff: { opacity: 0.3 },
  fText: { color: '#C3CBD2', fontSize: TYPE.label, fontWeight: '800', letterSpacing: SPACING.label },
  fCount: { color: '#9AA5AF', fontSize: TYPE.label, fontWeight: '700' },
  fTextOn: SELECTED_TEXT,
  sortBtn: {
    // Never shrinks: it is the one control here whose label changes, and a
    // squeezed "SOONEST" is how the row starts wrapping.
    flexShrink: 0,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 40, paddingHorizontal: 13, borderRadius: 20,
    borderWidth: 1, borderColor: '#232A31', backgroundColor: '#0E1114'
  },
  sortText: { color: '#9AA5AF', fontSize: TYPE.label, fontWeight: '800', letterSpacing: SPACING.label },
  sortCaret: { color: '#9AA5AF', fontSize: TYPE.meta, fontWeight: '800' },

  undoBar: {
    ...COLUMN,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    marginHorizontal: 24, marginBottom: 10,
    paddingVertical: 12, paddingHorizontal: 16,
    borderRadius: 12, backgroundColor: '#131A08', borderWidth: 1, borderColor: '#2E3A12'
  },
  undoText: { color: '#C3CBD2', fontSize: TYPE.body, fontWeight: '600', flexShrink: 1, flexGrow: 1 },
  undoAction: { color: VOLT, fontSize: TYPE.label, fontWeight: '900', letterSpacing: SPACING.label },
  undoDismiss: { color: '#9AA5AF', fontSize: 20, fontWeight: '700', marginTop: -2 },

  wipeAll: {
    alignSelf: 'center', marginTop: 12, paddingVertical: 10, paddingHorizontal: 16
  },
  wipeAllText: { color: '#B87A7A', fontSize: TYPE.label, fontWeight: '800', letterSpacing: SPACING.label },

  footer: {
    ...COLUMN, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 4,
    borderTopWidth: 1, borderTopColor: '#161B20'
  },
  /*
   * Centred while the list is empty. Pinning the add button to the bottom left
   * the one sentence explaining the screen floating a thousand pixels above the
   * only control that acts on it, with nothing in between — the two halves of
   * an empty state have to read as one thing.
   */
  bodyEmpty: { flexGrow: 1, justifyContent: 'center' },
  empty: { color: '#9AA5AF', fontSize: TYPE.body, textAlign: 'center', marginBottom: 24 },

  card: {
    backgroundColor: '#0E1114', borderRadius: 16, padding: 18, marginBottom: 14,
    borderWidth: 1, borderColor: '#181D22'
  },
  cardDone: { borderColor: VOLT },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardActions: { flexDirection: 'row', gap: 16, flexShrink: 0 },
  /*
   * The controls, on their own line under everything else.
   * `flex-end` puts them against the right edge of the card, so they read as
   * the card's actions rather than as another piece of its content.
   */
  cardFoot: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  editingLift: { color: '#fff', fontSize: 20, fontWeight: '800' },
  /*
   * `flexShrink` because the row now holds a name AND two controls. Measured
   * with the library's longest name, "Machine Chest Press": 76px of slack on a
   * 430px column, which is 23px on a 375px phone and negative for any movement
   * the user invents with a longer name. Shrinking plus numberOfLines makes it
   * ellipsize instead of shoving CHANGE and REMOVE off the card.
   */
  cardLift: { color: MUTED, fontSize: TYPE.label, fontWeight: '800', letterSpacing: SPACING.label, flexShrink: 1 },
  remove: { color: '#7C8792', fontSize: TYPE.micro, fontWeight: '800', letterSpacing: SPACING.micro },
  cardTarget: { color: '#fff', fontSize: 38, fontWeight: '900', marginTop: 8 },
  // Smaller when there is no progress under it — the number is still the point
  // of the row, but it is not carrying a whole card any more.
  cardTargetQuiet: { fontSize: 26, marginTop: 4 },
  metaQuiet: { marginTop: 6 },
  capNote: {
    color: '#9AA5AF', fontSize: TYPE.body, fontWeight: '600',
    textAlign: 'center', marginTop: 6, paddingHorizontal: 12
  },
  cardReps: { color: MUTED, fontSize: 18, fontWeight: '700' },
  track: { height: 6, backgroundColor: '#1A1F24', borderRadius: 3, marginTop: 14, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: VOLT, borderRadius: 3 },
  line: { color: '#E8EAED', fontSize: TYPE.body, fontWeight: '600', marginTop: 12 },
  meta: { color: '#9AA5AF', fontSize: TYPE.meta, marginTop: 5, flexShrink: 1 },
  // Same pair the trend column uses for up/down.
  paceGood: { color: VOLT, fontWeight: '800' },
  paceBad: { color: '#FF6B6B', fontWeight: '800' },

  add: {
    borderWidth: 1, borderColor: '#1E242A', borderRadius: 14, height: 56,
    alignItems: 'center', justifyContent: 'center', marginTop: 6
  },
  addText: { color: MUTED, fontSize: TYPE.label, fontWeight: '800', letterSpacing: SPACING.label },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  sheet: {
    // Capped and centred like every other surface - a sheet spanning a
    // 1024px window over a 430px app is not the same product.
    ...COLUMN,
    backgroundColor: '#0C0E10', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 22, paddingTop: 10, paddingBottom: 30,
    maxHeight: '86%'
  },
  sheetBody: { flexShrink: 1 },
  chipScroll: { flexGrow: 0 },
  chipScrollRow: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  grabber: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: '#2A323A',
    alignSelf: 'center', marginBottom: 18
  },
  sheetLabel: { color: MUTED, fontSize: TYPE.micro, fontWeight: '800', letterSpacing: SPACING.micro, marginTop: 16, marginBottom: 8 },
  otherRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  otherInput: {
    minWidth: 88, height: 44, paddingHorizontal: 14,
    backgroundColor: '#111417', borderRadius: 10,
    borderWidth: 1, borderColor: '#2A323A',
    color: '#fff', fontSize: 15, fontWeight: '700'
  },
  otherUnit: { color: '#7C8792', fontSize: TYPE.body, fontWeight: '600' },

  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  /*
   * A grid, not a wrap. Left to `flexWrap` with content-sized chips the rows
   * broke wherever the text happened to run out — "1 reps" beside "12 reps"
   * beside "OTHER", ragged, with a different amount of dead space on each line.
   * Fixed column widths make the rows line up and fill the sheet: nine rep
   * chips land as 5 + 4, five horizons as 3 + 2.
   */
  gridRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: {
    // A FIXED height, not padding. With padding, a label that wrapped to two
    // lines made its whole row taller than the one above it — "12 reps" and
    // "OTHER" did exactly that, and the grid stopped looking like a grid.
    height: 46, paddingHorizontal: 6, borderRadius: 10,
    borderWidth: 1, borderColor: '#232A31', alignItems: 'center', justifyContent: 'center'
  },
  /** For the horizontal lift rows, where the label decides the width. */
  chipAuto: { paddingHorizontal: 14 },
  /*
   * Fills the row, whatever the row is.
   *
   * It was `width: '18%'`, sized against a 335px sheet — "5 x 18% + 4 gaps of
   * 8 fits". On a 320px phone the sheet is 276px wide inside its padding, five
   * chips come to 280.5, and the grid silently reflowed to four per row and
   * left OTHER orphaned on a line of its own. A percentage cannot know the
   * width of the thing it is inside.
   *
   * `flexBasis` plus `flexGrow` asks for a minimum and takes whatever is going:
   * five per row where there is room, four where there is not, and every chip
   * in a row the same width because they all grow together. No magic number
   * tied to a screen size.
   */
  chipFifth: { flexGrow: 1, flexBasis: 44 },
  /** Three to a row, for labels like "3 MONTHS". */
  chipThird: { width: '31%' },
  chipOn: SELECTED,
  chipText: { color: '#C3CBD2', fontSize: 15, fontWeight: '700' },
  /** "OTHER" is five characters in a slot sized for two digits. */
  chipTextSmall: { fontSize: TYPE.micro, letterSpacing: 0.3 },
  chipTextOn: SELECTED_TEXT,

  targetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  step: {
    width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: '#242A30',
    alignItems: 'center', justifyContent: 'center'
  },
  stepText: { color: '#fff', fontSize: 26, fontWeight: '600', marginTop: -2 },
  targetNumbers: { flexDirection: 'row', alignItems: 'baseline' },
  targetValue: { color: '#fff', fontSize: 42, fontWeight: '900' },
  targetUnit: { color: VOLT, fontSize: 16, fontWeight: '900' },
  targetUnitGhost: { opacity: 0 },
  targetJumps: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 18, marginTop: 10
  },
  targetHint: { color: '#7C8792', fontSize: TYPE.meta, letterSpacing: 1, minWidth: 44, textAlign: 'center' },
  jump: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 1, borderColor: '#242A30',
    alignItems: 'center', justifyContent: 'center'
  },
  jumpText: { color: '#7C8792', fontSize: TYPE.meta, fontWeight: '800' },

  // R347: found at 2.35x Dynamic Type — `byUnitText`'s own label ("MONTHS")
  // is real body text and legitimately grows, and once it does the row's
  // total width outgrows the screen (the caret's right edge measured at
  // x328.6 on a 320px phone). `position: relative` is unaffected by
  // wrapping — it anchors the dropdown MENU to this row's own top-left,
  // not to any one child's position.
  byRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, position: 'relative',
    flexWrap: 'wrap'
  },
  byInput: {
    width: 88, height: 52, paddingHorizontal: 14,
    backgroundColor: '#111417', borderRadius: 12,
    borderWidth: 1, borderColor: '#2A323A',
    color: '#fff', fontSize: 20, fontWeight: '800'
  },
  byUnitBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    height: 52, paddingHorizontal: 16, borderRadius: 12,
    borderWidth: 1, borderColor: '#2A323A', backgroundColor: '#111417'
  },
  byUnitText: { color: '#E8EAED', fontSize: TYPE.body, fontWeight: '800', letterSpacing: SPACING.label },
  byCaret: { color: '#9AA5AF', fontSize: TYPE.meta, fontWeight: '800' },
  /*
   * An overlay, not a block in the flow.
   *
   * In flow it pushed SET GOAL and the preview down by its own height, so
   * opening the unit menu meant scrolling to reach the thing you opened it to
   * change. Absolute keeps the sheet still: the menu is drawn over what is
   * already there and the button stays exactly where the thumb left it. It
   * hangs off the unit button's row, which is why `byRow` is the positioning
   * context.
   */
  byMenu: {
    position: 'absolute', top: 56, left: 98, right: 0, zIndex: 20,
    borderRadius: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: '#2A323A', backgroundColor: '#0E1114'
  },
  byMenuItem: { paddingVertical: 13, paddingHorizontal: 16 },
  byMenuItemOn: { backgroundColor: '#161B20' },
  byMenuText: { color: '#9AA5AF', fontSize: TYPE.body, fontWeight: '700', letterSpacing: SPACING.label },
  byMenuTextOn: { color: VOLT },
  byPreview: { color: '#9AA5AF', fontSize: TYPE.meta, marginTop: 10 },

  noneLeft: { paddingTop: 6, paddingBottom: 4 },
  noneTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  noneBody: { color: '#7C8792', fontSize: TYPE.body, lineHeight: 21, marginTop: 10 },

  error: { color: '#FF8A8A', fontSize: TYPE.body, marginTop: 14, fontWeight: '600' },
  save: {
    backgroundColor: VOLT, borderRadius: 16, height: 60,
    alignItems: 'center', justifyContent: 'center', marginTop: 22
  },
  saveText: { color: '#000', fontSize: 15, fontWeight: '900', letterSpacing: 2 }
});

/**
 * A fingerprint of everything the app's pure modules decide, for proving a
 * change moved code without changing behaviour (AGENT_LOOP §3a: "a domain
 * snapshot whose hash is identical before and after").
 *
 * SCOPE: every `.ts` module under src/ that node can import: the domain, the
 * screen models, the storage layer. NOT the `.tsx` screens and components,
 * which node cannot load; a round that moves `.tsx` code proves itself with a
 * trace of the running screens instead. test/the-snapshot-runs-every-function
 * fails when a function in scope never runs here, so the scope is real.
 *
 * It runs on a fixed world: UTC, `Date.now` frozen at `T0` (the clock the app
 * stamps ids with), and the sample's shape (twelve weeks of push, pull and
 * legs, a goal, a bodyweight, some missed sets). Then a scripted life through
 * every public action, the pure helpers over a grid of inputs, and a seeded
 * coach battery. Ids stamped with the frozen clock are replaced by their order
 * of appearance, so only a decision can move the hash.
 *
 *   node tools/snapshot.ts             print the hash of each section, and the total
 *   node tools/snapshot.ts --out f     also write the full JSON to f, to diff two runs
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import type { LoggedSet, Unit } from '../src/domain/types.ts';
import { loadLabel, convertWeight } from '../src/domain/types.ts';
import { coachSuggestion, callMade, type TrainingGoal } from '../src/domain/coach.ts';
import { BUILTIN, startingWeight, prefillFor, strengthIndex, pickerFor, inferUnit, unitForNewSession } from '../src/domain/coldstart.ts';
import { profileFor, overlap, recommendNext } from '../src/domain/muscles.ts';
import { dayOf, SPLIT_DAYS, SPLIT_PLANS, PLAN_DAYS, planDayFor, inPlanDay, sessionDay, planOf, sessionPlanDay, groupBySplit, companionFor } from '../src/domain/split.ts';
import { rankExercises, openingLift, sessionCount, predictSession, nextCandidates, suggestNext } from '../src/domain/predict.ts';
import { findExercises, exactExercise, normalizeName } from '../src/domain/find-exercise.ts';
import { t, fill, languageFor, languageOf, dateLocale, number, type Language } from '../src/domain/i18n.ts';
import { goalProgress, narrativeLine, goalCardLine, goalBarA11y, headlineGoal, isAchieved, activeGoals, validateNewGoal, rankGoals, type GoalError } from '../src/domain/goals.ts';
import { plausible, toBase, convertMeasure, trendOf, readingAt, formatMeasure, realLoad, bodyweightMultiple } from '../src/domain/measure.ts';
import { directionOf, measureGoalProgress, validateMeasureGoal, measureGoalMessage, measureGoalLine, type MeasureGoalError } from '../src/domain/measure-goal.ts';
import { loadOf, rank, e1rm, bestWeightAtReps, heaviestEver, bestSetAtReps, bestE1rm } from '../src/domain/pr.ts';
import { restSince, formatRest } from '../src/domain/rest.ts';
import { lastSetAt, justFinished, autoEnd, isStale, weekIndex, weekStreak, longestStreakBefore, sessionStats, topSetPerExercise, sessionTitle } from '../src/domain/session.ts';
import { b64url, pack, shareUrl, SHARE_BASE } from '../src/domain/share-url.ts';
import { weeksSince, weeklyComparison, weeklyCard } from '../src/domain/weekly.ts';
import { NowModel, customJump, customRepJump, heroWidth, layoutFor, typedWeight, lastTimeLine, lastTimeParts, goalTail, revealOffset, splitPickerGroups } from '../src/ui/now-model.ts';
import { recapFor, shareText, multipleLine, latestRecap, streakWorthShowing } from '../src/ui/recap-model.ts';
import { progressRows, hiddenRowCount, recentSessions, weeklyLine, weeklyProgress, shareWeeklyText, goalTag, trendA11y, lastTrainedA11y, bestSetA11y, erasureCounts, erasureIsSingle, erasureLine } from '../src/ui/progress-model.ts';
import { horizonDays, customReps, goalLifts, goalErrorMessage, listGoals, draftToGoal, createGoal, editGoal, targetBase, removeGoals, restoreGoals, canAddGoal, suggestTarget, HORIZON_UNITS, type GoalDraft } from '../src/ui/goals-model.ts';
import { goalFilters, filterGoals, filterCounts, lastView, rememberView, GOAL_SORTS } from '../src/ui/goal-filters.ts';
import { trendLine, measureRows, readingsFor, recordMeasurement, prefillFor as measurePrefill, monthsFrom, saveMeasureGoal, clearMeasureGoal, suggestTarget as measureTarget } from '../src/ui/measure-model.ts';
import { liftHistory } from '../src/ui/lift-history.ts';
import { backupFilename, prepareBackup, applyBackup } from '../src/ui/backup-model.ts';
import { displayUnit, PREF_UNIT } from '../src/ui/display-unit.ts';
import { trainingGoal } from '../src/ui/training-goal.ts';
import { onState, pressStyle, dangerPressStyle } from '../src/ui/press-style.ts';
import { sparkFloor } from '../src/ui/spark-geom.ts';
import { slop } from '../src/ui/target.ts';
import { goTab, type Tab } from '../src/ui/tab-bar.ts';
import { exportAll, serialize, parse, restore, count, summarise } from '../src/data/portable.ts';
import { adaptExpoDb } from '../src/data/expo-db.ts';
import { toFsPath, joinPath, resolveDbLocation, planDbMigration, planDbOpen, describeDbLocation } from '../src/data/db-location.ts';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86_400_000, MIN = 60_000;
/** Wednesday 23 Sep 2026, 18:00 UTC: every clock in the snapshot counts from here, `Date.now` included. */
export const T0 = Date.UTC(2026, 8, 23, 18);
const WEEKS = 12;
const LANGS: Language[] = ['en', 'es'];

/** The sample's shape (tools/seed-web.ts), on the fixed clock. */
const SPLIT: Array<[string, Array<[string, number, number]>]> = [
  ['push', [['bench', 135, 5], ['ohp', 75, 8], ['triext', 35, 12], ['dip', 0, 10]]],
  ['pull', [['deadlift', 185, 5], ['row', 95, 8], ['curl', 30, 10], ['pullup', 0, 8]]],
  ['legs', [['squat', 155, 5], ['legpress', 200, 10]]]
];

function memoryRepo(clock: { now: number }): Repo {
  return new Repo(new DatabaseSync(':memory:') as never, () => clock.now);
}

function sampleRepo(clock: { now: number }): Repo {
  const repo = memoryRepo(clock);
  let n = 0;
  for (let week = WEEKS; week >= 1; week--) {
    SPLIT.forEach(([day, lifts], i) => {
      const start = T0 - week * 7 * DAY + (i * 2 + 2) * DAY;
      const sessionId = `seed_w${week}_${day}`;
      clock.now = start;
      repo.startSession(sessionId, 'lb');
      let at = start;
      for (const [exerciseId, base, reps] of lifts) {
        const step = base >= 135 ? 5 : base > 0 ? 2.5 : 0;
        const w = WEEKS - week + 1, stalled = w >= 5 && w <= 8;
        const weight = base + (stalled ? 4 : w <= 4 ? w : w - 4) * step;
        // The last set of every third session is a miss, so the snapshot sees misses too.
        for (let set = 0; set < 3; set++) {
          const short = set === 2 && (week + i) % 3 === 0 ? 2 : 0;
          repo.logSet({ id: `seed_${n++}`, sessionId, exerciseId, weight, reps: reps - short, at });
          at += 3 * MIN;
        }
        at += 2 * MIN;
      }
      repo.endSession(sessionId, at);
    });
  }
  clock.now = T0;
  repo.saveGoal({
    id: 'seed_goal', exerciseId: 'squat', targetWeight: 225, targetReps: 5,
    createdAt: T0 - 30 * DAY, targetDate: T0 + 60 * DAY, unit: 'lb'
  });
  repo.saveMeasurement({ id: 'seed_bodyweight', kind: 'bodyweight', value: 190, unit: 'lb', at: T0 - (WEEKS * 7 + 1) * DAY });
  return repo;
}

/** A small seeded PRNG (mulberry32), so the coach battery is the same every run. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** 400 random squat histories through the coach, each with a live workout checked by `callMade`. */
function coachBattery(): unknown[] {
  const rnd = prng(694);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const out: unknown[] = [];
  for (let c = 0; c < 400; c++) {
    const unit: Unit = rnd() < 0.8 ? 'lb' : 'kg';
    const grid = unit === 'lb' ? 5 : 2.5;
    const goal = pick(['size', 'strength', 'consistency'] as const) as TrainingGoal;
    let weight = unit === 'lb' ? 45 + Math.floor(rnd() * 40) * 5 : 20 + Math.floor(rnd() * 40) * 2.5;
    const history: LoggedSet[] = [];
    const sessions = 1 + Math.floor(rnd() * 6);
    for (let s = 0; s < sessions; s++) {
      const at = T0 - (sessions - s) * 3 * DAY;
      const sets = 1 + Math.floor(rnd() * 4);
      for (let k = 0; k < sets; k++) {
        const backOff = k > 0 && rnd() < 0.2;
        history.push({
          id: `h${c}_${s}_${k}`, sessionId: `c${c}s${s}`, exerciseId: 'squat',
          weight: backOff ? Math.max(0, weight - grid * 4) : weight, reps: 3 + Math.floor(rnd() * 10), at: at + k * 120_000
        });
      }
      const move = rnd();
      weight = move < 0.5 ? weight + grid : move < 0.65 ? Math.max(grid, weight - grid) : move < 0.7 ? weight * 1.3 : weight;
    }
    const call = coachSuggestion(history, 'squat', T0, { unit, goal, grid, base: unit === 'lb' ? 45 : 20, jump: rnd() < 0.2 ? grid * 2 : undefined });
    const today: LoggedSet[] = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, k) => ({
      id: `t${c}_${k}`, sessionId: 'live', exerciseId: 'squat',
      weight: (call?.weight ?? weight) + (rnd() < 0.2 ? grid : rnd() < 0.2 ? -grid : 0), reps: 2 + Math.floor(rnd() * 10), at: T0 + k * 120_000
    }));
    const made = callMade(call, today);
    out.push({ goal, unit, call, line: call ? fill(t('en', call.key as never), call.params) : null, made: made ? today.indexOf(made) : -1 });
  }
  return out;
}

/** Every public action of the Now screen's model, with its state after each, in one language. */
function nowLife(locale: string): unknown {
  const clock = { now: T0 };
  const repo = sampleRepo(clock);
  const m = new NowModel(repo, () => clock.now, locale);
  const steps: unknown[] = [{ label: 'open', state: m.state(), lang: m.lang(), plan: m.plan(), day: m.chosenDay() }];
  const step = (label: string, act: () => unknown) => { clock.now += 150_000; steps.push({ label, r: act(), state: m.state() }); };
  for (const plan of SPLIT_PLANS) {
    step(`plan ${plan}`, () => m.setPlan(plan));
    for (const day of PLAN_DAYS[plan]) step(`day ${day}`, () => { m.setDay(day); return m.chosenDay(); });
  }
  step('plan ppl', () => m.setPlan('ppl'));
  step('day legs', () => m.setDay('legs'));
  step('away to upper-lower', () => m.setPlan('upper-lower'));
  // Back without choosing: a day the other plan dropped must stay forgotten.
  step('back to ppl', () => { m.setPlan('ppl'); return m.chosenDay(); });
  step('day push', () => m.setDay('push'));
  const byLift: Record<string, unknown> = {};
  for (const e of BUILTIN) { m.selectExercise(e.id); byLift[e.id] = m.state(); }
  step('squat', () => m.selectExercise('squat'));
  step('last time', () => m.lastTime());
  step('log', () => m.log());
  step('bump weight +2', () => m.bumpWeight(2));
  step('bump reps -1', () => m.bumpReps(-1));
  step('jumps', () => [m.plateJump(), m.repJump(), m.plateGrid()]);
  step('bump plate +1', () => m.bumpPlate(1));
  step('jump reps +1', () => m.jumpReps(1));
  step('set weight 187.5', () => m.setWeight(187.5));
  step('set reps 6', () => m.setReps(6));
  // The sample's squat goal is 225 for 5: made in this workout, the line says so.
  step('hit the squat goal', () => { m.setWeight(225); m.setReps(5); return m.log(); });
  step('equipment', () => m.setEquipment('machine', 'Hammer Strength'));
  step('log', () => m.log());
  step('last set in session', () => m.lastSetOfInSession('squat'));
  step('add a set', () => m.addSetTo('squat', { reps: 4, note: 'belt' }));
  const last = m.lastSetOfInSession('squat');
  step('edit set', () => last && m.editSet(last.id, { weight: 190, reps: 5 }));
  step('remove set', () => last && m.removeSet(last.id));
  step('undo', () => m.undo());
  step('next', () => m.next());
  step('search', () => m.searchExercises('press').map(e => e.id));
  const custom = m.addCustomExercise('Sled Push');
  const again = m.addCustomExercise('Sled Push');
  steps.push({ label: 'custom', r: [custom, again], state: m.state() });
  if (custom) { step('select custom', () => m.selectExercise(custom)); step('log custom', () => m.log()); }
  if (again) step('remove custom', () => m.removeCustomExercise(again));
  step('bench', () => m.selectExercise('bench'));
  step('log', () => m.log());
  step('clear', () => m.clearWorkout());
  step('bench again', () => m.selectExercise('bench'));
  step('log', () => m.log());
  step('log', () => m.log());
  step('finish', () => m.finish());
  step('start next', () => m.startNextIfFinished());
  // A new workout has no day yet, so declining to name one shows.
  step('skip day', () => m.skipDay());
  // Kilos chosen in Settings over a history in pounds: the new workout converts it.
  repo.setPref(PREF_UNIT, 'kg');
  step('adopt unit', () => m.adoptChosenUnit());
  step('log', () => m.log());
  steps.push({ label: 'relaunch mid-workout', state: new NowModel(repo, () => clock.now, locale).state() });
  clock.now += 6 * 3_600_000;
  step('close if stale', () => m.closeIfStale());
  return { steps, byLift, stored: exportAll(repo, clock.now) };
}

/** The Now screen's pure helpers over a grid of inputs. */
function nowPure(repo: Repo): unknown {
  const sets = repo.allSets();
  const squat = sets.filter(s => s.exerciseId === 'squat');
  const coach = coachSuggestion(sets, 'squat', T0, { unit: 'lb', grid: 5 });
  const goal = { remaining: 20, targetWeight: 225, targetReps: 5 };
  const lineCases = [
    { previous: null, thisSession: [] },
    { previous: null, thisSession: [], start: 95 },
    { previous: squat[squat.length - 1], thisSession: [] },
    { previous: squat[squat.length - 1], thisSession: [], goal, coach },
    { previous: null, thisSession: squat.slice(-3), goal: { ...goal, remaining: 0, justHit: true }, coach },
  ];
  const exercises = [...repo.exercises().values()];
  return {
    layouts: [320, 375, 390, 430].flatMap(w => [568, 667, 812, 932].map(h => layoutFor(w, h))).concat([layoutFor(390, 844, 5)]),
    hero: [heroWidth(120, 3), heroWidth(96, 5)],
    typed: ['', '0', '185', '185.5', '185.25', '1600', 'abc', '12,5', '  90 '].map(typedWeight),
    jumps: ['', '0', '2.5', '10', '600', 'x'].map(r => [customJump(r, 'lb'), customJump(r, 'kg'), customRepJump(r)]),
    lines: lineCases.map(c => [lastTimeLine(c), ...LANGS.map(l => lastTimeParts(c, l))]),
    tails: [null, goal, { ...goal, remaining: 0, justHit: true }].flatMap(g => LANGS.map(l => goalTail(g, l))),
    reveal: [
      { blocks: [], current: 0, viewport: 0, content: 0, scrollTop: 0 },
      { blocks: [{ y: 0, h: 100 }, { y: 400, h: 100 }], current: 1, viewport: 300, content: 600, scrollTop: 0 },
      { blocks: [{ y: 0, h: 100 }, { y: 400, h: 100 }], current: 0, viewport: 300, content: 600, scrollTop: 250 },
    ].map(revealOffset),
    picker: ([null, 'push', 'upper', 'full'] as const).map(day =>
      splitPickerGroups(groupBySplit(exercises, day === 'push' ? 'push' : null), day)),
  };
}

function recapSection(repo: Repo): unknown {
  const ids = [...new Set(repo.allSets().map(s => s.sessionId))].sort();
  const measurements = repo.measurements();
  return {
    each: ids.map(id => {
      const session = repo.session(id)!;
      const recap = recapFor(repo, id, (session.endedAt ?? T0) + 3_600_000);
      return {
        id, recap, text: recap && LANGS.map(l => shareText(recap, l)),
        multiple: recap && multipleLine(recap.payload, measurements, session.endedAt ?? T0)
      };
    }),
    latest: latestRecap(repo, T0),
    worth: Array.from({ length: 16 }, (_, n) => streakWorthShowing(n)),
    noGoal: recapsWithoutAGoal(),
  };
}

/** A goal takes the recap's comparison line; without one the week's first workout gets the trend. */
function recapsWithoutAGoal(): unknown {
  const clock = { now: T0 };
  const repo = sampleRepo(clock);
  repo.deleteGoal('seed_goal');
  return ['seed_w1_push', 'seed_w1_pull', 'seed_w1_legs', 'seed_w2_legs'].map(id =>
    recapFor(repo, id, (repo.session(id)!.endedAt ?? T0) + 3_600_000));
}

function progressSection(repo: Repo): unknown {
  const rows = progressRows(repo, T0);
  return {
    rows, hidden: [hiddenRowCount(repo, T0), hiddenRowCount(repo, T0, 3)], recent: recentSessions(repo),
    weekly: [weeklyLine(repo, T0), weeklyProgress(repo, T0), shareWeeklyText(repo, T0)],
    tags: [{ targetWeight: 225, remaining: 20, achieved: false }, { targetWeight: 225, remaining: 0, achieved: true }]
      .flatMap(g => LANGS.map(l => goalTag(g, l))),
    a11y: rows.map(r => LANGS.map(l => [trendA11y(r, l), lastTrainedA11y(r, l), bestSetA11y(r, l)])),
    erasure: [erasureCounts(repo), erasureIsSingle(repo), ...LANGS.map(l => erasureLine(repo, l))],
  };
}

/** Goals: the domain rules, the screen model and its filters, driven through create, edit, remove and restore. */
function goalsSection(): unknown {
  const clock = { now: T0 };
  const repo = sampleRepo(clock);
  const history = repo.allSets(), exercises = repo.exercises(), units = repo.sessionUnits();
  const view = lastView();   // before anything remembers one: the screen's default
  const draft: GoalDraft = { exerciseId: 'bench', targetWeight: 225, targetReps: 5, inDays: 60, unit: 'lb' };
  const created = createGoal(repo, draft, T0);
  const more = [createGoal(repo, { ...draft, exerciseId: 'ohp', targetWeight: 100, targetReps: 8 }, T0),
    createGoal(repo, { ...draft, exerciseId: 'row', targetWeight: 125, targetReps: 8 }, T0)];
  const attempts = [
    createGoal(repo, draft, T0),
    createGoal(repo, { ...draft, exerciseId: 'row', targetWeight: 50 }, T0),
    createGoal(repo, { ...draft, exerciseId: 'ohp', targetReps: 40 }, T0),
    createGoal(repo, { ...draft, exerciseId: 'curl', inDays: -3 }, T0),
  ];
  const benchGoal = repo.goals().find(g => g.exerciseId === 'bench');
  const edited = benchGoal ? editGoal(repo, benchGoal.id, { ...draft, targetWeight: 235 }, T0) : null;
  const list = listGoals(repo, T0);
  const removed = removeGoals(repo, list.slice(0, 1).map(p => p.goal.id));
  const restored = restoreGoals(repo, removed);
  // Set weeks ago, so it has moved: the headline then has two goals to rank.
  repo.saveGoal({ id: 'seed_goal_2', exerciseId: 'deadlift', targetWeight: 250, targetReps: 5, createdAt: T0 - 40 * DAY, targetDate: T0 + 60 * DAY, unit: 'lb' });
  const goals = repo.goals();
  const progress = goals.map(g => goalProgress(g, history, exercises, T0, units));
  rememberView('push', 'soonest');
  const errors: GoalError[] = ['too_many', 'duplicate', 'target_below_current', 'bad_reps', 'date_in_past'];
  return {
    created, attempts, edited, removed, restored, list: listGoals(repo, T0), lifts: goalLifts(repo, T0),
    canAdd: canAddGoal(repo), suggest: [suggestTarget(repo, 'bench', 5, 'lb'), suggestTarget(repo, 'squat', 8, 'kg')],
    horizon: ['3', '0', '-1', 'x', '500'].flatMap(raw => HORIZON_UNITS.map(u => horizonDays(raw, u))),
    reps: ['', '0', '5', '21', 'x'].map(customReps),
    errors: errors.flatMap(e => LANGS.map(l => goalErrorMessage(e, l))),
    draft: draftToGoal(draft, T0), base: [targetBase(null, 200), targetBase(goals[0], 200)],
    lines: progress.map(p => LANGS.map(l => [narrativeLine(p, l), goalCardLine(p, l), goalBarA11y(p, l)])),
    headline: [headlineGoal(goals, history, exercises, T0, units), headlineGoal(goals, history, exercises, T0, units, T0 - 7 * DAY, ['row'])],
    achieved: goals.map(g => isAchieved(g, history, units)), active: activeGoals(goals, history, units),
    validate: validateNewGoal(draftToGoal({ ...draft, exerciseId: 'deadlift' }, T0), goals, history, T0, units),
    ranked: rankGoals(goals, history, exercises, T0, units),
    filters: SPLIT_PLANS.map(p => goalFilters(p)),
    filtered: goalFilters('ppl').flatMap(f => GOAL_SORTS.map(s => filterGoals(list, f, s).map(p => p.goal.id))),
    counts: SPLIT_PLANS.map(p => filterCounts(list, p)), view, remembered: lastView(), more,
    stored: exportAll(repo, T0),
  };
}

/** Measurements: readings in both units and kinds, goals set and cleared, every error worded. */
function measureSection(): unknown {
  const clock = { now: T0 };
  const repo = sampleRepo(clock);
  const recorded = [
    recordMeasurement(repo, 'bodyweight', '188.5', 'lb', T0 - 20 * DAY),
    recordMeasurement(repo, 'bodyweight', '86', 'kg', T0 - 5 * DAY, 'morning'),
    recordMeasurement(repo, 'bodyweight', 'abc', 'lb', T0),
    recordMeasurement(repo, 'bodyweight', '5000', 'lb', T0),
    recordMeasurement(repo, 'height', '180', 'cm', T0 - 2 * DAY),
    recordMeasurement(repo, 'height', '71', 'in', T0 - DAY),
  ];
  const all = repo.measurements();
  const goal = { id: 'mg1', kind: 'bodyweight' as const, target: 180, unit: 'lb' as const, createdAt: T0, targetDate: T0 + 90 * DAY };
  const saved = [
    saveMeasureGoal(repo, 'bodyweight', '180', 'lb', monthsFrom(T0, 3), T0),
    saveMeasureGoal(repo, 'height', '999', 'cm', monthsFrom(T0, 3), T0),
    saveMeasureGoal(repo, 'height', '185', 'cm', T0 - DAY, T0),
  ];
  const trends = (['bodyweight', 'height'] as const).map(k => trendOf(k, all, T0));
  const errors: MeasureGoalError[] = ['implausible', 'already-there', 'no-reading', 'past-date', 'duplicate'];
  const out = {
    recorded, saved, rows: measureRows(repo, T0), readings: readingsFor(repo, 'bodyweight'),
    prefill: [measurePrefill(repo, 'bodyweight', 'lb', T0), measurePrefill(repo, 'height', 'in', T0)],
    target: [measureTarget(repo, 'bodyweight', 'lb', T0), measureTarget(repo, 'height', 'cm', T0)],
    trendLines: trends.flatMap((tr, i) => (tr ? LANGS.map(l => trendLine(i ? 'height' : 'bodyweight', tr, l)) : [])),
    plausible: [plausible('bodyweight', 190, 'lb'), plausible('height', 400, 'cm')],
    base: [toBase('bodyweight', 86, 'kg'), toBase('height', 71, 'in')],
    convert: [convertMeasure('bodyweight', 190, 'lb', 'kg'), convertMeasure('height', 180, 'cm', 'in')],
    at: readingAt('bodyweight', all, T0 - 10 * DAY), format: [formatMeasure(86.25, 'kg'), formatMeasure(71, 'in')],
    load: [realLoad({ exerciseId: 'pullup', weight: 10, at: T0 }, all), realLoad({ exerciseId: 'bench', weight: 185, at: T0 }, all, 'kg')],
    multiple: bodyweightMultiple(315, 'lb', all, T0),
    direction: directionOf(goal, all), goalProgress: measureGoalProgress(goal, all, T0),
    validate: [validateMeasureGoal(goal, all, [], T0), validateMeasureGoal({ ...goal, target: 5000 }, all, [], T0),
      validateMeasureGoal({ ...goal, targetDate: T0 - DAY }, all, [goal], T0)],
    messages: errors.flatMap(e => LANGS.map(l => measureGoalMessage(e, l))),
    goalLines: LANGS.map(l => measureGoalLine(measureGoalProgress(goal, all, T0), l)),
  };
  const stored = exportAll(repo, T0);
  clearMeasureGoal(repo, 'bodyweight');
  return { ...out, stored, afterClear: exportAll(repo, T0) };
}

/** expo-sqlite's surface over node:sqlite, so the adapter runs the real Repo. */
function fakeExpo(): Parameters<typeof adaptExpoDb>[0] {
  const db = new DatabaseSync(':memory:');
  return {
    execSync: sql => { db.exec(sql); },
    prepareSync: sql => {
      const st = db.prepare(sql);
      return { executeSync: params => ({ getAllSync: () => st.all(...(params as never[])) }), finalizeSync: () => {} };
    }
  };
}

/** The Repo's own operations, on a throwaway database, with everything they stored hashed. */
function repoOps(clock: { now: number }): unknown {
  const db = new DatabaseSync(':memory:');
  const r = new Repo(db as never, () => clock.now);
  r.startSession('s1', 'kg', 'Legs', T0 - DAY);
  r.logSet({ id: 'x1', sessionId: 's1', exerciseId: 'squat', weight: 100, reps: 5, at: T0 - DAY, equipment: 'machine', machine: 'Smith' } as LoggedSet);
  r.logSet({ id: 'x2', sessionId: 's1', exerciseId: 'squat', weight: 100, reps: 4, at: T0 - DAY + MIN });
  r.logSet({ id: 'x3', sessionId: 's1', exerciseId: 'front-squat', weight: 60, reps: 5, at: T0 - DAY + 2 * MIN });
  r.updateSet('x2', { reps: 5, note: 'paused' });
  r.addExercise('sled_push', 'Sled Push');
  r.addExercise('my_front_squat', 'Front Squat');   // their own, named like a built-in that has sets: both stay
  r.addExercise('my_hack_squat', 'Hack Squat');     // named like one with no sets: theirs shadows it
  r.setPref('pref.test', '1');
  const before = {
    library: [...r.exercises().keys()].sort(),
    removedBuiltin: r.removeExercise('lateral'), removedWas: r.exerciseWasRemoved('lateral'),
    customs: r.customExerciseCount(), machines: [r.knownMachines(), r.knownMachines('squat')],
    history: r.historyBefore('s1'), unit: r.lastUsedUnit(), prefs: r.allPrefs(),
    reopened: [r.endSession('s1', T0 - DAY + 3_600_000), r.reopenSession('s1'), r.liveSession()],
  };
  r.deleteSet('x1');
  r.clearPref('pref.test');
  r.saveMeasurement({ id: 'm1', kind: 'bodyweight', value: 80, unit: 'kg', at: T0 });
  r.deleteMeasurement('m1');
  r.saveMeasureGoal({ id: 'mg', kind: 'bodyweight', target: 75, unit: 'kg', createdAt: T0, targetDate: T0 + 90 * DAY });
  let clash: string | null = null;
  try {
    r.saveMeasureGoal({ id: 'mg2', kind: 'bodyweight', target: 70, unit: 'kg', createdAt: T0, targetDate: T0 + 90 * DAY });
  } catch (e) {
    clash = (e as Error).message;
  }
  r.deleteMeasureGoal('mg');
  r.saveGoal({ id: 'g', exerciseId: 'squat', targetWeight: 140, targetReps: 5, createdAt: T0, targetDate: T0 + 90 * DAY, unit: 'kg' });
  r.deleteGoal('g');
  const ids = [r.knownSetIds(), r.knownGoalIds(), r.knownMeasurementIds(), r.knownMeasureGoalIds()];
  const stored = exportAll(r, T0);
  // The same database opened again, as the next launch opens it: seeding finds the library already there.
  const again = new Repo(db as never, () => clock.now);
  const reopenedLibrary = [...again.exercises().keys()].sort();
  r.eraseAll();
  return { before, clash, ids, stored, reopenedLibrary, erased: exportAll(r, T0) };
}

/** Storage: export and restore (what they STORED, not only what they report), the Repo, the expo adapter, the database's location. */
function dataSection(repo: Repo): unknown {
  const clock = { now: T0 };
  // A backup with every field filled, so a restore that drops or bends one shows.
  const rich = sampleRepo(clock);
  rich.addExercise('sled_push', 'Sled Push');
  rich.startSession('rich', 'kg', 'Odd day', T0 - 2 * DAY);
  rich.logSet({ id: 'r1', sessionId: 'rich', exerciseId: 'sled_push', weight: 80, reps: 10, at: T0 - 2 * DAY, note: 'turf', equipment: 'machine', machine: 'Prowler' } as LoggedSet);
  rich.logSet({ id: 'r2', sessionId: 'rich', exerciseId: 'squat', weight: 100, reps: 5, at: T0 - 2 * DAY + MIN, note: 'belt' } as LoggedSet);
  rich.endSession('rich', T0 - 2 * DAY + 3_600_000);
  rich.saveMeasurement({ id: 'rich_m', kind: 'height', value: 180, unit: 'cm', at: T0 - DAY, note: 'barefoot' });
  rich.saveMeasureGoal({ id: 'rich_mg', kind: 'bodyweight', target: 185, unit: 'lb', createdAt: T0, targetDate: T0 + 90 * DAY });
  rich.setPref('pref.unit', 'lb');
  const text = serialize(exportAll(rich, T0));
  const parsed = [parse(text).error, parse('{bad').error, parse('{}').error, parse('[1]').error];
  const file = parse(text).file!;
  const restoredInto = memoryRepo(clock);
  const report = restore(restoredInto, file);
  const dirtyInto = memoryRepo(clock);
  const dirty = restore(dirtyInto, {
    ...file, exercises: [...file.exercises, { id: 'nameless' }], sets: [...file.sets, { id: 'orphan-set', sessionId: 'nowhere' }]
  } as never);
  const second = memoryRepo(clock);
  const applied = [applyBackup(second, text), applyBackup(second, 'garbage')];
  const expo = new Repo(adaptExpoDb(fakeExpo()), () => clock.now);
  expo.startSession('e1', 'lb', undefined, T0);
  expo.logSet({ id: 'e1s', sessionId: 'e1', exerciseId: 'bench', weight: 185, reps: 5, at: T0 });
  const location = resolveDbLocation({ platform: 'ios', appGroup: 'group.proof', sharedContainers: { 'group.proof': { uri: 'file:///shared/' } } });
  const migration = planDbMigration({ from: '/docs/SQLite', to: toFsPath('file:///shared/SQLite'), exists: p => p.endsWith('proof.db') });
  return {
    text, parsed, report, dirty, summary: [report, dirty].flatMap(r => LANGS.map(l => summarise(r, l))),
    stored: [restoredInto, dirtyInto, second, expo].map(r => exportAll(r, T0)),
    counts: [count(1, 'set'), count(3, 'set'), count(2, 'entry', 'entries')],
    applied, filename: backupFilename(T0), prepared: prepareBackup(repo, T0), repo: repoOps(clock),
    location: [location, resolveDbLocation({ platform: 'android', appGroup: 'group.proof', sharedContainers: null })],
    migration, open: planDbOpen(location, migration, '/docs/SQLite'), describe: describeDbLocation(location, migration),
    paths: [toFsPath('file:///a/b%20c'), joinPath('/a/', '/b', 'c')],
  };
}

/** The domain rules the screens reach through the models, called directly over the sample. */
function domainSection(repo: Repo): unknown {
  const history = repo.allSets(), exercises = repo.exercises(), units = repo.sessionUnits(), measurements = repo.measurements();
  const lifts = [...new Set(history.map(s => s.exerciseId))].sort();
  const session = repo.session('seed_w1_push')!;
  const sessionSets = repo.setsInSession('seed_w1_push');
  const library = [...exercises.values()];
  const recap = recapFor(repo, 'seed_w1_push', T0);
  const weekly = weeklyComparison(history, exercises, T0, 'lb', measurements, units);
  return {
    records: lifts.map(id => [id, bestWeightAtReps(history, id, 5, measurements), heaviestEver(history, id, measurements),
      bestSetAtReps(history, id, 8, measurements), bestE1rm(history, id, measurements)]),
    load: [loadOf(history[0], measurements, 'lb', units), e1rm(200, 5), recap?.prs.map(rank)],
    predict: [sessionCount(history), predictSession(history, T0), nextCandidates(history, ['bench'], T0), suggestNext(history, ['bench'], T0),
      rankExercises(history, T0), openingLift(history, T0)],
    rest: [restSince(null, T0), restSince(T0 - 90_000, T0), ...[0, 59, 61, 3600].map(formatRest)],
    session: [lastSetAt(sessionSets), justFinished(history, sessionSets, T0), autoEnd(session, sessionSets, T0), isStale(session, sessionSets, T0),
      weekIndex(T0), weekStreak(history, T0), longestStreakBefore(history, T0), sessionStats(session, sessionSets, measurements),
      topSetPerExercise(sessionSets, measurements), ...SPLIT_PLANS.flatMap(p => LANGS.map(l => sessionTitle(sessionSets, l, p)))],
    share: [b64url('PROOF ✓'), recap && pack(recap.payload), recap && shareUrl(recap.payload, 'ref1', SHARE_BASE)],
    split: [...SPLIT_DAYS.flatMap(d => SPLIT_PLANS.map(p => planDayFor(d, p))), inPlanDay('bench', 'upper'), inPlanDay('squat', 'upper'),
      sessionDay(['bench', 'ohp']), sessionDay([], 'legs'), planOf(repo), sessionPlanDay(['squat'], 'upper-lower'),
      groupBySplit(library, 'yours'), companionFor('push', ['bench'], library)],
    types: [loadLabel(0), loadLabel(45), loadLabel(187.5), convertWeight(100, 'lb', 'kg'), convertWeight(100, 'kg', 'lb')],
    weekly: [weeksSince(0), weeksSince(7), weeksSince(30), weekly, weekly && weeklyCard(weekly, 'lb', 'PROOF', 'en')],
    muscles: [overlap(profileFor('bench')!, profileFor('ohp')!), LANGS.map(l => recommendNext(['ohp', 'row', 'squat'], sessionSets, l))],
    coldstart: [strengthIndex(history, 'lb'), pickerFor(history, T0, 3, 12, library), pickerFor([], T0), inferUnit('en-US'), inferUnit('en-GB'),
      inferUnit(null), unitForNewSession(null, 'en-US'), unitForNewSession('kg', 'en-US'), unitForNewSession(null, null, 'kg')],
    names: ['Bench Press', 'Dumbbells, flyes!', 'Crème Brûlée', 'Pull-Ups', 'Skull Crushers'].map(normalizeName),
    exact: exactExercise('bench press', library)?.id ?? null,
    i18n: [languageFor('es-MX'), languageFor('fr-FR'), languageFor(null), languageOf(repo, 'es-ES'), dateLocale('en'), dateLocale('es'),
      number(12345.5, 'en'), number(12345.5, 'es'), fill('{a} and {b}', { a: 1, b: 'two' })],
    goal: goalProgress(repo.goals()[0], history, exercises, T0, units),
  };
}

/** The screen helpers that are not a screen: preferences, press styles, geometry and navigation. */
function uiSection(repo: Repo): unknown {
  const calls: unknown[] = [];
  const router = {
    canGoBack: () => { calls.push('canGoBack'); return true; }, dismissAll: () => { calls.push('dismissAll'); },
    replace: (to: string) => { calls.push(['replace', to]); }, push: (to: string) => { calls.push(['push', to]); },
    navigate: (to: string) => { calls.push(['navigate', to]); }
  };
  const tabs: Tab[] = ['now', 'progress', 'goals', 'settings'];
  for (const tab of tabs) goTab(router as never, tab);
  const press = pressStyle({ opacity: 1 }, 'primary'), danger = dangerPressStyle({ opacity: 1 }, '#f00');
  return {
    prefs: [displayUnit(repo), trainingGoal(repo)], on: [onState(true), onState(false)],
    press: [press({ pressed: true } as never), press({ pressed: false } as never), danger({ pressed: true } as never),
      pressStyle({}, 'quiet', true)({ pressed: true } as never)],
    spark: Array.from({ length: 13 }, (_, n) => sparkFloor(n)), slop: [slop(30), slop(44, 8)], router: calls,
  };
}

/**
 * Every module in scope, and every non-function value each exports, keyed by
 * the export's NAME, so moving a constant between files does not move the hash
 * and a new module's constants are counted without a list to keep.
 */
async function exportsSection(): Promise<unknown> {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) files.push(p);
    }
  };
  walk(path.join(APP, 'src'));
  const values: Record<string, unknown> = {};
  const skipped: Record<string, string> = {};
  const imported: string[] = [];
  for (const abs of files.sort()) {
    const rel = path.relative(APP, abs).split(path.sep).join('/');
    let mod: Record<string, unknown>;
    try {
      mod = await import(pathToFileURL(abs).href) as Record<string, unknown>;
    } catch (e) {
      skipped[rel] = String((e as Error).message).split('\n')[0]
        .replace(/(?:file:\/\/\/)?(?:[A-Za-z]:)?[\\/][^\s'"`]*[\\/][^\s'"`]*/g, '…');
      continue;
    }
    imported.push(rel);
    for (const [name, v] of Object.entries(mod)) {
      if (typeof v === 'function') continue;
      values[name in values ? `${name}@${rel}` : name] = v;
    }
  }
  return { modules: imported, skipped, values };
}

/** JSON with sorted keys, Maps and Sets as arrays, and frozen-clock ids replaced by their order of appearance. */
export function canonical(value: unknown): string {
  const stamp = `_${T0.toString(36)}`;
  const ids = new Map<string, string>();
  const walk = (v: unknown): unknown => {
    if (v instanceof Map) return [...v.entries()].map(([k, x]) => [walk(k), walk(x)]);
    if (v instanceof Set) return [...v].map(walk);
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === 'string' && v.includes(stamp)) {
      if (!ids.has(v)) ids.set(v, `#id${ids.size + 1}`);
      return ids.get(v);
    }
    if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) {
        const x = (v as Record<string, unknown>)[k];
        if (typeof x !== 'function' && x !== undefined) o[k] = walk(x);
      }
      return o;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

/** Every section of the snapshot, by name, computed in the fixed world. */
export async function snapshot(): Promise<Record<string, unknown>> {
  const realNow = Date.now, realTZ = process.env.TZ;
  process.env.TZ = 'UTC';
  Date.now = () => T0;
  try {
    const clock = { now: T0 };
    const repo = sampleRepo(clock);
    const history = repo.allSets();
    const units: Unit[] = ['lb', 'kg'];
    return {
      exports: await exportsSection(),
      library: BUILTIN.map(e => ({
        id: e.id, profile: profileFor(e.id), day: dayOf(e.id),
        start: units.map(u => [startingWeight(e.id, [], u), startingWeight(e.id, history, u)]),
        prefill: units.map(u => prefillFor(e.id, history, u))
      })),
      find: ['rdl', 'incline db', 'press', 'squats', 'pull up', 'skullcrusher', 'military press', 'bss', 'kb swing', 'zz'].map(q =>
        [q, findExercises(q, [...repo.exercises().values()]).map(e => e.id)]),
      coach: coachBattery(),
      nowEn: nowLife('en-US'),
      nowEs: nowLife('es-ES'),
      nowPure: nowPure(repo),
      recaps: recapSection(repo),
      progress: progressSection(repo),
      goals: goalsSection(),
      measure: measureSection(),
      lifts: [...new Set(history.map(s => s.exerciseId))].sort().map(id => [id, liftHistory(repo, id)]),
      data: dataSection(repo),
      domain: domainSection(repo),
      ui: uiSection(repo),
    };
  } finally {
    Date.now = realNow;
    if (realTZ === undefined) delete process.env.TZ; else process.env.TZ = realTZ;
  }
}

/** The total hash, and one per section so a mismatch says where it is. */
export async function fingerprint(): Promise<{ total: string; sections: Record<string, string>; json: string }> {
  const snap = await snapshot();
  const sections: Record<string, string> = {};
  const parts: string[] = [];
  for (const [name, value] of Object.entries(snap)) {
    const json = canonical(value);
    sections[name] = createHash('sha256').update(json).digest('hex').slice(0, 16);
    parts.push(`"${name}":${json}`);
  }
  const json = `{${parts.join(',')}}`;
  return { total: createHash('sha256').update(json).digest('hex').slice(0, 16), sections, json };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const f = await fingerprint();
  const at = process.argv.indexOf('--out');
  if (at > 0) fs.writeFileSync(path.resolve(process.argv[at + 1]), f.json);
  for (const [name, hash] of Object.entries(f.sections)) console.log(`  ${name.padEnd(9)} ${hash}`);
  console.log(`snapshot ${f.total} (${Math.round(f.json.length / 1024)} KB)`);
}

import type { Repo } from '../data/repo.ts';
import type { LoggedSet, Unit } from '../domain/types.ts';
import type { Goal } from '../domain/goals.ts';
import { rankExercises } from '../domain/predict.ts';
import { bestSetAtReps, bestWeightAtReps, e1rm, MAX_PR_REPS } from '../domain/pr.ts';
import { sessionTitle, sessionStats, topSetPerExercise } from '../domain/session.ts';
import { planOf } from '../domain/split.ts';
import { realLoad, bodyweightMultiple, CARRIES_BODYWEIGHT, type Measurement } from '../domain/measure.ts';
import { t, fill, languageOf, number, MONTHS_TREND, type Language } from '../domain/i18n.ts';
import { weeklyComparison, weeklyCard, type WeeklyComparison } from '../domain/weekly.ts';
import { shareUrl } from '../domain/share-url.ts';
import type { RecapPayload } from '../domain/session.ts';
import { displayUnit } from './display-unit.ts';
import { loadLabel, convertWeight } from '../domain/types.ts';

/**
 * Screen 2 — Progress. PROMPT.md §5.
 *
 * "One screen, not a dashboard." And §8's mature clause: it must not become a
 * wall of sparklines. Old lifts fall OFF the screen, they do not fall into a
 * scroll — so this is capped and ranked, never exhaustive.
 *
 * The ranking is `rankExercises`, the same decayed recency×frequency score the
 * logging path uses. Reusing it is deliberate: a Progress screen ordered
 * differently from the exercise picker would show a lifter two different
 * answers to "what am I training right now".
 */

/**
 * The cap, and what it is actually for.
 *
 * §5 wants old lifts to fall off rather than into a scroll — "a wall of dead
 * lifts is what year two looks like otherwise" — and that is right. But it was
 * implemented as "the top 8 by recency×frequency", which cuts by RANK, and rank
 * is the wrong axis: walked with five weeks of a real push/pull/legs history,
 * the eight visible rows were every legs and pull movement and Bench Press was
 * hidden. Legs had simply been trained most recently. Train push tomorrow and
 * the screen recomposes — so a lifter's main lift is visible on some days of
 * the week and not others, on the screen whose whole job is tracking it.
 *
 * A dead lift is one you have not trained in a long time, not one that ranks
 * ninth. So the cut is by TIME now, and the number only bounds the worst case:
 * a twelve-movement programme shows all twelve, and year two still does not
 * show the forty movements it abandoned.
 */
export const MAX_ROWS = 16;

/**
 * How recently a lift must have been trained to still count as yours.
 *
 * Eight weeks: long enough to survive a holiday, an illness or a deload block,
 * short enough that a movement you have genuinely stopped doing stops taking up
 * a row. A lift with a goal on it is exempt — see `progressRows`.
 */
export const ACTIVE_WINDOW_MS = 56 * 86_400_000;
/** Enough points to read a trend; more is noise at this size. */
export const SPARK_POINTS = 10;

export interface ProgressRow {
  exerciseId: string;
  name: string;
  /**
   * The real best set at 5+ reps — its actual weight AND its actual reps.
   * Both come from one stored set, so the pair is always something the user
   * genuinely did. 0/0 when they have never trained it in that range.
   *
   * Deliberately NOT the peak of `spark`. `spark` is an e1RM trend across every
   * productive rep range (1-12), because a heavy single is real information
   * about how a lift is progressing; `best` is scoped to 5+ because that is the
   * range goals are set and compared in (`goalFor` uses the same threshold),
   * and letting an occasional heavy triple stand in for "your working weight"
   * would make the goal gap on this same row lie. So a session with a heavy
   * single genuinely CAN show as the sparkline's tallest point while `best`
   * names an earlier, lighter, higher-rep set — checked directly: 275×3 then
   * 225×5 then 215×8 renders `best: 225×5` with the 275×3 session as the
   * sparkline's peak. Both numbers are true; they are answering different
   * questions, and this is why a viewer should not expect them to agree.
   */
  best: number;
  bestReps: number;
  /**
   * When the current best set happened. Null alongside `best: 0` — nothing
   * to date if it was never trained at this rep range.
   *
   * `bestSetAtReps` already returns the full `LoggedSet`, `.at` and all, and
   * this row discarded it — the same shape as `reachedAt` before R267 and
   * `weeklyCard` before R285: data the app had computed and thrown away
   * before it reached a screen. Rendered as an accessibility label rather
   * than visible text, because the row's two lines are already at capacity
   * and this app has repeatedly found and fixed the crowding that comes from
   * treating "there is room for one more thing" as true when it is not — see
   * the `goalTag` slot's own history. §16's "every number checkable" does
   * not require every number to be ON SCREEN, only reachable.
   */
  bestAt: number | null;
  unit: Unit;
  /**
   * What that set actually moved, for the four movements whose load is the
   * lifter — "185 + 25" is 210 on a pull-up.
   *
   * Null for every ordinary lift, and null for a bodyweight lift with no
   * bodyweight on record: the row still shows the weight ADDED, which is the
   * only honest thing it can say, rather than inventing an operand.
   */
  realBest: number | null;
  /**
   * "1.75× bodyweight" — the milestone lifters actually chase and quote,
   * reusing the exact rule the recap's own `multipleLine` claims it with
   * (same function, same thresholds) rather than a second implementation
   * that could quietly disagree about what counts.
   *
   * Complementary to `realBest`, never alongside it: `realBest` is for the
   * four CARRIES_BODYWEIGHT movements, where the weight ALREADY is the
   * lifter's own load plus what they added — a multiple of that number would
   * be a ratio of a ratio. This is for everything else, where the barbell's
   * own number is worth comparing against a body it did not come from.
   * Null below 1x for the same reason the recap's own line is: an overhead
   * press at 0.4 times bodyweight is arithmetically true and says nothing
   * anybody asked this screen to say.
   */
  bestMultiple: number | null;
  /** Normalised 0..1 e1RM per session, oldest first. Flat line when there is no spread. */
  spark: number[];
  /**
   * Change in what they actually lifted across the sparkline window — same
   * lift, same reps, more weight — or null when the two ends are not
   * comparable.
   *
   * This was an **e1RM** delta, and e1RM is exactly the wrong basis for a
   * number printed next to a real set. `pr.ts` already says why: e1RM may RANK
   * candidate sets, never award, because it disagrees with what a lifter would
   * say. On screen that showed "Squat 195 x 5" with "+29" beside it, while the
   * weight had actually gone 170 to 195 — the user could not reconcile the
   * number with anything visible, which is the definition of an invented one.
   *
   * Null rather than 0 when the ends were done for different reps: 200x5 to
   * 200x8 is real progress that a weight delta reports as nothing, and printing
   * "0" would be a claim. A dash says "no like-for-like comparison", and the
   * sparkline still shows the shape.
   */
  trend: number | null;
  /**
   * When the WINDOW `trend` is measured across began — same shape as
   * `bestAt` (R292): `trendAcross` already has the first set's own date in
   * hand to compute the delta and threw it away before it reached anywhere
   * checkable. Null exactly when `trend` is null, for the same reasons
   * `trendAcross` itself declines: fewer than two comparable sessions, or
   * the two ends were done at different reps.
   *
   * The column header already names the WINDOW ("last 10 sessions"), which
   * is checkable by counting sparkline bars. This is checkable a different
   * way — against a calendar rather than a count — and §16 does not ask for
   * one at the expense of the other.
   */
  trendSince: number | null;
  /**
   * The goal on this lift, if there is one.
   *
   * Progress is the tracking screen and goals are per-lift, but the two never
   * met: a lift with a target 20 lb away looked exactly like one with no target
   * at all. It also gives a row something true to say before there is a trend —
   * `trend` is null until two comparable sessions exist, so a new user's
   * Progress screen is a column of dashes, and a goal turns that into a number
   * from the very first session.
   */
  goal: {
    targetWeight: number;
    /** Weight still to find, at the goal's rep count. 0 once it is met. */
    remaining: number;
    achieved: boolean;
  } | null;
  lastTrainedAt: number;
  sessionCount: number;
}

/**
 * The strength change across a window, on a basis the user can check.
 *
 * Ends compared like for like: the same reps, so the difference is weight and
 * nothing else. Anything cleverer stops being verifiable from the screen.
 *
 * **It is not rounded to whole units**, and that was the second way this number
 * became uncheckable. `Math.round` turned a 12.5 lb gain into "+13": the row
 * read `Barbell Row · 115 × 8 · +13 lb`, so the arithmetic gave a starting
 * weight of 102 — a number the user never lifted and, on 2.5 lb increments,
 * could not have loaded. Half-unit steps are the norm rather than the edge
 * (dumbbells, and every kg plate set), and `Math.round` breaks ties upward, so
 * four of the eight seeded lifts were each overstating their gain by half a
 * pound in the app's own favour.
 *
 * Weights are stored in the unit they were entered in and never converted
 * (`schema.ts`), so the difference of two of them is exact; the 2dp round is
 * only there to keep floating-point dust out of a displayed number.
 */
/**
 * A set's weight, converted into `unit` before anything else touches it.
 *
 * Checked directly and found missing, the same way `pr.ts`'s own `loadOf`
 * was: `realLoad(x, measurements, unit)?.load ?? x.weight` trusts `x.weight`
 * is already in `unit`, and across a screen that aggregates EVERY session
 * ever logged, that is false the moment a lifter has switched units once.
 * `sessionUnits` (from `repo.sessionUnits()`) is what makes it true; a
 * session missing from the map is assumed to already be in `unit`, which is
 * the honest answer for data older than the `sessions.unit` column.
 */
function loadIn(
  x: LoggedSet, measurements: readonly Measurement[], unit: Unit, sessionUnits: Map<string, Unit>
): number {
  const from = sessionUnits.get(x.sessionId) ?? unit;
  const weight = from === unit ? x.weight : convertWeight(x.weight, from, unit);
  return realLoad({ ...x, weight }, measurements, unit)?.load ?? weight;
}

function trendAcross(
  window: LoggedSet[], measurements: readonly Measurement[] = [], unit: Unit = 'lb',
  sessionUnits: Map<string, Unit> = new Map()
): number | null {
  if (window.length < 2) return null;
  const first = window[0], last = window[window.length - 1];
  if (first.reps !== last.reps) return null;
  // The change in what was MOVED. Ten sessions of strict pull-ups at eight reps
  // is a real 25 lb of progress if the lifter put on 25 lb — and reported "+0"
  // while the belt stayed empty, because nothing about the set changed except
  // the person doing it.
  const load = (x: LoggedSet) => loadIn(x, measurements, unit, sessionUnits);
  return Math.round((load(last) - load(first)) * 100) / 100;
}

/**
 * "1.75× bodyweight" for a row's own best set, or null — see `ProgressRow.
 * bestMultiple`'s own comment for the rules this mirrors from the recap's
 * `multipleLine`, on purpose, rather than a second implementation of them.
 */
function multipleFor(
  bestSet: LoggedSet | null, bestWeight: number, exerciseId: string,
  unit: Unit, measurements: readonly Measurement[]
): number | null {
  if (!bestSet || CARRIES_BODYWEIGHT.has(exerciseId)) return null;
  const m = bodyweightMultiple(bestWeight, unit, measurements, bestSet.at);
  return m !== null && m >= 1 ? m : null;
}

/**
 * Every DISTINCT session this exercise appears in, oldest last-trained first —
 * unlike `perSessionTop`, no rep cap. `sessionCount` and `lastTrainedAt` are
 * about whether and when a lift was trained, not about e1RM, and e1RM's own
 * cap (`MAX_PR_REPS`) was silently answering "was this ever trained" with the
 * wrong number: a push-up-only lifter logs every set at 12+ reps, so every
 * one of `perSessionTop`'s picks was rep-capped away, `tops` came back
 * empty, and the row vanished from Progress entirely — not a missing best
 * set, the whole exercise gone, with the cap note blaming a truncation that
 * was not the real cause. R327's unusual-user pass found it: three
 * bodyweight movements logged identically, two rows shown and one silently
 * absent.
 */
function sessionsFor(sets: LoggedSet[], exerciseId: string): { count: number; lastAt: number } {
  const seen = new Map<string, number>();
  for (const s of sets) {
    if (s.exerciseId !== exerciseId) continue;
    const prev = seen.get(s.sessionId);
    if (prev === undefined || s.at > prev) seen.set(s.sessionId, s.at);
  }
  let lastAt = 0;
  for (const at of seen.values()) if (at > lastAt) lastAt = at;
  return { count: seen.size, lastAt };
}

/** Top set of each session for one exercise, oldest first. */
function perSessionTop(
  sets: LoggedSet[], exerciseId: string,
  measurements: readonly Measurement[] = [], unit: Unit = 'lb',
  sessionUnits: Map<string, Unit> = new Map()
): LoggedSet[] {
  const best = new Map<string, LoggedSet>();
  // Ranked on real load, because `e1rm(0, reps)` is 0 for every set of strict
  // pull-ups a session contains — so the "top" set was simply the first one,
  // and the sparkline every row is drawn from was plotting whichever set the
  // lifter happened to start with.
  const load = (x: LoggedSet) => loadIn(x, measurements, unit, sessionUnits);
  for (const s of sets) {
    if (s.exerciseId !== exerciseId) continue;
    if (s.reps > MAX_PR_REPS || s.reps < 1) continue;
    const held = best.get(s.sessionId);
    if (!held || e1rm(load(s), s.reps) > e1rm(load(held), held.reps)) best.set(s.sessionId, s);
  }
  return [...best.values()].sort((a, b) => a.at - b.at);
}

/**
 * The goal readout for one row, or null when the lift has no target.
 *
 * Deliberately measured the same way the Goals screen measures it — best weight
 * AT THE GOAL'S REP COUNT — rather than against `row.best`, which is
 * the best at 5+ reps and would report a different gap than the goal card for
 * the very same goal. Two screens disagreeing about how far away a number is
 * would be worse than not showing it here at all.
 */
function goalFor(
  goal: Goal | undefined, history: LoggedSet[], sessionUnits: Map<string, Unit> = new Map(),
  display: Unit = 'lb'
) {
  if (!goal) return null;
  // Deliberately NOT measurement-aware, unlike everywhere else in this file.
  // A goal's target is the number the user typed into the goal sheet, and on a
  // pull-up that number is weight ADDED. Scoring it against real load would
  // mark a "+25 x 5" target as smashed the moment a bodyweight was recorded,
  // because 185 is already seven times 25.
  //
  // `unit` here is the GOAL's own unit, not the row's — `current` has to be
  // measured in the same unit `goal.targetWeight` is, or the subtraction two
  // lines down mixes them. Checked directly and found missing, the same gap
  // `goals.ts`'s own `bestAt` had before this round: neither the unit nor
  // `sessionUnits` was ever passed, so this always compared in lb regardless
  // of what the goal was actually set in.
  const current = bestWeightAtReps(history, goal.exerciseId, goal.targetReps, [], goal.unit, sessionUnits);
  const remaining = Math.max(0, goal.targetWeight - current);
  /*
   * Compared in the goal's unit, SHOWN in the screen's.
   *
   * The subtraction above must happen in one unit or it is meaningless — that
   * is what the note above is about. But the two numbers it produces are then
   * printed by `goalTag` on a row whose every other figure is in the display
   * unit, and they were not converted: a lifter with a 225 lb squat goal who
   * switched to kilograms read "88.5 × 5   30 TO 225   +11.5 kg", three
   * numbers in kilos and a target in pounds, on one line, with nothing saying
   * which was which. Found by switching units on a seeded database and reading
   * the row.
   *
   * `achieved` is decided BEFORE converting, so rounding a converted pair can
   * never turn a hit goal into a near miss or the reverse.
   */
  const to = (w: number) =>
    goal.unit === display ? w : Math.round(convertWeight(w, goal.unit, display) * 2) / 2;
  return {
    targetWeight: to(goal.targetWeight),
    remaining: to(remaining),
    achieved: remaining === 0
  };
}

export function progressRows(repo: Repo, now: number, limit = MAX_ROWS): ProgressRow[] {
  const all = repo.allSets();
  const measurements = repo.measurements();
  if (!all.length) return [];
  const exercises = repo.exercises();
  // NOT `liveSession()?.unit ?? 'lb'`. This screen is usually opened when no
  // session is live, so that expression falls through to pounds and shows a
  // metric user imperial labels — the same bug R24 fixed in NowModel.begin().
  const unit = displayUnit(repo);
  // This screen aggregates EVERY session ever logged, in one row, in one
  // unit — the widest exposure to the cross-unit bug in the whole app. See
  // `loadIn`.
  const sessionUnits = repo.sessionUnits();

  // One goal per exercise is enforced at creation, so a map is the whole story.
  const goals = new Map(repo.goals().map(g => [g.exerciseId, g]));

  /*
   * The cap is deliberate — §5, "a wall of dead lifts is what year two looks
   * like otherwise" — but it must not throw away a lift the user has said in so
   * many words that they care about. A goal IS that statement, and a lift could
   * be ranked off Progress while its goal sat on the Goals screen, so the app
   * tracked a target you could not see it tracking.
   *
   * Ranked lifts still fill the cap and still come first; a goal only buys a
   * seat that recency did not.
   */
  /*
   * Trained inside the window, or carrying a goal. The ranking still decides
   * the ORDER — it is the same score the picker uses, so the two screens agree
   * about what you are training now — it just no longer decides who is on the
   * screen at all.
   */
  const lastAt = new Map<string, number>();
  for (const s of all) {
    const prev = lastAt.get(s.exerciseId);
    if (prev === undefined || s.at > prev) lastAt.set(s.exerciseId, s.at);
  }
  const active = (id: string) =>
    goals.has(id) || now - (lastAt.get(id) ?? 0) <= ACTIVE_WINDOW_MS;

  const scored = rankExercises(all, now);
  /*
   * The staleness cut, and the one case it must NOT make (R487).
   *
   * §8's mature clause wants old lifts to fall OFF this screen rather than into
   * a scroll — "a wall of dead lifts is what year two looks like otherwise" —
   * and that is about a lifter with many lifts, some of them abandoned. It says
   * nothing about a lifter with NO active lifts, and applied to one it produced
   * a real lie: a nine-week layoff with no goals set emptied `ranked`, so
   * `progress.tsx` took its `rows.length === 0` branch and told somebody
   * holding 28 sessions and 84 sets **"Log a few sessions and this fills in."**
   * Their whole history went with it, because RECENT WORKOUTS renders in the
   * populated branch only.
   *
   * That is the returning lifter — the person the product most wants back —
   * being shown a first-run screen and told their training does not exist.
   *
   * So the cut only applies while it has something to protect. With nothing
   * active there is nothing being crowded out, and the honest answer to "where
   * am I" is the lifts they actually have. Deliberately narrow: when ANY lift
   * is active this line changes nothing at all, so the mature-account behaviour
   * §8 asks for is untouched.
   */
  const live = scored.filter(r => active(r.exerciseId));
  const ranked = live.length > 0 ? live : scored;
  const kept = ranked.slice(0, limit);
  const keptIds = new Set(kept.map(r => r.exerciseId));
  const spared = scored.filter(r => !keptIds.has(r.exerciseId) && goals.has(r.exerciseId));

  /*
   * Bucketed once, for the same reason `rankGoals` is — every read below is
   * scoped to one exercise, and this screen builds a row per lift. `spared`
   * grows with the GOAL count, so raising the cap to a hundred turned three
   * full scans per row into thirty rows x three scans of a whole training
   * history. See goals.ts: the same shape measured 48ms per render.
   */
  const byExercise = new Map<string, LoggedSet[]>();
  for (const s of all) {
    const bucket = byExercise.get(s.exerciseId);
    if (bucket) bucket.push(s);
    else byExercise.set(s.exerciseId, [s]);
  }

  return [...kept, ...spared]
    .map(ranked => {
      const mine = byExercise.get(ranked.exerciseId) ?? [];
      const trained = sessionsFor(mine, ranked.exerciseId);
      const tops = perSessionTop(mine, ranked.exerciseId, measurements, unit, sessionUnits);
      const window = tops.slice(-SPARK_POINTS);
      // Real load, or a strict-pull-up sparkline is a flat line at zero for
      // ever: e1rm(0, reps) is 0 however many reps you do.
      const values = window.map(s => e1rm(loadIn(s, measurements, unit, sessionUnits), s.reps));

      // Normalise within the window so a 200 lb bench and a 500 lb deadlift are
      // both legible at the same tiny size. An absolute scale would flatten
      // every light lift into a straight line.
      const lo = Math.min(...values, Infinity);
      const hi = Math.max(...values, -Infinity);
      const span = hi - lo;
      const spark = values.length
        ? values.map(v => (span === 0 ? 0.5 : (v - lo) / span))
        : [];

      // The real set, not a weight paired with the threshold rep count —
      // that produced "105 x 5" for a set that was actually 105 x 8.
      const bestSet = bestSetAtReps(mine, ranked.exerciseId, 5, measurements, unit, sessionUnits);
      // `bestSet.weight` is in ITS OWN session's unit, which need not be this
      // row's — the row shows one unit for everything in it, so the number
      // that reaches the display has to be converted the same way `loadIn`
      // converts it for comparison, or a kg best set displays under an lb
      // label with no conversion at all.
      const bestFrom = bestSet ? (sessionUnits.get(bestSet.sessionId) ?? unit) : unit;
      const bestWeight = bestSet
        ? (bestFrom === unit ? bestSet.weight : convertWeight(bestSet.weight, bestFrom, unit))
        : 0;

      return {
        exerciseId: ranked.exerciseId,
        name: exercises.get(ranked.exerciseId)?.name ?? ranked.exerciseId,
        best: bestWeight,
        bestReps: bestSet?.reps ?? 0,
        bestAt: bestSet?.at ?? null,
        // A pull-up's real load, when there is a bodyweight to add. Uses the
        // reading that applied on the day of THAT set, not today's.
        realBest: bestSet ? (realLoad({ ...bestSet, weight: bestWeight }, measurements, unit)?.load ?? null) : null,
        // The reading in force on the day of THAT set — see `bestAt`'s own
        // note on why "today's" bodyweight would be the wrong operand for a
        // set logged months ago.
        bestMultiple: multipleFor(bestSet, bestWeight, ranked.exerciseId, unit, measurements),
        unit,
        spark,
        trend: trendAcross(window, measurements, unit, sessionUnits),
        // Same eligibility as `trendAcross` itself — see `trendSince`'s own
        // comment for why this is not derived from `trend == null` alone,
        // which would be circular, but from the exact two conditions
        // `trendAcross` gates on.
        trendSince: window.length >= 2 && window[0].reps === window[window.length - 1].reps
          ? window[0].at : null,
        goal: goalFor(goals.get(ranked.exerciseId), mine, sessionUnits, unit),
        lastTrainedAt: trained.lastAt,
        sessionCount: trained.count
      };
    })
    // A lift with no scoring sets has nothing to show; dropping it here keeps
    // the cap meaningful rather than spending a row on an empty sparkline.
    .filter(r => r.sessionCount > 0);
}

/**
 * How many trained lifts the cap is holding back, so the screen can say so.
 *
 * §5 wants old lifts to fall off rather than into a scroll, and that is right —
 * but falling off SILENTLY is a different claim: the screen reads as the
 * complete list of what you train, and for anyone past eight movements it is
 * not. Saying the number costs one line and turns a truncation into a fact.
 */
export function hiddenRowCount(
  repo: Repo, now: number, limit = MAX_ROWS, rows?: ProgressRow[]
): number {
  const all = repo.allSets();
  if (!all.length) return 0;
  // The screen has already built the rows; recomputing them here made Progress
  // do the whole thing twice per render. Cheap now that the underlying read is
  // memoised, but two full passes where one will do.
  const shown = new Set((rows ?? progressRows(repo, now, limit)).map(r => r.exerciseId));

  /*
   * Only lifts the cap is holding back — not ones that have been retired.
   *
   * Counting every trained lift meant a movement abandoned a year ago was
   * advertised as "not shown", and §5 wants those to fall OFF rather than be
   * announced: a year-two lifter would be told about forty movements they had
   * deliberately stopped doing. The line explains the CAP, so it counts what
   * the cap costs.
   */
  const lastAt = new Map<string, number>();
  for (const s of all) {
    const prev = lastAt.get(s.exerciseId);
    if (prev === undefined || s.at > prev) lastAt.set(s.exerciseId, s.at);
  }
  let n = 0;
  for (const [id, at] of lastAt) {
    if (!shown.has(id) && now - at <= ACTIVE_WINDOW_MS) n++;
  }
  return n;
}

/** One past workout, as the history list shows it. */
export interface SessionSummary {
  id: string;
  startedAt: number;
  /** When the last set landed — what the list is ordered by. */
  lastAt: number;
  /** "PUSH DAY", or "WORKOUT" when the day cannot be named. */
  title: string;
  setCount: number;
  volume: number;
  /**
   * Whether `volume` is a total or a floor — see `SessionStats.volumeKnown`.
   * False for bodyweight work with no reading behind it, where the sum is 0
   * because the weight ADDED was 0. This list printed "1 set · 0 lb" under a
   * row that had just correctly said "BW × 12", which is the same false zero
   * R188 took off the recap card, on a surface that round did not reach.
   */
  volumeKnown: boolean;
  unit: Unit;
  /** Each lift and its top set, in the order they were trained. */
  lifts: Array<{ name: string; best: string }>;
}

/**
 * The last few workouts, newest first, with what was actually done in each.
 *
 * Progress answered "how is this lift going" — a row per movement, a sparkline,
 * a trend. It could not answer "what did I do on Tuesday", which is the
 * question you ask standing in the gym trying to remember whether you have
 * already pressed this week, and the only place the answer existed was inside
 * one recap you could no longer reach.
 *
 * Deliberately a SUMMARY per day rather than every set: the full detail of a
 * past session is what the recap is for, and reprinting forty sets here would
 * bury the trend rows this screen is built around. Each entry names the lifts
 * and their top set, which is what people actually compare week to week.
 */
export function recentSessions(repo: Repo, limit = 8): SessionSummary[] {
  const exercises = repo.exercises();
  const measurements = repo.measurements();
  const lang = languageOf(repo);
  const plan = planOf(repo);
  /*
   * R454: the identical bug `display-unit.ts`'s own header comment describes
   * fixing once already — Progress falling through to the last-used unit
   * instead of the Settings choice, while the Settings screen promises
   * "weights already logged... are converted for display" — recurring here
   * because `recentSessions` never called `displayUnit` at all. `progressRows`
   * right above this function gets it right and is tested for it; this
   * sibling function, built later, quietly never got the same fix. A kg
   * lifter who switched from pounds saw the per-lift trend rows correctly in
   * kg and the "Recent Workouts" list two inches below still in lb,
   * unlabeled-looking because both screens use the same bare "N × N" format.
   */
  const unit = displayUnit(repo);
  const byId = new Map<string, LoggedSet[]>();
  for (const set of repo.allSets()) {
    const held = byId.get(set.sessionId);
    if (held) held.push(set);
    else byId.set(set.sessionId, [set]);
  }

  /*
   * Decide WHICH sessions survive before building any of them.
   *
   * This used to summarise every session in the database and then `.slice(0, 8)`
   * — so a year of training built 700 summaries, each grouping its sets by
   * lift, ranking them, naming the day and totalling the volume, to throw 692 of
   * them away. Measured at 14,000 sets across 700 sessions: **9.7ms per call**,
   * the slowest thing on this screen by three times, and it is called on every
   * render.
   *
   * `lastAt` is the only field the ORDER depends on, and it is one pass over
   * the sets. Everything expensive now happens to eight sessions instead of
   * seven hundred.
   */
  const ordered = [...byId.entries()]
    .map(([id, sets]) => ({ id, sets, lastAt: sets.reduce((n, x) => Math.max(n, x.at), 0) }))
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, limit);

  const out: SessionSummary[] = [];
  for (const { id, sets, lastAt } of ordered) {
    const session = repo.session(id);
    // A session row with no session behind it would be a workout with no date.
    if (!session || sets.length === 0) continue;

    /*
     * Top set per lift, in the order the lifts were first touched.
     *
     * Ordered by when the lift STARTED rather than by weight: the list is a
     * record of the session, and a session has an order. Sorting by load would
     * turn "squat, then leg press, then calves" into a leaderboard.
     */
    const order: string[] = [];
    for (const set of sets) if (!order.includes(set.exerciseId)) order.push(set.exerciseId);
    /*
     * `topSetPerExercise`, not a copy of it.
     *
     * This had its own ranking loop, and the recap had another — so one
     * workout got two different "top set" answers: bench 200 x 5 then 185 x 10
     * read "200 x 5" on the recap card and "185 x 10" here. Same fix as the
     * session TITLE in R135: one definition, so the disagreement cannot be
     * expressed.
     */
    const best = topSetPerExercise(sets, measurements, session.unit);
    const stats = sessionStats(session, sets, measurements);
    // `sessionStats` and `topSetPerExercise` both answer in the SESSION's own
    // unit — correct for them, since they exist to agree with the recap card
    // for THAT session, which is always shown in its own unit. This list
    // shows many sessions in one column, so the number that reaches the
    // display has to be converted the same way `progressRows`' `bestWeight`
    // already is, or a kg preference shows an old lb session's numbers as if
    // they were kg.
    const volume = session.unit === unit ? stats.volume : convertWeight(stats.volume, session.unit, unit);

    out.push({
      id,
      startedAt: session.startedAt,
      // When the work actually happened. `startedAt` is the session's own
      // clock and is the right thing to SHOW, but it is not reliable to sort
      // on: a restored backup, or any fixture built with a fixed clock, gives
      // several sessions the same start and the order falls back to whatever
      // the map happened to iterate. The last set in a session is always
      // distinct and is what "most recent workout" actually means.
      lastAt,
      // The same function the recap titles itself with — one definition, so
      // the history and the recap can never disagree about a session's name.
      title: sessionTitle(sets, lang, plan),
      setCount: sets.length,
      /*
       * `sessionStats`, not a second reduce.
       *
       * This line was its own hand-rolled copy of the recap's volume sum, and
       * the moment the recap learned to count a pull-up it stopped agreeing
       * with it: the running app showed a finished session as "2,960 LB" on the
       * recap and the SAME session as "0 lb" two screens later. R135 removed a
       * duplicated session TITLE for exactly this reason; this is the same
       * mistake in a number, which is worse, because two names read as a wording
       * choice and two totals read as one of them being wrong.
       */
      volume: Math.round(volume),
      // Same source as the number itself, so this row and the recap card can
      // never disagree about whether the total is knowable — which is the
      // whole reason `sessionStats` is shared rather than re-implemented here.
      volumeKnown: stats.volumeKnown,
      unit,
      lifts: order.map(exId => {
        const top = best.get(exId)!;
        const topWeight = session.unit === unit ? top.weight : convertWeight(top.weight, session.unit, unit);
        return {
          name: exercises.get(exId)?.name ?? exId,
          best: `${loadLabel(topWeight)} × ${top.reps}`
        };
      })
    });
  }

  /*
   * Already ordered and already capped above. Kept as a re-sort rather than
   * dropped, because `continue` above can remove an entry and a caller reading
   * this line should not have to prove the order survived that.
   */
  return out.sort((a, b) => b.lastAt - a.lastAt);
}

/**
 * §10's rest-day comparison, as one sentence and its own claim.
 *
 * §10 asks for "one auto-surfaced comparison per week: *your squat is up 15 lb
 * since four weeks ago* — generated, not requested", and §5 names the same
 * artifact when it says a goal must feed "the recap AND the weekly card".
 * Nothing had built it: the app opened mid-workout and said nothing between
 * workouts, which §10 says leaves it with no habit hook at all.
 *
 * It lives at the top of Progress rather than on a fifth screen — §5 caps the
 * app at four and §9 bans a settings screen, and Progress is already the
 * surface a lifter opens on a rest day. Returns null when there is nothing
 * true to say, which is most weeks for most lifts, and saying nothing is the
 * whole point: §8's cry-wolf rule applies to every claim this app makes.
 */
export function weeklyLine(repo: Repo, now: number): string | null {
  const unit = displayUnit(repo);
  const c = weeklyComparison(
    repo.allSets(), repo.exercises(), now, unit,
    repo.measurements(), repo.sessionUnits()
  );
  if (!c) return null;
  const lang = languageOf(repo);
  const weeks = Math.max(1, Math.round(c.days / 7));
  return fill(t(lang, weeks === 1 ? 'weeklyUpOneWeek' : 'weeklyUp'), {
    lift: c.lift, gain: loadLabel(c.gain), unit, weeks
  });
}

/** The comparison itself, for anything that needs the numbers rather than the sentence. */
export function weeklyProgress(repo: Repo, now: number): WeeklyComparison | null {
  return weeklyComparison(
    repo.allSets(), repo.exercises(), now, displayUnit(repo),
    repo.measurements(), repo.sessionUnits()
  );
}

/**
 * §10's "already formatted as a postable card" — the half of the promise
 * nothing ever kept.
 *
 * `weeklyCard` (the renderer's payload) and the wire format both already
 * handle `kind: 'weekly'`, and have since R228/R271: the shared-card JS draws
 * it, `share-url.ts` packs it, the landing page decodes it. What was missing
 * was a caller — Progress showed the claim as a plain `<Text>` with nothing
 * under it, so the "card" a rest-day lifter's best lift produces was
 * unreachable from the running app. Not a rendering gap; a wiring one.
 *
 * Reuses `weeklyLine`'s own sentence as the claim, rather than composing a
 * second one, so the banner on screen and the message that goes out can never
 * disagree about what it says — the same discipline `shareText` follows for
 * the session recap.
 *
 * `firstSession: false` on the packed payload: `weeklyCard` never sets it
 * (there is no session behind a weekly card to be first OR not), and
 * `RecapPayload` requires it. `pack()` already drops a `false` value as the
 * assumed default, so this costs nothing on the wire — it exists only to
 * satisfy the type the packer was built for.
 */
export function shareWeeklyText(repo: Repo, now: number): string | null {
  const c = weeklyProgress(repo, now);
  if (!c) return null;
  const line = weeklyLine(repo, now);
  if (!line) return null;
  const lang = languageOf(repo);
  const unit = displayUnit(repo);
  const card = weeklyCard(c, unit, 'PROOF', lang) as unknown as RecapPayload;
  return `${line}. ${card.watermark} ${shareUrl({ ...card, firstSession: false })}`;
}

/**
 * The goal tag on a Progress row, in words that are true.
 *
 * Three states, and only one of them was being said properly:
 *
 * - **Nothing on the board yet.** `remaining` IS the target, so the row printed
 *   "108 TO 108" — measured on the running app against a lift trained only
 *   below its goal's rep count. A gap is a distance FROM somewhere and there is
 *   no somewhere yet, so it names the target instead. Same rule, same reason as
 *   `goalTail` on the Now screen; the two screens now agree.
 * - **Underway.** "40 TO 185" — the distance and the destination, unchanged.
 * - **Hit.** It said "GOAL", which is a label rather than an achievement: the
 *   row next to it says "97 TO 222" and this one said the word "goal". A tick
 *   and the number says what happened and which target it was.
 */
export function goalTag(
  goal: { targetWeight: number; remaining: number; achieved: boolean },
  lang: Language = 'en'
): string {
  if (goal.achieved) return `✓ ${goal.targetWeight}`;
  const gap = Math.round(goal.remaining);
  if (gap >= goal.targetWeight) return `${t(lang, 'goalTagWord')} ${goal.targetWeight}`;
  return `${gap} ${t(lang, 'toWord')} ${goal.targetWeight}`;
}

/**
 * The row's own accessibility label — the number, said the way a person
 * would, plus WHEN it happened.
 *
 * §16's "every number checkable" test: `bestSetAtReps` always carried the
 * date of the set it names, and nothing between the domain and the screen
 * ever asked for it, so a screen-reader user heard "225 by 5" with no more
 * context than a sighted user gets from the bare number — neither could
 * check it against anything. Kept off the visible row rather than added to
 * it: the row is already at capacity (see `bestAt`'s own note), and §16 asks
 * for checkable, not necessarily visible.
 */
/** Same idea as `bestSetA11y`, for the trend column: a delta plus WHEN it started. */
export function trendA11y(row: ProgressRow, lang: Language = 'en'): string | null {
  if (row.trend == null || row.trendSince == null) return null;
  const value = row.trend === 0
    ? fill(t(lang, 'trendFlatA11y'), { name: row.name, unit: row.unit })
    : fill(t(lang, 'trendChangeA11y'), {
        name: row.name, sign: row.trend > 0 ? '+' : '', trend: row.trend, unit: row.unit
      });
  const d = new Date(row.trendSince);
  const when = `${MONTHS_TREND[lang][d.getMonth()]} ${d.getDate()}`;
  return `${value} ${fill(t(lang, 'trendSinceA11y'), { when })}`;
}

/**
 * The row's own name, said with WHEN it was last trained — any set, any rep
 * range, unlike `bestAt`'s narrower "best at 5+ reps" scope. The two can
 * genuinely disagree (a heavy triple logged since the last 5-rep best would
 * move this date without moving that one), which is exactly why this is its
 * own label on its own element (the row's name) rather than folded into
 * `bestSetA11y`'s — two facts on one label reads as one confused fact.
 *
 * `lastTrainedAt` is computed in every row already — `rankExercises`'s own
 * decayed-frequency score already factors recency in, which is a real reason
 * `lastTrainedAt` looked used before this: something upstream reads dates
 * like it, just not this specific field, on this specific object. Nothing
 * ever read this ONE back before now.
 */
/**
 * `sessionCount` — how many DISTINCT sessions this lift has ever seen — has
 * been on this row since `progressRows` was written, filtering out anything
 * untrained. Nothing ever said it. Folded in here rather than a slot of its
 * own: the row is already at capacity (§4's own crowding history), and
 * "how often" belongs next to "how recently" as one fact about a habit
 * rather than a second number competing with `best`.
 */
export function lastTrainedA11y(row: ProgressRow, lang: Language = 'en'): string {
  if (!row.lastTrainedAt) return row.name;
  const d = new Date(row.lastTrainedAt);
  const when = `${MONTHS_TREND[lang][d.getMonth()]} ${d.getDate()}`;
  const key = row.sessionCount === 1 ? 'trainedOnceA11y' : 'trainedCountA11y';
  return `${row.name}, ${fill(t(lang, key), { n: row.sessionCount, when })}`;
}

export function bestSetA11y(row: ProgressRow, lang: Language = 'en'): string {
  const value = row.best > 0
    ? fill(t(lang, 'bestSetValueA11y'), { name: row.name, weight: row.best, unit: row.unit, reps: row.bestReps })
    : fill(t(lang, 'bestSetNoneA11y'), { name: row.name });
  if (!row.bestAt) return value;
  const d = new Date(row.bestAt);
  const when = `${MONTHS_TREND[lang][d.getMonth()]} ${d.getDate()}`;
  return `${value} ${fill(t(lang, 'bestSetOnA11y'), { when })}`;
}

/**
 * What "erase everything" is actually about to erase.
 *
 * Found by walking the confirmation on the running app with a stress database
 * loaded: it read "700 workouts, 14,000 sets and 100 goals will be deleted",
 * and `eraseAll` also drops every measurement and every measurement target. A
 * destructive confirmation that under-reports what it destroys is worse than
 * one that says nothing, because the user has read it and believes they know.
 *
 * Built as a list rather than a fixed sentence so a kind with nothing in it is
 * absent rather than a "0 measurements" that reads as filler — and so the next
 * table added here fails loudly as a missing clause instead of silently as an
 * undercount.
 */
export function erasureCounts(repo: Repo): Array<[number, string, string]> {
  const sets = repo.allSets();
  const measurements = repo.measurements().length + repo.measureGoals().length;
  /*
   * i18n KEYS, not words (R480). These were English literals and reached the
   * user through `erasureLine` untranslated, so the most destructive dialog in
   * the app read "Se eliminará 700 workouts, 14,000 sets and 3 measurements"
   * to a Spanish lifter. Returning keys rather than the resolved strings keeps
   * this function pure and language-free — the callers already have `lang`.
   */
  return ([
    [new Set(sets.map(x => x.sessionId)).size, 'eraseWorkoutOne', 'eraseWorkouts'],
    [sets.length, 'setOne', 'sets'],
    [repo.goals().length, 'eraseGoalOne', 'eraseGoals'],
    [measurements, 'eraseMeasurementOne', 'eraseMeasurements'],
    /*
     * R446: the identical defect this function's own header comment describes
     * fixing once, for measurements — recurring, for two more things `eraseAll`
     * genuinely drops that this line never named. Custom exercises do not come
     * back the way `eraseAll` puts the starting twelve straight back (only a
     * BUILTIN one survives); settings — language, units, split, jump amounts,
     * skip-machine — get the exact "theirs too" treatment `allPrefs`'s own
     * comment already gives them, and `eraseAll` deletes every `pref.%` row
     * with no exception. Both were verified live: a custom exercise and a
     * changed jump amount, erased for real, silently, with neither ever named
     * in the sentence the user read and agreed to.
     */
    [repo.customExerciseCount(), 'eraseCustomExerciseOne', 'eraseCustomExercises'],
    [Object.keys(repo.allPrefs()).length, 'eraseSettingOne', 'eraseSettings']
  ] as Array<[number, string, string]>).filter(([n]) => n > 0);
}

/**
 * Whether `erasureLine` is naming exactly ONE thing.
 *
 * Only Spanish needs this, and only for the verb: "Se eliminara 1 meta" against
 * "Se eliminaran 36 entrenamientos, 288 series y 1 ajuste". English does not
 * inflect there, so `eraseBody` and `eraseBodyOne` are the same sentence in the
 * EN table and `test/erase-language.test.ts` asserts they stay identical rather
 * than trusting nobody edits one of them.
 *
 * Here rather than in the screen so it cannot drift from `erasureLine`'s own
 * notion of "one item" — both read `erasureCounts`, which is the single place
 * that decides what counts as a category at all.
 */
export function erasureIsSingle(repo: Repo): boolean {
  const parts = erasureCounts(repo);
  return parts.length === 1 && parts[0][0] === 1;
}

/**
 * "700 workouts, 14,000 sets, 100 goals and 3 measurements", in the lifter's
 * own language — "700 entrenamientos, 14.000 series, 100 metas y 3 mediciones".
 *
 * Every word of this was an English literal until R480, including the joining
 * "and" and the "Nothing" fallback, so the sentence a Spanish user has to read
 * and agree to before destroying everything they have logged came out half
 * translated. §11 makes the export file the only backup and there is no server,
 * so this is the one dialog in the app where misreading is unrecoverable.
 *
 * The language defaults to English rather than being required, because the
 * pure-model tests call this with a bare repo and the English output is the
 * one they were written against — the caller that matters (`progress.tsx`)
 * passes the real one.
 */
export function erasureLine(repo: Repo, lang: Language = 'en'): string {
  const parts = erasureCounts(repo)
    .map(([n, oneKey, manyKey]) =>
      `${number(n, lang)} ${t(lang, (n === 1 ? oneKey : manyKey) as Parameters<typeof t>[1])}`);
  if (parts.length === 0) return t(lang, 'nothingWord');
  if (parts.length === 1) return parts[0];
  // "a, b and c" / "a, b y c" — no serial comma in either language.
  return `${parts.slice(0, -1).join(', ')} ${t(lang, 'andWord')} ${parts[parts.length - 1]}`;
}

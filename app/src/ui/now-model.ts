import type { LoggedSet, Session, Exercise, Unit, Equipment } from '../domain/types.ts';
import { Repo } from '../data/repo.ts';
import { prefillFor, pickerFor, unitForNewSession, EQUIPMENT_BASE, type Prefill } from '../domain/coldstart.ts';
import { railPool, railOrder } from './rail-order.ts';
import { nextCandidates, openingLift } from '../domain/predict.ts';
import { autoEnd, isStale, lastSetAt, sessionStats, justFinished } from '../domain/session.ts';
import { findPRs } from '../domain/pr.ts';
import type { Measurement } from '../domain/measure.ts';
import { restSince, type RestState } from '../domain/rest.ts';
import { PREF_UNIT } from './display-unit.ts';
import { weekStreak } from '../domain/session.ts';
import {
  sessionDay, sessionPlanDay, groupBySplit, companionFor, dayOf, inPlanDay, planOf,
  PLAN_DAYS, PLAN_DAY_COVERS,
  type SplitDay, type SplitGroup, type SplitPlan, type PlanDay
} from '../domain/split.ts';
import { coachSuggestion, callMade, type Suggestion } from '../domain/coach.ts';
import { findExercises, exactExercise } from '../domain/find-exercise.ts';
import { trainingGoal } from './training-goal.ts';
import { PHONE_MAX } from './column.ts';
import { loadLabel, convertWeight } from '../domain/types.ts';
import { goalProgress, isAchieved } from '../domain/goals.ts';
import { recommendNext } from '../domain/muscles.ts';
import { t, fill, languageOf, type Language } from '../domain/i18n.ts';
import { PLATE, REP_JUMP, WEIGHT_STEP, customJump, customRepJump } from './now-steppers.ts';
import { RAIL_MAX } from './now-layout.ts';
import { type GoalHint, lastTimeParts } from './now-line.ts';
import type { NowState, RailLift, SessionLift } from './now-state.ts';


/**
 * The Now screen, as a pure state machine. PROMPT.md §5 screen 1.
 *
 * All the logic, none of React: the component that renders this is a thin
 * binding, and every rule with teeth — tap counts, prefills, what happens on
 * launch — is asserted in tests that run on any machine without a simulator.
 *
 * The tap budget this exists to protect (§4):
 *   repeat last set        1 tap   -> log()
 *   change weight, log     3 taps  -> bumpWeight() x2 + log()
 *   next exercise          swipe   -> next()
 *   pick from the list     1 tap   -> selectExercise()
 */


/** Gap above the chips, and the height of the day label when there is room for it. */
/**
 * "Do not ask which machine again."
 *
 * Someone who trains at one gym answers "which machine" with the same word
 * every time, and the second step of the equipment sheet becomes a tap they
 * pay on every machine set for information the app already has. With this set,
 * choosing MACHINE records the kit and closes, exactly like barbell and
 * dumbbell do.
 *
 * A preference rather than a guess: the app cannot tell "always the same
 * machine" from "has not varied it yet" without waiting months, and §4's rule
 * is that it must not ASK what it can answer — not that it must guess at what
 * it cannot.
 */
export const PREF_SKIP_MACHINE = 'pref.skipMachineName';

/**
 * Split the picker into the day you are training and everything else.
 *
 * §7 makes exercise selection a prediction problem, and the strongest predictor
 * is the DAY: on push day a leg movement is not a near-miss, it is noise — rows
 * to scroll past to reach the handful that could plausibly be next. So the
 * sheet opens on the day and the other days sit behind one deliberate tap.
 *
 * Two rules keep that from becoming a cage:
 *
 *   - **Movements the user invented are never hidden.** They have no day
 *     (`group.day === null`, the YOURS group), and inventing one is already
 *     going out of your way; burying it afterwards would be the R32 trap —
 *     telling someone their movement exists and then never showing it again.
 *   - **When the day is not knowable, nothing is hidden.** Before anything is
 *     logged `sessionDay` can return null, and narrowing to an arbitrary third
 *     of the library would be worse than not narrowing at all.
 */
export function splitPickerGroups(
  groups: SplitGroup[], day: PlanDay | null
): { thisDay: SplitGroup[]; others: SplitGroup[] } {
  // A plan-day can cover more than one PPL group: "upper" is push AND pull,
  // and "full body" is everything — which is how a non-PPL split narrows
  // correctly without a second set of groupings.
  const covers = day ? PLAN_DAY_COVERS[day] : [];
  const thisDay = groups.filter(g => g.day === null || (g.day && covers.includes(g.day)));
  // Only the day-less YOURS group matched, so there is no day to narrow to.
  if (!thisDay.some(g => g.day !== null)) return { thisDay: groups, others: [] };
  return { thisDay, others: groups.filter(g => !thisDay.includes(g)) };
}

let counter = 0;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`;

/** Readable, stable ids for user-created exercises — "Hack Squat" -> "hack_squat". */
function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return base || `ex_${Date.now().toString(36)}`;
}

/**
 * A free slug.
 *
 * Necessary because slugification is lossy: "Caf Row" and "Café Row" both
 * reduce to `caf_row` (since R683 ADD picks "Hack Squat" for "Hack-Squat"
 * instead of creating it). Without this, the second one would collide and
 * `addExercise`'s upsert would silently RENAME the first — quietly merging two
 * different movements' history into one.
 */
function freeSlug(taken: Set<string>, name: string): string {
  const base = slugify(name);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${Date.now().toString(36)}`;
}

export class NowModel {
  repo: Repo;
  now: () => number;
  private locale: string | null;
  private session: Session;
  private exerciseId: string;
  /**
   * Lifts this session has been ON, logged or not — the exclusion behind UP
   * NEXT. Not persisted and not part of `trained`: it shapes the suggestion
   * only, never the day inference or anything written down.
   */
  private visited = new Set<string>();
  /**
   * What the current lift is being done on. Carried over from the last set of
   * this exercise the same way weight and reps are: the equipment almost never
   * changes between sessions, so asking again every time would be the app
   * asking a question it could answer (§4).
   */
  private equipment: Equipment | null = null;
  private machine: string | null = null;
  private weight = 0;
  private reps = 0;
  private source: Prefill['source'] = 'seed';
  /**
   * Last time's weight for the lift on screen, as `prefillFor` gave it. Since
   * R692 the hero may open on the coach's call instead (D8); this stays last
   * time's, and the grid and jump rules key off it.
   */
  private startWeight = 0;
  /**
   * Whether last time's weight was a CONVERSION: the set it came from was
   * logged in the other unit (R669). Set only by `loadPrefill`; `bumpPlate` and
   * the coach call read it.
   */
  private startConverted = false;

  constructor(repo: Repo, now: () => number = Date.now, locale?: string | null) {
    this.repo = repo;
    this.now = now;
    this.locale = locale ?? null;

    // §4: cold launch goes to the active workout if one is running, never a
    // home screen. A session left open from days ago is closed first, backdated
    // to its last set — otherwise the user resumes a workout they finished on
    // Tuesday.
    const live = repo.liveSession();
    if (live) {
      const sets = repo.setsInSession(live.id);
      if (isStale(live, sets, now())) {
        const closed = autoEnd(live, sets, now());
        repo.endSession(closed.id, closed.endedAt!);
        this.session = this.begin();
      } else {
        this.session = live;
      }
    } else {
      this.session = this.begin();
    }

    this.exerciseId = this.openingExercise();
    this.visited.add(this.exerciseId);
    this.loadPrefill();
  }

  /**
   * Start a session in the right unit.
   *
   * This used to read `liveSession()?.unit ?? 'lb'` — which is called precisely
   * when there is NO live session, so it always fell through to pounds. Every
   * metric user silently got imperial sessions, and §8's "infer from locale" was
   * never actually wired up.
   */
  private begin(): Session {
    const unit = unitForNewSession(
      this.repo.lastUsedUnit(),
      this.locale,
      (this.repo.getPref(PREF_UNIT) as Unit | null) ?? null
    );
    return this.repo.startSession(newId('s'), unit);
  }

  /**
   * What to open on. The predicted session's first lift if there is history
   * (§7), otherwise the head of the starting twelve (§6). Anything already
   * logged this session is skipped, so relaunching mid-workout resumes rather
   * than restarting.
   */
  private openingExercise(): string {
    const done = this.repo.setsInSession(this.session.id).map(s => s.exerciseId);
    if (done.length) return done[done.length - 1];

    const history = this.repo.allSets();
    return openingLift(history, this.now(), new Date(this.now()).getDay())
      ?? pickerFor(history, this.now(), undefined, 12, [...this.repo.exercises().values()])[0].id;
  }

  /**
   * History with every weight expressed in THIS session's unit.
   *
   * A `LoggedSet` carries no unit — the session owns it — so any function that
   * reads `set.weight` against a different session's unit is off by 2.2.
   * Nothing hit that while the unit could never change; the moment the Settings
   * control started working, it did: a lifter with 195 lb squats who switched
   * to kilos was offered **195 kg** as their next set. That is 430 lb, prefilled
   * as "same as last time" (§4).
   *
   * Converted for READING only. Nothing is written back — a 195 lb set stays
   * 195 lb in the database for ever (schema.ts), and rounding to the half unit
   * is what `convertWeight` is for.
   */
  /**
   * Which sets in this workout are personal records, cached on the history it
   * was computed from.
   *
   * `state()` runs on every tap and `findPRs` walks the whole history for each
   * set in the session. Measured at 14,000 sets it took `state()` from 3.98 ms
   * — the number R495 worked to get — back up to 5.99, which is a regression
   * on the one path §4 budgets in taps and milliseconds.
   *
   * Keyed on `allSets()`'s array IDENTITY, sound for the reason R495 and R509
   * both rely on: `Repo.allSets` hands back a frozen array and drops its memo
   * on every write, so a new object appears exactly when the answer could have
   * changed. Logging, editing and deleting a set all write, so all three
   * invalidate this.
   *
   * AND ON `measurements()`, which R539 found missing. The comment here used to
   * end "nothing else can", and that was wrong: `findPRs` is handed the
   * measurement list too, because the four bodyweight-carrying lifts are judged
   * on real load. Stepping on the scale changes what a pull-up weighed without
   * touching a single set.
   *
   * Measured, on a 25x5 history and a 30x5 today: log the set at an assumed
   * bodyweight and it is marked a PR; then record today's actual weight, twenty
   * pounds down, and `findPRs` correctly retracts it (225 lifted against 240 to
   * beat) — while the cached screen kept the star. The app went on claiming a
   * record it had already decided was not one, which is §8's cry-wolf produced
   * by an optimisation rather than by a rule.
   *
   * The same identity trick works: `measurements()` is a frozen memo dropped on
   * every write, so it is a key on exactly the same terms.
   */
  private prCacheKey: LoggedSet[] | null = null;
  private prMeasureKey: readonly Measurement[] | null = null;
  private prCacheValue: string[] = [];

  private prSetIds(sessionSets: LoggedSet[], exercises: Map<string, Exercise>): string[] {
    if (!this.session.id || sessionSets.length === 0) return [];
    const all = this.repo.allSets();
    const measurements = this.repo.measurements();
    if (all === this.prCacheKey && measurements === this.prMeasureKey) return this.prCacheValue;
    this.prCacheValue = findPRs(
      sessionSets, this.repo.historyBefore(this.session.id), exercises,
      this.session.unit, measurements, this.repo.sessionUnits()
    ).map(r => r.setId);
    this.prCacheKey = all;
    this.prMeasureKey = measurements;
    return this.prCacheValue;
  }

  /**
   * The history for one exercise, from an index built once per history.
   *
   * Keyed on `allSets()`'s array identity, sound for the reason R495, R509 and
   * R522 all rely on: `Repo.allSets` hands back a frozen array and drops its
   * memo on every write, so a new object appears exactly when the contents
   * could have changed.
   *
   * One pass to bucket, then every lookup is free — the same move R494 made
   * for `activeGoals`, which had the identical shape: a function scoped to one
   * exercise being handed the whole log.
   */
  private byExerciseKey: LoggedSet[] | null = null;
  private byExercise = new Map<string, LoggedSet[]>();

  private setsFor(exerciseId: string): LoggedSet[] {
    const all = this.repo.allSets();
    if (all !== this.byExerciseKey) {
      const built = new Map<string, LoggedSet[]>();
      for (const s of all) {
        const bucket = built.get(s.exerciseId);
        if (bucket) bucket.push(s);
        else built.set(s.exerciseId, [s]);
      }
      this.byExercise = built;
      this.byExerciseKey = all;
    }
    return this.byExercise.get(exerciseId) ?? [];
  }

  /*
   * Keyed on all three inputs by identity (R665): `allSets()` and
   * `sessionUnits()` are both memos dropped on the writes that could change
   * them, and the session's unit is a string. `state()` reads this twice per
   * tap, and each read walked the whole history just to learn that nothing
   * needed converting.
   */
  private unitHistoryKey: [LoggedSet[], Map<string, Unit>, Unit] | null = null;
  private unitHistory: LoggedSet[] = [];

  private historyInSessionUnit(): LoggedSet[] {
    const all = this.repo.allSets();
    const units = this.repo.sessionUnits();
    const mine = this.session.unit;
    const key = this.unitHistoryKey;
    if (key && key[0] === all && key[1] === units && key[2] === mine) return this.unitHistory;
    this.unitHistoryKey = [all, units, mine];
    // The common case by far: nothing was ever logged in another unit, so the
    // whole array passes through untouched and unallocated.
    this.unitHistory = !all.some(x => (units.get(x.sessionId) ?? mine) !== mine) ? all : all.map(x => {
      const from = units.get(x.sessionId) ?? mine;
      return from === mine ? x : { ...x, weight: convertWeight(x.weight, from, mine) };
    });
    return this.unitHistory;
  }

  /**
   * The coach's call for the lift on screen, one computation for the line
   * under its name and for the dial it opens on (R691). See the comment on
   * `lastTime` in `state()` for why each option is what it is.
   */
  private coachCall(): Suggestion | null {
    return coachSuggestion(
      this.historyInSessionUnit(), this.exerciseId, this.now(),
      {
        unit: this.session.unit, goal: trainingGoal(this.repo),
        live: { id: this.session.id, startedAt: this.session.startedAt },
        // The stepper's own grid; the lifter's jump is handed over below
        // — see the comment above this call for why (R592, R671).
        grid: WEIGHT_STEP[this.session.unit],
        /*
         * The empty implement, so a deload cannot suggest a weight the
         * rack does not have (R541). The engine defaults this to 0, so
         * it is this line that makes the floor real.
         *
         * `this.equipment`, not `exercises.get(id)?.equipment` — that
         * read a field `Exercise` has never had (equipment lives on
         * `LoggedSet`, per-set, not per-exercise) and `tsc --noEmit` was
         * never run to catch it. It type-checked as `any` and silently
         * fell through to the `?? 'barbell'` default on every call, so
         * the floor was always 45/20 regardless of what the lift was
         * actually logged on — right for a barbell lift by coincidence,
         * wrong and unnoticed for a dumbbell or bodyweight one.
         */
        base: EQUIPMENT_BASE[this.equipment ?? 'barbell'][this.session.unit],
        // Their jump, only where the plate button moves by exactly that from
        // this weight: not a conversion (R669), not off their own grid (R671).
        jump: this.startConverted || !this.onPlateGrid(this.startWeight) ? undefined : this.plateJump()
      }
    );
  }

  private loadPrefill(): void {
    const all = this.historyInSessionUnit();
    const p = prefillFor(this.exerciseId, all, this.session.unit);
    this.weight = p.weight;
    this.reps = p.reps;
    this.source = p.source;
    this.startWeight = p.weight;
    // `prefillFor` takes this lift's latest set by `at`; its session still knows
    // the unit it was logged in, which the converted number no longer shows.
    let newest: LoggedSet | null = null;
    for (const s of this.setsFor(this.exerciseId)) if (!newest || s.at > newest.at) newest = s;
    this.startConverted = newest !== null &&
      (this.repo.sessionUnits().get(newest.sessionId) ?? this.session.unit) !== this.session.unit;

    // Equipment carries over the same way the numbers do — the last set of
    // this lift is the best guess at how the next one will be done, and §4
    // says the app never asks a question it could answer. Null when it has
    // never been answered for this lift, which is not the same as "barbell".
    let last: LoggedSet | null = null;
    for (const set of all) {
      if (set.exerciseId !== this.exerciseId) continue;
      if (!set.equipment) continue;
      if (!last || set.at > last.at) last = set;
    }
    /*
     * A choice they made outranks a set they logged.
     *
     * History alone only remembers equipment that made it onto a LOGGED set, so
     * telling the app "this one is dumbbells" and then switching lifts and
     * coming back lost the answer — it fell back to the barbell on last week's
     * set and quietly contradicted them. `setEquipment` now writes the choice
     * down the moment it is made, and that is what gets read first. The set
     * history is still the fallback, for the lifts they have never answered
     * for, and null when neither knows — which is not the same as "barbell".
     */
    // `null` is "never answered"; `''` is "answered, and the answer is none".
    // Collapsing the two made CLEAR fail to stick — it wrote the empty string
    // and the next read treated it as no answer at all and went back to the
    // barbell on last week's set.
    const chosen = this.repo.getPref(`kit.${this.exerciseId}`);
    if (chosen !== null) {
      const [kit, ...rest] = chosen.split(':');
      this.equipment = (kit || null) as Equipment | null;
      this.machine = kit === 'machine' ? (rest.join(':') || null) : null;
    } else {
      this.equipment = last?.equipment ?? null;
      this.machine = last?.equipment === 'machine' ? (last.machine ?? null) : null;
    }

    /*
     * The dial opens on the coach's call (R692, D8), weight and reps, until
     * this lift has a set in this workout. The line already shows the call, so
     * the dial and the line say one thing, and taking the call is one tap on
     * LOG SET. The prefill it replaces was the last set logged, often a
     * back-off: PT2 had 160×8 under "try 190".
     *
     * A call with no reps (a deload) takes the reps of last time's TOP set at
     * the weight it backs off from, not the last set's: a 160×12 back-off put
     * 185×12 on the dial, harder than the 205×6 being backed off from (R692
     * review).
     */
    const call = this.coachCall();
    if (call && !this.repo.setsInSession(this.session.id).some(s => s.exerciseId === this.exerciseId)) {
      this.weight = call.weight;
      if (call.reps !== undefined) this.reps = call.reps;
      else {
        let top: LoggedSet | null = null;
        for (const s of all) {
          if (s.exerciseId === this.exerciseId && s.weight === call.recentWeight && (!top || s.at > top.at)) top = s;
        }
        if (top) this.reps = top.reps;
      }
    }
  }

  // ---- reads ---------------------------------------------------------------

  state(): NowState {
    const exercises = this.repo.exercises();
    const sessionSets = this.repo.setsInSession(this.session.id);
    const liveStats = sessionStats(this.session, sessionSets, this.repo.measurements());
    // "Up next" means what follows the lift you are ON, so the current exercise
    // is excluded alongside anything already trained. Without it the suggestion
    // is the exercise you are already looking at, and the swipe target reads as
    // empty until you have logged something.
    const trained = [...new Set([...sessionSets.map(s => s.exerciseId), this.exerciseId])];
    /*
     * UP NEXT must not offer somewhere you have already been, even if you
     * logged nothing there. With an empty session `trained` is just the current
     * lift, so the suggestion was whatever pairs with it — and pressing UP NEXT
     * made the lift you just left the pair again. It ping-ponged: bench, press,
     * bench, press, forever, two of twelve movements reachable.
     *
     * `visited` is deliberately kept OUT of `trained`. `trained` also decides
     * `sessionDay`, and merely looking at Squat must not turn a push day into
     * leg day.
     */
    const seen = [...new Set([...trained, ...this.visited])];
    const candidates = nextCandidates(
      this.repo.allSets(), seen, this.now(), new Date(this.now()).getDay()
    );

    const exercise = exercises.get(this.exerciseId) ?? { id: this.exerciseId, name: this.exerciseId };

    // The whole library goes in, so a movement the user created is offered even
    // before it has been trained — without it, adding a lift and switching away
    // lost it for good.
    const library = [...exercises.values()];
    let picker = pickerFor(
      this.repo.allSets(), this.now(), new Date(this.now()).getDay(), 12, library
    );
    // `pickerFor` ranks by history, so a lift with none — anything picked out
    // of the starting twelve after history exists — is absent from its own
    // picker, and the sheet opens with nothing marked as selected. Whatever is
    // currently open always belongs in the list.
    if (!picker.some(e => e.id === this.exerciseId)) picker = [exercise, ...picker];

    // The split is PRIOR knowledge and loses to evidence: `suggestNext` reads
    // their actual history, and only when it has nothing to say — which on a
    // first-ever workout is always, since ranking the history and removing what
    // is already done leaves the empty set — does the conventional companion
    // for the day fill in. UP NEXT used to be blank for exactly the beginner
    // who did not know what came next.
    const day = sessionDay(trained, dayOf(this.exerciseId));
    /**
     * History ranks; the split keeps it on today's workout.
     *
     * `predictSession` orders by typical position within a session, and on a
     * push/pull/legs routine EVERY day's opener has position 0 — so with twelve
     * weeks of real data the app suggested **Squat** immediately after Bench
     * Press, sending the user to a different day's lift mid-workout. Ranking by
     * their own history is still right; it just has no idea the days exist.
     *
     * So the highest-ranked candidate that belongs to the day being trained
     * wins. Their evidence still decides the order — this only rules out
     * answers that are on the wrong day, and only when a same-day answer exists
     * at all. `companionFor` remains the last resort, for the beginner with no
     * history to rank.
     */
    /*
     * The plan the user is running, and the day of it they said they are on.
     * The chosen day WINS over the inferred one — they told us, and §4's rule
     * is that the app does not argue with an answer it asked for. When they
     * have not said, the inferred day is COUNTED in their vocabulary — not
     * counted in push/pull/legs and translated afterwards, which is a
     * different answer and was the one this line took.
     *
     * R498. `planDayFor(day, plan)` tallies at the push/pull/legs level first,
     * and `sessionPlanDay`'s own comment says why that is wrong: an
     * upper/lower lifter's upper day is push AND pull, so bench + row + squat
     * reads as a 1-1-1 tie at the narrow level and the tie-break sends it to
     * whatever they are standing on. Counted at the level the lifter actually
     * has, it is 2 upper against 1 lower and not a tie at all. Measured: that
     * session, with the user on squat, titled LOWER here and UPPER on the
     * recap — `sessionTitle` has always called `sessionPlanDay` directly. One
     * session, two names, on two screens of the same app a minute apart.
     *
     * `day` stays a `SplitDay` because `groupBySplit` and `companionFor` still
     * want the narrow question; only the day shown to the LIFTER changes.
     */
    const plan = this.plan();
    const planDay = this.chosenDay() ?? sessionPlanDay(trained, plan, dayOf(this.exerciseId));

    /*
     * R496. Filtered by the day of THEIR plan, not by push/pull/legs.
     *
     * `day` is a `SplitDay`, and `DAY_OF` files bench under push and row under
     * pull. That is right for push/pull/legs and a category error for
     * UPPER/LOWER — a split this app offers in its own picker, where bench and
     * row are the same day. Measured on fourteen weeks of it: the lifter
     * benches, their own history says ROW next, and UP NEXT said OHP, because
     * this line skipped past row looking for something filed as push. The app
     * knew what they do and recommended something else.
     *
     * `planDay` is already computed three lines up and `inPlanDay` already
     * exists for exactly this comparison — `sessionPlanDay` carries the same
     * argument about why counting at the push/pull/legs level is wrong for a
     * lifter whose day spans two of them. This was the one place still asking
     * the narrower question. For a PPL lifter the plan day IS the split day, so
     * nothing about that case changes.
     */
    const onThisDay = planDay ? candidates.find(id => inPlanDay(id, planDay)) : null;
    const upNextId = onThisDay ?? candidates[0] ?? companionFor(day, seen, picker);

    return {
      session: this.session,
      exercise,
      weight: this.weight,
      reps: this.reps,
      prefillSource: this.source,
      plan,
      planDay,
      dayChosen: this.chosenDay() !== null,
      dayAsked: this.chosenDay() !== null || this.repo.getPref(`split.asked.${this.session.id}`) === '1',
      justFinished: justFinished(this.repo.allSets(), sessionSets, this.now()),
      equipment: this.equipment,
      machine: this.machine,
      knownMachines: this.repo.knownMachines(this.exerciseId),
      plateJump: this.plateJump(),
      repJump: this.repJump(),
      lang: this.lang(),
      /*
       * The coach line (OWNER.md #2) takes over this slot rather than getting
       * one of its own.
       *
       * Not a compromise — the right place. The slot's head says "Last time
       * 185 x 5" for any lift with history, and the coach line is that same
       * fact plus what to do about it: "185 for 2 sessions - try 190". It is a
       * strict improvement on what was there, in the position a lifter already
       * looks for it, directly under the exercise name.
       *
       * And it is the only place it could go. R512 measured the shortest
       * shipping phone at 624px of unshrinkable content against 568px of
       * screen, and R511 put LOG SET below the fold by adding EIGHT pixels of
       * padding. A new row costs about twenty. Reusing a row that is already
       * budgeted in `fixedHeight`'s HEADER_TEXT costs nothing at all.
       *
       * `historyInSessionUnit`, not `allSets`: a LoggedSet carries no unit
       * (HANDOFF trap 9), so raw history would compare kilos against pounds
       * and suggest a jump in the wrong currency.
       *
       * `grid` below is WEIGHT_STEP, the stepper's own increment, and the
       * lifter's plate jump goes in separately as `jump` (R671). R592 passed
       * the FINER of the two as the grid, because WEIGHT_STEP alone is
       * "reachable by the fine +/-5 stepper and loadable on a standard bar" —
       * right until somebody tells the app they load something finer, which
       * `jump.<unit>`'s own docstring in settings.tsx names directly ("someone
       * running microplates"). Measured then: a plateau at 60 kg with a 1.25 kg
       * jump got "try 62.5", the exact 2x jump that preference exists to avoid.
       *
       * But a grid of the jump counts from zero, and the lifter does not stand
       * at zero: a plateau at 85 with a 1.5 kg jump said "try 87", which the
       * plate button (86.5, 88) and the stepper (87.5, 90) both step over. So
       * the coach now takes whichever is nearer the goal's target -- the
       * stepper's grid, or a whole number of jumps from where they stand --
       * and 60 kg on 1.25 still says 61.25. Not `plateGrid()` either, which
       * R668 put here and R669 took back ("try 178" at 175 on dumbbells by 7);
       * R668's climb by whole jumps (175 -> 182, "try 189") also needs `jump`.
       */
      lastTime: lastTimeParts({
        previous: this.lastTime(),
        thisSession: sessionSets.filter(s => s.exerciseId === this.exerciseId),
        goal: this.goalHint(),
        start: this.source === 'history' ? null : this.startWeight,
        coach: this.coachCall()
      }, this.lang()),
      /*
       * Which sets logged in THIS workout are personal records (OWNER.md #5).
       *
       * §8 calls the PR "the emotional payload of the whole product", and until
       * now the logging screen did not know one had happened. `findPRs` was
       * used by the recap and by the harness and never here, so a lifter could
       * set a record and the screen it happened on said nothing — the moment
       * the app exists for, passing in silence until the recap.
       *
       * Same call the recap makes, with the same arguments, so the two cannot
       * disagree about what a record is: `historyBefore(sessionId)` excludes
       * this workout, which is what makes "more than ever" mean before today,
       * and the measurements and per-session units are what let a bodyweight
       * movement and a kilogram session be compared honestly.
       *
       * IDs, not claims. The screen marks the chip; the sentence about it
       * belongs to the recap, which has room for one.
       */
      prSetIds: this.prSetIds(sessionSets, exercises),
      loggedThisExercise: sessionSets.filter(s => s.exerciseId === this.exerciseId),
      loggedThisSession: sessionSets,
      dayRail: this.buildRail(planDay, candidates, sessionSets, exercises),
      upNext: upNextId && upNextId !== this.exerciseId
        ? exercises.get(upNextId) ?? { id: upNextId, name: upNextId }
        : null,
      picker,
      // The group you are IN leads. That is the session's day normally, and
      // `yours` when the lift being trained is one the user invented, since
      // those have no day and would otherwise sit below the fold.
      pickerGroups: groupBySplit(picker, dayOf(this.exerciseId) ? day : 'yours'),
      day,
      canFinish: sessionSets.length > 0,
      // Measured across the whole session, not per exercise: the rest that
      // matters is since you last did work, whatever the work was.
      rest: restSince(lastSetAt(sessionSets), this.now()),
      streak: weekStreak(this.repo.allSets(), this.now()),
      firstEver: this.repo.allSets().length === 0,
      today: this.buildToday(sessionSets, exercises),
      totalSets: sessionSets.length,
      // The third hand-rolled copy of this sum, and the third one to disagree
      // with the recap the moment a pull-up learned to weigh something. Through
      // `sessionStats` now, so the running total on the logging screen, the
      // history on Progress and the shareable at the end cannot say three
      // different things about one workout.
      // ...and `volumeKnown` off the same call, so the fourth thing it could
      // disagree about — whether the total is knowable at all — cannot be
      // expressed either.
      totalVolume: liveStats.volume,
      totalVolumeKnown: liveStats.volumeKnown
    };
  }

  /**
   * Group the session's sets by lift, in the order they were first trained.
   *
   * The lift currently open is always included even with no sets yet, so
   * switching to a new exercise shows you where you are in the workout rather
   * than making it appear only after you commit a set.
   */
  private buildToday(sessionSets: LoggedSet[], exercises: Map<string, Exercise>): SessionLift[] {
    const order: string[] = [];
    const byExercise = new Map<string, LoggedSet[]>();
    for (const set of sessionSets) {
      if (!byExercise.has(set.exerciseId)) { byExercise.set(set.exerciseId, []); order.push(set.exerciseId); }
      byExercise.get(set.exerciseId)!.push(set);
    }
    if (!byExercise.has(this.exerciseId)) { byExercise.set(this.exerciseId, []); order.push(this.exerciseId); }

    return order.map(id => ({
      exerciseId: id,
      name: exercises.get(id)?.name ?? id,
      sets: byExercise.get(id) ?? [],
      current: id === this.exerciseId
    }));
  }

  /**
   * The live goal on the lift being trained, or null.
   *
   * Live, not any: an achieved goal is a trophy and says nothing useful while
   * you are training — see `goalTail`. `goalProgress` measures `remaining` at
   * the goal's OWN rep count, which is the same number the goal card and the
   * Progress row show, so the three screens cannot disagree about how far away
   * a target is.
   */
  private goalHint(): GoalHint | null {
    const goal = this.repo.goals().find(g => g.exerciseId === this.exerciseId);
    if (!goal) return null;
    /*
     * Only this lift's sets, not the whole history.
     *
     * `goalProgress` touches `history` three times and filters by
     * `goal.exerciseId` every time — twice through `bestAt` and once for
     * `trainedSince` — so handing it the whole log makes it walk 14,000 rows to
     * look at a few dozen. Measured at that size: 1.43 ms, on a function that
     * runs inside `state()`, which runs on every tap.
     *
     * Behaviour-identical rather than an approximation: every use of the array
     * inside that function is already scoped to this exercise, so the sets
     * being withheld are ones it would have skipped.
     */
    const p = goalProgress(
      goal, this.setsFor(goal.exerciseId), this.repo.exercises(),
      this.now(), this.repo.sessionUnits());
    /*
     * The goal is measured in ITS own unit and shown in the SESSION'S.
     *
     * A goal carries the unit it was set in, and `goalProgress` compares it
     * against a history in that same unit, so the arithmetic is already
     * self-consistent — it is only the two numbers that reach the screen that
     * have to be moved. Converting the goal before scoring it would round the
     * target twice and drift the thing the whole card is measured against.
     *
     * Without this, a kg session under an lb goal printed "30 to 225 × 5"
     * beneath a hero reading kilos: a target the user cannot compare to the
     * number directly above it (§16).
     */
    const show = (w: number) =>
      goal.unit === this.session.unit ? w : convertWeight(w, goal.unit, this.session.unit);
    const base = { targetWeight: show(goal.targetWeight), targetReps: goal.targetReps };
    if (!p.achieved) return { ...base, remaining: show(p.remaining) };

    /*
     * Met. Whether that is news depends on WHEN: the same history without this
     * session's sets is the state the user walked in with, so if the goal was
     * already met then, nothing happened today and the line stays quiet.
     */
    // This lift's sets only, for the same reason as above: `isAchieved` is
    // scoped to the goal's exercise (R494 established that when it bucketed
    // `activeGoals`), so the rest of the log is rows it would skip.
    const before = this.setsFor(goal.exerciseId).filter(x => x.sessionId !== this.session.id);
    if (isAchieved(goal, before, this.repo.sessionUnits())) return null;
    return { ...base, remaining: 0, justHit: true };
  }

  /**
   * "Last time: 225 × 5" — the line §5 says must be visible without interaction.
   *
   * Read through `historyInSessionUnit`, because this line sits directly under
   * the hero and the two describe the SAME set. With a kg session over an lb
   * history the hero said 88.5 and this said "Last time 195 × 5": one set, two
   * numbers, neither labelled, on the one comparison §5 puts on screen without
   * being asked.
   */
  /**
   * The language every string on this screen is drawn in.
   *
   * Read here rather than passed in, because the setting can change while this
   * model is alive — Settings is a route pushed over the logging screen, and
   * coming back must not need a remount to speak the language they just chose.
   */
  lang(): Language {
    return languageOf(this.repo, this.locale);
  }

  lastTime(): LoggedSet | null {
    const previous = this.historyInSessionUnit().filter(
      s => s.exerciseId === this.exerciseId && s.sessionId !== this.session.id
    );
    return previous.length ? previous[previous.length - 1] : null;
  }

  // ---- writes --------------------------------------------------------------

  /**
   * Repeat a lift's last set, from the list rather than from the hero.
   *
   * The hero logs the lift you are ON. Adding another set of something further
   * up the session meant switching to it, checking the steppers landed on the
   * right numbers, logging, and switching back — four moves and a chance to log
   * the wrong weight, for the commonest action in a workout. The numbers come
   * from that lift's own last set in this session, so it repeats what happened
   * rather than what the steppers happen to be showing.
   *
   * Returns null when the lift has nothing to repeat yet.
   */
  addSetTo(
    exerciseId: string,
    patch?: { weight?: number; reps?: number; note?: string | null }
  ): LoggedSet | null {
    this.startNextIfFinished();
    const mine = this.repo.setsInSession(this.session.id)
      .filter(x => x.exerciseId === exerciseId);
    const last = mine[mine.length - 1];
    if (!last) return null;
    /*
     * The last set is the DEFAULT, not the answer.
     *
     * It used to log the copy outright, which is fast and wrong: the commonest
     * reason to add a set to a lift further up the session is that it was
     * different — heavier, fewer reps, a note about the machine. Copying
     * silently recorded a set that never happened and left the user to notice
     * and fix it. The patch is what the sheet collected; without one it still
     * repeats, which is what `undo` and the tests rely on.
     */
    const set: LoggedSet = {
      ...last,
      id: newId('x'),
      at: this.now(),
      ...(patch?.weight !== undefined ? { weight: patch.weight } : {}),
      ...(patch?.reps !== undefined ? { reps: patch.reps } : {}),
      ...(patch?.note !== undefined ? { note: patch.note?.trim() || null } : {})
    };
    this.repo.logSet(set);
    return set;
  }

  /** The set a `+` on this lift would start from, for the sheet to prefill. */
  lastSetOfInSession(exerciseId: string): LoggedSet | null {
    const mine = this.repo.setsInSession(this.session.id)
      .filter(x => x.exerciseId === exerciseId);
    return mine.length ? mine[mine.length - 1] : null;
  }

  /**
   * Fix a set that is already logged, instead of destroying it.
   *
   * Removing and re-logging moved the set to the END of the session and gave it
   * a new `at`, so correcting a mistyped middle set silently reordered the
   * workout. This keeps its id, its time and its place.
   */
  editSet(id: string, patch: { weight?: number; reps?: number; note?: string | null }): boolean {
    return this.repo.updateSet(id, patch);
  }

  /** THE one-tap action. Everything else on this screen exists to serve it. */
  log(): LoggedSet {
    // A set can never land in a workout that is already over, whatever the
    // navigation did to get back here. See `startNextIfFinished`.
    this.startNextIfFinished();
    const set: LoggedSet = {
      id: newId('x'),
      sessionId: this.session.id,
      exerciseId: this.exerciseId,
      weight: this.weight,
      reps: this.reps,
      at: this.now(),
      ...(this.equipment ? { equipment: this.equipment } : {}),
      ...(this.equipment === 'machine' && this.machine ? { machine: this.machine } : {})
    };
    this.repo.logSet(set);
    // Deliberately does NOT reset the steppers: the overwhelmingly common next
    // action is the same set again, and clearing them would cost a tap.
    this.source = 'history';
    return set;
  }

  /*
   * From an OFF-grid weight, + goes to the next weight up and - to the next one
   * down (R670). It rounded (weight +/- step) instead, which is the same thing on
   * the grid and skips a weight off it: 187.5 lb -- 85 kg, converted -- went to
   * 195, so a coach line reading "try 190" sat directly above a + button that
   * could not land on 190. Found by sweeping every coach suggestion against the
   * weights each button reaches when pressed repeatedly.
   */
  bumpWeight(steps: number): void {
    const step = WEIGHT_STEP[this.session.unit];
    const at = this.weight / step;
    const from = steps > 0 ? Math.floor(at + 1e-9) : Math.ceil(at - 1e-9);
    this.weight = Math.max(0, (from + steps) * step);
  }

  bumpReps(steps: number): void {
    this.reps = Math.max(1, this.reps + steps);
  }

  /**
   * Choose what this lift is being done on.
   *
   * The machine name is dropped when the equipment is not a machine, because
   * "Arsenal" against a barbell set is a fact about nothing.
   */
  /**
   * Record how this lift is done, and remember it.
   *
   * Stored per exercise rather than globally: bench is a barbell and lateral
   * raises are a machine, and one answer for the whole app would be wrong for
   * most of it. Written immediately rather than at log time, because the user
   * has already told us — waiting for a set to be logged means an answer given
   * and then abandoned is an answer thrown away.
   */
  setEquipment(equipment: Equipment | null, machine?: string | null): void {
    this.equipment = equipment;
    this.machine = equipment === 'machine' ? (machine?.trim() || null) : null;
    this.repo.setPref(
      `kit.${this.exerciseId}`,
      equipment === null ? '' : this.machine ? `${equipment}:${this.machine}` : equipment
    );
  }

  setWeight(w: number): void { this.weight = Math.max(0, w); }

  /** Which routine they are running. PPL until they say otherwise. */
  plan(): SplitPlan {
    return planOf(this.repo);
  }

  setPlan(plan: SplitPlan): void {
    this.repo.setPref('split.plan', plan);
    // A day of the old plan may not exist in the new one.
    const day = this.chosenDay();
    if (day && !PLAN_DAYS[plan].includes(day)) this.repo.setPref(`split.day.${this.session.id}`, '');
  }

  /**
   * The day they picked for THIS workout, or null if they have not been asked.
   *
   * Stored per session rather than globally: "today is pull day" is a fact
   * about one workout, and carrying it to the next one would have the app
   * insisting on Monday's answer all week.
   */
  chosenDay(): PlanDay | null {
    const saved = this.repo.getPref(`split.day.${this.session.id}`);
    if (!saved) return null;
    return PLAN_DAYS[this.plan()].includes(saved as PlanDay) ? (saved as PlanDay) : null;
  }

  setDay(day: PlanDay): void {
    this.repo.setPref(`split.day.${this.session.id}`, day);
    // Open on something that belongs to the day they just named, unless they
    // are already on one — switching the lift out from under them would undo
    // an answer they gave two taps ago.
    if (!inPlanDay(this.exerciseId, day)) {
      const first = pickerFor(this.repo.allSets(), this.now(), undefined, 12,
        [...this.repo.exercises().values()]).find(e => inPlanDay(e.id, day));
      if (first) this.selectExercise(first.id);
    }
  }

  /**
   * Remember that they were asked and did not answer.
   *
   * Without this the chooser reopens on every remount — leaving the screen for
   * Progress and coming back put the same question in front of somebody who had
   * already declined it once. §4's rule is that the app never asks a question it
   * could answer; asking one it has already been refused is worse than that.
   *
   * Per session, like the answer itself, so a skip on Monday does not silence
   * the question for the rest of the week.
   */
  skipDay(): void {
    this.repo.setPref(`split.asked.${this.session.id}`, '1');
  }

  /**
   * The day's lifts, ordered so the useful ones are reachable without scrolling.
   *
   * `railOrder` decides the order (R678): lifts with history, then the day's core
   * library, then the wider library, each tier moved by the coach's muscle
   * advice, and lifts already trained this session last. Those stay on the rail
   * rather than dropping off it — you often come back for a second round, and a
   * chip that vanishes the moment you use it makes the rail feel like it is
   * losing your work.
   *
   * `planDay` not `day`, so an upper/lower lifter gets the whole upper body and
   * not just the push half. When there is no day at all — no plan, nothing
   * inferred — the rail is empty rather than a list of everything, because the whole
   * library is the picker's job and §7 is explicit that the logging path
   * never shows a library.
   */
  private buildRail(
    planDay: PlanDay | null,
    candidates: string[],
    sessionSets: LoggedSet[],
    exercises: Map<string, Exercise>
  ): RailLift[] {
    if (!planDay) return [];
    const done = new Set(sessionSets.map(x => x.exerciseId));
    /*
     * The day, plus two things that belong on it regardless.
     *
     * A movement the user invented has no split day — `DAY_OF` only knows the
     * built-ins — so filtering on the day alone silently hid exactly the lifts
     * they cared enough to create. And the lift on screen stays on its own rail
     * even when it is off the day, because a chip row that does not contain
     * where you are standing reads as broken.
     */
    const onDay = [...exercises.values()].filter(e =>
      inPlanDay(e.id, planDay) || dayOf(e.id) === null || e.id === this.exerciseId);

    /*
     * Only about three chips fit across a phone before the row has to scroll,
     * so the first three have to be the three worth having. Measured with the
     * first ordering (current lift first, then the predictor's ranking), the
     * visible three were the lift already on screen and two alphabetical
     * accidents, while the app's own recommendation sat off the right edge
     * where nobody would find it.
     *
     * So the order is what you would actually reach for: the suggestion, then
     * the rest of the day by how likely you are to want it, then the ones you
     * have already trained today. Those stay on the rail, because you often come
     * back for a second round, but they do not spend the space seen first.
     *
     * The predictor says what this user usually does next; `recommendNext` says
     * what makes sense given what they have ALREADY done today. Both are needed:
     * habit will happily hand you a second heavy horizontal press straight after
     * the first. The pool's order is the base and the advice shifts it (see
     * `railPool` and `railOrder`). A movement with no muscle profile scores 0,
     * which is right for something the user invented.
     *
     * The order is blind to which lift is selected. Scoring the current lift
     * last made the row rearrange under your finger on every tap. The rail only
     * exists once a set is logged, and at that moment the lift you are on is
     * DONE, so it sorts to the back anyway. `done` changes only when you LOG. A
     * lift you merely tap does leave the predictor's list, so it can move within
     * its tier, but a lift with history never falls behind one without (R678).
     */
    const pool = railPool(onDay, candidates);
    const advice = new Map(
      recommendNext(pool, sessionSets, this.lang()).map(r => [r.exerciseId, r])
    );
    const ordered = railOrder(onDay, pool, new Map([...advice].map(([id, r]) => [id, r.score])),
      id => this.setsFor(id).length > 0, done);

    /*
     * §7: the logging path never shows a library. Without a cap it did — a FULL
     * BODY plan covers push, pull AND legs, so `inPlanDay` matched every built-in
     * movement and the rail became all 28 of them; upper/lower gave 20. The cap
     * keeps the ranking's best few and never drops a lift you have already
     * trained today or the one you are standing on, both of which you need to be
     * able to get back to.
     */
    const kept = ordered.filter((e, i) =>
      i < RAIL_MAX || done.has(e.id) || e.id === this.exerciseId);

    /*
     * The tag the NEXT LIFT button used to be. Derived from the rail itself
     * rather than from `upNext`, which is chosen across the whole library and so
     * could name a lift that is not on this rail at all — leaving the row with no
     * NEXT on it and the user with no steer.
     */
    const suggestedId = kept.find(e => !done.has(e.id) && !this.visited.has(e.id))?.id;

    /*
     * `visited`, not just `!== exerciseId`, and this is load-bearing.
     *
     * Skipping only the current lift makes the tag point BACKWARDS: move from
     * bench to fly without logging, and neither is done, so the rail turns round
     * and tags bench — "next" is the lift you just walked away from. Walked as a
     * swipe it does not merely read oddly, it never terminates: bench -> fly ->
     * bench -> fly, forever, which is the exact loop R50 fixed in `upNext` and
     * which this rail was written without.
     *
     * The current lift is always in `visited`, so it stays excluded for free.
     * Once everything on the rail has been visited the tag goes away, which is
     * the honest answer — there is nothing left to steer anyone to.
     */

    return kept.map(e => ({
      id: e.id,
      name: e.name,
      done: done.has(e.id),
      current: e.id === this.exerciseId,
      suggested: e.id === suggestedId,
      // Only the suggestion explains itself. A reason on every chip is a wall
      // of text on a row meant to be read at a glance mid-set.
      reason: e.id === suggestedId ? (advice.get(e.id)?.reason ?? '') : ''
    }));
  }

  /** The plate jump this user has chosen, or the default for their unit. */
  plateJump(): number {
    const saved = this.repo.getPref(`jump.${this.session.unit}`);
    const n = saved === null ? null : customJump(saved, this.session.unit);
    return n ?? PLATE[this.session.unit];
  }

  /** The rep jump this user has chosen, or five. */
  repJump(): number {
    const saved = this.repo.getPref('jump.reps');
    const n = saved === null ? null : customRepJump(saved);
    return n ?? REP_JUMP;
  }

  /** Store a jump amount. Rejects anything `customJump` will not accept. */
  /*
   * `setPlateJump` / `setRepJump` were here and are gone (R238).
   *
   * They wrote `jump.<unit>` and `jump.reps` — exactly what `app/settings.tsx`
   * does directly — so they were a second way to do one thing, and the tests
   * were the only caller either had ever had. Worse, they keyed off
   * `this.session.unit` while the Settings screen reads the DISPLAY unit
   * (`display-unit.ts`), so wiring one up would have written the preference
   * where the screen that shows it does not look.
   *
   * The validation they wrapped, `customJump` and `customRepJump`, is exported
   * and is what Settings actually calls.
   */

  /**
   * Add or strip a plate. Signed like `bumpWeight`, and routed through
   * `setWeight` so it inherits the same floor — stripping a plate off 20 lb
   * lands on 0, never below.
   *
   * LANDS ON A LOADABLE WEIGHT, like `bumpWeight` already did (R550).
   *
   * `bumpWeight` has always snapped to `WEIGHT_STEP`; this did not, and the two
   * sit next to each other on the same row. Measured on a lifter who logged one
   * session in kilos, so the field opens at 189.5 (86 kg, reported honestly):
   * `+45` gave 234.5 and `-45` gave 144.5, and every further press kept the
   * half — the big plate buttons could never return to a weight that exists,
   * while the small ones beside them fixed it in one tap.
   *
   * The grid is the FINER of the stepper's increment and the lifter's own plate
   * jump. Snapping a custom 2.5 lb jump onto a 5 lb grid would erase the point
   * of setting it — somebody who owns micro-plates is telling the app what they
   * can load, and that outranks the default, which is the same rule R518 and
   * R549 both landed on from the other side.
   */
  bumpPlate(steps: number): void {
    const jump = this.plateJump();
    const grid = WEIGHT_STEP[this.session.unit];
    const target = this.weight + steps * jump;
    /*
     * "On the grid" means on the lifter's OWN grid (R668): the finest weight
     * both the stepper and their jump land on. Measured against the stepper
     * alone, a jump of 7 went 175 -> 182 -> 190 -> 197 -> 205, because 182 is
     * "off" a 5 lb grid only on account of the 7 they asked for, and got
     * snapped as if it were a converted kilo. Ask for seven, get eight.
     *
     * Except for the one weight that IS a converted kilo (R669). For a kilo
     * jump that does not divide 2.5 -- 1, 1.5, 2, 3 -- that finest grid is
     * 0.5 kg, exactly what `convertWeight` rounds to, so every converted
     * weight passed as the lifter's own and R550's rescue stopped: a bench
     * last logged at 185 lb opened at 84 kg and a 3 kg jump went to 87.
     * Arithmetic cannot tell 81.5 = 80 + 1.5 from 81.5 = 179.5 lb, so the
     * prefill says where it came from instead.
     */
    const own = this.startConverted && this.weight === this.startWeight ? grid : this.plateGrid();
    /*
     * SNAP ONLY WHEN THE STARTING WEIGHT IS OFF THE GRID (R562).
     *
     * R550 rounded every result, and that silently overrode a jump the lifter
     * had set themselves: with `jump.lb` at 7, pressing +7 from 135 moved them
     * to 140, and in kilos a jump of 3 moved 2.5. Ask for seven, get five. The
     * app was correcting equipment it had been told about, which is the mistake
     * R518 and R549 each fixed from the other side — their own evidence
     * outranks the default.
     *
     * The two goals are not in tension once the condition is right. A weight
     * already on the grid plus their jump is exactly what they asked for and
     * needs no help. A weight OFF the grid is the case R550 existed for — 189.5
     * from a converted kilo session, where +45 gave 234.5 and every further
     * press kept the half — and snapping there returns them to loadable
     * numbers without touching anyone else.
     */
    const onGrid = Math.abs(this.weight / own - Math.round(this.weight / own)) < 1e-9;
    this.setWeight(onGrid ? target : Math.round(target / grid) * grid);
  }

  /**
   * The finest weight both the fixed stepper and the lifter's plate jump land
   * on: their greatest common divisor (R668). Equal to the finer of the two
   * whenever one divides the other -- a 45 lb or 20 kg default, 1.25 kg
   * micro-plates, a 1 lb jump -- and 1 lb for a jump of 7, so weights their own
   * dumbbells reach are never treated as off the grid. It can be as fine as
   * the half unit `convertWeight` rounds to, so it cannot spot a converted
   * weight by itself (R669: see `startConverted`).
   */
  plateGrid(): number {
    let a = Math.round(WEIGHT_STEP[this.session.unit] * 100);
    let b = Math.round(this.plateJump() * 100);
    while (b) [a, b] = [b, a % b];
    return a / 100;
  }

  /** Whether the plate button moves `w` by exactly the jump, rather than snapping it first. */
  private onPlateGrid(w: number): boolean {
    const g = this.plateGrid();
    return Math.abs(w / g - Math.round(w / g)) < 1e-9;
  }

  /**
   * Jump either way by the chosen amount. `setReps` floors at 1, so dropping
   * five from a triple lands on 1 rather than a negative set.
   */
  jumpReps(steps: number): void { this.setReps(this.reps + steps * this.repJump()); }
  setReps(r: number): void { this.reps = Math.max(1, Math.round(r)); }

  selectExercise(exerciseId: string): void {
    this.exerciseId = exerciseId;
    this.visited.add(exerciseId);
    this.loadPrefill();
  }

  /**
   * Add a movement the library does not have, and switch to it. §7 — search is
   * the *add a new exercise* path, and this is it.
   *
   * `addExercise` before anything else is not optional: `sets` carries a foreign
   * key to `exercises`, so logging against an unregistered id fails the write.
   * Returns the id so the caller can confirm what it landed on.
   */
  addCustomExercise(name: string): string | null {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) return null;

    const all = [...this.repo.exercises().values()];
    // Its own name, or one that means one movement: "RDL" is Romanian
    // Deadlift, not a second lift without its history (R683).
    const existing = exactExercise(clean, all);
    if (existing) {                       // don't create a second "Hack Squat"
      this.selectExercise(existing.id);
      return existing.id;
    }

    const id = freeSlug(new Set(all.map(e => e.id)), clean);
    this.repo.addExercise(id, clean);
    this.selectExercise(id);
    return id;
  }

  /**
   * What the add field shows as the lifter types (R683): the whole library and
   * their own lifts, not only the ones the picker predicts.
   */
  searchExercises(query: string): Exercise[] {
    return findExercises(query, [...this.repo.exercises().values()]);
  }

  /**
   * Undo a custom exercise added by mistake. `repo.removeExercise` already
   * refuses a built-in or anything ever logged against — this only adds the
   * one rule that belongs at the UI layer: never remove the lift currently
   * open, so the screen never has to decide what to show in its place.
   */
  removeCustomExercise(id: string): boolean {
    if (id === this.exerciseId) return false;
    return this.repo.removeExercise(id);
  }

  /**
   * Swipe. Advances to the lift the rail is pointing at, if there is one.
   *
   * Reads `dayRail`'s suggestion, NOT `upNext`. They are different answers on
   * purpose: `upNext` ranks the whole library, the rail ranks the few movements
   * it can actually show, and `buildRail` already refuses to tag a suggestion
   * that is not on the rail for exactly that reason. Taking `upNext` here would
   * let a swipe land on a lift the rail never named — the user would see NEXT
   * beside one chip, swipe, and arrive somewhere else. Two controls for one
   * decision have to agree about what the decision was.
   *
   * Latent until now only because nothing called this.
   */
  next(): boolean {
    const target = this.state().dayRail.find(l => l.suggested);
    if (!target) return false;
    this.selectExercise(target.id);
    return true;
  }

  /**
   * Undo the last set of a lift — a mis-tap must cost one tap to fix.
   *
   * `exerciseId` defaults to the one being trained, but any lift in the session
   * can be named, and that is the point. Undo used to work ONLY on the current
   * lift, so a set logged wrong and then moved on from was stranded: it sat
   * there in TODAY, plainly visible, with the fix three taps away behind
   * realising you had to switch back to it first. The mistake was on screen and
   * the way to fix it was not.
   */
  undo(exerciseId = this.exerciseId): boolean {
    const mine = this.repo.setsInSession(this.session.id)
      .filter(s => s.exerciseId === exerciseId);
    if (!mine.length) return false;
    this.repo.deleteSet(mine[mine.length - 1].id);
    return true;
  }

  /**
   * Throw away today's workout and start it over. Returns how many sets went.
   *
   * Scoped to the LIVE session on purpose: this clears what you are doing, not
   * what you have done. Yesterday's training, the streak behind it and every
   * goal are untouched, which is the whole difference between this and the
   * erase control on Progress.
   *
   * The session itself is kept open rather than ended — you are starting the
   * workout again, not abandoning it, and ending it would push an empty recap
   * and leave a phantom row behind (see `finish`).
   */
  clearWorkout(): number {
    const mine = this.repo.setsInSession(this.session.id);
    for (const set of mine) this.repo.deleteSet(set.id);
    this.loadPrefill();
    return mine.length;
  }

  /**
   * Remove one specific set from this session.
   *
   * Scoped to the live session on purpose: this screen shows today's work, and
   * reaching back into history from the logging path is how you delete
   * something you cannot see. A set that is not in this session is refused
   * rather than silently ignored.
   */
  removeSet(setId: string): boolean {
    const mine = this.repo.setsInSession(this.session.id);
    if (!mine.some(s => s.id === setId)) return false;
    this.repo.deleteSet(setId);
    return true;
  }

  finish(): Session {
    const sets = this.repo.setsInSession(this.session.id);
    // Nothing to finish, so nothing is ended. The session stays open and gets
    // reused on the next launch instead of leaving an empty ended row behind
    // for every time someone opened the app and did not train.
    if (!sets.length) return this.session;
    const endedAt = sets[sets.length - 1].at;
    this.repo.endSession(this.session.id, endedAt);
    this.session = { ...this.session, endedAt };
    return this.session;
  }

  /**
   * Roll onto a fresh workout if the one this model holds is over.
   *
   * The recap is `router.push`ed on top of Now, so DONE is a `router.back()` and
   * the Now screen underneath was never unmounted — the model came back still
   * pointing at the session it had just ended. That left the user inside a
   * finished workout: TODAY listing the sets they had been congratulated on, a
   * running rest clock, FINISH offered again. And logging from there **wrote
   * into a closed session**, whose `endedAt` was by then earlier than sets
   * inside it, so its duration and any recap quoting it were both wrong.
   *
   * Returning to the logging screen after finishing means the next workout, so
   * that is what this starts. It is called on focus so the screen is clean
   * immediately, and again inside `log()` — a write must never be able to land
   * in an ended session whatever the navigation did.
   *
   * Returns true if a new session was started, so a caller can tell whether
   * anything changed.
   */
  /**
   * Take up a newly chosen unit, if the workout has not started yet.
   *
   * `unitForNewSession` now honours the Settings choice, which fixes the unit
   * for the NEXT session — and leaves the commonest path still broken. Opening
   * the app starts a session immediately; going to Settings, switching to kg,
   * and coming back lands on that same lb session, so the setting appears to do
   * nothing a second time and the lifter logs the whole workout in the unit
   * they just rejected.
   *
   * Safe precisely while the session is EMPTY. A session with sets in it has
   * numbers whose meaning is fixed — 100 logged in pounds is not 100 kilos, and
   * this app never rewrites a weight it was given (see schema.ts). So an
   * untouched session is restarted in the new unit, and a session with a single
   * set in it keeps the unit it was born with until it is finished.
   *
   * Returns true if the session was replaced.
   */
  adoptChosenUnit(): boolean {
    const chosen = this.repo.getPref(PREF_UNIT) as Unit | null;
    if (!chosen || chosen === this.session.unit) return false;
    if (this.repo.setsInSession(this.session.id).length > 0) return false;
    const live = this.repo.session(this.session.id);
    if (!live || live.endedAt != null) return false;

    // End the empty shell rather than leaving it open: two live sessions is a
    // state `liveSession()` cannot describe, and an abandoned empty one would
    // show up in nothing but still hold the "most recent unit".
    this.repo.endSession(this.session.id, this.now());
    this.session = this.begin();
    this.loadPrefill();
    return true;
  }

  /**
   * End a session the §8 idle rule says is over, and start a fresh one.
   *
   * The constructor already does this, so a COLD launch never resumes a
   * workout finished on Tuesday. But a cold launch is the rare path: a phone
   * does not relaunch the app, it wakes it. Lock the screen mid-workout, leave
   * the gym, come back to it two hours later, and iOS restores the process with
   * this model still holding the same live session — so the next set joins a
   * workout that started before lunch, and the recap reports `TIME 137 MIN`.
   * That is precisely the "phone left on a bench" case §8's ninety minutes
   * exist to prevent, arriving by the route nobody checked.
   *
   * Backdated to the last set by `autoEnd`, exactly as the constructor does, so
   * the abandoned workout keeps the duration it actually had.
   *
   * Returns whether anything changed, so the caller can avoid a redraw.
   */
  closeIfStale(): boolean {
    const live = this.repo.session(this.session.id);
    if (!live || live.endedAt != null) return false;
    const sets = this.repo.setsInSession(live.id);
    if (!isStale(live, sets, this.now())) return false;
    const closed = autoEnd(live, sets, this.now());
    this.repo.endSession(closed.id, closed.endedAt!);
    this.session = this.begin();
    this.exerciseId = this.openingExercise();
    this.visited.clear();
    this.visited.add(this.exerciseId);
    this.loadPrefill();
    return true;
  }

  startNextIfFinished(): boolean {
    /*
     * Also covers the session having been ERASED underneath us.
     *
     * `eraseAll` on Progress deletes the row this model is holding, and it used
     * to keep right on pointing at it: the screen showed the weight from a set
     * that no longer existed, and the next log would have failed the foreign
     * key against a session that had been deleted. A session that is gone and
     * one that is finished want the same answer — start a new one.
     */
    const live = this.repo.session(this.session.id);
    if (live && live.endedAt == null) return false;
    this.session = this.begin();
    // A new workout has been nowhere yet, so UP NEXT starts over with it.
    this.visited = new Set();
    this.exerciseId = this.openingExercise();
    this.visited.add(this.exerciseId);
    this.loadPrefill();
    return true;
  }
}

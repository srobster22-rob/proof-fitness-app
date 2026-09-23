import type { Exercise, LoggedSet, Unit, Equipment } from './types.ts';
import { rankExercises, sessionCount, MIN_SESSIONS_FOR_PREDICTION } from './predict.ts';

/**
 * The first session. PROMPT.md §6.
 *
 * The whole design rests on "pre-filled with last time's numbers", and on day
 * one there is no last time — so the app is at its weakest exactly where day-1
 * retention is decided, and Health & Fitness has the worst day-1 retention of
 * any category.
 *
 * Two rules do the work:
 *   - twelve lifts, not two hundred
 *   - never a blank field: seed from a population default and let steppers do
 *     the rest
 */

/**
 * The starting twelve. Compound movements people actually walk in and do,
 * ordered by how likely a beginner is to be looking for them.
 *
 * `seed` values are deliberately CONSERVATIVE — an untrained adult should be
 * able to complete the set. Overshooting on set one is worse than undershooting:
 * a number that is too heavy is discouraging and possibly unsafe, while one that
 * is too light gets corrected with two taps of a stepper.
 */
export interface SeedExercise extends Exercise {
  seedLb: number;
  seedKg: number;
  reps: number;
  /** What it is normally done on, before the user says otherwise. */
  kit: Equipment;
  /**
   * Working weight relative to a bench press, roughly.
   *
   * Not a 1RM coefficient — a "what would this person put on the bar for a set
   * of this" number, which is what the field is prefilling. Calibrated against
   * the ratio a lifter would recognise: a 315 bench goes with a 135 overhead
   * press, and 0.43 x 315 is 135.
   *
   * Dumbbell factors are PER HAND, because that is the number written on the
   * dumbbell and the number the user types.
   */
  factor: number;
  /**
   * Whether a set of this movement says how strong the lifter is (R678).
   *
   * `strengthIndex` divides a set's weight by `factor` to get a bench-press
   * equivalent. That only holds for a movement whose load tracks whole-body
   * strength the same way for everybody, which means the barbell compounds. An
   * isolation lift does not: one 120 lb hip abduction made a first squat open at
   * 290. Neither does a machine, whose numbers change from one gym to the next.
   * Absent means no.
   */
  calibrates?: boolean;
}

export const STARTING_TWELVE: SeedExercise[] = [
  { id: 'bench',    name: 'Bench Press',      seedLb: 95,  seedKg: 40,  reps: 8, kit: 'barbell', factor: 1.0, calibrates: true },
  { id: 'squat',    name: 'Squat',            seedLb: 95,  seedKg: 40,  reps: 8, kit: 'barbell', factor: 1.2, calibrates: true },
  { id: 'deadlift', name: 'Deadlift',         seedLb: 135, seedKg: 60,  reps: 5, kit: 'barbell', factor: 1.45, calibrates: true },
  { id: 'ohp',      name: 'Overhead Press',   seedLb: 65,  seedKg: 30,  reps: 8, kit: 'barbell', factor: 0.43, calibrates: true },
  { id: 'row',      name: 'Barbell Row',      seedLb: 85,  seedKg: 35,  reps: 8, kit: 'barbell', factor: 0.65, calibrates: true },
  { id: 'pulldown', name: 'Lat Pulldown',     seedLb: 80,  seedKg: 35,  reps: 10, kit: 'machine', factor: 0.55 },
  { id: 'dbpress',  name: 'DB Bench Press',   seedLb: 35,  seedKg: 15,  reps: 10, kit: 'dumbbell', factor: 0.35 },
  { id: 'dbrow',    name: 'DB Row',           seedLb: 35,  seedKg: 15,  reps: 10, kit: 'dumbbell', factor: 0.28 },
  { id: 'legpress', name: 'Leg Press',        seedLb: 180, seedKg: 80,  reps: 10, kit: 'machine', factor: 1.8 },
  { id: 'curl',     name: 'Bicep Curl',       seedLb: 30,  seedKg: 12.5, reps: 10, kit: 'dumbbell', factor: 0.2 },
  { id: 'triext',   name: 'Tricep Extension', seedLb: 30,  seedKg: 12.5, reps: 12, kit: 'dumbbell', factor: 0.2 },
  { id: 'lateral',  name: 'Lateral Raise',    seedLb: 15,  seedKg: 7.5, reps: 12, kit: 'dumbbell', factor: 0.08 }
];

/**
 * The rest of the library.
 *
 * `STARTING_TWELVE` stays exactly twelve because §6 promises a **short** list on
 * first launch — a beginner facing thirty movements is the setup maze §5 exists
 * to avoid. These are what everyone else needs once they know what they are
 * doing, and they only reach the first-launch picker once it has history to
 * rank. A day's rail offers them sooner, in this order (see `buildRail`).
 *
 * Chosen for how common they are, not for coverage: every one of these is in
 * an ordinary commercial gym. The bodyweight four (pull-up, chin-up, dip,
 * push-up) are here now that a set's real load counts the lifter's bodyweight
 * (`realLoad`); nothing else is marked bodyweight, because that mark means the
 * whole body is the load.
 */
export const MORE_MOVEMENTS: SeedExercise[] = [
  // push
  { id: 'incline',   name: 'Incline Bench Press', seedLb: 65,  seedKg: 30,   reps: 8, kit: 'barbell', factor: 0.85, calibrates: true },
  { id: 'dbohp',     name: 'DB Shoulder Press',   seedLb: 25,  seedKg: 10,   reps: 10, kit: 'dumbbell', factor: 0.18 },
  { id: 'chestpress',name: 'Machine Chest Press', seedLb: 70,  seedKg: 30,   reps: 10, kit: 'machine', factor: 0.95 },
  { id: 'fly',       name: 'Chest Fly',           seedLb: 25,  seedKg: 10,   reps: 12, kit: 'machine', factor: 0.25 },
  { id: 'pushdown',  name: 'Tricep Pushdown',     seedLb: 40,  seedKg: 20,   reps: 12, kit: 'machine', factor: 0.25 },

  // pull
  { id: 'cablerow',  name: 'Seated Cable Row',    seedLb: 80,  seedKg: 35,   reps: 10, kit: 'machine', factor: 0.6 },
  { id: 'hammer',    name: 'Hammer Curl',         seedLb: 25,  seedKg: 10,   reps: 10, kit: 'dumbbell', factor: 0.2 },
  { id: 'facepull',  name: 'Face Pull',           seedLb: 30,  seedKg: 12.5, reps: 12, kit: 'machine', factor: 0.2 },
  { id: 'revfly',    name: 'Reverse Fly',         seedLb: 20,  seedKg: 7.5,  reps: 12, kit: 'machine', factor: 0.1 },
  /*
   * Bodyweight, and the four most conspicuous absences from a gym library.
   * `factor: 0` because there is nothing to scale — `startingWeight` is added
   * weight, and the honest default for all four is none.
   */
  { id: 'pullup',    name: 'Pull-up',             seedLb: 0,   seedKg: 0,    reps: 8,  kit: 'bodyweight', factor: 0 },
  { id: 'chinup',    name: 'Chin-up',             seedLb: 0,   seedKg: 0,    reps: 8,  kit: 'bodyweight', factor: 0 },
  { id: 'dip',       name: 'Dip',                 seedLb: 0,   seedKg: 0,    reps: 8,  kit: 'bodyweight', factor: 0 },
  { id: 'pushup',    name: 'Push-up',             seedLb: 0,   seedKg: 0,    reps: 12, kit: 'bodyweight', factor: 0 },
  { id: 'shrug',     name: 'Shrug',               seedLb: 95,  seedKg: 40,   reps: 12, kit: 'barbell', factor: 0.8 },

  // legs
  { id: 'rdl',       name: 'Romanian Deadlift',   seedLb: 95,  seedKg: 40,   reps: 8, kit: 'barbell', factor: 1.1, calibrates: true },
  { id: 'hipthrust', name: 'Hip Thrust',          seedLb: 135, seedKg: 60,   reps: 10, kit: 'barbell', factor: 1.3 },
  { id: 'legcurl',   name: 'Leg Curl',            seedLb: 50,  seedKg: 25,   reps: 12, kit: 'machine', factor: 0.4 },
  { id: 'legext',    name: 'Leg Extension',       seedLb: 50,  seedKg: 25,   reps: 12, kit: 'machine', factor: 0.45 },
  { id: 'lunge',     name: 'Lunge',               seedLb: 30,  seedKg: 12.5, reps: 10, kit: 'dumbbell', factor: 0.25 },
  { id: 'calf',      name: 'Calf Raise',          seedLb: 90,  seedKg: 40,   reps: 12, kit: 'machine', factor: 0.6 }
];

/*
 * The rest of what an ordinary commercial gym has (R678).
 *
 * Strong ships 200+ movements and Hevy 400+ (MARKET.md), and a lifter whose
 * program calls for a front squat or a skull crusher had to invent it: no
 * starting weight, no day, no muscles for the coach to reason with. These
 * come LAST on purpose. `BUILTIN`'s order is the order a lifter with no
 * history meets the day's lifts on the rail, and the rail offers this tier only
 * in the room the core leaves: a push or pull day's twelve stays whole, and leg
 * day, which has fewer core lifts than the rail holds, fills the rest from here.
 * Once a lifter trains one of them it ranks like any lift they do.
 *
 * Ids are hyphenated on purpose. A custom exercise's id is a slug of
 * `[a-z0-9_]`, so none a lifter already made can hold one of these.
 */
export const WIDER_LIBRARY: SeedExercise[] = [
  // push
  { id: 'close-grip-bench', name: 'Close-Grip Bench Press', seedLb: 65,  seedKg: 30,   reps: 8,  kit: 'barbell',  factor: 0.85, calibrates: true },
  { id: 'incline-db-press', name: 'Incline DB Press',       seedLb: 30,  seedKg: 12.5, reps: 10, kit: 'dumbbell', factor: 0.3 },
  { id: 'machine-shoulder-press', name: 'Machine Shoulder Press', seedLb: 50,  seedKg: 22.5, reps: 10, kit: 'machine',  factor: 0.45 },
  { id: 'arnold-press',  name: 'Arnold Press',           seedLb: 20,  seedKg: 7.5,  reps: 10, kit: 'dumbbell', factor: 0.15 },
  { id: 'skull-crusher', name: 'Skull Crusher',          seedLb: 20,  seedKg: 7.5,  reps: 10, kit: 'dumbbell', factor: 0.15 },
  { id: 'cable-fly',     name: 'Cable Fly',              seedLb: 15,  seedKg: 7.5,  reps: 12, kit: 'machine',  factor: 0.15 },
  { id: 'db-fly',        name: 'DB Fly',                 seedLb: 15,  seedKg: 7.5,  reps: 12, kit: 'dumbbell', factor: 0.1 },
  { id: 'front-raise',   name: 'Front Raise',            seedLb: 15,  seedKg: 7.5,  reps: 12, kit: 'dumbbell', factor: 0.08 },
  { id: 'cable-lateral-raise', name: 'Cable Lateral Raise',    seedLb: 10,  seedKg: 5,    reps: 12, kit: 'machine',  factor: 0.08 },

  // pull
  { id: 't-bar-row',     name: 'T-Bar Row',              seedLb: 70,  seedKg: 30,   reps: 8,  kit: 'barbell',  factor: 0.6 },
  { id: 'machine-row',   name: 'Machine Row',            seedLb: 70,  seedKg: 30,   reps: 10, kit: 'machine',  factor: 0.55 },
  { id: 'sumo-deadlift', name: 'Sumo Deadlift',          seedLb: 135, seedKg: 60,   reps: 5,  kit: 'barbell',  factor: 1.4, calibrates: true },
  { id: 'rack-pull',     name: 'Rack Pull',              seedLb: 135, seedKg: 60,   reps: 5,  kit: 'barbell',  factor: 1.5 },
  { id: 'straight-arm-pulldown', name: 'Straight-Arm Pulldown',  seedLb: 30,  seedKg: 12.5, reps: 12, kit: 'machine',  factor: 0.2 },
  { id: 'barbell-curl',  name: 'Barbell Curl',           seedLb: 45,  seedKg: 20,   reps: 10, kit: 'barbell',  factor: 0.25 },
  { id: 'cable-curl',    name: 'Cable Curl',             seedLb: 30,  seedKg: 12.5, reps: 12, kit: 'machine',  factor: 0.2 },
  { id: 'preacher-curl', name: 'Preacher Curl',          seedLb: 30,  seedKg: 12.5, reps: 10, kit: 'machine',  factor: 0.18 },

  // legs
  { id: 'front-squat',   name: 'Front Squat',            seedLb: 75,  seedKg: 35,   reps: 5,  kit: 'barbell',  factor: 0.85, calibrates: true },
  { id: 'hack-squat',    name: 'Hack Squat',             seedLb: 90,  seedKg: 40,   reps: 10, kit: 'machine',  factor: 1.0 },
  { id: 'trap-bar-deadlift', name: 'Trap Bar Deadlift',      seedLb: 135, seedKg: 60,   reps: 5,  kit: 'barbell',  factor: 1.45, calibrates: true },
  { id: 'goblet-squat',  name: 'Goblet Squat',           seedLb: 35,  seedKg: 15,   reps: 10, kit: 'dumbbell', factor: 0.25 },
  { id: 'bulgarian-split-squat', name: 'Bulgarian Split Squat',  seedLb: 20,  seedKg: 7.5,  reps: 10, kit: 'dumbbell', factor: 0.15 },
  { id: 'good-morning',  name: 'Good Morning',           seedLb: 65,  seedKg: 30,   reps: 10, kit: 'barbell',  factor: 0.5 },
  { id: 'step-up',       name: 'Step-Up',                seedLb: 20,  seedKg: 7.5,  reps: 10, kit: 'dumbbell', factor: 0.15 },
  // One bell held in both hands. The nearest kit the app models is a dumbbell,
  // whose 5 lb / 2.5 kg floor is a real kettlebell too.
  { id: 'kettlebell-swing', name: 'Kettlebell Swing',       seedLb: 35,  seedKg: 15,   reps: 12, kit: 'dumbbell', factor: 0.25 },
  { id: 'seated-calf-raise', name: 'Seated Calf Raise',      seedLb: 45,  seedKg: 20,   reps: 12, kit: 'machine',  factor: 0.4 },
  { id: 'hip-abduction', name: 'Hip Abduction',          seedLb: 70,  seedKg: 30,   reps: 12, kit: 'machine',  factor: 0.5 },
  { id: 'cable-crunch',  name: 'Cable Crunch',           seedLb: 50,  seedKg: 22.5, reps: 12, kit: 'machine',  factor: 0.3 }
];

/** Everything the app ships knowing about. Seeded into the database. */
export const BUILTIN: SeedExercise[] = [...STARTING_TWELVE, ...MORE_MOVEMENTS, ...WIDER_LIBRARY];

/** Each built-in by id, for lookups that run once per logged set. */
const BY_ID = new Map(BUILTIN.map(e => [e.id, e]));

export interface Prefill { weight: number; reps: number; source: 'history' | 'seed' | 'fallback'; }

/**
 * What to put in the weight and reps fields right now.
 *
 * §4: "An empty number field is a bug." This is the function that guarantees it,
 * and `source` is returned so the UI can tell the user which it is — "last time"
 * is reassuring, a seeded guess should not pretend to be their history.
 */
/**
 * The empty version of each thing: a bar with no plates, the lightest dumbbell,
 * the first pin on a stack. The floor a suggestion can never go below.
 */
export const EQUIPMENT_BASE: Record<Equipment, Record<Unit, number>> = {
  barbell:  { lb: 45, kg: 20 },
  dumbbell: { lb: 5,  kg: 2.5 },
  machine:  { lb: 5,  kg: 2.5 },
  // Zero: for these, weight means what you have STRAPPED ON, and none is the
  // normal case. Flooring them at a plate would open a pull-up at 45 lb.
  bodyweight: { lb: 0, kg: 0 }
};

/**
 * What one plate change is worth, for rounding a suggestion to something
 * loadable.
 *
 * FILED, NOT FIXED (R593, found by R592's own method — tracing a promise like
 * this one to every place it is made rather than trusting one fix covers the
 * class): this is the fixed default, the same way `WEIGHT_STEP` was before
 * R592 taught the coach to prefer `plateJump()` when the lifter has declared
 * something finer. `startingWeight` below carries the identical claim
 * ("rounded to something loadable") for a lift with no history at all, and it
 * has the same blind spot — a lifter on 1.25 kg microplates still gets a
 * first-time suggestion rounded to 2.5. Not fixed here because `prefillFor`,
 * which calls `startingWeight`, is shared with `measure-model.ts` for body
 * measurements (bodyweight, height) where a "plate jump" has no meaning at
 * all — threading a weight-training preference through a function two
 * different domains call needs more care than a parameter rename, unlike
 * R592's single call site in now-model.ts.
 */
const ROUND_TO: Record<Unit, number> = { lb: 5, kg: 2.5 };

/**
 * How strong this person is, expressed as the bench press they would do.
 *
 * Every movement carries a `factor` relative to a bench, so a lift they HAVE
 * trained can be read backwards into a bench-equivalent — a 405 squat implies
 * roughly a 340 bench. Taking the strongest such reading means one heavy lift
 * is enough to calibrate everything else, which is the point: somebody who
 * benches 315 should not be handed an empty bar for their first overhead press.
 *
 * Two kinds of set are not readings (R678), and both inflated the answer, which
 * is the worse direction because the result opens a lift they have never done:
 *   - a movement that does not `calibrate`: one 120 lb hip abduction read as a
 *     290 squat;
 *   - a set at the empty implement's own weight. PT0's first-timer pressed the
 *     bare 45 lb bar, which read as a 105 bench, and was then handed a 150 lb
 *     first deadlift.
 *
 * And a set just above the bar reads as the smaller of two numbers (R678
 * review). Dividing the whole weight by the factor made 50 lb of overhead press
 * a 116 lb bench, and opened a 170 lb first deadlift for someone benching 50.
 * Near the bar most of the weight IS the bar, so the second reading scales only
 * the plates on it. For a lift weaker than the bench that one is smaller; for a
 * stronger lift the whole-weight reading is. Taking the smaller never makes a
 * first set heavier than either would.
 *
 * `history` is in `unit`, which the caller has already converted it to.
 * Returns 0 when they have trained nothing the app can measure against.
 */
export function strengthIndex(history: LoggedSet[], unit: Unit): number {
  let best = 0;
  for (const set of history) {
    const move = BY_ID.get(set.exerciseId);
    if (!move?.calibrates) continue;
    const bar = EQUIPMENT_BASE[move.kit][unit];
    if (set.weight <= bar) continue;
    const asBench = Math.min(set.weight / move.factor, bar + (set.weight - bar) / move.factor);
    if (asBench > best) best = asBench;
  }
  return best;
}

/**
 * What to put on the bar for a lift they have never done.
 *
 * Scaled from what they can already lift, floored at the empty version of
 * whatever it is done on, and rounded to something loadable. With no history at
 * all it IS the floor: an empty barbell, the lightest dumbbell, the first pin.
 *
 * A movement the user INVENTED always gets the floor too, however strong they
 * are — checked directly: a 315 bench still seeds a brand-new custom exercise
 * at 45. Not an oversight: scaling needs the movement's `factor`, and a typed
 * name carries none. Guessing one would mean assuming what the exercise even
 * is — a barbell compound and a single-joint cable movement scale nothing
 * alike — and a wrong guess overshoots, which this file's own rule calls worse
 * than an empty bar. The floor is the one answer that is never actively wrong.
 */
export function startingWeight(
  exerciseId: string, history: LoggedSet[], unit: Unit
): number {
  const move = BUILTIN.find(e => e.id === exerciseId);
  const kit: Equipment = move?.kit ?? 'barbell';
  const floor = EQUIPMENT_BASE[kit][unit];

  const index = strengthIndex(history, unit);
  if (!move || index <= 0) return floor;

  const step = ROUND_TO[unit];
  const scaled = Math.round((index * move.factor) / step) * step;
  return Math.max(floor, scaled);
}

export function prefillFor(
  exerciseId: string, history: LoggedSet[], unit: Unit
): Prefill {
  // Most recent set of this exercise wins — that is the "same as last time"
  // default the entire logging path is built around.
  let latest: LoggedSet | null = null;
  for (const s of history) {
    if (s.exerciseId !== exerciseId) continue;
    if (!latest || s.at > latest.at) latest = s;
  }
  if (latest) return { weight: latest.weight, reps: latest.reps, source: 'history' };

  /*
   * Never trained: start from the empty version of the equipment, scaled by
   * what they can already lift. See `startingWeight`.
   *
   * This has been three things. A fixed per-movement guess (95 lb bench) was
   * wrong for everybody in one direction or the other. Zero was never a claim
   * about them but made every first set of every movement a chore. Scaling is
   * the version that is both: an empty bar is 45 and a dumbbell is 5 whatever
   * happens, and someone who benches 315 gets 135 for their first overhead
   * press instead of an empty bar.
   */
  const seed = BUILTIN.find(e => e.id === exerciseId);
  return {
    weight: startingWeight(exerciseId, history, unit),
    reps: seed?.reps ?? 8,
    source: seed ? 'seed' : 'fallback'
  };
}

/**
 * What the picker shows. Before there is history this is the starting twelve;
 * after, it is their own movements, ranked (§7).
 *
 * Never the full 200-exercise library — that lives behind search, which is the
 * "add a new exercise" path and not what a returning user touches.
 *
 * `library` is every movement the app knows about, names included — the twelve
 * plus anything the user has created. It is optional so the pure §6/§7 rules can
 * still be exercised on their own, but a caller with a database should always
 * pass it, for two reasons that were both live bugs:
 *
 *   - a lift the user CREATED was dropped from every branch of this function.
 *     Before three sessions it returned the twelve verbatim, and after them it
 *     ranked by history, so a new movement was invisible until it had been
 *     trained — and it could not be trained, because selecting it is what this
 *     list is for. Add "Hack Squat", switch away, and it was gone. Telling
 *     someone their movement exists and then never showing it again is worse
 *     than not letting them add one.
 *   - names came from a STARTING_TWELVE-only map with `?? exerciseId` behind
 *     them, so once a custom lift DID have enough history to rank, it appeared
 *     in the sheet as `hack_squat`.
 *
 * The order is: what they have actually trained, ranked; then what they made
 * but have not trained yet; then the generic twelve, which only appears while
 * there is not yet enough history to rank anything.
 */
export function pickerFor(
  history: LoggedSet[], now: number, weekday?: number, size = 12,
  library: Exercise[] = []
): Exercise[] {
  // BUILTIN, not STARTING_TWELVE: anything the app ships is library, and
  // treating the newer movements as user-invented put them in the
  // YOURS group and at the front of a first-run sheet promised to be short.
  const builtin = new Set(BUILTIN.map(e => e.id));
  const names = new Map<string, string>([
    ...STARTING_TWELVE.map(e => [e.id, e.name] as [string, string]),
    ...library.map(e => [e.id, e.name] as [string, string])
  ]);
  /** Movements the user added themselves. These are never dropped. */
  const mine = library.filter(e => !builtin.has(e.id)).map(({ id, name }) => ({ id, name }));
  /*
   * The built-ins this lifter has, when the caller says. `Repo.exercises()` leaves
   * out one their own same-named movement stands in for (R678, D3), and the
   * picker must not offer it back: the second "Front Squat" would split their
   * history in two the first time they logged on it.
   */
  const live = library.length ? new Set(library.map(e => e.id)) : null;
  const offered = (e: { id: string }) => !live || live.has(e.id);

  if (sessionCount(history) < MIN_SESSIONS_FOR_PREDICTION) {
    return [...mine, ...STARTING_TWELVE.filter(offered).map(({ id, name }) => ({ id, name }))];
  }

  const ranked = rankExercises(history, now, weekday)
    .slice(0, size)
    .map(r => ({ id: r.exerciseId, name: names.get(r.exerciseId) ?? r.exerciseId }));

  const listed = new Set(ranked.map(e => e.id));
  /*
   * Then everything else the app knows, untrained included.
   *
   * Without this tail the picker was a list of what you have ALREADY done: past
   * three sessions it returned `rankExercises`, which only ever knows about
   * lifts with history, so a movement you had never tried was unreachable
   * forever. That made the library unusable — the way to start doing leg curls
   * was to have already done leg curls. It is the same trap `mine` was added to
   * fix for custom movements, one step further out.
   *
   * Order matters and is doing the work: what you actually train is ranked
   * first, your own movements next, and the rest of the library behind them —
   * so the common case is unchanged and discovery costs a scroll rather than a
   * different screen. Grouped by day in the sheet, most of this tail is not
   * even on screen until you ask for another day.
   */
  const untrained = BUILTIN
    .filter(e => offered(e) && !listed.has(e.id) && !mine.some(m => m.id === e.id))
    .map(({ id, name }) => ({ id, name }));

  return [...ranked, ...mine.filter(e => !listed.has(e.id)), ...untrained];
}

/**
 * Which unit a new user gets. §8 — "infer lb/kg from device locale."
 *
 * Pounds are the everyday unit for barbell training in the US and, for gym
 * purposes, essentially nowhere else — UK gyms are plated in kilos even though
 * the country weighs people in stone. Liberia and Myanmar are the other two
 * non-metric holdouts and are included for completeness rather than out of any
 * knowledge of their gym culture.
 *
 * Accepts a raw locale tag so this stays pure and testable; the caller supplies
 * whatever the platform reports.
 */
const POUND_REGIONS = new Set(['US', 'LR', 'MM']);

export function inferUnit(locale: string | null | undefined): Unit {
  if (!locale) return 'kg';
  // Handles en-US, en_US, en-Latn-US, und-US and bare US.
  const parts = String(locale).replace(/_/g, '-').split('-');
  for (const part of parts) {
    if (/^[A-Za-z]{2}$/.test(part) && POUND_REGIONS.has(part.toUpperCase())) return 'lb';
  }
  return 'kg';
}

/**
 * The unit a NEW session should use.
 *
 * Three sources, in order of how deliberate they are:
 *
 * 1. **What they CHOSE**, in Settings. Nothing outranks somebody answering the
 *    question directly.
 * 2. **What they last trained in.** A choice made by doing rather than saying,
 *    and still theirs — someone who trains in kilos on a US phone set that up
 *    on purpose, and reverting them to pounds would corrupt the comparison
 *    every prefill and PR depends on.
 * 3. **The locale**, which is a guess and is treated as one.
 *
 * The `chosen` rung was missing, and its absence made the UNITS control in
 * Settings a decoration: it wrote `pref.unit` and **nothing in the app ever
 * read it**. The chips lit up, the conversion example redrew, and every session
 * afterwards started in the old unit for ever, because `lastUsedUnit` is sticky
 * and there was no other way in. Two taps that changed nothing but their own
 * highlight.
 */
export function unitForNewSession(
  previous: Unit | null, locale: string | null | undefined, chosen: Unit | null = null
): Unit {
  return chosen ?? previous ?? inferUnit(locale);
}

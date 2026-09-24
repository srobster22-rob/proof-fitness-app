/**
 * The exercise library: every movement the app ships knowing about, one entry
 * each, with everything the app knows about it. Its name; where it starts a
 * lifter with no history (`seedLb`, `seedKg`, `reps`, `kit`, `factor`,
 * `calibrates`, documented on `SeedExercise`); the push/pull/legs day it is
 * trained on; the muscles it trains; and what else a lifter types for it.
 *
 * The one registry for exercises. `coldstart.ts`'s tiers and `BUILTIN`,
 * `muscles.ts`'s `MUSCLES`, `split.ts`'s day of each lift and
 * `find-exercise.ts`'s aliases are views of it, so a new movement is one entry
 * here and cannot exist in one table and be missing from another.
 */
// TYPES only, never a value: coldstart, muscles and split import this file,
// so a value imported back from one of them is a cycle that fails at load
// ("Cannot access 'EXERCISES' before initialization").
import type { SeedExercise } from './coldstart.ts';
import type { Profile } from './muscles.ts';
import type { SplitDay } from './split.ts';

export interface LibraryExercise extends SeedExercise {
  /** The push/pull/legs day it is trained on (`dayOf`). */
  day: SplitDay;
  /** What it trains (`profileFor`). */
  muscles: Profile;
  /**
   * What a lifter types for it when the library names it another way. Only
   * names that mean ONE movement, because an alias also decides what ADD picks
   * instead of creating: "shoulder press" could be three of them, "flyes" four,
   * and a stiff-leg deadlift is not a Romanian one. Spacing, hyphens and a
   * plural need no entry of their own (`find-exercise.ts`).
   */
  aliases?: readonly string[];
}

/**
 * The starting twelve. Compound movements people actually walk in and do,
 * ordered by how likely a beginner is to be looking for them.
 *
 * `seed` values are deliberately CONSERVATIVE — an untrained adult should be
 * able to complete the set. Overshooting on set one is worse than undershooting:
 * a number that is too heavy is discouraging and possibly unsafe, while one that
 * is too light gets corrected with two taps of a stepper.
 *
 * Days are assigned the conventional way. Deadlift sits on pull rather than
 * legs: it is trained with the back in every common PPL template, and putting
 * it on leg day next to squats is how people end up unable to walk.
 */
export const STARTING: readonly LibraryExercise[] = [
  { id: 'bench', name: 'Bench Press', day: 'push', kit: 'barbell', seedLb: 95, seedKg: 40, reps: 8, factor: 1.0, calibrates: true,
    muscles: { primary: ['chest', 'triceps'], secondary: ['frontdelt'], compound: true }, aliases: ['bench'] },
  { id: 'squat', name: 'Squat', day: 'legs', kit: 'barbell', seedLb: 95, seedKg: 40, reps: 8, factor: 1.2, calibrates: true,
    muscles: { primary: ['quads', 'glutes'], secondary: ['lowerback', 'core'], compound: true } },
  { id: 'deadlift', name: 'Deadlift', day: 'pull', kit: 'barbell', seedLb: 135, seedKg: 60, reps: 5, factor: 1.45, calibrates: true,
    muscles: { primary: ['hamstrings', 'glutes', 'lowerback'], secondary: ['traps', 'lats'], compound: true } },
  { id: 'ohp', name: 'Overhead Press', day: 'push', kit: 'barbell', seedLb: 65, seedKg: 30, reps: 8, factor: 0.43, calibrates: true,
    muscles: { primary: ['frontdelt', 'triceps'], secondary: ['sidedelt', 'core'], compound: true }, aliases: ['ohp', 'military press'] },
  { id: 'row', name: 'Barbell Row', day: 'pull', kit: 'barbell', seedLb: 85, seedKg: 35, reps: 8, factor: 0.65, calibrates: true,
    muscles: { primary: ['lats', 'upperback'], secondary: ['biceps', 'lowerback'], compound: true } },
  { id: 'pulldown', name: 'Lat Pulldown', day: 'pull', kit: 'machine', seedLb: 80, seedKg: 35, reps: 10, factor: 0.55,
    muscles: { primary: ['lats'], secondary: ['biceps'], compound: true } },
  { id: 'dbpress', name: 'DB Bench Press', day: 'push', kit: 'dumbbell', seedLb: 35, seedKg: 15, reps: 10, factor: 0.35,
    muscles: { primary: ['chest', 'triceps'], secondary: ['frontdelt'], compound: true } },
  { id: 'dbrow', name: 'DB Row', day: 'pull', kit: 'dumbbell', seedLb: 35, seedKg: 15, reps: 10, factor: 0.28,
    muscles: { primary: ['lats', 'upperback'], secondary: ['biceps'], compound: true } },
  { id: 'legpress', name: 'Leg Press', day: 'legs', kit: 'machine', seedLb: 180, seedKg: 80, reps: 10, factor: 1.8,
    muscles: { primary: ['quads', 'glutes'], secondary: [], compound: true } },
  { id: 'curl', name: 'Bicep Curl', day: 'pull', kit: 'dumbbell', seedLb: 30, seedKg: 12.5, reps: 10, factor: 0.2,
    muscles: { primary: ['biceps'], secondary: ['forearms'], compound: false } },
  { id: 'triext', name: 'Tricep Extension', day: 'push', kit: 'dumbbell', seedLb: 30, seedKg: 12.5, reps: 12, factor: 0.2,
    muscles: { primary: ['triceps'], secondary: [], compound: false } },
  { id: 'lateral', name: 'Lateral Raise', day: 'push', kit: 'dumbbell', seedLb: 15, seedKg: 7.5, reps: 12, factor: 0.08,
    muscles: { primary: ['sidedelt'], secondary: [], compound: false } }
];

/**
 * The rest of the library.
 *
 * The starting twelve stays exactly twelve because §6 promises a **short** list
 * on first launch — a beginner facing thirty movements is the setup maze §5
 * exists to avoid. These are what everyone else needs once they know what they
 * are doing, and they only reach the first-launch picker once it has history to
 * rank. A day's rail offers them sooner, in this order (see `buildRail`).
 *
 * Chosen for how common they are, not for coverage: every one of these is in
 * an ordinary commercial gym. The bodyweight four (pull-up, chin-up, dip,
 * push-up) are here now that a set's real load counts the lifter's bodyweight
 * (`realLoad`); nothing else is marked bodyweight, because that mark means the
 * whole body is the load.
 *
 * Every movement the app ships knowing about has a day, or the picker cannot
 * file it and it falls into YOURS beside the ones the user invented. Vertical
 * pulling is pull day; dips and push-ups are pressing.
 */
export const MORE: readonly LibraryExercise[] = [
  // push
  { id: 'incline', name: 'Incline Bench Press', day: 'push', kit: 'barbell', seedLb: 65, seedKg: 30, reps: 8, factor: 0.85, calibrates: true,
    muscles: { primary: ['chest', 'frontdelt'], secondary: ['triceps'], compound: true } },
  { id: 'dbohp', name: 'DB Shoulder Press', day: 'push', kit: 'dumbbell', seedLb: 25, seedKg: 10, reps: 10, factor: 0.18,
    muscles: { primary: ['frontdelt', 'triceps'], secondary: ['sidedelt'], compound: true } },
  { id: 'chestpress', name: 'Machine Chest Press', day: 'push', kit: 'machine', seedLb: 70, seedKg: 30, reps: 10, factor: 0.95,
    muscles: { primary: ['chest', 'triceps'], secondary: ['frontdelt'], compound: true } },
  { id: 'fly', name: 'Chest Fly', day: 'push', kit: 'machine', seedLb: 25, seedKg: 10, reps: 12, factor: 0.25,
    muscles: { primary: ['chest'], secondary: [], compound: false }, aliases: ['pec fly'] },
  { id: 'pushdown', name: 'Tricep Pushdown', day: 'push', kit: 'machine', seedLb: 40, seedKg: 20, reps: 12, factor: 0.25,
    muscles: { primary: ['triceps'], secondary: [], compound: false }, aliases: ['rope pushdown'] },

  // pull
  { id: 'cablerow', name: 'Seated Cable Row', day: 'pull', kit: 'machine', seedLb: 80, seedKg: 35, reps: 10, factor: 0.6,
    muscles: { primary: ['lats', 'upperback'], secondary: ['biceps'], compound: true } },
  { id: 'hammer', name: 'Hammer Curl', day: 'pull', kit: 'dumbbell', seedLb: 25, seedKg: 10, reps: 10, factor: 0.2,
    muscles: { primary: ['biceps', 'forearms'], secondary: [], compound: false } },
  { id: 'facepull', name: 'Face Pull', day: 'pull', kit: 'machine', seedLb: 30, seedKg: 12.5, reps: 12, factor: 0.2,
    muscles: { primary: ['reardelt', 'upperback'], secondary: [], compound: false } },
  { id: 'revfly', name: 'Reverse Fly', day: 'pull', kit: 'machine', seedLb: 20, seedKg: 7.5, reps: 12, factor: 0.1,
    muscles: { primary: ['reardelt', 'upperback'], secondary: [], compound: false } },

  /*
   * Bodyweight, and the four most conspicuous absences from a gym library.
   * `factor: 0` because there is nothing to scale — `startingWeight` is added
   * weight, and the honest default for all four is none.
   */
  { id: 'pullup', name: 'Pull-up', day: 'pull', kit: 'bodyweight', seedLb: 0, seedKg: 0, reps: 8, factor: 0,
    muscles: { primary: ['lats'], secondary: ['biceps'], compound: true } },
  { id: 'chinup', name: 'Chin-up', day: 'pull', kit: 'bodyweight', seedLb: 0, seedKg: 0, reps: 8, factor: 0,
    muscles: { primary: ['lats', 'biceps'], secondary: [], compound: true } },
  { id: 'dip', name: 'Dip', day: 'push', kit: 'bodyweight', seedLb: 0, seedKg: 0, reps: 8, factor: 0,
    muscles: { primary: ['chest', 'triceps'], secondary: ['frontdelt'], compound: true } },
  { id: 'pushup', name: 'Push-up', day: 'push', kit: 'bodyweight', seedLb: 0, seedKg: 0, reps: 12, factor: 0,
    muscles: { primary: ['chest', 'triceps'], secondary: ['frontdelt', 'core'], compound: true } },

  // pull
  { id: 'shrug', name: 'Shrug', day: 'pull', kit: 'barbell', seedLb: 95, seedKg: 40, reps: 12, factor: 0.8,
    muscles: { primary: ['traps'], secondary: ['forearms'], compound: false } },

  // legs
  { id: 'rdl', name: 'Romanian Deadlift', day: 'legs', kit: 'barbell', seedLb: 95, seedKg: 40, reps: 8, factor: 1.1, calibrates: true,
    muscles: { primary: ['hamstrings', 'glutes'], secondary: ['lowerback'], compound: true }, aliases: ['rdl'] },
  { id: 'hipthrust', name: 'Hip Thrust', day: 'legs', kit: 'barbell', seedLb: 135, seedKg: 60, reps: 10, factor: 1.3,
    muscles: { primary: ['glutes', 'hamstrings'], secondary: [], compound: true } },
  { id: 'legcurl', name: 'Leg Curl', day: 'legs', kit: 'machine', seedLb: 50, seedKg: 25, reps: 12, factor: 0.4,
    muscles: { primary: ['hamstrings'], secondary: [], compound: false } },
  { id: 'legext', name: 'Leg Extension', day: 'legs', kit: 'machine', seedLb: 50, seedKg: 25, reps: 12, factor: 0.45,
    muscles: { primary: ['quads'], secondary: [], compound: false } },
  { id: 'lunge', name: 'Lunge', day: 'legs', kit: 'dumbbell', seedLb: 30, seedKg: 12.5, reps: 10, factor: 0.25,
    muscles: { primary: ['quads', 'glutes'], secondary: ['core'], compound: true } },
  { id: 'calf', name: 'Calf Raise', day: 'legs', kit: 'machine', seedLb: 90, seedKg: 40, reps: 12, factor: 0.6,
    muscles: { primary: ['calves'], secondary: [], compound: false } }
];

/**
 * The rest of what an ordinary commercial gym has.
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
 * Filed on the days the lists above file their kind. Floor-pulled deadlifts are
 * pull day with the conventional one, sumo and trap bar alike (see the deadlift
 * note above). Direct core work has no pushing or pulling day, and leg day is
 * where most push/pull/legs programmes put it.
 *
 * Ids are hyphenated on purpose. A custom exercise's id is a slug of
 * `[a-z0-9_]`, so none a lifter already made can hold one of these.
 */
export const WIDER: readonly LibraryExercise[] = [
  // push
  { id: 'close-grip-bench', name: 'Close-Grip Bench Press', day: 'push', kit: 'barbell', seedLb: 65, seedKg: 30, reps: 8, factor: 0.85, calibrates: true,
    muscles: { primary: ['triceps', 'chest'], secondary: ['frontdelt'], compound: true } },
  { id: 'incline-db-press', name: 'Incline DB Press', day: 'push', kit: 'dumbbell', seedLb: 30, seedKg: 12.5, reps: 10, factor: 0.3,
    muscles: { primary: ['chest', 'frontdelt'], secondary: ['triceps'], compound: true } },
  { id: 'machine-shoulder-press', name: 'Machine Shoulder Press', day: 'push', kit: 'machine', seedLb: 50, seedKg: 22.5, reps: 10, factor: 0.45,
    muscles: { primary: ['frontdelt', 'triceps'], secondary: ['sidedelt'], compound: true } },
  { id: 'arnold-press', name: 'Arnold Press', day: 'push', kit: 'dumbbell', seedLb: 20, seedKg: 7.5, reps: 10, factor: 0.15,
    muscles: { primary: ['frontdelt', 'sidedelt'], secondary: ['triceps'], compound: true } },
  { id: 'skull-crusher', name: 'Skull Crusher', day: 'push', kit: 'dumbbell', seedLb: 20, seedKg: 7.5, reps: 10, factor: 0.15,
    muscles: { primary: ['triceps'], secondary: [], compound: false }, aliases: ['skullcrusher', 'lying tricep extension'] },
  { id: 'cable-fly', name: 'Cable Fly', day: 'push', kit: 'machine', seedLb: 15, seedKg: 7.5, reps: 12, factor: 0.15,
    muscles: { primary: ['chest'], secondary: [], compound: false } },
  { id: 'db-fly', name: 'DB Fly', day: 'push', kit: 'dumbbell', seedLb: 15, seedKg: 7.5, reps: 12, factor: 0.1,
    muscles: { primary: ['chest'], secondary: [], compound: false } },
  { id: 'front-raise', name: 'Front Raise', day: 'push', kit: 'dumbbell', seedLb: 15, seedKg: 7.5, reps: 12, factor: 0.08,
    muscles: { primary: ['frontdelt'], secondary: [], compound: false } },
  { id: 'cable-lateral-raise', name: 'Cable Lateral Raise', day: 'push', kit: 'machine', seedLb: 10, seedKg: 5, reps: 12, factor: 0.08,
    muscles: { primary: ['sidedelt'], secondary: [], compound: false } },

  // pull
  { id: 't-bar-row', name: 'T-Bar Row', day: 'pull', kit: 'barbell', seedLb: 70, seedKg: 30, reps: 8, factor: 0.6,
    muscles: { primary: ['lats', 'upperback'], secondary: ['biceps', 'lowerback'], compound: true } },
  { id: 'machine-row', name: 'Machine Row', day: 'pull', kit: 'machine', seedLb: 70, seedKg: 30, reps: 10, factor: 0.55,
    muscles: { primary: ['upperback', 'lats'], secondary: ['biceps'], compound: true } },
  { id: 'sumo-deadlift', name: 'Sumo Deadlift', day: 'pull', kit: 'barbell', seedLb: 135, seedKg: 60, reps: 5, factor: 1.4, calibrates: true,
    muscles: { primary: ['glutes', 'hamstrings', 'quads'], secondary: ['lowerback', 'traps'], compound: true } },
  { id: 'rack-pull', name: 'Rack Pull', day: 'pull', kit: 'barbell', seedLb: 135, seedKg: 60, reps: 5, factor: 1.5,
    muscles: { primary: ['upperback', 'traps', 'lowerback'], secondary: ['glutes', 'hamstrings', 'lats', 'forearms'], compound: true } },
  { id: 'straight-arm-pulldown', name: 'Straight-Arm Pulldown', day: 'pull', kit: 'machine', seedLb: 30, seedKg: 12.5, reps: 12, factor: 0.2,
    muscles: { primary: ['lats'], secondary: [], compound: false } },
  { id: 'barbell-curl', name: 'Barbell Curl', day: 'pull', kit: 'barbell', seedLb: 45, seedKg: 20, reps: 10, factor: 0.25,
    muscles: { primary: ['biceps'], secondary: ['forearms'], compound: false } },
  { id: 'cable-curl', name: 'Cable Curl', day: 'pull', kit: 'machine', seedLb: 30, seedKg: 12.5, reps: 12, factor: 0.2,
    muscles: { primary: ['biceps'], secondary: [], compound: false } },
  { id: 'preacher-curl', name: 'Preacher Curl', day: 'pull', kit: 'machine', seedLb: 30, seedKg: 12.5, reps: 10, factor: 0.18,
    muscles: { primary: ['biceps'], secondary: [], compound: false } },

  // legs
  { id: 'front-squat', name: 'Front Squat', day: 'legs', kit: 'barbell', seedLb: 75, seedKg: 35, reps: 5, factor: 0.85, calibrates: true,
    muscles: { primary: ['quads', 'glutes'], secondary: ['core', 'upperback'], compound: true } },
  { id: 'hack-squat', name: 'Hack Squat', day: 'legs', kit: 'machine', seedLb: 90, seedKg: 40, reps: 10, factor: 1,
    muscles: { primary: ['quads', 'glutes'], secondary: [], compound: true } },
  { id: 'trap-bar-deadlift', name: 'Trap Bar Deadlift', day: 'pull', kit: 'barbell', seedLb: 135, seedKg: 60, reps: 5, factor: 1.45, calibrates: true,
    muscles: { primary: ['quads', 'glutes', 'hamstrings'], secondary: ['lowerback', 'traps'], compound: true } },
  { id: 'goblet-squat', name: 'Goblet Squat', day: 'legs', kit: 'dumbbell', seedLb: 35, seedKg: 15, reps: 10, factor: 0.25,
    muscles: { primary: ['quads', 'glutes'], secondary: ['core'], compound: true } },
  { id: 'bulgarian-split-squat', name: 'Bulgarian Split Squat', day: 'legs', kit: 'dumbbell', seedLb: 20, seedKg: 7.5, reps: 10, factor: 0.15,
    muscles: { primary: ['quads', 'glutes'], secondary: ['core'], compound: true }, aliases: ['bss'] },
  { id: 'good-morning', name: 'Good Morning', day: 'legs', kit: 'barbell', seedLb: 65, seedKg: 30, reps: 10, factor: 0.5,
    muscles: { primary: ['hamstrings', 'lowerback'], secondary: ['glutes'], compound: true } },
  { id: 'step-up', name: 'Step-Up', day: 'legs', kit: 'dumbbell', seedLb: 20, seedKg: 7.5, reps: 10, factor: 0.15,
    muscles: { primary: ['quads', 'glutes'], secondary: [], compound: true } },
  // One bell held in both hands. The nearest kit the app models is a dumbbell,
  // whose 5 lb / 2.5 kg floor is a real kettlebell too.
  { id: 'kettlebell-swing', name: 'Kettlebell Swing', day: 'legs', kit: 'dumbbell', seedLb: 35, seedKg: 15, reps: 12, factor: 0.25,
    muscles: { primary: ['glutes', 'hamstrings'], secondary: ['lowerback', 'core'], compound: true }, aliases: ['kb swing'] },
  { id: 'seated-calf-raise', name: 'Seated Calf Raise', day: 'legs', kit: 'machine', seedLb: 45, seedKg: 20, reps: 12, factor: 0.4,
    muscles: { primary: ['calves'], secondary: [], compound: false } },
  { id: 'hip-abduction', name: 'Hip Abduction', day: 'legs', kit: 'machine', seedLb: 70, seedKg: 30, reps: 12, factor: 0.5,
    muscles: { primary: ['glutes'], secondary: [], compound: false } },
  { id: 'cable-crunch', name: 'Cable Crunch', day: 'legs', kit: 'machine', seedLb: 50, seedKg: 22.5, reps: 12, factor: 0.3,
    muscles: { primary: ['core'], secondary: [], compound: false } }
];

/** The whole library, in the order a lifter with no history meets it. */
export const EXERCISES: readonly LibraryExercise[] = [...STARTING, ...MORE, ...WIDER];

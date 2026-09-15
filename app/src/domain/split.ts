import type { Exercise } from './types.ts';

/**
 * Splits — what goes with what. PROMPT.md §6 and §7.
 *
 * §17's gate, answered before this was written:
 *
 *   Does it add a tap to the logging path?  No. It changes what the picker
 *   shows and what UP NEXT suggests; both already exist and neither gains a
 *   step. The one-tap repeat is untouched.
 *
 *   Does it serve first-run friction or shareable output?  First-run friction,
 *   squarely. §7 is a prediction problem and the predictor needs three sessions
 *   before it will say anything (`MIN_SESSIONS_FOR_PREDICTION`) — so the people
 *   with no idea what to do next are exactly the people the app currently tells
 *   nothing. On a first-ever workout UP NEXT was literally blank: rank the
 *   history, remove what you have already done, and for a beginner that is the
 *   empty set.
 *
 *   What is being removed to make room?  The picker's flat alphabet-soup
 *   ordering. It was a list of twelve in a fixed order with no reason behind it;
 *   it becomes three named groups, and the group you are training leads.
 *
 * Why push/pull/legs and not something cleverer: it is the split most lifters
 * actually run, it partitions the starting twelve cleanly, and every movement
 * belongs to exactly one day. Upper/lower falls out of it for free (upper =
 * push + pull) if that is ever wanted. A routine builder is a different product
 * and §5 does not have room for one.
 *
 * This is PRIOR knowledge, deliberately weaker than evidence. Once someone has
 * trained enough for §7 to rank their own movements, their real pattern wins —
 * a person who squats on push day is not wrong, and the app should not correct
 * them.
 */

export type SplitDay = 'push' | 'pull' | 'legs';

export const SPLIT_DAYS: SplitDay[] = ['push', 'pull', 'legs'];

/**
 * Which routine the user is running.
 *
 * Push/pull/legs is the base because it partitions the library cleanly and
 * every movement belongs to exactly one day. The others are **derived from it**
 * rather than modelled separately, which is what this file predicted from the
 * start: upper is push + pull, lower is legs, and full body is all three. That
 * is why adding two more splits costs a lookup table rather than a routine
 * builder — §5 has no room for one of those and still does not.
 */
export type SplitPlan = 'ppl' | 'upper-lower' | 'full';

export const SPLIT_PLANS: SplitPlan[] = ['ppl', 'upper-lower', 'full'];

export const PLAN_LABEL: Record<SplitPlan, string> = {
  ppl: 'PUSH / PULL / LEGS',
  'upper-lower': 'UPPER / LOWER',
  full: 'FULL BODY'
};

/**
 * The same three, said in words someone who has never lifted can act on.
 *
 * The labels above are gym vocabulary. On a first-ever launch this is the first
 * screen of the app, and asking "what split do you run" of somebody who has
 * never trained is exactly the "made to feel stupid" the loop's second rule
 * names — they cannot answer it, and there is nothing behind it they can see to
 * work it out from. So each one says what it actually means in days and body
 * parts, and the answer becomes a choice rather than a test.
 */
export const PLAN_BLURB: Record<SplitPlan, string> = {
  ppl: 'Three days. Chest and shoulders, then back and arms, then legs.',
  'upper-lower': 'Two days. Push and pull work together, then legs.',
  full: 'One day. A bit of everything, every time you train.'
};

/** A day of whichever plan is being run. `full` has exactly one. */
export type PlanDay = SplitDay | 'upper' | 'lower' | 'full';

/** Which PPL days each plan-day covers. The whole derivation lives here. */
export const PLAN_DAY_COVERS: Record<PlanDay, SplitDay[]> = {
  push: ['push'],
  pull: ['pull'],
  legs: ['legs'],
  upper: ['push', 'pull'],
  lower: ['legs'],
  full: ['push', 'pull', 'legs']
};

export const PLAN_DAYS: Record<SplitPlan, PlanDay[]> = {
  ppl: ['push', 'pull', 'legs'],
  'upper-lower': ['upper', 'lower'],
  full: ['full']
};

export const PLAN_DAY_LABEL: Record<PlanDay, string> = {
  push: 'PUSH', pull: 'PULL', legs: 'LEGS',
  upper: 'UPPER', lower: 'LOWER', full: 'FULL BODY'
};

/**
 * What the day's rail of lifts is called, on the logging screen.
 *
 * It used to read just "PUSH DAY", which names the day but not what the row
 * under it is FOR — the report was "there's a next button, but it doesn't
 * really imply what's next". So the heading does both jobs: it says these are
 * what comes next, and it says exactly which day you are on.
 *
 * Written out per day rather than composed from PLAN_DAY_LABEL, because the
 * English does not compose: "LEGS DAY" and "FULL BODY DAY" are not what anyone
 * calls them.
 */
export const DAY_HEADING: Record<PlanDay, string> = {
  push: 'NEXT ON PUSH DAY',
  pull: 'NEXT ON PULL DAY',
  legs: 'NEXT ON LEG DAY',
  upper: 'NEXT ON UPPER DAY',
  lower: 'NEXT ON LOWER DAY',
  full: 'NEXT IN FULL BODY TODAY'
};

/** Is this movement part of the given day of the given plan? */
export function inPlanDay(exerciseId: string, day: PlanDay): boolean {
  const base = dayOf(exerciseId);
  return base !== null && PLAN_DAY_COVERS[day].includes(base);
}

/**
 * The plan-day a PPL day belongs to — how a session whose day was INFERRED from
 * what got trained is reported back in the user's own vocabulary. Someone on
 * upper/lower who benches has trained "upper", not "push".
 */
export function planDayFor(day: SplitDay | null, plan: SplitPlan): PlanDay | null {
  if (day === null) return null;
  return PLAN_DAYS[plan].find(d => PLAN_DAY_COVERS[d].includes(day)) ?? null;
}

export const SPLIT_LABEL: Record<SplitDay, string> = {
  push: 'PUSH',
  pull: 'PULL',
  legs: 'LEGS'
};

/**
 * The starting twelve, assigned the conventional way.
 *
 * Deadlift sits on pull rather than legs: it is trained with the back in every
 * common PPL template, and putting it on leg day next to squats is how people
 * end up unable to walk.
 */
const DAY_OF: Record<string, SplitDay> = {
  bench: 'push',
  ohp: 'push',
  dbpress: 'push',
  triext: 'push',
  lateral: 'push',

  deadlift: 'pull',
  row: 'pull',
  pulldown: 'pull',
  dbrow: 'pull',
  curl: 'pull',

  squat: 'legs',
  legpress: 'legs',

  // The rest of the library (`MORE_MOVEMENTS`). Every movement the app ships
  // knowing about has a day, or the picker cannot file it and it falls into
  // YOURS beside the ones the user invented.
  incline: 'push',
  dbohp: 'push',
  chestpress: 'push',
  fly: 'push',
  pushdown: 'push',

  cablerow: 'pull',
  hammer: 'pull',
  facepull: 'pull',
  revfly: 'pull',
  // Vertical pulling is pull day; dips and push-ups are pressing.
  pullup: 'pull',
  chinup: 'pull',
  dip: 'push',
  pushup: 'push',
  shrug: 'pull',

  rdl: 'legs',
  hipthrust: 'legs',
  legcurl: 'legs',
  legext: 'legs',
  lunge: 'legs',
  calf: 'legs'
};

/** Which day a movement belongs to, or null for one the user invented. */
export function dayOf(exerciseId: string): SplitDay | null {
  return DAY_OF[exerciseId] ?? null;
}

/**
 * Which day the session in progress is, judged by what has been trained.
 *
 * Majority wins, so a stray accessory cannot rename the workout — bench, press,
 * curl is still a push day. Null until something recognisable has been logged,
 * because guessing a day from nothing is how you end up recommending bench
 * press to someone mid-squat.
 *
 * `prefer` breaks ties, and callers pass the lift the user is ON. Ties are
 * common early — one set of bench then one of squats is 1–1 — and breaking them
 * toward what was trained first put the app in the position of labelling the
 * screen PUSH DAY, and leading the picker with push movements, while the user
 * sat looking at SQUAT. The sheet is opened to choose what comes next, so what
 * you are doing right now is the better tiebreak than what you opened with.
 */
export function sessionDay(exerciseIds: string[], prefer?: SplitDay | null): SplitDay | null {
  const count = new Map<SplitDay, number>();
  let first: SplitDay | null = null;

  for (const id of exerciseIds) {
    const day = dayOf(id);
    if (!day) continue;
    if (!first) first = day;
    count.set(day, (count.get(day) ?? 0) + 1);
  }
  if (!first) return null;

  const at = (d: SplitDay) => count.get(d) ?? 0;
  let best = prefer && at(prefer) > 0 ? prefer : first;
  for (const day of SPLIT_DAYS) {
    if (at(day) > at(best)) best = day;
  }
  return best;
}

/**
 * Which plan they run, from the same pref `NowModel.plan()` reads.
 *
 * Pulled out to its own function so a lifter's plan can be read anywhere that
 * has a repo, not only from `NowModel` — `sessionTitle` needs it and is a pure
 * domain function with no model of its own. PPL until they say otherwise, same
 * default as everywhere else this pref is read.
 */
export function planOf(repo: { getPref(key: string): string | null }): SplitPlan {
  const saved = repo.getPref('split.plan');
  return saved === 'upper-lower' || saved === 'full' || saved === 'ppl' ? saved : 'ppl';
}

/**
 * `sessionDay`, bucketed at the granularity the LIFTER thinks in rather than
 * the granularity the domain tracks internally.
 *
 * The difference matters exactly when it doesn't for PPL: `sessionDay` counts
 * push/pull/legs and majority-wins works fine there because a PPL day IS one
 * of those three. An upper/lower lifter's "upper" day is push AND pull by
 * `PLAN_DAY_COVERS`, so counting at the push/pull/legs level splits a single
 * upper session's votes across two buckets — bench(push) + row(pull) reads as
 * a 1-1 tie with squat(legs), when it is really two-out-of-three FOR upper.
 * Bucketing by the lifter's own plan-day before taking a majority is the fix.
 */
export function sessionPlanDay(
  exerciseIds: string[], plan: SplitPlan, prefer?: SplitDay | null
): PlanDay | null {
  const preferPlanDay = prefer ? planDayFor(prefer, plan) : null;
  const count = new Map<PlanDay, number>();
  let first: PlanDay | null = null;

  for (const id of exerciseIds) {
    const day = planDayFor(dayOf(id), plan);
    if (!day) continue;
    if (!first) first = day;
    count.set(day, (count.get(day) ?? 0) + 1);
  }
  if (!first) return null;

  const at = (d: PlanDay) => count.get(d) ?? 0;
  let best = preferPlanDay && at(preferPlanDay) > 0 ? preferPlanDay : first;
  for (const day of PLAN_DAYS[plan]) {
    if (at(day) > at(best)) best = day;
  }
  return best;
}

export interface SplitGroup {
  day: SplitDay | null;
  label: string;
  exercises: Exercise[];
}

/**
 * The picker, grouped — "the common exercises that go with your split".
 *
 * `lead` is put first so the day being trained is what the sheet opens on;
 * everything else stays visible below it, because a grouped list that hides the
 * other groups is a filter, and a filter on the exercise picker is one more
 * thing to discover and get stuck in.
 *
 * Movements the user created keep their own group at the end rather than being
 * guessed at. Their split is not knowable and inventing one would be the same
 * class of mistake as labelling a custom lift with its slug.
 */
export function groupBySplit(
  exercises: Exercise[], lead: SplitDay | 'yours' | null
): SplitGroup[] {
  const byDay = new Map<SplitDay, Exercise[]>(SPLIT_DAYS.map(d => [d, []]));
  const mine: Exercise[] = [];

  for (const e of exercises) {
    const day = dayOf(e.id);
    if (day) byDay.get(day)!.push(e);
    else mine.push(e);
  }

  const leadDay = lead === 'yours' ? null : lead;
  const order = leadDay ? [leadDay, ...SPLIT_DAYS.filter(d => d !== leadDay)] : SPLIT_DAYS;
  const groups: SplitGroup[] = order
    .map(day => ({ day, label: SPLIT_LABEL[day], exercises: byDay.get(day)! }))
    .filter(g => g.exercises.length > 0);

  if (!mine.length) return groups;
  const yours: SplitGroup = { day: null, label: 'YOURS', exercises: mine };
  // `lead: 'yours'` means the user is ON a movement they invented. It has no
  // day, so it lands in this group — and at the bottom of the sheet, which is
  // where the lift you are currently training is the one thing that must not
  // be: opening the picker on "Hack Squat" put the selected row at y 1098 on an
  // 812px screen, below the fold and invisible, with nothing on screen marked.
  return lead === 'yours' ? [yours, ...groups] : [...groups, yours];
}

/**
 * What to train next on this day, knowing nothing about the person.
 *
 * The fallback for §7 when there is no history to rank — which on a first-ever
 * workout is every user. `suggestNext` used to return null there: it ranks the
 * history, removes what has already been trained, and for a beginner three sets
 * into their first session that is the empty set. UP NEXT was blank for exactly
 * the person who did not know what to do next.
 *
 * Order within a day is the conventional one: the big compound first, isolation
 * last, which is the order the seed list is already in.
 */
export function companionFor(
  day: SplitDay | null, done: string[], library: Exercise[]
): string | null {
  if (!day) return null;
  const already = new Set(done);
  const candidate = library.find(e => dayOf(e.id) === day && !already.has(e.id));
  return candidate?.id ?? null;
}

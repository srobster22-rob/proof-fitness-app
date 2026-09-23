import type { LoggedSet, Session, Exercise, PersonalRecord, Unit } from './types.ts';
import { heaviestEver, loadOf, rank, e1rm } from './pr.ts';
import { loadLabel } from './types.ts';
import { sessionPlanDay, type SplitPlan } from './split.ts';
import { t, DAY_TITLE_KEY, MONTHS_SHORT, DAYS_SHORT, type Language } from './i18n.ts';
import { realLoad, CARRIES_BODYWEIGHT, type Measurement } from './measure.ts';

/**
 * Session lifecycle and recap assembly. PROMPT.md §8, §10.
 */

/** §8: people forget to press stop. */
export const IDLE_END_MS = 90 * 60_000;
const DAY_MS = 86_400_000;

export function lastSetAt(sets: LoggedSet[]): number | null {
  let last: number | null = null;
  for (const s of sets) if (last === null || s.at > last) last = s.at;
  return last;
}

/**
 * A workout ended moments ago and the next has not started (R679): nothing is
 * logged in the live session, and the last set anywhere is under `IDLE_END_MS`
 * old, the span after which a workout already counts as over.
 *
 * DONE on the recap begins the next session at once, and its "TODAY IS" sheet
 * covered the tab bar: someone who had just finished and wanted Progress or
 * Goals had to answer for a workout they had not started (PT0). The next
 * workout is still asked, when they come back to train.
 *
 * `allSets` is oldest first, as `Repo.allSets()` returns it, so this reads one
 * set rather than scanning a year of them on every render.
 */
export function justFinished(
  allSets: readonly LoggedSet[], sessionSets: readonly LoggedSet[], now: number
): boolean {
  if (sessionSets.length) return false;
  const last = allSets[allSets.length - 1];
  return last !== undefined && now - last.at < IDLE_END_MS;
}

/**
 * The moment to measure idleness FROM — the last set, or the row's own last
 * touch, whichever is later.
 *
 * Almost always the last set: `logSet` never rewrites the session row, so
 * `updatedAt` sits at whenever the session started or was last reopened
 * while sets keep landing after it. It only wins right after `reopenSession`
 * — which touches the row and nothing else — on a session whose last SET is
 * old enough to already be stale. Without this, editing a workout from
 * earlier today re-triggered the idle rule on the very next read: reopen,
 * `isStale` asks "when was the last set", gets an old answer, and the
 * session that was just reopened closes itself again before the correction
 * ever lands. `updatedAt` is the only signal that says "someone just did
 * something here", so the idle rule has to consider it.
 */
function lastTouch(session: Session, sets: LoggedSet[]): number {
  return Math.max(lastSetAt(sets) ?? session.startedAt, session.updatedAt);
}

/**
 * Close a session that has gone quiet, backdating to the final set.
 *
 * Backdating matters: a session left open overnight must not report a nine-hour
 * duration on a recap the user is about to send.
 */
export function autoEnd(session: Session, sets: LoggedSet[], now: number): Session {
  if (session.endedAt !== null) return session;
  if (now - lastTouch(session, sets) < IDLE_END_MS) return session;
  return { ...session, endedAt: lastSetAt(sets) ?? session.startedAt };
}

export function isStale(session: Session, sets: LoggedSet[], now: number): boolean {
  if (session.endedAt !== null) return false;
  return now - lastTouch(session, sets) >= IDLE_END_MS;
}

/**
 * Which LOCAL calendar week a timestamp falls in, Monday-start.
 *
 * This was `Math.floor(at / WEEK_MS)`, and the comment calling that
 * "midnight-aligned" was only true in UTC. Epoch day 0 was a **Thursday**, so
 * the bucket edge landed at Thursday 00:00 UTC — Wednesday 5pm in California,
 * 8pm on the east coast, which is prime gym time. Two wrong answers followed:
 *
 *   - **over-count.** Two sets two hours apart on one Wednesday evening
 *     straddled the edge and read as a 2-week streak, on a fresh install. That
 *     number reaches the card AND the share message, so the app announced a
 *     habit the user had not formed.
 *   - **under-count.** A fixed 7-day ruler is not a calendar: sessions on three
 *     consecutive local Wednesdays an hour apart in the day skipped a bucket
 *     and returned 2, breaking a streak the user had genuinely earned.
 *
 * §10 defines the streak against calendar weeks — "instead of resetting every
 * Monday" — so Monday is the week start, and the rest of the app already reads
 * LOCAL dates (`new Date(now).getDay()` drives the split), which this now
 * matches instead of contradicting.
 *
 * The day number comes from `Date.UTC` applied to LOCAL calendar fields: that
 * is immune to DST, because the arithmetic never crosses a clock that moves.
 */
export function weekIndex(at: number): number {
  const d = new Date(at);
  const day = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
  // Epoch day 0 is Thursday 1 Jan 1970, so +3 puts a Monday at each boundary.
  return Math.floor((day + 3) / 7);
}

/**
 * Consecutive weeks containing at least one session. §10 — "counts training
 * days not app opens".
 *
 * Weeks rather than days, because nobody trains 365 days a year and a daily
 * streak would break constantly and mean nothing. The current week is a GRACE
 * period: it is not yet a miss, so the count resumes from the last trained week
 * rather than resetting the moment a new week starts.
 */
/**
 * The set of week indices this history touches, keyed on the exact array it
 * was built from.
 *
 * `weekStreak` runs inside `state()`, which runs on every tap, and both it and
 * `longestStreakBefore` walk the WHOLE history to build the same set of weeks.
 * Measured at 14,000 sets: 3.84 ms and 2.70 ms, the two largest remaining costs
 * on the logging path and the one full walk R495's collapse cache never
 * covered -- its buckets are exercises, these are weeks.
 *
 * Sound for the same reason R495's is, and only for that reason: `Repo.allSets`
 * returns a FROZEN array and drops its memo on every write, so a new object is
 * handed out exactly when the contents could have changed. Identity is
 * therefore a safe key. The length check is for callers that build their own
 * array -- cheap, and it catches the one in-place edit a caller might make.
 *
 * `now` is deliberately NOT part of the key: what is cached is which weeks were
 * trained, which is a property of the sets alone. Both callers compare that
 * against their own clock afterwards, so a cached entry cannot freeze a streak
 * as the weeks roll over.
 */
let lastSets: LoggedSet[] | null = null;
let lastLength = -1;
let lastWeeks: Set<number> | null = null;

function trainedWeeks(sets: LoggedSet[]): Set<number> {
  if (sets === lastSets && sets.length === lastLength && lastWeeks) return lastWeeks;
  const weeks = new Set<number>();
  for (const s of sets) weeks.add(weekIndex(s.at));
  lastSets = sets;
  lastLength = sets.length;
  lastWeeks = weeks;
  return weeks;
}

export function weekStreak(sets: LoggedSet[], now: number): number {
  if (sets.length === 0) return 0;
  const weeks = trainedWeeks(sets);

  const thisWeek = weekIndex(now);
  let cursor = weeks.has(thisWeek) ? thisWeek : thisWeek - 1;
  if (!weeks.has(cursor)) return 0;

  let streak = 0;
  while (weeks.has(cursor)) { streak++; cursor--; }
  return streak;
}

/**
 * The longest run of consecutive trained weeks BEFORE the one `weekStreak` is
 * currently counting — the bar this week's own streak has to clear to be a
 * record, not the record itself.
 *
 * Deliberately excludes the current run rather than returning the all-time
 * max including it, because "is this a new record" needs to compare the
 * streak being lived right now against everything that came before it. Taking
 * the plain historical max would make week 9 of a lifter's ONLY 9-week streak
 * read as tied with itself — true but useless, since nothing has actually
 * been broken.
 *
 * Same week-grace behaviour as `weekStreak`: the current run is whichever one
 * contains this week or last week, so a user who trained this week and last
 * week and the week before is walking a 3-week run, and only weeks earlier
 * than that count toward what they have to beat.
 */
export function longestStreakBefore(sets: LoggedSet[], now: number): number {
  if (sets.length === 0) return 0;
  const weekSet = trainedWeeks(sets);
  const weeks = [...weekSet].sort((a, b) => a - b);

  const thisWeek = weekIndex(now);
  const cursor = weekSet.has(thisWeek) ? thisWeek : thisWeek - 1;
  const isCurrent = weekSet.has(cursor);

  // Group into [start, end] runs first, THEN find which whole run the current
  // one is — not just which single week matches `cursor`. A run several weeks
  // long has `cursor` as only its last week; comparing week-by-week would
  // leave every earlier week of that same run eligible to count toward
  // "before", double-counting the streak being measured against itself.
  const runs: Array<[number, number]> = [];
  for (const w of weeks) {
    const last = runs[runs.length - 1];
    if (last && w === last[1] + 1) last[1] = w;
    else runs.push([w, w]);
  }

  let best = 0;
  for (const [start, end] of runs) {
    if (isCurrent && start <= cursor && cursor <= end) continue;
    best = Math.max(best, end - start + 1);
  }
  return best;
}

export interface SessionStats {
  volume: number;
  /**
   * Whether `volume` is a fact or a floor.
   *
   * False when the session contains work whose load the app genuinely does not
   * know — bodyweight movements logged before the lifter ever recorded a
   * bodyweight, where `realLoad` correctly abstains (see its note) and the
   * `?? s.weight` fallback below turns that abstention into a 0.
   *
   * Walked on a cold database: twelve push-ups, and the recap — the artifact
   * §5 judges the whole product on — read **TOTAL VOLUME 0 LB**. That is not
   * a small number, it is a false one, and `sessionStats`'s own history says
   * so: R141 fixed this for sets that HAVE a reading behind them, with the
   * note that "a workout that says you moved nothing is worse than one that
   * says nothing at all". The case with no reading at all was left printing
   * the zero.
   *
   * So the number stays (it is still the honest floor — the weight actually
   * added, which for a push-up is none) and this says whether it can be shown
   * as a total. A surface that cannot express "unknown" should show nothing
   * rather than the zero.
   */
  volumeKnown: boolean;
  setCount: number;
  durationMs: number;
  exerciseIds: string[];
}

/**
 * @param measurements Optional. When supplied, the four movements whose load is
 *   the lifter count what they ACTUALLY moved instead of only the weight added.
 *
 *   Measured on the running app: a session of two pull-ups reported "TOTAL
 *   VOLUME 0 LB" on the recap — the artifact this whole product is judged on —
 *   because the sets were logged at 0 and 0 x 8 is 0. A workout that says you
 *   moved nothing is worse than one that says nothing at all.
 *
 *   Optional rather than required so every existing caller and every test that
 *   does not care about bodyweight keeps working unchanged, and so the answer
 *   degrades to the old one when there is no reading rather than throwing.
 */
export function sessionStats(
  session: Session, sets: LoggedSet[], measurements: readonly Measurement[] = []
): SessionStats {
  let volume = 0;
  let volumeKnown = true;
  const order: string[] = [];
  const seen = new Set<string>();
  for (const s of sets) {
    const real = measurements.length ? realLoad(s, measurements, session.unit) : null;
    // A movement whose load IS the lifter, with no reading to say what that
    // was. `s.weight` is the weight added — 0 for a strict set — so the sum
    // below is a floor, not a total. See `volumeKnown`.
    if (!real && CARRIES_BODYWEIGHT.has(s.exerciseId)) volumeKnown = false;
    volume += (real?.load ?? s.weight) * s.reps;
    if (!seen.has(s.exerciseId)) { seen.add(s.exerciseId); order.push(s.exerciseId); }
  }
  const end = session.endedAt ?? lastSetAt(sets) ?? session.startedAt;
  return {
    volume,
    volumeKnown,
    setCount: sets.length,
    durationMs: Math.max(0, end - session.startedAt),
    exerciseIds: order
  };
}

/**
 * The best set per exercise — what a recap should show, and what the Progress
 * history shows for the same workout.
 *
 * Ranked by **estimated 1RM of what the set actually moved**, which is the same
 * rule `perSessionTop` uses on Progress and the same one `findPRs` ranks
 * records by. It used to be raw weight then reps, and the two surfaces
 * disagreed out loud: a session of bench 200 x 5 then 185 x 10 was "200 x 5" on
 * the recap card and "185 x 10" in RECENT WORKOUTS, because e1rm(200,5) is
 * 233.3 and e1rm(185,10) is 246.7. One workout, two answers, and no way for the
 * reader to tell which one the app meant.
 *
 * Weight-then-reps also cannot rank a bodyweight movement at all: every strict
 * pull-up in a session is logged at 0, so "heaviest" was whichever came first.
 *
 * This is now the single definition — `recentSessions` calls it rather than
 * keeping a copy, the same fix R135 applied to the session title, and for the
 * same reason: a disagreement that cannot be expressed cannot ship.
 */
export function topSetPerExercise(
  sets: LoggedSet[], measurements: readonly Measurement[] = [], unit: Unit = 'lb'
): Map<string, LoggedSet> {
  const top = new Map<string, LoggedSet>();
  const load = (x: LoggedSet) =>
    (measurements.length ? realLoad(x, measurements, unit)?.load : null) ?? x.weight;
  for (const s of sets) {
    const held = top.get(s.exerciseId);
    if (!held || e1rm(load(s), s.reps) > e1rm(load(held), held.reps)) {
      top.set(s.exerciseId, s);
    }
  }
  return top;
}

/**
 * The exact payload shape consumed by spike/recap.js and harness/clip.js.
 *
 * Domain -> artifact in one function, deliberately: if these drift, the video
 * the user sends stops matching the workout they did, which is the worst
 * possible bug in a product whose entire thesis is the shareable output.
 */
export interface RecapPayload {
  title: string;
  date: string;
  volume: number;
  /**
   * False when the session contains bodyweight work with no reading behind it,
   * so `volume` is a floor rather than a total — see `SessionStats.volumeKnown`.
   * Optional so every existing consumer, including the shared-card renderer,
   * keeps working: absent reads as "known", which is what they all assumed.
   */
  volumeKnown?: boolean;
  /**
   * The language the card's own labels are drawn in.
   *
   * `buildRecap` already translates the values — title, date and duration all
   * arrive localised — but the renderer's chrome (TOTAL VOLUME, SETS, STREAK,
   * the claim slabs) was English literals inside `spike/recap.js`. So a Spanish
   * lifter read VOLUMEN TOTAL on their own screen and sent a card saying TOTAL
   * VOLUME: one claim, two surfaces, disagreeing on the artifact §5 says the
   * product is judged by.
   *
   * Absent means English, so every card built before this still renders, and an
   * ordinary English session spends no URL budget restating the default.
   */
  lang?: Language;
  sets: number;
  duration: string;
  streak: number;
  /**
   * This session's own streak just beat every earlier one — the same shape as
   * `bestYet`, for the same reason: the app has this fact and, until now, threw
   * it away every time the count reset. `weekStreak` and `longestStreakBefore`
   * agree on what "before" means, so this can only be true on the run that is
   * actually setting the record, never on a run merely as long as an old one.
   *
   * `>= 2` for the same reason `streakWorthShowing` refuses a bare 1: a
   * lifter's first-ever week beating a "previous best" of 0 is not a record,
   * it's the absence of one yet.
   */
  streakRecord?: boolean;
  /**
   * Absent for an ordinary session card. `'weekly'` for §10's rest-day
   * comparison (`weeklyCard` in weekly.ts) — the renderer's OWN switch on
   * this (`isWeekly` in recap.js) needs it to draw the weekly layout instead
   * of a session's, and until R284 this field was never in the wire format
   * at all: `pack`/`unpack`'s LONG/SHORT arrays never named it, so a shared
   * weekly link silently decoded with no `kind` and rendered as an ordinary,
   * claim-less session card on the landing page — the exact card the sender
   * never sent.
   */
  kind?: 'weekly';
  unit: Unit;
  watermark: string;
  /**
   * Whether this is the first workout on the device.
   *
   * A first session can never produce a PR — there is nothing behind it to
   * beat, and §8's "never cry wolf" means the app does not get to call your
   * opening set a record. But a PR-less, goal-less recap is also the emptiest
   * this card ever is, and the first one is the one most likely to be shared.
   * This lets the card say the true thing instead of the flattering one: this
   * is the baseline every later session is measured against.
   */
  firstSession: boolean;
  /**
   * The session's best set beat everything before it — but no PR was awarded,
   * because §8's cold-start guard needs three prior sessions of that movement
   * before the app is allowed to use the word "record".
   *
   * This exists because the claim slab had a hole exactly where it could least
   * afford one. Walked on a cold database: sessions one, two and three at 90,
   * 90 and then **135** — a lifter's heaviest ever lift by 45 lb — and the
   * card's only editorial line was "Short one. It still counts." `firstSession`
   * had passed, `pr` was still suppressed by the cold-start guard, and there is
   * no goal yet in week one, so every branch of the claim chain missed. The
   * emptiest this card ever renders turned out not to be the first session
   * (which `firstSession` already covers) but the two after it — and §6 is
   * explicit that week one is where day-1 retention is decided.
   *
   * Deliberately NOT a PR, and rendered outlined rather than volt-filled for
   * the same reason `firstSession` is: no record was broken by the app's own
   * definition, and dressing one up is the crying wolf §8 forbids. It states a
   * fact the lifter can check against the card's own lift list instead.
   *
   * Carries `prev` rather than being a bare flag so the card can say what was
   * beaten — §16 wants a number the reader can check, and "135 × 8, up from
   * 90" is checkable in a way that a lone "BEST YET" is not.
   */
  bestYet?: { prev: number };
  /**
   * The heaviest set of this workout, by weight then reps.
   *
   * Only used when there is no PR to show. It is deliberately NOT the volume
   * again — the hero above already is that number, and a card that prints
   * 1,800 LB twice reads as a rendering fault rather than a summary.
   */
  /**
   * `exerciseId` alongside the display name because a consumer may need to know
   * WHICH movement it was, not just what to call it — the bodyweight-multiple
   * line has to recognise a pull-up, whose load is the lifter, and refuse to
   * claim it as a multiple of themselves.
   */
  best?: { lift: string; weight: number; reps: number; exerciseId: string };
  pr?: {
    lift: string;
    weight: number;
    reps: number;
    /** 0 means "no comparable previous set" — read `gain`, never subtract this. */
    prev: number;
    /** Weight improvement over the comparable set, or null when there was none. */
    gain: number | null;
    /** True only if this is the most weight ever moved on the lift, at any reps. */
    heaviest: boolean;
  };
  lifts: Array<[string, string, boolean]>;
  /**
   * The goal narrative — "42 lb from a 315 squat". §5: goals must feed the
   * output or the screen gets cut, and this field is that obligation made
   * concrete. Absent when no goal has anything honest to say.
   */
  goalLine?: string;
  /**
   * §8's second lead: one true sentence for a mature account with no goal.
   *
   * Shares the narrative slot with `goalLine` and never renders beside it — a
   * goal wins, because it is the thing the user chose. Absent unless the
   * weekly comparison had something true to say, which is most sessions.
   */
  trendLine?: string;
  /**
   * "Squat 315 x 5 - 1.75x bodyweight." §-: the milestone lifters actually
   * chase and actually quote, curated by `multipleLine`'s four rules (best set
   * only, 1x-or-above only, never the four bodyweight-native movements, null
   * with no bodyweight on record).
   *
   * Lives ON the payload — not a sibling field the way `sessionId` deliberately
   * is — because the payload is what actually leaves the device: `shareText`,
   * `pack()`'s wire form, and the shareable PNG all read from it, not from the
   * screen-only `Recap` wrapper. It was originally computed straight onto that
   * wrapper and never made it into any of the three, so a genuinely curated
   * achievement was visible only to someone already looking at the live app —
   * shared, the best thing in the session silently was not there. See R435-438.
   */
  multiple?: string;
}

/*
 * The date is DRAWN, not formatted.
 *
 * `toLocaleDateString` is the obvious tool and it is wrong here: this string
 * goes onto a card at a fixed width in all-caps, and the locale formatter emits
 * "24 de agosto de 2026" for Spanish — five times the length, mixed case, and
 * it would run off the card. The names live in the table beside every other
 * string instead, so the card and the app agree and the shape never changes.
 */

/**
 * What to call a workout.
 *
 * The recap screen said "WORKOUT" for every session ever recorded, because
 * `buildRecap` defaulted to that string and the screen passes no title — while
 * the shared card was handed "PUSH DAY" by its caller and the Progress history
 * derived the day itself. Three surfaces naming the same session, two answers,
 * and the one the user sees immediately after finishing was the vague one.
 *
 * Named from the lifts, like everywhere else, via `sessionDay` — which takes
 * the day MOST of the session's lifts belong to, with ties going to whichever
 * was trained first. WORKOUT is the answer only when nothing in the session
 * has a known day at all, which in practice means a session made entirely of
 * movements the user invented.
 *
 * This comment used to claim that "a session that mixed push and legs is a
 * WORKOUT", and that has never been true: measured, `bench + squat + row`
 * titles as **PUSH DAY**, and an even 2-push/2-legs split does too. The test
 * covering it was named for the same claim and asserted
 * `title === 'WORKOUT' || /DAY$/` — which every possible output satisfies, so
 * nothing ever caught the drift.
 *
 * Majority-wins is the right rule; the bug was voting at the wrong
 * granularity. `PLAN_DAY_COVERS` makes an upper/lower lifter's upper day push
 * AND pull, so tallying push/pull/legs directly splits one upper session's
 * votes across two buckets — bench + squat + row read as a three-way tie
 * (1 push, 1 legs, 1 pull) when for an upper/lower lifter it is 2-out-of-3 for
 * UPPER. `sessionPlanDay` tallies in the lifter's own plan's vocabulary, so
 * the same session titles correctly under every plan they might run — closed
 * per the owner's decision in LOOP_LOG R204/R268: real fix, not a fallback to
 * WORKOUT on disagreement.
 */
export function sessionTitle(sets: LoggedSet[], lang: Language = 'en', plan: SplitPlan = 'ppl'): string {
  const day = sessionPlanDay(sets.map(s => s.exerciseId), plan);
  // Through the table rather than composed from the day name: "LEGS DAY" and
  // "FULL BODY DAY" are not what anyone calls them in English, and Spanish
  // puts the day word first — a template cannot do either.
  return day ? t(lang, DAY_TITLE_KEY[day]) : t(lang, 'workoutWord');
}

export function buildRecap(opts: {
  session: Session;
  sets: LoggedSet[];
  exercises: Map<string, Exercise>;
  prs: PersonalRecord[];
  allSets: LoggedSet[];
  now: number;
  title?: string;
  /** The lifter's split, for `sessionTitle` when `title` is not given. */
  plan?: SplitPlan;
  watermark?: string;
  /** Precomputed by the caller via goals.headlineGoal + narrativeLine. */
  goalLine?: string | null;
  trendLine?: string | null;
  /**
   * Every bodyweight reading, so a session of pull-ups reports the load it
   * actually moved rather than the nothing that was typed. Optional — without
   * it the totals are exactly what they were before measurements existed.
   */
  measurements?: readonly Measurement[];
  /**
   * Which unit each session was logged in, from `repo.sessionUnits()`.
   *
   * A `LoggedSet` carries no unit — the SESSION owns it — so every comparison
   * below that reaches across sessions needs this map or it reads a 100 kg
   * bench as a bare 100 (HANDOFF trap 9). `findPRs` has taken it since
   * R179-R181; this object's OWN two cross-session comparisons, `heaviest` and
   * `bestYet`, were left behind and read raw weights until R478. Optional, so
   * every existing caller keeps the behaviour it had — but `recapFor` passes it,
   * and it is the caller that matters.
   */
  sessionUnits?: Map<string, Unit>;
  /**
   * What language the card is written in.
   *
   * On the payload rather than applied by the screen, because this object IS
   * the artifact: `spike/recap.js` and `harness/clip.js` render it straight to
   * an image, and a card assembled in English and relabelled at the last moment
   * would be a card whose title and date disagreed with its own body.
   */
  lang?: Language;
}): RecapPayload {
  const { session, sets, exercises, prs, allSets, now } = opts;
  const lang = opts.lang ?? 'en';
  const stats = sessionStats(session, sets, opts.measurements ?? []);
  const streak = weekStreak(allSets, now);
  const streakRecord = streak >= 2 && streak > longestStreakBefore(allSets, now);
  const top = topSetPerExercise(sets, opts.measurements ?? [], session.unit);
  const d = new Date(session.startedAt);
  const headline = prs[0];

  /*
   * Same ordering the PR list uses — weight first, reps only to break a tie —
   * so the baseline slab and the record slab rank a session the same way.
   *
   * `loadOf` rather than a local `realLoad` fallback (R478): this is the one
   * comparison primitive that converts a set out of its OWN session's unit
   * before anything else touches it, and `bestYet` below reduces it across
   * `allSets`. Within this session the map is a no-op — every set's own unit IS
   * `session.unit` — so `bestSet` ranks exactly as it did.
   */
  const load = (x: LoggedSet) =>
    loadOf(x, opts.measurements ?? [], session.unit, opts.sessionUnits ?? new Map());
  const bestSet = [...top.values()].sort(
    (a, b) => load(b) - load(a) || b.reps - a.reps
  )[0];

  // Only the HEADLINE PR is badged, even when several lifts legitimately hit
  // one. Bumping four accessories in a session is common and every one of those
  // records is real — but four highlighted rows on one card flattens the
  // hierarchy and the badge stops meaning anything. §8's "never cry wolf"
  // applies to presentation, not just detection: the other PRs are still
  // recorded and still show up in Progress, they just do not all shout.
  const lifts = stats.exerciseIds.map(id => {
    const t = top.get(id)!;
    const name = exercises.get(id)?.name ?? id;
    return [name, `${loadLabel(t.weight)} × ${t.reps}`, id === headline?.exerciseId] as [string, string, boolean];
  });

  return {
    title: opts.title ?? sessionTitle(sets, lang, opts.plan ?? 'ppl'),
    date: `${DAYS_SHORT[lang][d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[lang][d.getMonth()]}`,
    volume: Math.round(stats.volume),
    // Only when it is FALSE. A payload that restates the default on every
    // ordinary session spends URL budget saying nothing (see share-url.ts).
    ...(stats.volumeKnown ? {} : { volumeKnown: false }),
    // Same rule as `volumeKnown`: only when it is not the default.
    ...(lang === 'en' ? {} : { lang }),
    sets: stats.setCount,
    duration: `${Math.max(1, Math.round(stats.durationMs / 60_000))} ${t(lang, 'minShort')}`,
    streak,
    ...(streakRecord ? { streakRecord: true } : {}),
    unit: session.unit,
    watermark: opts.watermark ?? 'PROOF',
    // Nothing was logged before this workout started. `allSets` is every set on
    // the device, so this is a fact about the device, not about the session.
    firstSession: !allSets.some(x => x.at < session.startedAt),
    /*
     * Beat everything before it, on the same movement, at the same reps or
     * more. What differs from `findPRs` is only whether the app is allowed to
     * call it a RECORD yet.
     *
     * This used to say the two "can never disagree", and R540 measured them
     * disagreeing. `findPRs` holds a pull-up to BOTH scales — more total load
     * AND more added weight than ever — because on a bodyweight movement the
     * one way real load can rise without the lifter doing anything is the
     * lifter getting heavier, and `pr.ts` calls that "the purest cry-wolf in
     * the app: a badge for eating". `bestYet` compared load alone.
     *
     * Measured: three sessions of 25 x 5 pull-ups at 180 lb bodyweight, then
     * the same 25 x 5 at 192. `findPRs` correctly awards nothing. The recap
     * card said BEST YET, prev 205 — and precisely because there was no
     * record, the `headline` suppression below could not catch it. The guard
     * that exists one file over was the whole defence, and it was not here.
     *
     * Scoped to `bestSet`'s own lift rather than the whole history: "heaviest
     * ever" across every movement would be true of a deadlift session for
     * almost everyone, which is exactly the kind of claim that is technically
     * correct and says nothing.
     *
     * Suppressed when a PR exists — that slab is strictly better and two
     * claims about the same set is the hierarchy-flattening §8 warns about.
     */
    bestYet: (() => {
      if (headline || !bestSet) return undefined;
      const prior = allSets.filter(x =>
        x.exerciseId === bestSet.exerciseId
        && x.at < session.startedAt
        && x.reps >= bestSet.reps);
      const priorBest = prior.reduce((m, x) => Math.max(m, load(x)), 0);
      // The added weight on the same set of prior sets — what the lifter
      // actually put on the belt, which is what `findPRs` calls `previousAdded`.
      const priorAdded = prior.reduce((m, x) => Math.max(m, x.weight), 0);
      // `priorBest > 0` is what keeps a first-ever session out of this branch:
      // with nothing behind it there is nothing to have beaten, and
      // `firstSession` is the claim that fits that case.
      if (priorBest <= 0 || load(bestSet) <= priorBest) return undefined;
      // `findPRs`' rule, and for its reason: at an unchanged bodyweight the two
      // scales agree exactly, so this costs a real lifter nothing.
      if (CARRIES_BODYWEIGHT.has(bestSet.exerciseId) && bestSet.weight <= priorAdded) return undefined;
      return { prev: priorBest };
    })(),
    best: bestSet && {
      lift: exercises.get(bestSet.exerciseId)?.name ?? bestSet.exerciseId,
      weight: bestSet.weight,
      reps: bestSet.reps,
      exerciseId: bestSet.exerciseId
    },
    pr: headline && {
      // The exercise's real name, not a shouted one. This used to be
      // `.toUpperCase()` — a styling decision baked into the data — and it
      // leaked the moment anything but the card read it: the share message
      // came out "BENCH PRESS 225 x 5 - heaviest ever", shouting mid-sentence.
      // The card uppercases at render, where presentation belongs.
      lift: headline.exerciseName,
      weight: headline.weight,
      reps: headline.reps,
      prev: headline.previousWeight,
      /**
       * The improvement, or null when there is nothing comparable to improve on.
       *
       * `previousWeight` is 0 in the e1RM branch — a sentinel meaning "no set
       * at this rep count was beaten" — and BOTH renderers of the shareable
       * subtracted it: `weight - prev` printed the entire bar as the gain, so a
       * 315 x 5 after a 300 x 3 history rendered "SQUAT +315 LB". `shareText`
       * already guarded with `prev > 0`, which is proof the field was known to
       * be zero-able; the guard simply never reached the card or the clip. It
       * is computed once, here, so a renderer cannot get it wrong again.
       */
      gain: headline.previousWeight > 0 ? headline.weight - headline.previousWeight : null,
      /**
       * Whether this really is the most weight they have ever moved on it —
       * moved, not typed. A +25 pull-up compared against a history of +30s
       * would answer "no" on added weight while being the heaviest pull the
       * lifter has ever done, if the 30s were pulled twenty pounds lighter.
       */
      heaviest: rank(headline)
        >= heaviestEver(allSets, headline.exerciseId, opts.measurements ?? [], session.unit,
          opts.sessionUnits ?? new Map())
    },
    lifts,
    goalLine: opts.goalLine ?? undefined,
    trendLine: opts.trendLine ?? undefined
  };
}

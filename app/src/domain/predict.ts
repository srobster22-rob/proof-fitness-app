import type { LoggedSet } from './types.ts';

/**
 * Exercise prediction. PROMPT.md §7.
 *
 * Picking a lift sits on the logging path, so it is governed by rule 1 — and a
 * searchable list of 200 exercises fails that instantly. This is therefore a
 * PREDICTION problem, not a search problem: a lifter uses 15-25 movements, and
 * the next one is highly predictable from their own history.
 *
 * Scoring sums an exponential decay over every past session containing the
 * exercise:
 *
 *     score = Σ  0.5 ^ (daysAgo / HALF_LIFE)
 *
 * Frequency emerges from the summing, recency from the decay, and the §8
 * "mature" requirement — that a movement trained hard a year ago and abandoned
 * must not outrank this month's — falls out for free rather than needing a
 * special case. A predictor that merely counted would get *worse* the longer
 * someone used the app, which is the failure mode that matters most because it
 * only hits the users who stayed.
 */

export const HALF_LIFE_DAYS = 28;
export const WEEKDAY_BOOST = 1.0;
export const MIN_SESSIONS_FOR_PREDICTION = 3;
const DAY_MS = 86_400_000;

interface Occurrence { sessionId: string; at: number; weekday: number; position: number; }

/**
 * The last collapse, keyed on the exact array it was built from.
 *
 * `state()` runs on every tap, and it walks the whole history four times:
 * twice inside `nextCandidates`, once in `pickerFor`, once in `weekStreak`.
 * Measured at 14,000 sets: `state()` 5.93ms, of which `nextCandidates` 1.51ms
 * and `pickerFor` 0.88ms — and every one of those passes collapses the SAME
 * sets into the SAME occurrences, because they all read `repo.allSets()`,
 * which is itself memoised and hands back one stable array.
 *
 * So this caches on that array's identity, which is sound because of a
 * property `Repo.allSets` already guarantees for its own reasons: the array it
 * returns is FROZEN, and every method that writes to `sets` drops the memo, so
 * the next read builds a new one. Identity therefore changes exactly when the
 * contents could have. Nothing here can go stale without the array in hand
 * being a different object.
 *
 * Not a general cache: exactly one entry, and no clock in the key. The length
 * check is for callers that are not the Repo and hand over an array of their
 * own — cheap, and it catches the one in-place edit a caller is likely to make.
 * Scoring still runs every time, because scoring depends on `now` and
 * `weekday`; only the O(sets) collapse is reused, and what it produces is
 * O(sessions x lifts-per-session) — 2,800 entries against those 14,000 sets.
 *
 * Measured at that size: `state()` 5.93ms to 3.98ms, `rankExercises` 0.64ms to
 * 0.05ms, and the four full walks of the history per tap down to one.
 */
let lastHistory: LoggedSet[] | null = null;
let lastLength = -1;
let lastOccurrences: Map<string, Occurrence[]> | null = null;

/** Collapse raw sets into one occurrence per (session, exercise). */
function occurrences(history: LoggedSet[]): Map<string, Occurrence[]> {
  if (history === lastHistory && history.length === lastLength && lastOccurrences) {
    return lastOccurrences;
  }
  const built = collapse(history);
  lastHistory = history;
  lastLength = history.length;
  lastOccurrences = built;
  return built;
}

function collapse(history: LoggedSet[]): Map<string, Occurrence[]> {
  const seen = new Map<string, Set<string>>();     // sessionId -> exercises, in order
  const out = new Map<string, Occurrence[]>();

  for (const s of history) {
    let inSession = seen.get(s.sessionId);
    if (!inSession) { inSession = new Set(); seen.set(s.sessionId, inSession); }
    if (inSession.has(s.exerciseId)) continue;
    const position = inSession.size;
    inSession.add(s.exerciseId);

    const list = out.get(s.exerciseId) ?? [];
    list.push({
      sessionId: s.sessionId,
      at: s.at,
      weekday: new Date(s.at).getDay(),
      position
    });
    out.set(s.exerciseId, list);
  }
  return out;
}

export function sessionCount(history: LoggedSet[]): number {
  return new Set(history.map(s => s.sessionId)).size;
}

/**
 * A scored exercise. `typicalPosition` is "how early in a session this is
 * usually done", and it carries the SAME exponential decay as the score.
 *
 * It did not, and the asymmetry was a live defect. Selection decayed on a
 * 28-day half-life while ordering took a plain unweighted mean over all
 * history, so a lifter who reordered their session kept being offered the old
 * order, and the lag grew with the size of the history behind it. Measured on
 * a five-lift day whose order was reversed, holding the LIFTS fixed so that
 * only position could move: after four weeks of the old order it took 35 days
 * to adopt the new one, after ten weeks 77 days, after twenty weeks 147. That
 * is precisely the failure this module's opening comment says the decay exists
 * to prevent -- a predictor that gets WORSE the longer someone uses the app,
 * which is the worst shape a regression can have because it only reaches the
 * users who stayed. Weighted, the same three cases take 21, 28 and 35 days:
 * bounded, and no longer a function of how long they have been here.
 *
 * Decay only, no `WEEKDAY_BOOST`: the boost answers "is this lift part of
 * today's session", which is a selection question. Where a lift sits WITHIN a
 * session is not something a Wednesday knows better than a Friday.
 *
 * A steady lifter is unaffected -- an unchanging position averages to itself
 * under any weights -- so the change is invisible until the order moves, which
 * is exactly when it should become visible.
 */
export interface Ranked { exerciseId: string; score: number; typicalPosition: number; }

/**
 * Rank every exercise the user has ever trained.
 *
 * @param now     evaluation time (epoch ms)
 * @param weekday 0-6; occurrences on the same weekday are boosted
 */
export function rankExercises(history: LoggedSet[], now: number, weekday?: number): Ranked[] {
  const occ = occurrences(history);
  const ranked: Ranked[] = [];

  for (const [exerciseId, list] of occ) {
    let score = 0;
    let positionSum = 0;
    let positionWeight = 0;
    for (const o of list) {
      const daysAgo = Math.max(0, (now - o.at) / DAY_MS);
      const decay = Math.pow(0.5, daysAgo / HALF_LIFE_DAYS);
      const sameDay = weekday != null && o.weekday === weekday;
      score += decay * (1 + (sameDay ? WEEKDAY_BOOST : 0));
      positionSum += decay * o.position;
      positionWeight += decay;
    }
    ranked.push({ exerciseId, score, typicalPosition: positionSum / positionWeight });
  }

  return ranked.sort((a, b) => b.score - a.score);
}

/**
 * The predicted session: which lifts, in the order they are usually done.
 *
 * Selection is by score; ORDERING is by typical position within a session,
 * because a predictor that opens on the accessory the user does last is
 * technically right and practically useless.
 *
 * Returns [] before there is enough history — the caller falls back to §6's
 * short list of common movements rather than guessing.
 */
export function predictSession(
  history: LoggedSet[], now: number, weekday?: number, size = 5
): string[] {
  if (sessionCount(history) < MIN_SESSIONS_FOR_PREDICTION) return [];
  return rankExercises(history, now, weekday)
    .slice(0, size)
    .sort((a, b) => a.typicalPosition - b.typicalPosition)
    .map(r => r.exerciseId);
}

/**
 * Which lift a brand-new session should open on.
 *
 * `predictSession` deliberately returns nothing until three sessions exist — it
 * infers a *routine*, and two data points do not make one. But "what do I open
 * on" is a much easier question than "what is your routine", and it still has an
 * obvious answer after a single workout: whatever you started with last time.
 *
 * Without this rung, sessions two and three fell all the way through to the head
 * of the starting twelve — so a returning user whose only lift was a squat
 * landed on **Bench Press**, seeded at 95 lb, with the app's own "UP NEXT"
 * simultaneously pointing at Squat. The swipe target knew what they lifted and
 * the screen they landed on did not.
 *
 * The FIRST lift of the last session, not the last one: you begin a workout
 * where you began it last time, and the accessory you finished on is not where
 * anybody wants to start. That is the same reason `predictSession` orders by
 * typical position.
 *
 * Returns null only when nothing has ever been logged — §6's genuine cold start.
 */
export function openingLift(history: LoggedSet[], now: number, weekday?: number): string | null {
  const predicted = predictSession(history, now, weekday);
  if (predicted.length) return predicted[0];
  if (!history.length) return null;

  let latestSession = history[0].sessionId;
  let latestAt = history[0].at;
  for (const s of history) {
    if (s.at >= latestAt) { latestAt = s.at; latestSession = s.sessionId; }
  }

  let opener: LoggedSet | null = null;
  for (const s of history) {
    if (s.sessionId !== latestSession) continue;
    if (!opener || s.at < opener.at) opener = s;
  }
  return opener!.exerciseId;
}

/**
 * What to put in front of the user next, given what they have already done in
 * this session. Drives the swipe-to-next-exercise gesture.
 */
export function nextCandidates(
  history: LoggedSet[], doneThisSession: string[], now: number, weekday?: number
): string[] {
  const done = new Set(doneThisSession);

  /*
   * TODAY'S session first, in the order it is usually done — then everything
   * else by score, as overflow.
   *
   * This was one call, `predictSession(history, now, weekday, 12)`, and the
   * width was the bug. `typicalPosition` is a WITHIN-session number: it says
   * "third lift of the day", and comparing it across different days compares
   * two things that never happen together. Widen the pool to 12 and it spans
   * the whole split, so sorting all 12 by position puts every day's OPENER at
   * the front. Measured on fourteen weeks of Mon/Wed/Fri push-pull-legs: the
   * size-5 prediction for a Monday was a flawless push day, and then the swipe
   * target after Bench Press was **SQUAT** — position 0 of leg day beating
   * position 1 of the day the user is actually having.
   *
   * The score already knew better. All five push lifts outscored every leg
   * lift; the widening threw that away and re-sorted on a key that could not
   * carry it. So the session keeps position-order, and the pool beyond it
   * keeps score-order, which is the only ranking that means anything between
   * days.
   */
  const session = predictSession(history, now, weekday).filter(id => !done.has(id));
  const inSession = new Set(session);
  const overflow = rankExercises(history, now, weekday)
    .map(r => r.exerciseId)
    .filter(id => !done.has(id) && !inSession.has(id));
  return [...session, ...overflow];
}

export function suggestNext(
  history: LoggedSet[], doneThisSession: string[], now: number, weekday?: number
): string | null {
  return nextCandidates(history, doneThisSession, now, weekday)[0] ?? null;
}

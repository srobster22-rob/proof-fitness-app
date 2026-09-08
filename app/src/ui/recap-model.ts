import type { Repo } from '../data/repo.ts';
import { findPRs } from '../domain/pr.ts';
import { buildRecap, weekIndex, type RecapPayload } from '../domain/session.ts';
import { planOf } from '../domain/split.ts';
import { headlineGoal, narrativeLine } from '../domain/goals.ts';
import { shareUrl } from '../domain/share-url.ts';
import { weeklyLine } from './progress-model.ts';
import type { PersonalRecord, LoggedSet, Session } from '../domain/types.ts';
import { loadLabel } from '../domain/types.ts';
import { t, fill, languageOf, number, type Language } from '../domain/i18n.ts';
import {
  CARRIES_BODYWEIGHT, bodyweightMultiple,
  type Measurement, type MeasureUnit } from '../domain/measure.ts';

/**
 * Assembling a recap from what is stored. PROMPT.md §5 screen 4.
 *
 * The domain functions are pure and each take arrays; this is the one place
 * that knows how to get those arrays out of the database and in what order.
 * Keeping it separate from `buildRecap` means the payload logic stays testable
 * with literals, and this stays testable with a real database — neither has to
 * fake the other.
 */

export interface Recap {
  payload: RecapPayload;
  prs: PersonalRecord[];
  /** True when there is nothing worth sending — one warm-up set and no history. */
  thin: boolean;
  /**
   * Which session this recap is OF.
   *
   * The payload deliberately does not carry it — it is the shape handed to the
   * renderer, and a session id is not something a shareable card has any
   * business knowing. But the screen needs it to reopen the workout for
   * editing, so it lives out here beside the payload rather than inside it.
   */
  sessionId: string;
  /** "Squat 315 x 5 - 1.75x bodyweight", or null. See `multipleLine`. */
  multiple: string | null;
}

/**
 * Is this the first workout of its calendar week?
 *
 * §10 asks for one auto-surfaced comparison PER WEEK, and a recap is generated
 * per session — so the gate has to be derivable from the data rather than from
 * remembered state, or restoring a backup would resurface a claim already made.
 * The week is the same local-calendar one `weekStreak` counts in, so the two
 * cannot disagree about which week a session belongs to.
 */
function firstSessionOfItsWeek(allSets: readonly LoggedSet[], session: Session): boolean {
  /*
   * Anchored on each session's earliest SET, not on `startedAt`.
   *
   * Two sessions can share a `startedAt` — a restored backup, or any fixture
   * built with a fixed clock — and comparing loose set timestamps against one
   * shared start makes a session look preceded by a workout that actually came
   * after it. Caught by a test whose two sessions started at the same instant;
   * the earliest set is the thing that is always distinct and always means
   * "when this workout really began".
   */
  const mine = allSets.filter(s => s.sessionId === session.id);
  if (!mine.length) return true;
  const start = mine.reduce((m, s) => Math.min(m, s.at), Infinity);
  const week = weekIndex(start);
  for (const s of allSets) {
    if (s.sessionId === session.id) continue;
    if (s.at < start && weekIndex(s.at) === week) return false;
  }
  return true;
}

/** A session is worth a recap once it has any real work in it. */
const MIN_SETS_FOR_RECAP = 1;

export function recapFor(repo: Repo, sessionId: string, now: number, title?: string): Recap | null {
  const session = repo.session(sessionId);
  if (!session) return null;

  const sets = repo.setsInSession(sessionId);
  if (sets.length < MIN_SETS_FOR_RECAP) return null;

  const exercises = repo.exercises();
  const history = repo.historyBefore(sessionId);
  const allSets = repo.allSets();
  const measurements = repo.measurements();
  const prs = findPRs(sets, history, exercises, session.unit, measurements, repo.sessionUnits());

  // §5 — goals earn their place by feeding the output. If no goal has anything
  // honest to say, the line is simply absent rather than invented.
  // `session.startedAt` scopes "achieved" to THIS workout: finishing a goal
  // today leads the recap, finishing one last month does not go on leading it.
  // The session's own exercise ids, so a goal on something trained today
  // outranks one that is merely further along on a lift never touched.
  const goal = headlineGoal(repo.goals(), allSets, exercises, now, repo.sessionUnits(), session.startedAt,
    [...new Set(sets.map(x => x.exerciseId))]);
  const lang = languageOf(repo);
  // The goal sentence is the one line §5 makes the Goals screen earn its place
  // with, and it lands here. It went out in English on a Spanish card because
  // this call was the only `narrativeLine` that never got the language.
  const goalLine = goal ? narrativeLine(goal, lang) : null;
  /*
   * §8's "second lead", for the accounts that have earned one.
   *
   * The mature clause is explicit: PRs get rarer by design — "a recap that
   * leads with 'no PR today' every session for a year is a failure of framing,
   * not of the lifter" — and such accounts "need a second lead: consistency,
   * volume trend, a goal's progress". Only the third existed. A lifter two
   * years in with no active goal got a card with nothing to say about them,
   * which is exactly the user §8 is worried about losing.
   *
   * A separate field rather than reusing `goalLine`, which was tried and
   * rejected: that field is read by `shareText` and packed on the wire, and a
   * field named for a goal carrying a trend sentence is how the confusions this
   * codebase keeps paying for get made. Two names, one slot, goal wins — it is
   * the thing the user chose.
   *
   * Computed only when there is no goal, and `weeklyLine` says nothing at all
   * unless it is true (§8's cry-wolf rule).
   *
   * ONCE PER WEEK, which is §10's own wording — "one auto-surfaced comparison
   * per week" — and which R256 measured the need for. Put on every recap, this
   * lead fired on 676 of 700 cards: **97% of a mature account's recaps became
   * the same shape**, which is precisely the failure §8's mature clause names
   * ("the same layout with different numbers, 200 times"). A four-week window
   * moves slowly, so it would also have repeated the same SENTENCE about the
   * same lift for days. Gated to the first session of its week it stays news.
   */
  const trendLine = goal || !firstSessionOfItsWeek(allSets, session)
    ? null
    : weeklyLine(repo, now);

  const builtPayload = buildRecap({
    session, sets, exercises, prs, allSets, now, title, goalLine, trendLine,
    // The same map already fetched above for `findPRs` — `buildRecap` runs its
    // OWN cross-session comparisons (`heaviest` and `bestYet`) and read raw
    // weights without it until R478.
    measurements, lang, plan: planOf(repo), sessionUnits: repo.sessionUnits()
  });
  const multiple = multipleLine(builtPayload, measurements, session.startedAt);
  // On the payload itself, not just the `Recap` wrapper below — see the field's
  // own doc comment in session.ts (R435-438). `multipleLine` needs `measurements`,
  // which `buildRecap` does not carry into its return value, so it is computed
  // here and folded back in rather than inside `buildRecap` itself.
  const payload = multiple ? { ...builtPayload, multiple } : builtPayload;

  return {
    payload,
    prs,
    // A single set with no PR and no goal is a receipt of turning up. Worth
    // showing the user, not worth pushing them to send.
    thin: sets.length === 1 && prs.length === 0 && !goalLine,
    sessionId,
    multiple
  };
}

/**
 * The most recently finished session — what to show after `finish()`, and what
 * the Recap route opens on when reached without an explicit id.
 */
/**
 * "Squat 315 x 5 - 1.75x bodyweight."
 *
 * The one line in this app that says something a weight alone cannot: 315
 * means nothing until you know who lifted it, and a bodyweight multiple is the
 * milestone lifters actually chase and actually quote.
 *
 * Four rules make it worth printing rather than noise:
 *
 * - Only the session's BEST set. A multiple on every lift is a wall of
 *   arithmetic; on a warm-up it is a lie about the effort.
 * - Only at or above 1x. Below bodyweight the number is arithmetically true
 *   and says nothing anybody wants said — this app does not exist to inform
 *   someone their overhead press is 0.4 times their weight.
 * - Never for the four movements whose load IS the lifter. "Pull-up at 1.0x
 *   bodyweight" is a tautology wearing an achievement's clothes.
 * - Null with no bodyweight on record, like everything else that needs one.
 */
export function multipleLine(
  payload: RecapPayload, measurements: readonly Measurement[], at: number
): string | null {
  const best = payload.best;
  if (!best || CARRIES_BODYWEIGHT.has(best.exerciseId)) return null;

  const x = bodyweightMultiple(best.weight, payload.unit as MeasureUnit, measurements, at);
  if (x === null || x < 1) return null;
  // "2x" rather than "2.00x" — the claim is the number, not its precision.
  const said = Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100);
  return `${best.lift} ${best.weight} × ${best.reps} — ${said}× ${t((payload.lang ?? 'en') as Language, 'bodyweightWord')}`;
}

export function latestRecap(repo: Repo, now: number, title?: string): Recap | null {
  const sessions = repo.allSets();
  if (!sessions.length) return null;
  const lastSessionId = sessions[sessions.length - 1].sessionId;
  return recapFor(repo, lastSessionId, now, title);
}

/**
 * The single line that leads the share sheet. Ranked by what actually travels:
 * a PR beats a finished goal beats raw volume.
 */
/**
 * The message that leaves the app. §5 — the whole product is judged on whether
 * this is worth sending.
 *
 * `headline` is NOT this, and using it as this was the bug. It is written to
 * sit on the card, ABOVE the numbers, so it leaves them out on purpose:
 * "Heaviest 5-rep bench press". Handed to a share sheet on its own it became
 * "Heaviest 5-rep bench press — PROOF", which does not say **225**. The single
 * most postable fact in the entire session was the one thing missing, and a
 * reader learned nothing they could react to.
 *
 * So this composes a message that stands alone: the claim, the numbers behind
 * it, and nothing the app cannot back. A one-week streak is not mentioned — see
 * `streakWorthShowing`: "1 week running" would be dressing up a first session
 * as a habit.
 *
 * **It always opens with a lift and a number**, and that invariant is the
 * second bug this function has had. Only the PR branch named the work, and §8
 * makes PRs deliberately rare — so the ordinary session, which is nearly all of
 * them, went out as *"30 lb from a 225 squat. 4,905 lb across 6 sets. 13 weeks
 * running."* after a workout of bench and overhead press. The one lift it named
 * had not been trained that day, and nothing the reader could react to had. §5
 * calls a volume summary Strava-shaped — "legible only to people who already
 * lift" — and this was worse than that: the receipt without even the lift list.
 * The group chat is the channel this is designed for, and what travels in one
 * is the work.
 *
 * One lift, not all of them: §4 wants this legible in two seconds in a thread,
 * and the aggregate sentence already covers the rest of the session.
 */
/**
 * Is this streak something the app is entitled to show?
 *
 * `weekStreak` counts the current run of consecutive trained weeks, and a
 * first-ever set makes that run length 1 — a "1 week" streak before the user
 * has strung two of anything together. R36 refused to put that in the share
 * message — "1 weeks running" after a first session is the app lying on the
 * user's behalf — and the recap card went on printing `STREAK · 1 WK` beside
 * SETS and TIME anyway, dressing up a first session as a habit in the one
 * surface that is meant to be checkable. §6 was rewritten to match this
 * (R150/R205, closed R269) rather than leave the spec contradicting the code.
 *
 * One threshold, used by both surfaces, so they cannot drift apart again.
 */
export function streakWorthShowing(streak: number): boolean {
  return streak >= 2;
}

export function shareText(recap: Recap, lang: Language = 'en'): string {
  const { payload } = recap;
  const parts: string[] = [];

  if (payload.pr) {
    const { lift, weight, reps, prev, heaviest } = payload.pr;
    /*
     * "Heaviest ever" was unconditional, and it is often false. §8 awards a PR
     * on e1RM when no comparable set exists, so a 200 x 10 beating a 225 x 5
     * went out as "Bench Press 200 × 10 — heaviest ever" — 25 lb lighter than
     * the user's actual best. It could misfire in the direct branch too: 230 x 5
     * over 225 x 5 claimed "heaviest ever" with a 275 x 3 on the books.
     *
     * So the claim now matches what was actually beaten. `best set yet` is
     * `pr.ts`'s own wording for the e1RM branch, and it is true in both cases
     * that are not literally the heaviest.
     */
    const what = t(lang, heaviest ? 'heaviestEverWord' : 'bestSetYet');
    const from = prev > 0 ? `, ${t(lang, 'upFrom')} ${prev}` : '';
    parts.push(`${lift} ${loadLabel(weight)} × ${reps} — ${what}${from}.`);
  } else if (payload.firstSession && payload.best) {
    /*
     * The one honest thing a first workout can claim — see recap.tsx's own
     * SESSION ONE slab, which this branch was missing entirely: `firstSession`
     * sits in the exact same priority slot as `bestYet` right below (pr beats
     * firstSession beats bestYet, same order the card uses), and `bestYet`'s
     * own comment already describes fixing this identical defect for ITSELF
     * once — the message fell through to a bare lift line while the card said
     * something. `firstSession` never got the equivalent fix. A first-ever
     * workout is "the one most likely to be shared" by the card's own comment,
     * which makes its message the least excusable one to leave thin.
     */
    const { lift, weight, reps } = payload.best;
    parts.push(`${lift} ${loadLabel(weight)} × ${reps} — ${t(lang, 'sessionOne')}, ` +
      `${t(lang, 'oneToBeat').toLowerCase()}.`);
  } else if (payload.bestYet && payload.best) {
    /*
     * Beat your own best, but too early for §8 to call it a record — see
     * `bestYet` in session.ts. Without this branch the message fell straight
     * through to the bare "Bench Press 135 × 8." below while the CARD was
     * saying "BEST YET · UP FROM 90", so the two disagreed about how
     * interesting the same workout was.
     *
     * That is the exact defect the goal-line comment below this block
     * describes — fixed on the card, not followed through to the message —
     * repeating one branch up. The message is the half that actually travels
     * (§5), so it is the worse half to leave behind.
     *
     * Reuses the PR branch's own wording rather than inventing a second
     * vocabulary for the same fact: `bestSetYet` is `pr.ts`'s phrase for a
     * genuine best that is not literally the heaviest bar ever held, which is
     * precisely what this is. The word "record" is what stays withheld.
     */
    const { lift, weight, reps } = payload.best;
    parts.push(`${lift} ${loadLabel(weight)} × ${reps} — ${t(lang, 'bestSetYet')}, ` +
      `${t(lang, 'upFrom')} ${loadLabel(payload.bestYet.prev)}.`);
  } else if (payload.lifts.length) {
    // Session order, so the message and the card agree about what led the
    // workout. Picking the "biggest" lift instead would mean comparing a leg
    // press against a bench, which is not a comparison that means anything.
    const [name, top] = payload.lifts[0];
    parts.push(`${name} ${top}.`);
  }

  /*
   * The goal is context, and it survives a PR day being about a different lift
   * because a standing direction is true whatever was trained. It follows the
   * work rather than leading it: §5 wants the story, but a story about a lift
   * you did not touch today cannot be the first thing the reader sees.
   *
   * That is what this comment said while the code read `!payload.pr &&`, which
   * is the exact opposite: the goal was dropped precisely on the days it was
   * describing. And it is not a rare case — a lifter who is progressing sets
   * PRs, so for them the goal never reached the caption at all. Same defect the
   * card had, one layer up, found by fixing the card.
   */
  // The narrative slot, whichever fills it — a goal, or §8's second lead for a
  // mature account that has none. Never both; `recapFor` chooses.
  const narrative = payload.goalLine ?? payload.trendLine;
  if (narrative) parts.push(`${narrative}.`);

  // The bodyweight-multiple milestone — see `multiple` in session.ts and
  // `multipleLine` below. Shown on the card unconditionally alongside whatever
  // else is there (R435-438); the message follows the same rule rather than
  // choosing a different subset of the truth to send.
  if (payload.multiple) parts.push(`${payload.multiple}.`);

  /*
   * A volume the app cannot compute is not sent as one. `volumeKnown` is
   * false only for bodyweight work with no reading behind it, where the sum
   * is 0 because the weight ADDED was 0 — so this went out as "0 lb across 1
   * set." for a set of twelve push-ups, to a group chat, over the sender's
   * name. The set count is still a fact and still travels; only the number
   * the app does not have is dropped.
   */
  parts.push(payload.volumeKnown === false
    ? fill(t(lang, 'setsOnly'), {
        sets: payload.sets,
        setWord: t(lang, payload.sets === 1 ? 'setOne' : 'sets')
      })
    : fill(t(lang, 'volumeAcross'), {
        volume: number(payload.volume, lang),
        unit: payload.unit,
        sets: payload.sets,
        setWord: t(lang, payload.sets === 1 ? 'setOne' : 'sets')
      }));
  if (streakWorthShowing(payload.streak)) {
    parts.push(fill(t(lang, payload.streakRecord ? 'weeksRunningRecord' : 'weeksRunning'),
      { n: payload.streak }));
  }

  /*
   * The link, last.
   *
   * §5: the group chat is the destination to design for and "the only
   * destination that can carry a link" — a tappable install path beside the
   * file, rather than a watermark impression that converts close to nobody.
   * `link/` had the landing page, the wire format and the deep-link manifests
   * all built; nothing in the app ever produced a URL, so this message went out
   * as bare text and the strongest acquisition path the product has was simply
   * unused.
   *
   * After the watermark rather than before it, because the watermark is the
   * signature and a URL is the thing a reader taps — putting the mark last would
   * bury it under a 300-character fragment.
   */
  return `${parts.join(' ')} ${payload.watermark} ${shareUrl(payload)}`;
}

/*
 * R463: found genuinely stale, not just unwired. This function's claim chain
 * was written before `firstSession`/`bestYet` existed on `RecapPayload`
 * (R435-442 added them) and never got the branches every other claim
 * consumer received — `recap.tsx`'s own three slabs (pr / firstSession /
 * bestYet, each guarded so exactly one can fire), `spike/recap.js`'s
 * `drawClaim` chain ("must mirror the claim chain above exactly," its own
 * comment says), and `shareText` right above this function all agree on one
 * order: a PR beats a first session beats an early best beats a standing
 * goal beats plain volume. `headline` skipped straight from PR to the goal
 * line, so a first-ever or early-best session — the two cases every sibling
 * surface calls out as the ones most worth getting right — fell through to
 * either a goal line that was not the truest claim available, or the bare
 * volume line. Orphan-scan's exemption for this function used to justify its
 * unused state with a reason that turned out to be false (R462); this is the
 * actual bug that reason was standing in front of.
 */
export function headline(recap: Recap): string {
  const { payload, prs } = recap;
  if (prs.length) return prs[0].claim;
  if (payload.firstSession && payload.best) {
    const { lift, weight, reps } = payload.best;
    return `${lift} ${weight} × ${reps} — session one`;
  }
  if (payload.bestYet && payload.best) {
    const { lift, weight, reps } = payload.best;
    return `${lift} ${weight} × ${reps} — best yet`;
  }
  if (payload.goalLine ?? payload.trendLine) return (payload.goalLine ?? payload.trendLine)!;
  return `${number(payload.volume, 'en')} ${payload.unit} moved`;
}

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { recapFor, latestRecap, headline, shareText, streakWorthShowing } from '../src/ui/recap-model.ts';
import { recentSessions } from '../src/ui/progress-model.ts';
import type { LoggedSet } from '../src/domain/types.ts';
import type { Goal } from '../src/domain/goals.ts';

const DAY = 86_400_000, MIN = 60_000;
const T0 = Date.UTC(2026, 6, 29, 18);
const fresh = () => new Repo(new DatabaseSync(':memory:') as any, () => T0);

let uid = 0;
const mk = (sid: string, ex: string, w: number, r: number, at: number): LoggedSet =>
  ({ id: `x${uid++}`, sessionId: sid, exerciseId: ex, weight: w, reps: r, at });

/** Twelve weekly squat sessions at 215, then today. */
function trained(repo: Repo) {
  for (let w = 12; w >= 1; w--) {
    const at = T0 - w * 7 * DAY;
    repo.startSession(`h${w}`, 'lb');
    repo.logSet(mk(`h${w}`, 'squat', 215, 5, at));
    repo.endSession(`h${w}`, at + 40 * MIN);
  }
}

describe('recap assembly from storage', () => {
  test('a real session produces a full payload', () => {
    const repo = fresh();
    trained(repo);
    repo.startSession('now', 'lb');
    repo.logSet(mk('now', 'squat', 135, 8, T0 - 40 * MIN));
    repo.logSet(mk('now', 'squat', 225, 5, T0 - 20 * MIN));
    repo.endSession('now', T0 - 18 * MIN);

    const r = recapFor(repo, 'now', T0, 'LEG DAY')!;
    assert.equal(r.payload.title, 'LEG DAY');
    assert.equal(r.payload.sets, 2);
    assert.equal(r.payload.volume, 135 * 8 + 225 * 5);
    assert.equal(r.prs.length, 1, 'beating 215x5 is a PR');
    assert.equal(r.payload.pr!.prev, 215);
    assert.equal(r.thin, false);
  });

  test('a stored goal supplies the narrative line', () => {
    const repo = fresh();
    trained(repo);
    const goal: Goal = {
      id: 'g1', exerciseId: 'squat', targetWeight: 315, targetReps: 5,
      targetDate: T0 + 60 * DAY, unit: 'lb', createdAt: T0 - 90 * DAY
    };
    repo.saveGoal(goal);
    repo.startSession('now', 'lb');
    repo.logSet(mk('now', 'squat', 285, 5, T0 - 20 * MIN));
    repo.endSession('now', T0 - 18 * MIN);

    const r = recapFor(repo, 'now', T0)!;
    assert.equal(r.payload.goalLine, '30 lb from a 315 squat');
  });

  test('no goal means no line, not an empty one', () => {
    const repo = fresh();
    trained(repo);
    repo.startSession('now', 'lb');
    repo.logSet(mk('now', 'squat', 225, 5, T0 - 20 * MIN));
    repo.endSession('now', T0 - 18 * MIN);
    assert.equal(recapFor(repo, 'now', T0)!.payload.goalLine, undefined);
  });

  test('a first-ever single set is flagged thin, not hidden', () => {
    const repo = fresh();
    repo.startSession('first', 'lb');
    repo.logSet(mk('first', 'bench', 95, 8, T0 - 10 * MIN));
    repo.endSession('first', T0 - 8 * MIN);

    const r = recapFor(repo, 'first', T0)!;
    assert.equal(r.thin, true, 'worth showing, not worth pushing them to send');
    assert.equal(r.payload.sets, 1);
    assert.equal(r.payload.pr, undefined, 'and it claims no PR on day one');
  });

  test('an empty or unknown session yields nothing rather than an empty card', () => {
    const repo = fresh();
    repo.startSession('empty', 'lb');
    assert.equal(recapFor(repo, 'empty', T0), null);
    assert.equal(recapFor(repo, 'nope', T0), null);
  });

  test("today's sets cannot beat themselves", () => {
    const repo = fresh();
    trained(repo);
    repo.startSession('now', 'lb');
    repo.logSet(mk('now', 'squat', 225, 5, T0 - 30 * MIN));
    repo.logSet(mk('now', 'squat', 230, 5, T0 - 20 * MIN));
    repo.endSession('now', T0 - 18 * MIN);

    const r = recapFor(repo, 'now', T0)!;
    assert.equal(r.prs.length, 1, 'one PR for the exercise, not one per improving set');
    assert.equal(r.payload.pr!.prev, 215, 'measured against history, not against 225');
  });

  test('latestRecap finds the most recent session', () => {
    const repo = fresh();
    trained(repo);
    repo.startSession('now', 'lb');
    repo.logSet(mk('now', 'squat', 240, 5, T0 - 5 * MIN));
    assert.equal(latestRecap(repo, T0)!.payload.lifts[0][1], '240 × 5');
  });
});

describe('recap headline ranking', () => {
  const base = () => {
    const repo = fresh();
    trained(repo);
    return repo;
  };

  test('a PR leads over everything', () => {
    const repo = base();
    repo.saveGoal({ id: 'g1', exerciseId: 'squat', targetWeight: 315, targetReps: 5,
      targetDate: T0 + 60 * DAY, unit: 'lb', createdAt: T0 - 90 * DAY });
    repo.startSession('now', 'lb');
    repo.logSet(mk('now', 'squat', 225, 5, T0 - 20 * MIN));
    repo.endSession('now', T0 - 18 * MIN);
    assert.match(headline(recapFor(repo, 'now', T0)!), /^Heaviest 5-rep squat$/);
  });

  /*
   * R463: `headline` predates `firstSession`/`bestYet` on `RecapPayload` and
   * never got these two branches — the exact defect `shareText`'s own
   * neighbouring tests describe fixing for the message, unfixed here for the
   * function every sibling surface's claim-priority chain agrees comes right
   * after a PR. Confirmed against `recap.tsx`'s three mutually-exclusive
   * slabs and `spike/recap.js`'s "must mirror the claim chain above exactly"
   * branch order: PR, then a first session, then an early best, then a goal.
   */
  test('a first-ever session leads over a goal line, matching every sibling surface', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    repo.saveGoal({ id: 'g1', exerciseId: 'bench', targetWeight: 200, targetReps: 5,
      targetDate: T0 + 60 * DAY, unit: 'lb', createdAt: T0 - 1 * DAY });
    repo.startSession('now', 'lb');
    repo.logSet(mk('now', 'bench', 95, 8, T0));
    repo.endSession('now', T0 + 2 * MIN);
    const recap = recapFor(repo, 'now', T0)!;
    assert.ok(recap.payload.firstSession, 'fixture sanity: this is the first-session case');
    assert.equal(recap.prs.length, 0, 'fixture sanity: §8 never awards a PR on session one');
    assert.match(headline(recap), /^Bench Press 95 × 8/);
    assert.doesNotMatch(headline(recap), /record/i,
      'no record was broken — this is a starting line, not a beaten one');
  });

  test('an early best leads over a goal line too, matching every sibling surface', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    repo.startSession('h1', 'lb');
    repo.logSet(mk('h1', 'bench', 90, 8, T0 - 7 * DAY));
    repo.endSession('h1', T0 - 7 * DAY + 40 * MIN);
    repo.saveGoal({ id: 'g1', exerciseId: 'bench', targetWeight: 200, targetReps: 5,
      targetDate: T0 + 60 * DAY, unit: 'lb', createdAt: T0 - 1 * DAY });
    repo.startSession('now', 'lb');
    repo.logSet(mk('now', 'bench', 135, 8, T0));
    repo.endSession('now', T0 + 2 * MIN);
    const recap = recapFor(repo, 'now', T0)!;
    assert.ok(recap.payload.bestYet, 'fixture sanity: this is the bestYet case');
    assert.equal(recap.prs.length, 0, 'fixture sanity: still too early for a record');
    assert.match(headline(recap), /^Bench Press 135 × 8/);
    assert.doesNotMatch(headline(recap), /record/i,
      'no record was broken yet — §8 has not awarded one');
  });

  test('with no PR, a goal line leads over volume', () => {
    const repo = base();
    repo.saveGoal({ id: 'g1', exerciseId: 'squat', targetWeight: 315, targetReps: 5,
      targetDate: T0 + 60 * DAY, unit: 'lb', createdAt: T0 - 200 * DAY });
    repo.startSession('now', 'lb');
    repo.logSet(mk('now', 'squat', 215, 5, T0 - 20 * MIN));   // matches, does not beat
    repo.endSession('now', T0 - 18 * MIN);
    const h = headline(recapFor(repo, 'now', T0)!);
    assert.match(h, /from a 315 squat$/);
  });

  test('with neither, volume carries it', () => {
    const repo = base();
    repo.startSession('now', 'lb');
    repo.logSet(mk('now', 'squat', 215, 5, T0 - 20 * MIN));
    repo.endSession('now', T0 - 18 * MIN);
    assert.match(headline(recapFor(repo, 'now', T0)!), /lb moved$/);
  });
});

// §5 judges the whole product on whether what leaves the app is worth sending.
// It was `headline(recap) — watermark`, and `headline` is written to sit ON the
// card, above the numbers, so it leaves them out on purpose. Alone it became
// "Heaviest 5-rep bench press — PROOF": the single most postable fact in the
// session, 225, was the one thing missing.
describe('what actually leaves the app (§5)', () => {
  const T = Date.UTC(2026, 6, 31, 18);
  const MIN = 60_000, DAY = 86_400_000;

  function repoOf(rows: Array<[string, string, number, number, number]>): Repo {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    let i = 0;
    for (const [sid, ex, w, r, at] of rows) {
      if (!repo.session(sid)) repo.startSession(sid, 'lb');
      repo.logSet({ id: `x${i++}`, sessionId: sid, exerciseId: ex, weight: w, reps: r, at });
    }
    for (const sid of new Set(rows.map(r => r[0]))) {
      const sets = repo.setsInSession(sid);
      repo.endSession(sid, sets[sets.length - 1].at + 5 * MIN);
    }
    return repo;
  }

  /** Four weeks of bench, then a fifth session that beats all of them. */
  function withPR(): Repo {
    const rows: Array<[string, string, number, number, number]> = [];
    for (let w = 4; w >= 1; w--) rows.push([`h${w}`, 'bench', 180 + (4 - w) * 5, 5, T - w * 7 * DAY]);
    rows.push(['now', 'bench', 225, 5, T]);
    return repoOf(rows);
  }

  test('the number that makes it a PR is IN the message', () => {
    const text = shareText(latestRecap(withPR(), T + 30 * MIN)!);
    assert.match(text, /225/, 'the whole reason to post it was missing');
    assert.match(text, /5/, 'and the reps it was done for');
  });

  test('it says what was beaten, so the claim can be checked', () => {
    assert.match(shareText(latestRecap(withPR(), T + 30 * MIN)!), /up from 195/);
  });

  test('the lift is named, not shouted', () => {
    const text = shareText(latestRecap(withPR(), T + 30 * MIN)!);
    assert.match(text, /Bench Press/, 'the payload carries the real name');
    assert.doesNotMatch(text, /BENCH PRESS/, 'a shouted name mid-sentence reads as a bug');
  });

  /*
   * The goal is context, and it survives a PR day being about a different lift
   * because a standing direction is true whatever was trained.
   *
   * That was what the comment in `shareText` said while the code read
   * `!payload.pr &&`, which is the exact opposite — the goal was dropped
   * precisely on the days the comment was describing, and a lifter who is
   * progressing sets PRs, so for them it never reached the caption at all.
   * Nothing tested it in that direction.
   */
  test('a standing goal reaches the caption even on a PR day', () => {
    const repo = withPR();
    repo.saveGoal({
      id: 'g1', exerciseId: 'bench', targetWeight: 275, targetReps: 5,
      targetDate: T + 90 * DAY, unit: 'lb', createdAt: T - 30 * DAY
    });
    const text = shareText(latestRecap(repo, T + 30 * MIN)!);
    assert.match(text, /275/, 'the target the whole session was aimed at is missing');
    assert.match(text, /up from 195[\s\S]*275/,
      'the goal must FOLLOW the work — a direction cannot lead a record');
  });

  test('and a goal already met does not become the caption', () => {
    // `headlineGoal` refuses a stale trophy; this is the guard that the looser
    // condition did not quietly undo that.
    const repo = withPR();
    repo.saveGoal({
      id: 'g1', exerciseId: 'bench', targetWeight: 200, targetReps: 5,
      targetDate: T + 90 * DAY, unit: 'lb', createdAt: T - 300 * DAY
    });
    const text = shareText(latestRecap(repo, T + 30 * MIN)!);
    assert.match(text, /225/, 'the PR is still the story');
  });

  /*
   * The card and the message have to agree about how interesting a workout
   * was. `bestYet` — beat your own best, too early for §8 to call it a
   * record — was added to the CARD first, and the message kept falling
   * through to the bare "Bench Press 135 × 8." fallback, so the two said
   * different things about the same session. That is the identical defect
   * `shareText`'s own goal-line comment describes, one branch up: fixed on
   * the card, not followed through to the half that actually travels.
   */
  function bestYetRepo(): Repo {
    // Two prior sessions — one short of what §8's cold-start guard needs.
    return repoOf([
      ['h2', 'bench', 90, 8, T - 14 * DAY],
      ['h1', 'bench', 90, 8, T - 7 * DAY],
      ['now', 'bench', 135, 8, T]
    ]);
  }

  test('beating your own best reaches the message, not just the card', () => {
    const recap = latestRecap(bestYetRepo(), T + 30 * MIN)!;
    assert.ok(recap.payload.bestYet, 'fixture sanity: this is the bestYet case');
    assert.equal(recap.payload.pr, undefined, 'fixture sanity: still too early for a record');
    const text = shareText(recap);
    assert.match(text, /135 × 8/, 'the set that made it worth posting');
    assert.match(text, /up from 90/, 'and what it beat, so the claim is checkable');
  });

  test('the message withholds the word "record" exactly as the card does', () => {
    const text = shareText(latestRecap(bestYetRepo(), T + 30 * MIN)!);
    assert.doesNotMatch(text, /record/i,
      '§8 has not awarded one yet — saying so anyway is the crying wolf the guard exists to prevent');
  });

  /*
   * `firstSession` sits in the exact same priority slot `bestYet` occupies
   * right above — and had the identical defect the `bestYet` fix above
   * describes fixing for itself, left unfixed on its neighbour: the message
   * fell straight through to a bare lift line while the card said SESSION
   * ONE / THE ONE TO BEAT. A first-ever workout is "the one most likely to be
   * shared" by the card's own comment, which makes this the least excusable
   * instance of the pattern, not the least important.
   */
  test('a first-ever session reaches the message, not just the card', () => {
    const recap = latestRecap(repoOf([['now', 'bench', 95, 8, T]]), T + 30 * MIN)!;
    assert.ok(recap.payload.firstSession, 'fixture sanity: this is the first-session case');
    assert.equal(recap.payload.pr, undefined, 'fixture sanity: §8 never awards a PR on session one');
    const text = shareText(recap);
    assert.match(text, /95 × 8/, 'the set that made it worth posting');
    assert.doesNotMatch(text, /record/i,
      'no record was broken — this is a starting line, not a beaten record');
  });

  /*
   * R435-438: `multiple` (the bodyweight-milestone line) was computed with
   * real care but kept OUTSIDE RecapPayload entirely, so it never reached this
   * message — visible only on the live in-app screen. Same fixture recipe as
   * progress-model.test.ts's own multipleLine coverage: a 200 lb bodyweight
   * reading and a 350 lb squat is a checkable 1.75x.
   */
  test('a bodyweight milestone reaches the message, not just the card', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.saveMeasurement({ id: 'w1', kind: 'bodyweight', value: 200, unit: 'lb', at: T - 50 * DAY });
    repo.startSession('sq', 'lb', undefined, T - 40 * DAY);
    repo.logSet({ id: 'sq1', sessionId: 'sq', exerciseId: 'squat', weight: 350, reps: 5, at: T - 40 * DAY });
    repo.endSession('sq', T - 40 * DAY + 60_000);
    const recap = recapFor(repo, 'sq', T)!;
    assert.ok(recap.payload.multiple, 'fixture sanity: this should have earned a multiple');
    assert.match(shareText(recap), /1\.75.*bodyweight/i, 'the milestone never reached the message');
  });

  /*
   * "0 lb across 1 set." — sent to a group chat, over the sender's name, for
   * twelve push-ups. R188 took this zero off the recap card and R189 off the
   * shared card; the MESSAGE, which is the half that actually travels, kept
   * saying it. Fourth surface for one claim; see BUILD_LOOP step 4.
   */
  test('a volume the app cannot compute is not sent as one', () => {
    const repo = repoOf([['now', 'pushup', 0, 12, T]]);
    const recap = latestRecap(repo, T + 30 * MIN)!;
    assert.equal(recap.payload.volumeKnown, false, 'fixture sanity: nothing to total');
    const text = shareText(recap);
    assert.doesNotMatch(text, /\b0 lb\b/, 'the message told the chat they moved nothing');
    assert.match(text, /1 set\./, 'the set count is still a fact and still travels');
  });

  test('an ordinary session still carries its volume', () => {
    const repo = repoOf([['now', 'bench', 180, 8, T]]);
    const text = shareText(latestRecap(repo, T + 30 * MIN)!);
    assert.match(text, /1,440 lb across 1 set\./, 'the common path must be untouched');
  });

  test('a plain session with nothing beaten is still left plain', () => {
    // Same two-session history, but today only MATCHES it.
    const flat = repoOf([
      ['h2', 'bench', 90, 8, T - 14 * DAY],
      ['h1', 'bench', 90, 8, T - 7 * DAY],
      ['now', 'bench', 90, 8, T]
    ]);
    const text = shareText(latestRecap(flat, T + 30 * MIN)!);
    assert.doesNotMatch(text, /up from/, 'equalling 90 is not beating it');
  });

  test('a plain session still carries real numbers', () => {
    const plain = repoOf([['s1', 'bench', 95, 8, T], ['s1', 'squat', 135, 5, T + 20 * MIN]]);
    const text = shareText(latestRecap(plain, T + 30 * MIN)!);
    assert.match(text, /1,435/, 'the aggregate is still there behind the work');
    assert.match(text, /2 sets/);
  });

  test('a one-week streak is never dressed up as a habit', () => {
    // §6 makes the streak read 1 the moment anything is logged. Posting
    // "1 weeks running" after a first session would be the app lying for them.
    const plain = repoOf([['s1', 'bench', 95, 8, T]]);
    assert.doesNotMatch(shareText(latestRecap(plain, T + 30 * MIN)!), /running/);
  });

  test('a real streak is worth saying', () => {
    assert.match(shareText(latestRecap(withPR(), T + 30 * MIN)!), /5 weeks running/);
  });

  /*
   * This asserted /PROOF$/ until the share link landed. The rule it was really
   * protecting is that the mark SIGNS the message — it is the last thing the
   * reader reads, after the work and the numbers. A URL is not read, it is
   * tapped, and the end of a chat message is where a call to action belongs, so
   * the link now follows the signature and the mark still closes the prose.
   */
  test('the mark signs it, and the link closes it', () => {
    for (const repo of [withPR(), repoOf([['s1', 'bench', 95, 8, T]])]) {
      const text = shareText(latestRecap(repo, T + 30 * MIN)!);
      assert.match(text, /PROOF https:\/\/\S+$/,
        'the watermark must be the last prose, with only the link after it');
      assert.doesNotMatch(text, /https:\/\/\S+ /,
        'nothing may follow the URL — a trailing word can be swallowed by a linkifier');
    }
  });

  test('one set is a set, not 1 sets', () => {
    const one = repoOf([['s1', 'bench', 95, 8, T]]);
    assert.match(shareText(latestRecap(one, T + 30 * MIN)!), /1 set\./);
  });
});

/*
 * Journey E, second walk. §5 judges the whole product on whether what leaves
 * the app is worth sending, and the group chat is the channel it is designed
 * for. R36 made the message carry the numbers; it carried them only on a PR.
 */
describe('the share message always names the work', () => {
  const T = Date.UTC(2026, 6, 31, 18);
  const MIN = 60_000, DAY = 86_400_000;

  function repoOf(rows: Array<[string, string, number, number, number]>): Repo {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    let i = 0;
    for (const [sid, ex, w, r, at] of rows) {
      if (!repo.session(sid)) repo.startSession(sid, 'lb');
      repo.logSet({ id: `y${i++}`, sessionId: sid, exerciseId: ex, weight: w, reps: r, at });
    }
    for (const sid of new Set(rows.map(r => r[0]))) {
      const sets = repo.setsInSession(sid);
      repo.endSession(sid, sets[sets.length - 1].at + 5 * MIN);
    }
    return repo;
  }

  function withPR(): Repo {
    const rows: Array<[string, string, number, number, number]> = [];
    for (let w = 4; w >= 1; w--) rows.push([`h${w}`, 'bench', 180 + (4 - w) * 5, 5, T - w * 7 * DAY]);
    rows.push(['now', 'bench', 225, 5, T]);
    return repoOf(rows);
  }

  /*
   * The defect, measured on the running app. A push session of Bench Press
   * 175 × 5 and Overhead Press 95 × 8 went out as:
   *
   *   "30 lb from a 225 squat. 4,905 lb across 6 sets. 13 weeks running. PROOF"
   *
   * The one lift named was SQUAT, which was not trained that day, and nothing
   * the reader could react to was in it. §8 makes PRs deliberately rare, so
   * this is not the edge case — it is nearly every session.
   */
  test('a session with no PR still says what was lifted', () => {
    const plain = repoOf([['s1', 'bench', 175, 5, T], ['s1', 'ohp', 95, 8, T + 20 * MIN]]);
    const text = shareText(latestRecap(plain, T + 30 * MIN)!);
    assert.match(text, /Bench Press 175 × 5/,
      'this is the bug: not one lift the user actually did appeared in the message');
  });

  test('it opens with the work, not with the totals', () => {
    const plain = repoOf([['s1', 'bench', 175, 5, T], ['s1', 'ohp', 95, 8, T + 20 * MIN]]);
    const text = shareText(latestRecap(plain, T + 30 * MIN)!);
    assert.ok(text.startsWith('Bench Press'), `opened with: ${text.slice(0, 40)}`);
  });

  test('one lift, not the whole session — it has two seconds in a thread', () => {
    const many = repoOf([
      ['s1', 'bench', 175, 5, T], ['s1', 'ohp', 95, 8, T + 10 * MIN],
      ['s1', 'row', 135, 8, T + 20 * MIN], ['s1', 'curl', 40, 10, T + 30 * MIN]
    ]);
    const text = shareText(latestRecap(many, T + 40 * MIN)!);
    assert.match(text, /Bench Press 175 × 5/);
    assert.doesNotMatch(text, /Bicep Curl/, 'the aggregate sentence already covers the rest');
  });

  test('a PR still leads — it outranks the plain top set', () => {
    const text = shareText(latestRecap(withPR(), T + 30 * MIN)!);
    assert.match(text, /heaviest ever/);
    assert.ok(text.startsWith('Bench Press 225 × 5 — heaviest ever'), text.slice(0, 50));
  });

  /*
   * §5 is blunt: goals must feed the output or the screen gets cut. They still
   * do — they just no longer speak before the workout does, because a story
   * about a lift you did not touch today cannot be the first thing read.
   */
  test('the goal line survives, behind the work', () => {
    const repo = repoOf([
      ['old', 'squat', 185, 5, T - 45 * DAY],   // baseline, before the goal
      ['mid', 'squat', 195, 5, T - 30 * DAY],   // moved since -> the goal has a line
      ['s1', 'bench', 175, 5, T]                // today: a push session
    ]);
    repo.saveGoal({
      id: 'g1', exerciseId: 'squat', targetWeight: 225, targetReps: 5,
      createdAt: T - 40 * DAY, targetDate: T + 60 * DAY, unit: 'lb'
    } as Goal);
    const text = shareText(latestRecap(repo, T + 30 * MIN)!);
    assert.match(text, /Bench Press 175 × 5/, 'the work is still first');
    assert.match(text, /squat/, 'and the goal still reaches the shareable (§5)');
    assert.ok(text.indexOf('Bench Press') < text.indexOf('squat'),
      'a goal about an untrained lift must not open the message');
  });

  test('the watermark is still the last thing before the link', () => {
    const plain = repoOf([['s1', 'bench', 175, 5, T]]);
    const text = shareText(latestRecap(plain, T + 30 * MIN)!);
    const mark = text.indexOf('PROOF'), link = text.indexOf('https://');
    assert.ok(mark > 0 && link > mark, 'the mark closes the prose; the link closes the message');
    assert.equal(text.slice(mark + 'PROOF'.length + 1), text.slice(link),
      'nothing sits between the mark and the link');
  });
});

/*
 * Journey H, second walk. Its question is whether anything reads as broken in
 * the empty and edge states, and the thinnest recap there is — one set, ever —
 * was crediting the user with a week-long streak.
 */
describe('a streak has to be real before it is shown', () => {
  const T = Date.UTC(2026, 6, 31, 18);
  const MIN = 60_000, DAY = 86_400_000;

  function repoOf(rows: Array<[string, string, number, number, number]>): Repo {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    let i = 0;
    for (const [sid, ex, w, r, at] of rows) {
      if (!repo.session(sid)) repo.startSession(sid, 'lb');
      repo.logSet({ id: `z${i++}`, sessionId: sid, exerciseId: ex, weight: w, reps: r, at });
    }
    for (const sid of new Set(rows.map(r => r[0]))) {
      const sets = repo.setsInSession(sid);
      repo.endSession(sid, sets[sets.length - 1].at + 5 * MIN);
    }
    return repo;
  }

  /*
   * §6 makes `weekStreak` read 1 the moment anything is logged. R36 kept that
   * out of the share message; the card printed `STREAK · 1 WK` beside SETS and
   * TIME regardless — measured on a first-ever session in the running app.
   */
  test('a first-ever session has no streak worth showing', () => {
    assert.equal(streakWorthShowing(1), false,
      'this is the bug: the card credited a first set with a week');
    assert.equal(streakWorthShowing(0), false);
  });

  test('two weeks is a habit, and gets said', () => {
    assert.equal(streakWorthShowing(2), true);
    assert.equal(streakWorthShowing(13), true);
  });

  // The point of extracting it: the card and the message cannot drift apart.
  test('both surfaces answer to the same threshold', () => {
    const first = repoOf([['s1', 'bench', 95, 8, T]]);
    const text = shareText(latestRecap(first, T + 30 * MIN)!);
    const payload = latestRecap(first, T + 30 * MIN)!.payload;
    assert.equal(streakWorthShowing(payload.streak), false);
    assert.doesNotMatch(text, /running/, 'the message already knew; the card did not');
  });

  test('a real streak still reaches both', () => {
    const rows: Array<[string, string, number, number, number]> = [];
    for (let w = 5; w >= 0; w--) rows.push([`h${w}`, 'bench', 135, 5, T - w * 7 * DAY]);
    const recap = latestRecap(repoOf(rows), T + 30 * MIN)!;
    assert.equal(streakWorthShowing(recap.payload.streak), true);
    assert.match(shareText(recap), /weeks running/);
  });

  test('the payload still carries the true number — only the display is gated', () => {
    const first = repoOf([['s1', 'bench', 95, 8, T]]);
    assert.equal(latestRecap(first, T + 30 * MIN)!.payload.streak, 1,
      'the clip renderer and the harness read this field; it must stay honest');
  });
});

/*
 * FINISH used to be one-way, and it is the last thing you tap while still stood
 * in the gym — exactly when you notice the set you typed wrong. The only route
 * back was a NEW workout, which splits one session in two and files the fix on
 * the wrong day.
 */
describe('a finished workout can be reopened', () => {
  const T = Date.UTC(2026, 7, 21, 18);
  const MIN_ = 60_000;

  function finished() {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'a', sessionId: 's1', exerciseId: 'bench', weight: 145, reps: 8, at: T });
    repo.logSet({ id: 'b', sessionId: 's1', exerciseId: 'bench', weight: 155, reps: 5, at: T + MIN_ });
    repo.endSession('s1', T + 30 * MIN_);
    return repo;
  }

  test('the recap says which session it is of', () => {
    const repo = finished();
    assert.equal(latestRecap(repo, T + 40 * MIN_)!.sessionId, 's1');
  });

  test('reopening makes it live again', () => {
    const repo = finished();
    assert.equal(repo.liveSession(), null, 'it is finished to start with');
    assert.equal(repo.reopenSession('s1'), true);
    assert.equal(repo.liveSession()?.id, 's1', 'the app has to find it again');
  });

  test('and nothing about the work changes', () => {
    const repo = finished();
    const before = repo.setsInSession('s1');
    repo.reopenSession('s1');
    const after = repo.setsInSession('s1');
    assert.deepEqual(after, before, 'the sets, their times and their order are untouched');
    assert.equal(repo.session('s1')!.startedAt, T, 'and it is still the same day');
  });

  test('finishing again just sets a later end', () => {
    const repo = finished();
    repo.reopenSession('s1');
    repo.endSession('s1', T + 50 * MIN_);
    assert.equal(repo.session('s1')!.endedAt, T + 50 * MIN_);
    assert.equal(repo.liveSession(), null);
  });

  test('a session that is not there cannot be reopened', () => {
    const repo = finished();
    assert.equal(repo.reopenSession('nope'), false);
    assert.equal(repo.liveSession(), null, 'and nothing was resurrected');
  });

  test('the corrected session is still ONE session, not two', () => {
    const repo = finished();
    repo.reopenSession('s1');
    repo.logSet({ id: 'c', sessionId: 's1', exerciseId: 'bench', weight: 165, reps: 3, at: T + 45 * MIN_ });
    assert.equal(repo.setsInSession('s1').length, 3);
    assert.equal(latestRecap(repo, T + 60 * MIN_)!.sessionId, 's1',
      'the fix belongs to the workout it corrects');
  });
});

/*
 * The recap screen said "WORKOUT" for every session ever recorded, while the
 * shared card was handed "PUSH DAY" and the Progress history derived the day
 * itself. Three surfaces, two answers, and the vague one was what you saw
 * immediately after finishing.
 */
describe('a workout is called the same thing everywhere', () => {
  const T = Date.UTC(2026, 7, 22, 18);
  const MIN_ = 60_000;

  function pushDay() {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'a', sessionId: 's1', exerciseId: 'bench', weight: 145, reps: 8, at: T });
    repo.logSet({ id: 'b', sessionId: 's1', exerciseId: 'triext', weight: 40, reps: 12, at: T + MIN_ });
    repo.endSession('s1', T + 30 * MIN_);
    return repo;
  }

  test('the recap names the day without being told', () => {
    assert.equal(latestRecap(pushDay(), T + 40 * MIN_)!.payload.title, 'PUSH DAY');
  });

  test('and the history calls it exactly the same thing', () => {
    const repo = pushDay();
    assert.equal(recentSessions(repo)[0].title, latestRecap(repo, T + 40 * MIN_)!.payload.title);
  });

  test('an explicit title still wins — the card names its own', () => {
    assert.equal(recapFor(pushDay(), 's1', T + 40 * MIN_, 'LEG DAY')!.payload.title, 'LEG DAY');
  });

  /*
   * This test was named "a session the lifts cannot agree on is a WORKOUT,
   * not a guess" and asserted `title === 'WORKOUT' || /DAY$/.test(title)` —
   * satisfied by every possible output of `sessionTitle`, so it enforced
   * nothing while reading as coverage of a documented rule. `sessionTitle`'s
   * own comment made the same claim, and the behaviour has never matched it:
   * a bench + squat + row session titles as PUSH DAY.
   *
   * Rewritten to assert what the code actually does, because majority-wins is
   * the right rule and unanimity is not — see the note now on `sessionTitle`
   * about `PLAN_DAY_COVERS`. The surfaces-agree half was the only real
   * assertion here and it is kept.
   */
  const mixed = () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.startSession('m', 'lb');
    repo.logSet({ id: 'a', sessionId: 'm', exerciseId: 'bench', weight: 145, reps: 8, at: T });
    repo.logSet({ id: 'b', sessionId: 'm', exerciseId: 'squat', weight: 225, reps: 5, at: T + MIN_ });
    repo.logSet({ id: 'c', sessionId: 'm', exerciseId: 'row', weight: 135, reps: 8, at: T + 2 * MIN_ });
    repo.endSession('m', T + 30 * MIN_);
    return repo;
  };

  test('a mixed session takes the day most of its lifts belong to', () => {
    const title = latestRecap(mixed(), T + 40 * MIN_)!.payload.title;
    assert.equal(title, 'PUSH DAY',
      'one push, one pull, one legs — push led, so push names it');
  });

  /*
   * The bug `sessionTitle`'s own comment used to (wrongly) describe. Same
   * session as above — bench, squat, row — but on an upper/lower plan. Voting
   * at the push/pull/legs level splits it 1-1-1 (bench=push, row=pull both
   * count separately) and the first-trained tiebreak names it PUSH DAY, which
   * is not even a day upper/lower has. `PLAN_DAY_COVERS` makes bench AND row
   * both "upper", so the honest count is 2 upper to 1 lower. Closed R268.
   */
  test('the same mixed session, on an upper/lower plan, votes in that plan’s own days', () => {
    const repo = mixed();
    repo.setPref('split.plan', 'upper-lower');
    const title = latestRecap(repo, T + 40 * MIN_)!.payload.title;
    assert.equal(title, 'UPPER DAY',
      'bench and row are both upper under PLAN_DAY_COVERS — 2 upper beats 1 lower');
  });

  test('and the two surfaces that name it still agree', () => {
    const repo = mixed();
    assert.equal(recentSessions(repo)[0].title, latestRecap(repo, T + 40 * MIN_)!.payload.title,
      'the recap and the history list named one session two different things');
  });

  test('and still agree on an upper/lower plan, not just the PPL default', () => {
    // The plan has to reach BOTH surfaces for this to mean anything — each one
    // reads `planOf(repo)` independently, so a fix landed in only one of them
    // would pass the PPL-default test above and still disagree here.
    const repo = mixed();
    repo.setPref('split.plan', 'upper-lower');
    assert.equal(recentSessions(repo)[0].title, latestRecap(repo, T + 40 * MIN_)!.payload.title);
    assert.equal(recentSessions(repo)[0].title, 'UPPER DAY');
  });

  test('WORKOUT is for a session with no known day at all', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.addExercise('invented', 'Invented Thing');
    repo.startSession('u', 'lb');
    repo.logSet({ id: 'z', sessionId: 'u', exerciseId: 'invented', weight: 100, reps: 5, at: T });
    repo.endSession('u', T + 20 * MIN_);
    assert.equal(latestRecap(repo, T + 30 * MIN_)!.payload.title, 'WORKOUT',
      'a movement the user invented has no split day, so there is nothing to claim');
  });
});

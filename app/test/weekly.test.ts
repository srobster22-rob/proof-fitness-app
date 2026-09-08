import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { weeklyComparison, weeklyCard, LOOKBACK_DAYS } from '../src/domain/weekly.ts';
import type { LoggedSet, Exercise } from '../src/domain/types.ts';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { weeklyLine, shareWeeklyText } from '../src/ui/progress-model.ts';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE_ = path.dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
/** The landing page's own copy — the thing that has to be able to read this. */
const ShareURL = require_(path.join(HERE_, '..', '..', 'link', 'share-url.js'));
import { PREF_LANG } from '../src/domain/i18n.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 27, 12);

const EX = new Map<string, Exercise>([
  ['squat', { id: 'squat', name: 'Squat' } as Exercise],
  ['bench', { id: 'bench', name: 'Bench Press' } as Exercise],
  ['curl', { id: 'curl', name: 'Bicep Curl' } as Exercise]
]);

let n = 0;
const set = (exerciseId: string, weight: number, reps: number, daysAgo: number,
             sessionId = 's' + daysAgo): LoggedSet =>
  ({ id: 'x' + n++, sessionId, exerciseId, weight, reps, at: NOW - daysAgo * DAY } as LoggedSet);

/*
 * §10's rest-day claim: "your squat is up 15 lb since four weeks ago".
 *
 * §5 names the same artifact — a goal must feed "the recap AND the weekly
 * card" — and nothing had ever built it. The rule that decides what is TRUE is
 * separated from the card and the schedule so it can be tested without a clock
 * or a renderer, the same split every other claim here uses.
 */
describe('the weekly comparison says something true or says nothing', () => {
  test('it finds a real gain at the reps actually being worked', () => {
    const c = weeklyComparison([
      set('squat', 300, 5, 35),
      set('squat', 325, 5, 3)
    ], EX, NOW);
    assert.ok(c);
    assert.equal(c!.lift, 'Squat');
    assert.equal(c!.reps, 5);
    assert.equal(c!.then, 300);
    assert.equal(c!.now, 325);
    assert.equal(c!.gain, 25);
    assert.equal(c!.days, LOOKBACK_DAYS);
  });

  test('a lift with no baseline is never claimed', () => {
    /*
     * The cry-wolf case, and the one that matters most. A lift first trained
     * three weeks ago has nothing on the far side of the cutoff — reporting
     * "up 185 lb since four weeks ago" would be a claim about a month the user
     * did not train it. §8 forbids exactly this for PRs.
     */
    const c = weeklyComparison([
      set('bench', 135, 5, 40),          // gives the window something older
      set('squat', 185, 5, 20),
      set('squat', 225, 5, 2)
    ], EX, NOW);
    assert.equal(c?.exerciseId, undefined,
      'a lift with no pre-cutoff history was surfaced anyway');
  });

  test('going backwards says nothing at all', () => {
    const c = weeklyComparison([
      set('squat', 325, 5, 35),
      set('squat', 300, 5, 3)
    ], EX, NOW);
    assert.equal(c, null);
  });

  test('standing still says nothing either', () => {
    const c = weeklyComparison([
      set('squat', 300, 5, 35),
      set('squat', 300, 5, 3)
    ], EX, NOW);
    assert.equal(c, null, 'a flat month is not a comparison worth posting');
  });

  test('an empty or one-sided history is null, not a guess', () => {
    assert.equal(weeklyComparison([], EX, NOW), null);
    assert.equal(weeklyComparison([set('squat', 300, 5, 2)], EX, NOW), null);
    assert.equal(weeklyComparison([set('squat', 300, 5, 40)], EX, NOW), null);
  });

  test('the biggest absolute gain wins, not the biggest percentage', () => {
    /*
     * A curl going 20 to 30 is +50% and a squat going 300 to 325 is +8%.
     * Nobody posts the curl. "Up 25 lb" is the sentence a lifter repeats.
     */
    const c = weeklyComparison([
      set('curl', 20, 10, 35), set('curl', 30, 10, 3),
      set('squat', 300, 5, 35), set('squat', 325, 5, 3)
    ], EX, NOW);
    assert.equal(c!.lift, 'Squat');
    assert.equal(c!.gain, 25);
  });

  test('a heavier set at MORE reps counts toward the same baseline', () => {
    // The window is compared at the LOWEST rep count worked recently, and
    // `bestWeightAtReps` counts a set at that count or more — so an 8-rep set
    // beats a 5-rep baseline, the same rule `findPRs` uses.
    const c = weeklyComparison([
      set('bench', 185, 5, 35),
      set('bench', 200, 8, 3),
      set('bench', 190, 5, 3)
    ], EX, NOW);
    assert.ok(c);
    assert.equal(c!.reps, 5);
    assert.equal(c!.gain, 15, 'the 200 x 8 should be the best set at 5+ reps');
  });

  test('moving to a rep range with no history says nothing', () => {
    /*
     * Written the other way round first, asserting that fives-to-eights was a
     * 15 lb gain, and the code was right to refuse it: at 8 reps there is no
     * like-for-like baseline, because `bestWeightAtReps` only counts sets at
     * the target reps OR MORE. Comparing 200 x 8 against 185 x 5 would be
     * inventing a comparison the lifter never made.
     */
    const c = weeklyComparison([
      set('bench', 185, 5, 35),
      set('bench', 200, 8, 3)
    ], EX, NOW);
    assert.equal(c, null);
  });

  test('sets logged in kilos are converted before being compared', () => {
    /*
     * A LoggedSet carries no unit — the SESSION owns it — so any comparison
     * across sessions is silently wrong for anyone who has switched. Five
     * separate bugs of this exact shape have been found in this codebase, and
     * none of them looked like a bug: 100 kg would read as 100 lb and a real
     * gain would come out as a loss.
     */
    const units = new Map([['old', 'kg' as const], ['new', 'lb' as const]]);
    const c = weeklyComparison([
      { ...set('squat', 100, 5, 35), sessionId: 'old' },
      { ...set('squat', 250, 5, 3), sessionId: 'new' }
    ], EX, NOW, 'lb', [], units);
    // 100 kg is 220.5 lb, so 250 lb is a gain of about 29.5 — not 150.
    assert.ok(c);
    assert.ok(c!.gain > 25 && c!.gain < 35,
      `expected roughly 29.5 lb of gain, got ${c!.gain} — the kg session was read as pounds`);
  });

  test('the lookback is a real window, not the age of the oldest set', () => {
    // `days` describes the claim ("since four weeks ago"), so it has to be the
    // window, not whenever the baseline set happened to be logged.
    const c = weeklyComparison([
      set('squat', 300, 5, 300),
      set('squat', 325, 5, 1)
    ], EX, NOW);
    assert.equal(c!.days, LOOKBACK_DAYS);
  });

  test('a shorter lookback can be asked for and is honoured', () => {
    const sets = [set('squat', 300, 5, 10), set('squat', 325, 5, 1)];
    assert.equal(weeklyComparison(sets, EX, NOW), null, '10 days ago is inside a 28-day window');
    const c = weeklyComparison(sets, EX, NOW, 'lb', [], new Map(), 7);
    assert.equal(c!.gain, 25);
    assert.equal(c!.days, 7);
  });

  test('an unnamed lift falls back to its id rather than rendering undefined', () => {
    const c = weeklyComparison([
      set('mystery', 100, 5, 35),
      set('mystery', 120, 5, 3)
    ], new Map(), NOW);
    assert.equal(c!.lift, 'mystery');
  });
});

/*
 * The sentence, in the language the app is set to.
 *
 * `weeklyLine` is the half of this that reaches a screen, so it is the half a
 * missing translation would break — and the recap's goal line went out in
 * English on a Spanish card once already, because one call site never got the
 * language. Checked through a real `Repo` rather than a fixture, so the
 * language really is read the way the screen reads it.
 */
/** Shared by both language describe blocks below — a real 25 lb gain over 4 weeks. */
const build = (lang?: 'es') => {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => NOW);
  if (lang) repo.setPref(PREF_LANG, lang);
  repo.startSession('old', 'lb');
  repo.logSet({ id: 'o1', sessionId: 'old', exerciseId: 'squat', weight: 300, reps: 5, at: NOW - 35 * DAY });
  repo.startSession('new', 'lb');
  repo.logSet({ id: 'n1', sessionId: 'new', exerciseId: 'squat', weight: 325, reps: 5, at: NOW - 2 * DAY });
  return repo;
};

describe('the rest-day line speaks the app language', () => {

  test('English reads as §10 words it', () => {
    const line = weeklyLine(build(), NOW);
    assert.ok(line, 'a real 25 lb gain produced no line at all');
    assert.match(line!, /is up 25 lb since 4 weeks ago/);
  });

  test('Spanish is translated, not a fallback', () => {
    const line = weeklyLine(build('es'), NOW);
    assert.ok(line);
    assert.match(line!, /subió 25 lb en 4 semanas/);
    assert.doesNotMatch(line!, /is up|since/);
  });

  test('a database with nothing to say says nothing', () => {
    // The common case. §8's cry-wolf rule is about every claim this app makes,
    // and an invented comparison on a rest day is the worst kind: there is no
    // workout in front of the user to check it against.
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => NOW);
    assert.equal(weeklyLine(repo, NOW), null);
  });

  /*
   * R313: this is exactly why `app/recap.tsx` freezes `now` at the session's
   * own end when opened from Progress's history list, instead of passing
   * today's real clock. `weeklyLine` compares against the window ENDING at
   * `now` — right when a card is read the day it was made, wrong for a card
   * reopened weeks later, when there is nothing trained anywhere near the
   * real "now" to anchor a comparison against. A historical viewer that
   * naively passed `Date.now()` would show yesterday's true, checkable trend
   * as a rest-day silence instead — the exact failure §8's cry-wolf rule
   * exists to prevent, just approached from the other direction.
   */
  test('the same real gain goes silent once "now" drifts past the window', () => {
    const repo = build();
    assert.ok(weeklyLine(repo, NOW), 'sanity: the fixture has something to say at its own time');
    assert.equal(weeklyLine(repo, NOW + 90 * DAY), null,
      'a "now" from months later has nothing near it to compare, and must not invent one');
  });
});

/*
 * `weeklyCard` and the wire format have both understood `kind: 'weekly'`
 * since R228/R271 — `shareText`'s recap is where a session's own claim
 * reaches a share sheet, and nothing did the same job for the rest-day
 * claim. §10 calls it "already formatted as a postable card"; a card no
 * screen ever asks for is not postable, it is dead code with a renderer.
 */
describe('the rest-day claim can actually be sent (§10)', () => {
  test('the message is the same sentence the screen shows, plus a link', () => {
    const repo = build();
    const line = weeklyLine(repo, NOW);
    const message = shareWeeklyText(repo, NOW);
    assert.ok(message);
    assert.ok(message!.startsWith(line!),
      'the shared message must not say something different from the banner it came from');
    assert.match(message!, /https?:\/\//, 'no link — the acquisition path §5 built is unused');
  });

  test('the link decodes back to the same claim, on the landing page\'s own code', () => {
    const repo = build();
    const message = shareWeeklyText(repo, NOW)!;
    const url = message.match(/https?:\S+/)![0];
    const decoded = ShareURL.readURL(url);
    assert.equal(decoded.kind, 'weekly');
    assert.equal(decoded.title, 'SQUAT');
    assert.equal(decoded.volume, 25);
    assert.deepEqual(decoded.lifts, [['Squat', '300 → 325', true]]);
  });

  test('Spanish rides the link too, not just the visible sentence', () => {
    const repo = build('es');
    const message = shareWeeklyText(repo, NOW)!;
    const url = message.match(/https?:\S+/)![0];
    assert.equal(ShareURL.readURL(url).lang, 'es');
  });

  test('nothing to say is nothing to send', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => NOW);
    assert.equal(shareWeeklyText(repo, NOW), null);
  });
});

/*
 * §10's "already formatted as a postable card".
 *
 * A rest-day claim nobody can send is a rest-day claim that does no work, so
 * the comparison has to reach the same renderer the recap uses — and reusing
 * that payload shape rather than inventing a second layout is what keeps it
 * from acquiring its own layout bugs.
 */
describe('the comparison is a card, not only a sentence', () => {
  const cmp = () => weeklyComparison([
    set('squat', 220, 5, 35),
    set('squat', 240, 5, 3)
  ], EX, NOW)!;

  test('the hero is the gain, and the card says which lift', () => {
    const card = weeklyCard(cmp(), 'lb');
    assert.equal(card.kind, 'weekly');
    assert.equal(card.volume, 20);
    assert.equal(card.title, 'SQUAT');
    assert.equal(card.date, '4 WEEKS');
    assert.equal(card.unit, 'lb');
  });

  test('it carries the two numbers the gain came from', () => {
    // §16: a number the reader cannot check is one they cannot trust, and
    // "+20" alone asks them to take it on faith.
    const card = weeklyCard(cmp(), 'lb');
    assert.deepEqual(card.lifts, [['Squat', '220 → 240', true]]);
  });

  test('it claims no session statistics, because there was no session', () => {
    const card = weeklyCard(cmp(), 'lb');
    for (const k of ['sets', 'duration', 'streak', 'pr', 'best', 'goalLine']) {
      assert.equal(k in card, false, `a weekly card must not carry ${k}`);
    }
  });

  test('English rides absent and Spanish rides, exactly as on the wire', () => {
    assert.equal('lang' in weeklyCard(cmp(), 'lb', 'PROOF', 'en'), false);
    assert.equal(weeklyCard(cmp(), 'lb', 'PROOF', 'es').lang, 'es');
  });

  test('one week reads as a week, not "1 WEEKS"', () => {
    const c = weeklyComparison(
      [set('squat', 220, 5, 10), set('squat', 240, 5, 1)], EX, NOW, 'lb', [], new Map(), 7)!;
    assert.equal(weeklyCard(c, 'lb').date, '1 WEEK');
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoEnd, isStale, weekStreak, longestStreakBefore, sessionStats, topSetPerExercise, buildRecap, IDLE_END_MS
} from '../src/domain/session.ts';
import { findPRs } from '../src/domain/pr.ts';
import type { LoggedSet, Session, Exercise } from '../src/domain/types.ts';

const DAY = 86_400_000;
const MIN = 60_000;
const NOW = Date.UTC(2026, 6, 29, 18, 0, 0);

const exercises = new Map<string, Exercise>([
  ['bench', { id: 'bench', name: 'Bench Press' }],
  ['ohp', { id: 'ohp', name: 'OHP' }]
]);

let uid = 0;
const s = (exerciseId: string, weight: number, reps: number, at: number, sessionId = 'now'): LoggedSet =>
  ({ id: `x${uid++}`, sessionId, exerciseId, weight, reps, at });

const live = (startedAt: number, updatedAt = startedAt): Session =>
  ({ id: 'now', startedAt, endedAt: null, unit: 'lb', updatedAt });

describe('session lifecycle (§8)', () => {
  test('stays open while sets are still arriving', () => {
    const session = live(NOW - 40 * MIN);
    const sets = [s('bench', 225, 5, NOW - 5 * MIN)];
    assert.equal(isStale(session, sets, NOW), false);
    assert.equal(autoEnd(session, sets, NOW).endedAt, null);
  });

  test('auto-ends after the idle window, backdated to the last set', () => {
    const lastAt = NOW - (IDLE_END_MS + 10 * MIN);
    const session = live(lastAt - 45 * MIN);
    const sets = [s('bench', 225, 5, lastAt)];
    assert.equal(isStale(session, sets, NOW), true);
    assert.equal(autoEnd(session, sets, NOW).endedAt, lastAt,
      'a session left open overnight must not report a nine-hour duration');
  });

  test('an already-ended session is never re-ended', () => {
    const ended: Session = {
      id: 'x', startedAt: NOW - DAY, endedAt: NOW - DAY + 30 * MIN, unit: 'lb', updatedAt: NOW - DAY
    };
    assert.equal(autoEnd(ended, [], NOW).endedAt, ended.endedAt);
    assert.equal(isStale(ended, [], NOW), false);
  });

  /*
   * R333: found by driving the app with the app killed mid-workout — a
   * session left open with its last set well past the idle window,
   * discovered and auto-ended, then REOPENED to fix a mistake. The very
   * next read asked `isStale` the same question it always had — "when was
   * the last SET" — got the same stale answer, and closed the session
   * again before the correction could land. `reopenSession` touches the
   * row and nothing else, so `updatedAt` is the only signal that says
   * "someone just did something here", and the idle rule has to honour it.
   */
  test('reopening a stale session buys it a fresh idle window, not an instant re-close', () => {
    const lastSetAt = NOW - (IDLE_END_MS + 2 * DAY);
    const sets = [s('bench', 225, 5, lastSetAt)];
    // Reopened right now: the row was just touched, the set is still ancient.
    const reopened = live(lastSetAt - 40 * MIN, NOW);
    assert.equal(isStale(reopened, sets, NOW), false,
      'a session touched moments ago must not read as abandoned');
    assert.equal(autoEnd(reopened, sets, NOW).endedAt, null,
      'the reopen must survive the very next read, not close itself instantly');
  });

  test('...but the fresh window still expires like any other idle session', () => {
    const lastSetAt = NOW - (IDLE_END_MS + 2 * DAY);
    const touchedAt = NOW - (IDLE_END_MS + 10 * MIN); // the reopen itself is now stale
    const sets = [s('bench', 225, 5, lastSetAt)];
    const reopened = live(lastSetAt - 40 * MIN, touchedAt);
    assert.equal(isStale(reopened, sets, NOW), true,
      'a reopen is a fresh 90 minutes, not an exemption forever');
    assert.equal(autoEnd(reopened, sets, NOW).endedAt, lastSetAt,
      'still backdates to the real last SET, not to when it was reopened');
  });

  test('an empty session still ends, off its start time', () => {
    const session = live(NOW - (IDLE_END_MS + MIN));
    assert.equal(autoEnd(session, [], NOW).endedAt, session.startedAt);
  });
});

describe('streak (§10)', () => {
  test('counts consecutive weeks that contain training', () => {
    const sets = [0, 7, 14, 21].map(d => s('bench', 100, 5, NOW - d * DAY, `w${d}`));
    assert.equal(weekStreak(sets, NOW), 4);
  });

  test('a gap week breaks it', () => {
    const sets = [0, 7, 21, 28].map(d => s('bench', 100, 5, NOW - d * DAY, `w${d}`));
    assert.equal(weekStreak(sets, NOW), 2, 'the missing third week ends the run');
  });

  test('the current week is grace, not a miss', () => {
    // Nothing logged yet this week; last session was 3 days ago in the prior week.
    const sets = [8, 15, 22].map(d => s('bench', 100, 5, NOW - d * DAY, `w${d}`));
    const streak = weekStreak(sets, NOW);
    assert.ok(streak >= 3, `expected the run to survive an untrained current week, got ${streak}`);
  });

  test('no training is no streak', () => {
    assert.equal(weekStreak([], NOW), 0);
  });
});

describe('longestStreakBefore — the bar THIS streak has to clear to be a record', () => {
  test('one continuous run has nothing before it', () => {
    // The exact bug caught while writing this: counting week-by-week and
    // excluding only the single week equal to `cursor` leaves the OTHER weeks
    // of this same multi-week run free to count toward "best" — a 3-week run
    // would read as having a 2-week run before it, when there is only one run
    // in the whole history.
    const sets = [0, 7, 14].map(d => s('bench', 100, 5, NOW - d * DAY, `w${d}`));
    assert.equal(weekStreak(sets, NOW), 3);
    assert.equal(longestStreakBefore(sets, NOW), 0,
      'a single 3-week run has no separate run before it, however long it is');
  });

  test('a genuinely earlier run is the bar to clear', () => {
    // A 2-week run 4 and 3 weeks back, a full untrained week at -2, then the
    // current 2-week run at -1 and this week. Day offsets in multiples of 7,
    // same pattern the other streak tests use, so the gap at day 14 is a real
    // gap and not an artefact of which weekday `NOW` happens to fall on.
    const sets = [
      ...[28, 21].map(d => s('bench', 100, 5, NOW - d * DAY, `old${d}`)),
      ...[7, 0].map(d => s('bench', 100, 5, NOW - d * DAY, `now${d}`))
    ];
    assert.equal(weekStreak(sets, NOW), 2);
    assert.equal(longestStreakBefore(sets, NOW), 2, 'the old 2-week run is what has to be beaten');
  });

  test('no training at all has nothing to beat', () => {
    assert.equal(longestStreakBefore([], NOW), 0);
  });

  test('the record bar ignores the run in progress even mid-run', () => {
    // Same fixture as the grace-period weekStreak test above: nothing logged
    // yet this week, but the run is still "current" and must still be excluded.
    const sets = [8, 15, 22].map(d => s('bench', 100, 5, NOW - d * DAY, `w${d}`));
    assert.equal(longestStreakBefore(sets, NOW), 0);
  });
});

describe('stats and recap assembly', () => {
  const sets = [
    s('bench', 135, 8, NOW - 50 * MIN), s('bench', 225, 5, NOW - 40 * MIN),
    s('bench', 230, 5, NOW - 35 * MIN), s('ohp', 115, 6, NOW - 20 * MIN)
  ];
  const session: Session = {
    id: 'now', startedAt: NOW - 55 * MIN, endedAt: NOW - 18 * MIN, unit: 'lb', updatedAt: NOW - 55 * MIN
  };

  test('volume, count and duration', () => {
    const st = sessionStats(session, sets);
    assert.equal(st.setCount, 4);
    assert.equal(st.volume, 135 * 8 + 225 * 5 + 230 * 5 + 115 * 6);
    assert.equal(Math.round(st.durationMs / MIN), 37);
    assert.deepEqual(st.exerciseIds, ['bench', 'ohp'], 'exercises in the order trained');
  });

  test('top set is the heaviest, not the last', () => {
    const top = topSetPerExercise(sets);
    assert.equal(top.get('bench')!.weight, 230);
  });

  test('buildRecap emits exactly what recap.js consumes', () => {
    const history = [0, 7, 14, 21].flatMap(d =>
      [s('bench', 225, 5, NOW - d * DAY, `p${d}`), s('ohp', 110, 6, NOW - d * DAY, `p${d}`)]);
    const prs = findPRs(sets, history, exercises);
    const payload = buildRecap({
      session, sets, exercises, prs, allSets: [...history, ...sets], now: NOW, title: 'PUSH DAY'
    });

    // Shape contract with spike/recap.js
    for (const k of ['title','date','volume','sets','duration','streak','unit','watermark','lifts']) {
      assert.ok(k in payload, `missing key ${k}`);
    }
    assert.equal(payload.title, 'PUSH DAY');
    assert.match(payload.date, /^[A-Z]{3} \d{1,2} [A-Z]{3}$/);
    assert.match(payload.duration, /^\d+ MIN$/);
    assert.equal(payload.unit, 'lb');
    assert.equal(payload.watermark, 'PROOF');

    assert.equal(payload.lifts.length, 2);
    assert.deepEqual(payload.lifts[0], ['Bench Press', '230 × 5', true]);
    assert.deepEqual(payload.lifts[1], ['OHP', '115 × 6', false],
      'both lifts PR\'d, but only the headline is badged — see buildRecap');

    assert.ok(payload.pr, 'a 230x5 against a 225x5 history is a PR');
    assert.equal(payload.pr!.lift, 'Bench Press',
      'the payload carries the real name; the card shouts it, the share message does not');
    assert.equal(payload.pr!.weight, 230);
    assert.equal(payload.pr!.prev, 225);
  });

  test('a session with no PR omits the slab rather than faking one', () => {
    const flat = [s('bench', 225, 5, NOW - 30 * MIN)];
    const history = [0, 7, 14, 21].map(d => s('bench', 225, 5, NOW - d * DAY, `p${d}`));
    const payload = buildRecap({
      session, sets: flat, exercises, prs: findPRs(flat, history, exercises),
      allSets: [...history, ...flat], now: NOW
    });
    assert.equal(payload.pr, undefined);
    assert.equal(payload.lifts[0][2], false);
  });

  /*
   * The hole in the claim chain, found by walking a cold database: sessions
   * one, two and three at 90, 90 then 135 — a lifter's heaviest ever lift by
   * 45 lb — and the card's only editorial line was "Short one. It still
   * counts." `firstSession` had passed, `pr` was still suppressed by §8's
   * three-session cold-start guard, and week one has no goal yet, so every
   * branch missed. See `bestYet` in session.ts.
   */
  describe('the two sessions after the first can still say something true', () => {
    /** Two prior sessions — one short of what a PR needs. */
    const twoPrior = [
      s('bench', 90, 8, NOW - 14 * DAY, 'p1'),
      s('bench', 90, 8, NOW - 7 * DAY, 'p2')
    ];

    test('beating your own best is claimed, even when it is too early for a PR', () => {
      const today = [s('bench', 135, 8, NOW - 10 * MIN)];
      const prs = findPRs(today, twoPrior, exercises);
      assert.equal(prs.length, 0, 'fixture sanity: the cold-start guard still suppresses the PR');
      const payload = buildRecap({
        session, sets: today, exercises, prs, allSets: [...twoPrior, ...today], now: NOW
      });
      assert.equal(payload.firstSession, false, 'fixture sanity: not the first session either');
      assert.ok(payload.bestYet, 'every claim branch missed and the card had nothing to say');
      assert.equal(payload.bestYet!.prev, 90, 'says what was beaten, so the reader can check it');
    });

    test('a real PR still wins — two claims about one set is not a hierarchy', () => {
      const fourPrior = [...twoPrior, s('bench', 90, 8, NOW - 3 * DAY, 'p3')];
      const today = [s('bench', 135, 8, NOW - 10 * MIN)];
      const prs = findPRs(today, fourPrior, exercises);
      assert.equal(prs.length, 1, 'fixture sanity: three prior sessions clears the guard');
      const payload = buildRecap({
        session, sets: today, exercises, prs, allSets: [...fourPrior, ...today], now: NOW
      });
      assert.ok(payload.pr, 'the PR slab is the better claim and must still appear');
      assert.equal(payload.bestYet, undefined, 'and the weaker claim steps aside');
    });

    test('matching your best is not beating it', () => {
      const today = [s('bench', 90, 8, NOW - 10 * MIN)];
      const payload = buildRecap({
        session, sets: today, exercises, prs: findPRs(today, twoPrior, exercises),
        allSets: [...twoPrior, ...today], now: NOW
      });
      assert.equal(payload.bestYet, undefined, 'equalling 90 is not "up from 90"');
    });

    test('a first-ever session is left to firstSession, not claimed twice', () => {
      const today = [s('bench', 135, 8, NOW - 10 * MIN)];
      const payload = buildRecap({
        session, sets: today, exercises, prs: [], allSets: today, now: NOW
      });
      assert.equal(payload.firstSession, true);
      assert.equal(payload.bestYet, undefined,
        'nothing behind it means nothing was beaten — SESSION ONE is the honest claim');
    });

    /*
     * The load-bearing property: `bestYet` and `findPRs` must never disagree
     * about whether something was BEATEN. They differ only on whether the app
     * is yet allowed to call it a record. Written first with the opposite
     * expectation — that a 100 x 3 could not clear a 90 x 8 — and the code was
     * right and the test was wrong: `bestWeightAtReps` compares against every
     * prior set at the target reps OR MORE, so an 8-rep set is very much in
     * range of a 3-rep one. Asserting the agreement directly is worth more
     * than asserting either half from memory.
     */
    test('bestYet agrees with findPRs about what counts as beaten', () => {
      const threePrior = [...twoPrior, s('bench', 90, 8, NOW - 3 * DAY, 'p3')];
      for (const [w, reps] of [[100, 3], [135, 8], [90, 8], [85, 10]] as const) {
        const today = [s('bench', w, reps, NOW - 10 * MIN)];
        // Same sets, same history — only the session COUNT differs, which is
        // the only thing the cold-start guard looks at.
        const early = buildRecap({
          session, sets: today, exercises, prs: findPRs(today, twoPrior, exercises),
          allSets: [...twoPrior, ...today], now: NOW
        });
        const late = buildRecap({
          session, sets: today, exercises, prs: findPRs(today, threePrior, exercises),
          allSets: [...threePrior, ...today], now: NOW
        });
        assert.equal(!!early.bestYet, !!late.pr,
          `${w} x ${reps}: bestYet said ${!!early.bestYet}, the PR rule said ${!!late.pr}`);
      }
    });
  });

  /*
   * "TOTAL VOLUME 0 LB" over twelve push-ups, on the artifact §5 judges the
   * whole product on. `realLoad` abstains for a bodyweight movement with no
   * reading behind it — deliberately, and tested in real-load.test.ts — but
   * the `?? s.weight` fallback here turned that abstention into a claim,
   * because the weight ADDED to a strict push-up is 0. R141 fixed this for
   * sets that have a reading; the no-reading case kept printing the zero.
   *
   * The number stays — it is the honest floor — and `volumeKnown` says
   * whether it can be shown as a total.
   */
  describe('a volume the app cannot compute is not reported as zero', () => {
    const bw = (at: number) => [{ id: 'm', kind: 'bodyweight' as const, value: 180, unit: 'lb' as const, at }];

    test('an ordinary session is known, and unchanged', () => {
      const st = sessionStats(session, [s('bench', 180, 8, NOW - 10 * MIN)]);
      assert.equal(st.volume, 1440);
      assert.equal(st.volumeKnown, true);
    });

    test('bodyweight work with no reading at all is not known', () => {
      const st = sessionStats(session, [s('pushup', 0, 12, NOW - 10 * MIN)]);
      assert.equal(st.volume, 0, 'the floor is still 0 — nothing was added to the lifter');
      assert.equal(st.volumeKnown, false, 'but 0 is not what they moved');
    });

    test('a reading recorded AFTER the set does not retroactively apply', () => {
      // The common order for a new user: train, see the gap, then go weigh in.
      const st = sessionStats(session, [s('pushup', 0, 12, NOW - 10 * MIN)], bw(NOW - 5 * MIN));
      assert.equal(st.volumeKnown, false,
        '`readingAt` is at-or-before on purpose — June must not rewrite January');
    });

    test('a reading that DID apply makes it known', () => {
      const st = sessionStats(session, [s('pushup', 0, 12, NOW - 10 * MIN)], bw(NOW - 20 * MIN));
      assert.equal(st.volume, 2160, '180 lb of lifter, twelve times');
      assert.equal(st.volumeKnown, true);
    });

    test('one unknown lift is enough to make the TOTAL unknown', () => {
      // The bench half is real and the push-up half is missing, so the sum is
      // a floor. Reporting it as a total would understate the session.
      const st = sessionStats(session,
        [s('bench', 180, 8, NOW - 12 * MIN), s('pushup', 0, 12, NOW - 10 * MIN)]);
      assert.equal(st.volume, 1440, 'still the honest floor');
      assert.equal(st.volumeKnown, false);
    });

    test('the recap payload carries it, and only when it is false', () => {
      const push = [s('pushup', 0, 12, NOW - 10 * MIN)];
      const unknown = buildRecap({
        session, sets: push, exercises, prs: [], allSets: push, now: NOW
      });
      assert.equal(unknown.volumeKnown, false);

      const bench = [s('bench', 180, 8, NOW - 10 * MIN)];
      const known = buildRecap({
        session, sets: bench, exercises, prs: [], allSets: bench, now: NOW
      });
      assert.ok(!('volumeKnown' in known),
        'an ordinary session must not spend payload restating the default');
    });
  });

  test('at most one lift is badged even when many PR at once', () => {
    // Four accessories all bumped in the same session — common, and every one
    // of these records is genuine.
    const ids = ['bench', 'ohp'];
    const history = [0, 7, 14, 21].flatMap(d =>
      ids.map(id => s(id, 100, 5, NOW - d * DAY, `p${d}`)));
    const now = ids.map(id => s(id, 110, 5, NOW - 20 * MIN));
    const payload = buildRecap({
      session, sets: now, exercises, prs: findPRs(now, history, exercises),
      allSets: [...history, ...now], now: NOW
    });
    const badged = payload.lifts.filter(l => l[2]).length;
    assert.equal(badged, 1, `${badged} badged rows is a card that shouts at itself`);
  });

  // §6 — the one-set first session must produce a usable recap.
  test('a single set on day one still builds a recap', () => {
    const one = [s('bench', 135, 5, NOW - 10 * MIN)];
    const payload = buildRecap({
      session: live(NOW - 12 * MIN), sets: one, exercises, prs: [],
      allSets: one, now: NOW
    });
    assert.equal(payload.sets, 1);
    assert.equal(payload.lifts.length, 1);
    assert.equal(payload.streak, 1, 'the streak reads 1 immediately, never 0');
    assert.equal(payload.pr, undefined, 'and claims no PR on day one');
  });
});

/*
 * Found by an adversarial bug hunt, then reproduced end-to-end through the real
 * Repo and shareText before being believed.
 */
describe('weekStreak counts LOCAL calendar weeks', () => {
  const set = (id: string, at: number): LoggedSet =>
    ({ id, sessionId: 's' + id, exerciseId: 'bench', weight: 155, reps: 5, at });

  /*
   * The bug: weekIndex was Math.floor(at / WEEK_MS). Epoch day 0 was a
   * THURSDAY, so buckets flipped at Thursday 00:00 UTC — Wednesday 5pm in
   * California, 8pm on the east coast. Prime gym time.
   */
  test('two sets on one evening are one week, not two', () => {
    const sets = [
      set('a', Date.parse('2026-07-08T23:00:00Z')),   // Wed 4pm Pacific
      set('b', Date.parse('2026-07-09T01:00:00Z'))    // Wed 6pm Pacific, 2h later
    ];
    assert.equal(weekStreak(sets, Date.parse('2026-07-09T01:30:00Z')), 1,
      'this is the bug: one workout reported a 2-week streak on a fresh install');
  });

  // The converse. A fixed 7-day ruler is not a calendar: sessions in
  // consecutive local weeks that are >7 days apart used to skip a bucket.
  test('three consecutive local weeks are three, even at drifting times of day', () => {
    const sets = [
      set('a', Date.parse('2026-07-01T23:00:00Z')),
      set('b', Date.parse('2026-07-09T00:00:00Z')),
      set('c', Date.parse('2026-07-16T00:00:00Z'))
    ];
    assert.equal(weekStreak(sets, Date.parse('2026-07-16T01:00:00Z')), 3,
      'an hour of drift used to break a genuinely earned streak');
  });

  /*
   * `weekIndex`'s comment claims DST-immunity — "the arithmetic never crosses
   * a clock that moves", because `Date.UTC` is applied to LOCAL calendar
   * fields. That was asserted and never demonstrated, and the streak reaches
   * both the card and the share message, so a wrong one announces a habit the
   * user has not formed.
   *
   * Built from LOCAL constructors on purpose, so the test means whatever the
   * machine's timezone means: a real check where DST exists (the project's
   * own machine is America/Los_Angeles, where both these dates shift the
   * clock) and trivially true where it does not.
   */
  const localSet = (y: number, mo: number, d: number, h: number): LoggedSet => {
    const at = new Date(y, mo, d, h, 0, 0, 0).getTime();
    return { id: `l${at}`, sessionId: `sl${at}`, exerciseId: 'bench', weight: 155, reps: 5, at };
  };

  test('an hour lost to spring DST does not break a streak', () => {
    // Four consecutive local Mondays; US clocks jump forward Sun 8 Mar 2026.
    const sets = [
      localSet(2026, 1, 23, 18), localSet(2026, 2, 2, 18),
      localSet(2026, 2, 9, 18), localSet(2026, 2, 16, 18)
    ];
    assert.equal(weekStreak(sets, new Date(2026, 2, 16, 20).getTime()), 4,
      'a 23-hour week must not skip a bucket');
  });

  test('an hour gained to autumn DST does not double-count a week', () => {
    // Four consecutive local Mondays; US clocks fall back Sun 1 Nov 2026.
    const sets = [
      localSet(2026, 9, 12, 18), localSet(2026, 9, 19, 18),
      localSet(2026, 9, 26, 18), localSet(2026, 10, 2, 18)
    ];
    assert.equal(weekStreak(sets, new Date(2026, 10, 2, 20).getTime()), 4,
      'a 25-hour week must not split into two');
  });

  test('the Sunday-to-Monday boundary is where the week actually turns', () => {
    // §10 puts the week start at Monday; these are two hours apart and must
    // still be two weeks, which is the exact inverse of the Thursday-edge bug.
    const sets = [localSet(2026, 6, 12, 23), localSet(2026, 6, 13, 0)];
    assert.equal(weekStreak(sets, new Date(2026, 6, 13, 1).getTime()), 2);
  });

  test('a real gap still breaks the streak', () => {
    const sets = [
      set('a', Date.parse('2026-06-10T18:00:00Z')),
      set('c', Date.parse('2026-07-01T18:00:00Z'))    // three weeks later
    ];
    assert.equal(weekStreak(sets, Date.parse('2026-07-01T19:00:00Z')), 1);
  });

  test('the week boundary is a Monday, per §10', () => {
    // Sunday and the Monday after it must land in different weeks.
    const sun = [set('a', new Date(2026, 6, 12, 20).getTime())];
    const mon = [set('b', new Date(2026, 6, 13, 8).getTime())];
    assert.equal(weekStreak([...sun, ...mon], new Date(2026, 6, 13, 9).getTime()), 2,
      'Sunday evening and Monday morning are consecutive weeks');
  });

  test('one session is one week however late at night it ran', () => {
    for (const h of [0, 6, 12, 17, 20, 23]) {
      const at = new Date(2026, 6, 8, h).getTime();
      assert.equal(weekStreak([set('x', at)], at + 60_000), 1, `failed at ${h}:00 local`);
    }
  });
});

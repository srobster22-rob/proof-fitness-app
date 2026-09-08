import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  rankExercises, predictSession, suggestNext, nextCandidates, sessionCount,
  MIN_SESSIONS_FOR_PREDICTION, HALF_LIFE_DAYS, openingLift
} from '../src/domain/predict.ts';
import type { LoggedSet } from '../src/domain/types.ts';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 6, 29, 12, 0, 0);   // a Wednesday

let uid = 0;
/** One session on `daysAgo`, containing `exerciseIds` in order. */
function session(daysAgo: number, exerciseIds: string[]): LoggedSet[] {
  const sessionId = `s${uid++}`;
  const at = NOW - daysAgo * DAY;
  return exerciseIds.flatMap(exerciseId => ([
    { id: `x${uid++}`, sessionId, exerciseId, weight: 100, reps: 5, at },
    { id: `x${uid++}`, sessionId, exerciseId, weight: 100, reps: 5, at }
  ]));
}

describe('exercise prediction (§7)', () => {
  test('nothing is predicted before there is history to predict from', () => {
    for (let n = 0; n < MIN_SESSIONS_FOR_PREDICTION; n++) {
      const history = Array.from({ length: n }, (_, i) => session(i, ['bench'])).flat();
      assert.deepEqual(predictSession(history, NOW), [],
        `${n} sessions should fall back to the common-lift list, not guess`);
    }
  });

  test('recent and frequent outranks stale and frequent', () => {
    const history = [
      // trained heavily but abandoned a year ago
      ...Array.from({ length: 20 }, (_, i) => session(330 + i * 2, ['legacy'])).flat(),
      // trained a handful of times this month
      ...session(2, ['current']), ...session(9, ['current']), ...session(16, ['current'])
    ];
    const ranked = rankExercises(history, NOW);
    assert.equal(ranked[0].exerciseId, 'current',
      'a movement abandoned a year ago must not lead — this is the §8 decay requirement');
  });

  test('decay halves the contribution over one half-life', () => {
    const fresh = rankExercises(session(0, ['a']), NOW)[0].score;
    const old = rankExercises(session(HALF_LIFE_DAYS, ['a']), NOW)[0].score;
    assert.ok(Math.abs(old / fresh - 0.5) < 1e-9, `expected half, got ${old / fresh}`);
  });

  test('same-weekday occurrences are boosted', () => {
    // 'wed' trained on Wednesdays, 'thu' on Thursdays, same count and recency.
    const history = [
      ...session(7, ['wed']), ...session(14, ['wed']), ...session(21, ['wed']),
      ...session(6, ['thu']), ...session(13, ['thu']), ...session(20, ['thu'])
    ];
    const onWed = rankExercises(history, NOW, new Date(NOW).getDay());
    assert.equal(onWed[0].exerciseId, 'wed');
  });

  test('predicted session is ordered by where lifts usually fall, not by score', () => {
    // 'accessory' appears last every time but is trained most often.
    const history = [
      ...session(2, ['squat', 'rdl', 'accessory']),
      ...session(9, ['squat', 'rdl', 'accessory']),
      ...session(16, ['squat', 'rdl', 'accessory']),
      ...session(4, ['bench', 'accessory']), ...session(11, ['bench', 'accessory'])
    ];
    const predicted = predictSession(history, NOW, undefined, 3);
    assert.equal(predicted[predicted.length - 1], 'accessory',
      'opening on the lift they always do last is technically right and useless');
  });

  test('suggestNext skips what is already done this session', () => {
    const history = [
      ...session(2, ['squat', 'rdl', 'legpress']),
      ...session(9, ['squat', 'rdl', 'legpress']),
      ...session(16, ['squat', 'rdl', 'legpress'])
    ];
    assert.equal(suggestNext(history, [], NOW), 'squat');
    assert.equal(suggestNext(history, ['squat'], NOW), 'rdl');
    assert.equal(suggestNext(history, ['squat', 'rdl'], NOW), 'legpress');
    assert.equal(suggestNext(history, ['squat', 'rdl', 'legpress'], NOW), null);
  });

  /*
   * This ranking drives the picker's order and Progress's row order, both of
   * which the user taps. `goal-filters.ts` breaks ties on name explicitly,
   * with the reason written down: "a list of a hundred that reshuffles under
   * the finger is worse than one in a mediocre order." Here the same property
   * holds only IMPLICITLY — from `Array.sort` being stable plus Map insertion
   * order — so nothing would catch a switch to an unstable or re-keyed sort.
   */
  test('a tie ranks the same way every time it is asked', () => {
    // Two lifts trained in exactly the same sessions score identically.
    const history = [...session(7, ['bench', 'squat']), ...session(1, ['bench', 'squat'])];
    const orders = new Set<string>();
    for (let i = 0; i < 20; i++) {
      orders.add(rankExercises(history, NOW).map(r => r.exerciseId).join(','));
    }
    assert.equal(orders.size, 1, `the order moved between renders: ${[...orders].join(' | ')}`);
  });

  /*
   * Device clocks move — timezone changes, manual corrections, a restored
   * backup. `daysAgo` is clamped at 0, so a set dated in the future decays by
   * the same factor as one logged now rather than by a NEGATIVE number of
   * days, which would raise 0.5 to a negative power and hand that lift an
   * unbeatable score at the top of every list until the clock caught up.
   */
  test('a set dated in the future cannot out-rank one logged today', () => {
    const history = [...session(-30, ['bench']), ...session(0, ['squat'])];
    const ranked = rankExercises(history, NOW);
    const future = ranked.find(r => r.exerciseId === 'bench')!;
    const today = ranked.find(r => r.exerciseId === 'squat')!;
    assert.equal(future.score, today.score, 'a future date bought a higher score');
    assert.ok(Number.isFinite(future.score));
  });

  test('sessionCount counts sessions, not sets', () => {
    const history = [...session(1, ['a', 'b']), ...session(2, ['a'])];
    assert.equal(sessionCount(history), 2);
  });
});

// PROMPT.md §16.11 — the year-two test, for the predictor specifically.
describe('year-two behaviour (§16.11)', () => {
  test('two years of history still leads with what they train now', () => {
    const history: LoggedSet[] = [];
    // 18 months of an old programme, then 3 months of a new one.
    for (let i = 0; i < 200; i++) history.push(...session(90 + i * 3, ['old_a', 'old_b', 'old_c']));
    for (let i = 0; i < 36; i++) history.push(...session(i * 2.5, ['new_a', 'new_b', 'new_c']));

    const predicted = predictSession(history, NOW, undefined, 3);
    console.log(`      200+ sessions of history -> predicts [${predicted.join(', ')}]`);
    assert.deepEqual(
      [...predicted].sort(), ['new_a', 'new_b', 'new_c'],
      'the abandoned programme must not resurface after two years of data'
    );
  });

  test('score stays finite and ordered across a decade of data', () => {
    const history: LoggedSet[] = [];
    for (let i = 0; i < 1500; i++) history.push(...session(i * 2.4, ['a', 'b']));
    const ranked = rankExercises(history, NOW);
    for (const r of ranked) {
      assert.ok(Number.isFinite(r.score) && r.score > 0, `bad score ${r.score}`);
    }
  });
});

// Where a NEW session opens. §7 predicts a routine and needs three sessions to
// do it; this is the rung below that, and it is the one journey B walks. Without
// it, sessions two and three fell through to the head of the starting twelve —
// a returning user who had only ever squatted landed on Bench Press.
describe('where a new session opens', () => {
  const T = Date.UTC(2026, 6, 30, 18);
  const sets = (rows: Array<[string, string, number]>): LoggedSet[] =>
    rows.map(([sessionId, exerciseId, at], i) =>
      ({ id: `x${i}`, sessionId, exerciseId, weight: 100, reps: 5, at }));

  test('with no history at all it defers to the caller', () => {
    assert.equal(openingLift([], T), null, 'a genuine cold start is §6, not §7');
  });

  test('after ONE session it opens on a lift they actually train', () => {
    const h = sets([['s1', 'squat', T - DAY], ['s1', 'row', T - DAY + HOUR]]);
    assert.equal(openingLift(h, T), 'squat');
  });

  test('and on the lift they STARTED with, not the accessory they finished on', () => {
    const h = sets([
      ['s1', 'squat', T - DAY],
      ['s1', 'legpress', T - DAY + HOUR],
      ['s1', 'curl', T - DAY + 2 * HOUR]
    ]);
    assert.equal(openingLift(h, T), 'squat', 'nobody wants to open on bicep curls');
  });

  test('it reads the most recent session, not the first one', () => {
    const h = sets([
      ['s1', 'squat', T - 8 * DAY],
      ['s2', 'bench', T - DAY],
      ['s2', 'row', T - DAY + HOUR]
    ]);
    assert.equal(openingLift(h, T), 'bench');
  });

  test('once a routine exists the predictor takes over', () => {
    const rows: Array<[string, string, number]> = [];
    for (let w = 4; w >= 1; w--) {
      rows.push([`s${w}`, 'squat', T - w * 7 * DAY]);
      rows.push([`s${w}`, 'row', T - w * 7 * DAY + HOUR]);
    }
    const h = sets(rows);
    assert.equal(openingLift(h, T), predictSession(h, T)[0],
      'with enough history §7 decides, not the fallback');
  });

  test('the screen you land on agrees with the lift UP NEXT points past', () => {
    // The defect this fixes was an ASYMMETRY: suggestNext ranked the user's own
    // movements after a single session while the opener did not, so the app
    // opened on Bench Press while simultaneously suggesting Squat.
    const h = sets([['s1', 'squat', T - DAY]]);
    const opener = openingLift(h, T)!;
    assert.equal(opener, 'squat');
    assert.notEqual(suggestNext(h, [opener], T), opener,
      'UP NEXT must point somewhere else, not back at where you are');
  });
});

/*
 * R493. `nextCandidates` drives the swipe-to-next-exercise gesture, and it
 * pointed at the wrong DAY.
 *
 * Measured by walk-forward simulation over fourteen weeks of routine — predict
 * each of the last eight sessions from prior history only. The size-5 session
 * prediction was flawless on an aligned split (100% of lifts, 100% of openers),
 * and the next-lift suggestion after the true opener was right **0%** of the
 * time. Not low: zero, on the same histories where the set was perfect.
 *
 * The cause was one number. `nextCandidates` widened the pool to twelve, which
 * on a three-day split spans the entire routine, and `predictSession` sorts its
 * pool by `typicalPosition` — a WITHIN-session number. Position 0 of leg day
 * then sorts ahead of position 1 of the push day the user is actually having,
 * so after Bench Press the app offered SQUAT. Score already had it right: all
 * five push lifts outscored every leg lift, and the widening discarded that.
 *
 * After: 100% on the aligned rows, 90-92% with a 30% chance of a dropped or
 * swapped accessory per session.
 */
describe('the swipe target belongs to the day you are having (§7)', () => {
  /** Fourteen weeks of Mon/Wed/Fri push-pull-legs, ending on a Sunday. */
  function ppl() {
    const push = ['bench', 'ohp', 'incline', 'lateral', 'pushdown'];
    const pull = ['deadlift', 'pullup', 'row', 'facepull', 'curl'];
    const legs = ['squat', 'rdl', 'legpress', 'legcurl', 'calf'];
    const days = [push, pull, legs];
    const out: LoggedSet[] = [];
    let n = 0;
    /*
     * NOW is a Wednesday, so within week `w` back: Monday is `w*7 + 2` days
     * ago, Wednesday `w*7`, Friday `w*7 - 2`. Listed in that order so the
     * three-day cycle advances chronologically. Forty-two sessions means the
     * next one is cycle index 0 again: a push day, landing on Monday.
     */
    for (let w = 14; w >= 1; w--) {
      for (const d of [2, 0, -2]) {
        out.push(...session(w * 7 + d, days[n % 3]));
        n++;
      }
    }
    return out;
  }

  const MONDAY = NOW - 2 * DAY;
  const wd = new Date(MONDAY).getDay();

  test('the session itself was never the problem', () => {
    assert.deepEqual(predictSession(ppl(), MONDAY, wd),
      ['bench', 'ohp', 'incline', 'lateral', 'pushdown'],
      'the five lifts and their order are what the fix has to preserve');
  });

  test('after the opener comes the second lift of THAT day', () => {
    const next = suggestNext(ppl(), ['bench'], MONDAY, wd);
    assert.equal(next, 'ohp',
      `after benching on push day the app offered ${next} — a lift from ` +
      'another day, ranked ahead because it is that day\'s opener');
  });

  test('and it keeps agreeing all the way down the session', () => {
    const done: string[] = [];
    for (const expected of ['bench', 'ohp', 'incline', 'lateral', 'pushdown']) {
      const got = suggestNext(ppl(), done, MONDAY, wd);
      assert.equal(got, expected, `after ${done.join(', ') || 'nothing'}`);
      done.push(expected);
    }
  });

  test('only then does it reach into the rest of the routine', () => {
    const done = ['bench', 'ohp', 'incline', 'lateral', 'pushdown'];
    const rest = nextCandidates(ppl(), done, MONDAY, wd);
    assert.ok(rest.length > 0,
      'a lifter who finishes the predicted session has nothing left to swipe to');
    assert.equal(done.some(id => rest.includes(id)), false,
      'the overflow offers lifts already done today');
    /*
     * Ordered by score, not by position — between days `typicalPosition` is
     * meaningless, and score is the only ranking that survives the crossing.
     */
    const scores = rankExercises(ppl(), MONDAY, wd);
    const order = rest.map(id => scores.findIndex(r => r.exerciseId === id));
    assert.deepEqual(order, [...order].sort((a, b) => a - b),
      'the overflow is not in score order');
  });
});

/*
 * R495. `state()` runs on every tap and walked the whole history four times
 * doing it — twice in `nextCandidates`, once in `pickerFor`, once in
 * `weekStreak` — collapsing the same sets into the same occurrences each time,
 * because all of them read the one memoised array `Repo.allSets` hands out.
 * Measured at 14,000 sets: `state()` 5.93ms, `rankExercises` 0.64ms. After
 * caching the collapse on that array's identity: 3.98ms and 0.05ms, one walk.
 *
 * A cache is only worth having if it cannot answer with something stale, so
 * these tests are about invalidation, not speed.
 */
describe('the history collapse is reused, and only when it is still the history', () => {
  test('and the second read of the same history does not walk it again', () => {
    /*
     * The gate. Everything above proves the cache is SAFE; this is the only
     * test that fails without it. It counts what the collapse actually reads,
     * by handing over a history whose iterator reports every element it yields
     * — the same instrument `goals.test.ts` uses on `activeGoals`, and for the
     * same reason: a millisecond budget passes on fast hardware whether the
     * work is being repeated or not.
     */
    const real = [...session(5, ['squat']), ...session(3, ['bench'])];
    let yielded = 0;
    const counted = [...real] as LoggedSet[];
    counted[Symbol.iterator] = (function* () {
      for (const s of real) { yielded++; yield s; }
    }) as () => ArrayIterator<LoggedSet>;

    rankExercises(counted, NOW);
    const first = yielded;
    assert.equal(first, real.length, 'the first call did not read the history exactly once');

    // Four more reads: what one `state()` costs — twice in `nextCandidates`,
    // once in `pickerFor`, once more for luck.
    for (let i = 0; i < 4; i++) rankExercises(counted, NOW + i);
    assert.equal(yielded, first,
      `four further reads of the same history walked ${yielded - first} more sets — ` +
      'the collapse is being redone on every tap');
  });

  test('a longer history is not answered from the shorter one', () => {
    const first = session(10, ['squat']);
    const ranked = rankExercises(first, NOW);
    assert.deepEqual(ranked.map(r => r.exerciseId), ['squat']);

    // A new array, which is what the Repo produces after any write.
    const grown = [...first, ...session(1, ['bench'])];
    assert.deepEqual(rankExercises(grown, NOW).map(r => r.exerciseId).sort(), ['bench', 'squat'],
      'the second lift is missing — a cached collapse answered for a history it did not build from');
  });

  test('and an array edited in place is not either', () => {
    /*
     * `allSets` freezes what it returns, so the Repo cannot do this. Anything
     * else holding its own array can, and the length is the cheap half of that
     * — the half worth catching, since appending is what callers actually do.
     */
    const history = [...session(10, ['squat'])];
    assert.deepEqual(rankExercises(history, NOW).map(r => r.exerciseId), ['squat']);
    history.push(...session(1, ['deadlift']));
    assert.deepEqual(rankExercises(history, NOW).map(r => r.exerciseId).sort(), ['deadlift', 'squat'],
      'the pushed sets were invisible — same array, same cached collapse');
  });

  test('scoring still follows the clock, so the cache cannot freeze the ranking', () => {
    /*
     * The collapse is cached; the SCORE is not, and must not be — it decays
     * with `now` and takes a weekday boost. Caching that instead would leave
     * every prediction stuck at whatever time the first call happened.
     */
    const history = [...session(0, ['bench']), ...session(200, ['squat'])];
    const fresh = rankExercises(history, NOW);
    const later = rankExercises(history, NOW + 400 * DAY);
    assert.equal(fresh[0].exerciseId, 'bench');
    assert.ok(later[0].score < fresh[0].score,
      'four hundred days passed and the score did not decay — the clock is being cached');
  });

  test('two histories interleaved still answer for themselves', () => {
    // One entry, so alternating between two arrays is a miss every time. It
    // must be a miss that RECOMPUTES, not one that returns the other's answer.
    const a = [...session(5, ['squat'])];
    const b = [...session(5, ['bench'])];
    for (let i = 0; i < 3; i++) {
      assert.deepEqual(rankExercises(a, NOW).map(r => r.exerciseId), ['squat']);
      assert.deepEqual(rankExercises(b, NOW).map(r => r.exerciseId), ['bench']);
    }
  });

  test('the caller cannot corrupt the cache by keeping what it was given', () => {
    /*
     * The cached map is shared between calls, so anything a caller mutates is
     * mutated for everyone after it. Nothing in the app does — this pins that
     * the RESULT handed out is a fresh array each time, so a caller sorting or
     * splicing its ranking cannot reach the collapse behind it.
     */
    const history = [...session(5, ['squat']), ...session(5, ['bench'])];
    const first = rankExercises(history, NOW);
    first.length = 0;
    assert.equal(rankExercises(history, NOW).length, 2,
      'emptying one caller\'s ranking emptied the next one\'s');
  });

  /*
   * R499. The decay was applied to WHICH lifts and never to WHAT ORDER.
   *
   * `typicalPosition` took a plain unweighted mean over the whole history, so
   * a lifter who reordered their session was still offered the old order, and
   * the wait grew with the history behind it: 35 days after four weeks of the
   * old order, 77 after ten, 147 after twenty. The module's own opening
   * comment rejects exactly that shape -- "a predictor that merely counted
   * would get worse the longer someone used the app".
   *
   * Every fixture below holds the LIFTS fixed and moves only their order, so
   * selection cannot mask or explain the result.
   */
  describe('the order the lifts come in decays too (§7)', () => {
    const OLD = ['squat', 'legpress', 'legcurl', 'calf'];
    const NEW = ['calf', 'legcurl', 'legpress', 'squat'];

    /** `weeksOld` weeks of OLD, then `weeksNew` of NEW, three sessions a week. */
    function reordered(weeksOld: number, weeksNew: number): LoggedSet[] {
      const out: LoggedSet[] = [];
      const total = weeksOld + weeksNew;
      for (let w = 0; w < total; w++) {
        for (const d of [0, 2, 4]) {
          const daysAgo = (total - 1 - w) * 7 + (4 - d);
          out.push(...session(daysAgo, w < weeksOld ? OLD : NEW));
        }
      }
      return out;
    }

    test('a session reordered a month ago is offered in its new order', () => {
      const history = reordered(10, 4);
      assert.equal(predictSession(history, NOW)[0], 'calf',
        'four weeks after the change it still opens on the lift they dropped ' +
        'to last, because ten weeks of the old order outvote it forever');
    });

    test('and the wait does not grow with the size of the history', () => {
      /*
       * The defect in one assertion. Unweighted, twenty weeks of history took
       * five times longer to adapt than four weeks did; weighted, both have
       * adapted by eight weeks because the weights only look back so far.
       */
      for (const weeksOld of [4, 10, 20]) {
        assert.equal(predictSession(reordered(weeksOld, 8), NOW)[0], 'calf',
          `after ${weeksOld} weeks of the old order the new one is still not adopted`);
      }
    });

    test('but not so fast that one odd session rewrites the routine', () => {
      // Ten weeks of OLD and a single NEW session yesterday. Adaptive is not
      // the same as credulous.
      const history = [...reordered(10, 0), ...session(1, NEW)];
      assert.equal(predictSession(history, NOW)[0], 'squat',
        'one session in a new order threw away ten weeks of routine');
    });

    test('a lifter who never changes anything sees no difference', () => {
      /*
       * The whole change has to be invisible in the steady state -- an
       * unchanging position averages to itself under any weights. Pinned
       * because a weighting bug (weights that do not sum to the divisor) would
       * show up here first, as an order that drifts for no reason.
       */
      const history = reordered(14, 0);
      assert.deepEqual(predictSession(history, NOW, undefined, 4), OLD,
        'the order moved for a lifter whose order never moved');
      for (const r of rankExercises(history, NOW)) {
        assert.equal(Number.isFinite(r.typicalPosition), true,
          `${r.exerciseId} has a non-finite typicalPosition`);
        // Within float noise, not exactly: the weighted mean of a constant
        // divides a sum of products by a sum of weights, and that it lands a
        // few ulps off is itself proof the weighted path is the one running.
        assert.ok(Math.abs(r.typicalPosition - OLD.indexOf(r.exerciseId)) < 1e-9,
          `${r.exerciseId} averaged to ${r.typicalPosition}, not its constant position`);
      }
    });

    test('the weekday boost stays out of it', () => {
      /*
       * The boost answers "is this lift part of TODAY", a selection question.
       * Position is a within-session number, so asking on a different weekday
       * must not reorder anything. If the boost leaked into the position
       * weights, a lift trained on Wednesdays would be pulled toward its
       * Wednesday position and away from its Friday one.
       */
      const history = reordered(6, 6);
      const base = rankExercises(history, NOW).map(r => [r.exerciseId, r.typicalPosition]);
      for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
        assert.deepEqual(
          rankExercises(history, NOW, weekday).map(r => [r.exerciseId, r.typicalPosition]).sort(),
          [...base].sort(),
          `asking on weekday ${weekday} changed where lifts sit inside a session`);
      }
    });
  });
});

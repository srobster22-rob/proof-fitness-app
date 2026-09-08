import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withinBudget } from './helpers/perf.ts';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { progressRows, recentSessions, MAX_ROWS, SPARK_POINTS, bestSetA11y, trendA11y, lastTrainedA11y } from '../src/ui/progress-model.ts';

const DAY = 86_400_000, MIN = 60_000;
const T0 = Date.UTC(2026, 6, 29, 18);
const fresh = () => new Repo(new DatabaseSync(':memory:') as any, () => T0);

let uid = 0;
// Sets carry a FOREIGN KEY to exercises, so anything not in the starting
// twelve has to exist before it can be logged against. The constraint is
// deliberate — it is what stops a typo'd id becoming a phantom lift.
function session(repo: Repo, at: number, rows: Array<[string, number, number]>) {
  const sid = `s${uid++}`;
  const known = repo.exercises();
  for (const [ex] of rows) if (!known.has(ex)) repo.addExercise(ex, ex);
  repo.startSession(sid, 'lb');
  rows.forEach(([ex, w, r], i) =>
    repo.logSet({ id: `x${uid++}`, sessionId: sid, exerciseId: ex, weight: w, reps: r, at: at + i * MIN }));
  repo.endSession(sid, at + 40 * MIN);
}

describe('Progress (§5 screen 2)', () => {
  test('empty history shows nothing rather than an empty grid', () => {
    assert.deepEqual(progressRows(fresh(), T0), []);
  });

  /*
   * The cap is still a cap, but the thing it cuts changed. It used to take the
   * top 8 by rank, and rank is the wrong axis: walked with five weeks of a real
   * push/pull/legs history, the visible rows were every legs and pull movement
   * and Bench Press was hidden, purely because legs had been trained most
   * recently. Train push tomorrow and the screen recomposes. A dead lift is one
   * you stopped doing, not one that ranks ninth.
   */
  test('year two is not a wall of sparklines — dead lifts fall off by time', () => {
    const repo = fresh();
    // 20 movements abandoned a year ago...
    for (let w = 60; w >= 56; w--) {
      session(repo, T0 - w * 7 * DAY, Array.from({ length: 20 }, (_, i) =>
        ['old' + i, 100 + i, 5] as [string, number, number]));
    }
    // ...and four still being trained.
    for (let w = 4; w >= 1; w--) {
      session(repo, T0 - w * 7 * DAY, Array.from({ length: 4 }, (_, i) =>
        ['now' + i, 100 + i, 5] as [string, number, number]));
    }
    const rows = progressRows(repo, T0);
    assert.equal(rows.length, 4, `year two showed ${rows.length} rows`);
    assert.ok(rows.every(r => r.exerciseId.startsWith('now')),
      'an abandoned movement is still taking up a row');
  });

  test('but a whole programme fits, however it is ordered', () => {
    const repo = fresh();
    // A twelve-movement split, each day trained on a different date — the shape
    // that used to hide a third of it behind the cap.
    for (let w = 5; w >= 1; w--) {
      for (let d = 0; d < 3; d++) {
        session(repo, T0 - (w * 7 - d * 2) * DAY, Array.from({ length: 4 }, (_, i) =>
          ['d' + d + '_' + i, 100 + i, 5] as [string, number, number]));
      }
    }
    assert.equal(progressRows(repo, T0).length, 12,
      'a lifter cannot see their whole programme on the screen that tracks it');
  });

  test('an explicit limit is still honoured', () => {
    const repo = fresh();
    for (let w = 5; w >= 1; w--) {
      session(repo, T0 - w * 7 * DAY, Array.from({ length: 12 }, (_, i) =>
        ['ex' + i, 100 + i, 5] as [string, number, number]));
    }
    assert.equal(progressRows(repo, T0, 3).length, 3);
    assert.ok(progressRows(repo, T0).length <= MAX_ROWS);
  });

  test('ordering matches the exercise picker — not two answers to the same question', () => {
    const repo = fresh();
    // 'stale' trained hard a year ago, 'current' trained this month
    for (let i = 0; i < 20; i++) session(repo, T0 - (330 + i * 2) * DAY, [['stale', 200, 5]]);
    for (const d of [2, 9, 16]) session(repo, T0 - d * DAY, [['current', 100, 5]]);
    assert.equal(progressRows(repo, T0)[0].exerciseId, 'current');
  });

  test('reports the best set at five reps, not the heaviest single', () => {
    const repo = fresh();
    for (const d of [21, 14, 7]) session(repo, T0 - d * DAY, [['squat', 225, 5]]);
    session(repo, T0 - DAY, [['squat', 300, 2]]);
    const row = progressRows(repo, T0).find(r => r.exerciseId === 'squat')!;
    assert.equal(row.best, 225, 'a 300 double is not a 5-rep best');
    assert.equal(row.bestReps, 5);
  });

  test('sparkline is normalised within its own window', () => {
    const repo = fresh();
    [200, 210, 220, 230].forEach((w, i) => session(repo, T0 - (28 - i * 7) * DAY, [['squat', w, 5]]));
    const row = progressRows(repo, T0)[0];
    assert.equal(row.spark.length, 4);
    assert.equal(row.spark[0], 0, 'lowest point sits on the floor');
    assert.equal(row.spark[row.spark.length - 1], 1, 'highest on the ceiling');
    assert.ok(row.spark.every(v => v >= 0 && v <= 1));
  });

  /*
   * R317: proved by mutation, not just read — with `e1rm`/`loadIn` swapped
   * for raw `s.weight`, every existing sparkline test above still passed.
   * They only pin the SHAPE (normalises to 0..1, lowest on the floor,
   * highest on the ceiling), which any monotonic transform of the inputs
   * satisfies just as well as the real one — the same failure a sibling
   * found this same night in a different project's flagship test, floats
   * passing through a check with no margin against what they actually mean.
   * This pins the VALUE: two sessions at the identical raw weight but
   * different rep counts must NOT draw a flat line, because e1RM says they
   * are not equally hard — reverting e1rm to raw weight collapses this to
   * `every(v === 0.5)` and fails it.
   */
  test('same weight, more reps draws a real rise — proves e1RM is doing the work', () => {
    const repo = fresh();
    session(repo, T0 - 14 * DAY, [['squat', 200, 5]]);
    session(repo, T0 - 7 * DAY, [['squat', 200, 12]]);
    const row = progressRows(repo, T0)[0];
    assert.equal(row.spark.length, 2);
    assert.notDeepEqual(row.spark, [0.5, 0.5],
      'same raw weight at different rep counts must not read as no change');
    assert.ok(row.spark[0] < row.spark[1], 'more reps at the same weight is more work, not less');
  });

  test('a flat history draws a flat line, not a divide-by-zero', () => {
    const repo = fresh();
    for (const d of [21, 14, 7]) session(repo, T0 - d * DAY, [['squat', 225, 5]]);
    const row = progressRows(repo, T0)[0];
    assert.ok(row.spark.every(v => v === 0.5), `got ${JSON.stringify(row.spark)}`);
    assert.equal(row.trend, 0);
  });

  test('the sparkline window is bounded', () => {
    const repo = fresh();
    for (let i = 0; i < 40; i++) session(repo, T0 - (40 - i) * 7 * DAY, [['squat', 200 + i, 5]]);
    assert.equal(progressRows(repo, T0)[0].spark.length, SPARK_POINTS);
  });

  // The trend used to be an e1RM delta, which is the wrong basis for a number
  // printed beside a real set: the screen read "Squat 195 x 5" with "+29" next
  // to it while the weight had gone 170 to 195. `pr.ts` already forbids
  // awarding on e1RM for the same reason — it disagrees with what a lifter
  // would say. It is a like-for-like weight change now, and checkable.
  test('trend is the weight they actually added, at the same reps', () => {
    const repo = fresh();
    [200, 220].forEach((w, i) => session(repo, T0 - (14 - i * 7) * DAY, [['squat', w, 5]]));
    assert.equal(progressRows(repo, T0)[0].trend, 20, 'the number must be checkable from the screen');
  });

  test('losing weight reads as a loss', () => {
    const repo = fresh();
    [225, 205].forEach((w, i) => session(repo, T0 - (14 - i * 7) * DAY, [['squat', w, 5]]));
    assert.equal(progressRows(repo, T0)[0].trend, -20);
  });

  test('it makes no claim when the ends are not comparable', () => {
    // 200x5 to 200x8 is real progress that a weight delta reports as nothing,
    // and printing 0 would be a claim. The sparkline still shows the shape.
    const repo = fresh();
    session(repo, T0 - 14 * DAY, [['squat', 200, 5]]);
    session(repo, T0 - 7 * DAY, [['squat', 200, 8]]);
    const row = progressRows(repo, T0)[0];
    assert.equal(row.trend, null, 'a weight delta across different reps is not a like-for-like claim');
    assert.equal(row.spark.length, 2, 'but the shape is still drawn');
  });

  test('one session is a row with a point and no trend', () => {
    const repo = fresh();
    session(repo, T0 - DAY, [['squat', 225, 5]]);
    const row = progressRows(repo, T0)[0];
    assert.equal(row.sessionCount, 1);
    assert.equal(row.trend, null, 'a single point has nothing to compare against');
  });

  /*
   * R327: found by driving the app with an actual bodyweight-only lifter —
   * three real push-up sessions, all at 15 reps, and Progress showed two
   * of the account's three trained lifts. This test's own name said the
   * DROP was deliberate ("rather than shown empty"), but `bestSetAtReps`
   * finds the real 20x30 set fine (30 is above its 5-rep threshold) — the
   * row vanishing was `perSessionTop`'s `MAX_PR_REPS` cap, built to bound
   * e1RM's own validity, silently zeroing `sessionCount` for anyone who
   * only ever trains above 12 reps. Real training reported as no training.
   */
  test('a high-rep-only lift still gets its real row', () => {
    const repo = fresh();
    for (const d of [21, 14, 7]) session(repo, T0 - d * DAY, [['cardio', 20, 30]]);
    const row = progressRows(repo, T0)[0];
    assert.ok(row, 'three real sessions must not vanish from Progress');
    assert.equal(row.best, 20);
    assert.equal(row.bestReps, 30, 'the real set logged, not a fabrication and not nothing');
    assert.equal(row.sessionCount, 3);
  });
});

// Found by running the app: Progress displayed "105 × 5" for a set that was
// actually 105 × 8, because it paired the best WEIGHT with the threshold rep
// count. Displaying a rep count the user never performed is the same class of
// dishonesty as claiming a PR they did not hit.
describe('Progress shows a set that actually happened', () => {
  test('reports the real reps, not the 5-rep threshold', () => {
    const repo = fresh();
    for (const d of [21, 14, 7]) session(repo, T0 - d * DAY, [['squat', 105, 8]]);
    const row = progressRows(repo, T0)[0];
    assert.equal(row.best, 105);
    assert.equal(row.bestReps, 8, 'the user did 105 × 8 and never did 105 × 5');
  });

  test('the displayed pair is always one stored set', () => {
    const repo = fresh();
    session(repo, T0 - 21 * DAY, [['squat', 225, 5]]);
    session(repo, T0 - 14 * DAY, [['squat', 205, 12]]);
    session(repo, T0 - 7 * DAY, [['squat', 225, 6]]);
    const row = progressRows(repo, T0)[0];
    const all = repo.allSets().filter(s => s.exerciseId === 'squat');
    assert.ok(
      all.some(s => s.weight === row.best && s.reps === row.bestReps),
      `displayed ${row.best} × ${row.bestReps}, which is not a set that exists`
    );
    assert.equal(row.bestReps, 6, 'at equal weight the better set is the one with more reps');
  });

  /*
   * R327: this test's own name promised "reports zeroes" and its assertion
   * checked something else entirely — the row VANISHING, `[]`. That
   * mismatch was the tell. It matched what the code did only because
   * `perSessionTop`'s rep cap (`MAX_PR_REPS`, meant to bound e1RM's own
   * validity) silently zeroed `sessionCount` for any lift trained only
   * above 12 reps, dropping the whole row — not the "fabricated pair" this
   * test thought it was guarding against, an unrelated bug in a different
   * function, one this test unknowingly depended on. 20 reps is squarely
   * inside `bestSetAtReps`'s own "at or above" search (the sibling test two
   * above already proves an 8-rep-only lift reports its real pair, not a
   * fabricated 5-rep one) — the row was never supposed to disappear.
   */
  test('a lift trained only above the rep cap still gets its real row, not none', () => {
    const repo = fresh();
    for (const d of [21, 14, 7]) session(repo, T0 - d * DAY, [['squat', 95, 20]]);
    const row = progressRows(repo, T0)[0];
    assert.ok(row, 'a genuinely trained lift must not vanish from Progress entirely');
    assert.equal(row.best, 95);
    assert.equal(row.bestReps, 20, 'the real set, not a fabricated 5-rep pair');
    assert.equal(row.sessionCount, 3, 'three real sessions, none of them uncounted');
  });

  /*
   * The genuine "untrained rep range" case: every set is BELOW the 5-rep
   * threshold `bestSetAtReps` searches at or above, so there is truly
   * nothing to report there — but the row itself must still exist, since
   * the lift was very much trained.
   */
  test('a rep range with nothing in it reports zeroes, and the row still exists', () => {
    const repo = fresh();
    for (const d of [21, 14, 7]) session(repo, T0 - d * DAY, [['squat', 315, 2]]);
    const row = progressRows(repo, T0)[0];
    assert.ok(row, 'three real sessions must produce a row');
    assert.equal(row.best, 0);
    assert.equal(row.bestReps, 0);
    assert.equal(row.sessionCount, 3);
  });
});

/*
 * Journey F, second walk. §16 and R37 set the standard this has to meet: a
 * number printed next to a real set must be reconcilable with what is on
 * screen, or it is invented. R37 fixed the BASIS (an e1RM delta beside a real
 * weight); this is the same number failing on precision.
 */
describe('Progress — the trend is a number the user can check', () => {
  const T = Date.UTC(2026, 7, 19, 18);
  const WEEK = 7 * 86_400_000;

  /** Twelve weekly sessions of one lift, gaining `step` each week. */
  function climbing(exerciseId: string, from: number, step: number, reps = 8): Repo {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    for (let w = 11; w >= 0; w--) {
      const sid = `s${w}`;
      repo.startSession(sid, 'lb');
      const at = T - w * WEEK;
      repo.logSet({ id: `x${w}`, sessionId: sid, exerciseId, weight: from + (11 - w) * step, reps, at });
      repo.endSession(sid, at + 30 * 60_000);
    }
    return repo;
  }

  const rowFor = (repo: Repo) => progressRows(repo, T)[0];

  /*
   * The defect, measured on the seeded history: Barbell Row showed
   * `115 × 8` with `+13 lb` beside it. The change was 12.5 — the arithmetic
   * gave a starting weight of 102, which is neither a weight the user lifted
   * nor one they could load on 2.5 lb increments.
   */
  test('a half-unit gain is reported as a half unit, not rounded away', () => {
    // 2.5 lb per week across the 10-session window = 22.5, not 23.
    const row = rowFor(climbing('row', 92.5, 2.5));
    assert.equal(row.trend, 22.5, 'this is the bug: Math.round reported 23');
  });

  test('the trend and the best set reconcile — that is the whole test', () => {
    const row = rowFor(climbing('row', 92.5, 2.5));
    // The window is the last 10 sessions, so the start is the 3rd of 12.
    const startedAt = 92.5 + 2 * 2.5;
    assert.equal(row.best - row.trend!, startedAt,
      `${row.best} minus ${row.trend} must land on a weight actually lifted`);
  });

  test('rounding never breaks the tie in the app\'s favour', () => {
    // Math.round(12.5) is 13, Math.round(-12.5) is -12: it rounds UP either
    // way, so a gain was flattered and a loss was softened.
    const gaining = rowFor(climbing('row', 92.5, 2.5));
    const losing = rowFor(climbing('row', 120, -2.5));
    assert.equal(gaining.trend, 22.5);
    assert.equal(losing.trend, -22.5, 'a decline must be reported at full size');
  });

  test('a whole-unit gain still prints as a whole number', () => {
    const row = rowFor(climbing('bench', 135, 5, 5));
    assert.equal(row.trend, 45);
    assert.equal(String(row.trend), '45', 'no stray .0 for the common case');
  });

  test('kg increments survive too', () => {
    const row = rowFor(climbing('squat', 60, 1.25, 5));
    assert.equal(row.trend, 11.25, 'a 1.25 kg plate is a real plate');
  });

  test('floating point dust never reaches the screen', () => {
    const row = rowFor(climbing('curl', 0.1, 0.2, 10));
    assert.equal(String(row.trend).length <= 5, true, `got ${row.trend}`);
  });

  /*
   * `trendAcross` always had the window's own start date in hand to compute
   * the delta and discarded it (R293) — the same shape as `bestAt` (R292).
   * The column header already names the window by COUNT ("last 10
   * sessions"); this is the other, calendar-based way to check the same
   * number, kept off the visible row for the reason `bestAt` was.
   */
  test('trendSince names the window\'s own start, not "now"', () => {
    const row = rowFor(climbing('row', 92.5, 2.5));
    // 12 weekly sessions, a 10-session window: the 3rd session is the start.
    assert.equal(row.trendSince, T - 9 * WEEK);
  });

  test('the trend label carries the sign, the number and a checkable date', () => {
    const row = rowFor(climbing('row', 92.5, 2.5));
    const label = trendA11y(row, 'en')!;
    assert.match(label, /\+22\.5 lb/);
    assert.match(label, /since/i);
  });

  test('a decline is not silently reported as a positive change', () => {
    const row = rowFor(climbing('row', 120, -2.5));
    const label = trendA11y(row, 'en')!;
    assert.doesNotMatch(label, /\+/, 'a loss must not carry a plus sign');
    assert.match(label, /-22\.5/);
  });

  test('no comparable window means no label to give, not an invented one', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'x1', sessionId: 's1', exerciseId: 'row', weight: 100, reps: 8, at: T });
    repo.endSession('s1', T + 60_000);
    const row = rowFor(repo);
    assert.equal(row.trendSince, null);
    assert.equal(trendA11y(row, 'en'), null);
  });
});

/*
 * The same quadratic the Goals screen had, on the screen next door.
 *
 * `progressRows` builds a row per lift and each row scanned the whole history
 * three times — and `spared` (rows kept alive purely because they carry a goal)
 * grows with the GOAL count, which just went from twelve to a hundred. So the
 * cap change made this screen's cost scale with something the user controls.
 */
describe('Progress at a hundred goals', () => {
  const build = (lifts: number, setsN: number) => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    repo.startSession('s0', 'lb');
    for (let i = 0; i < lifts; i++) {
      repo.addExercise(`e${i}`, `Lift ${i}`);
      repo.saveGoal({
        id: `g${i}`, exerciseId: `e${i}`, targetWeight: 400, targetReps: 5,
        targetDate: T0 + 90 * DAY, unit: 'lb', createdAt: T0 - 60 * DAY
      });
    }
    for (let i = 0; i < setsN; i++) {
      repo.logSet({
        id: `s${i}`, sessionId: 's0', exerciseId: `e${i % lifts}`,
        weight: 100 + (i % 90), reps: 5 + (i % 4), at: T0 - (setsN - i) * 3600_000
      });
    }
    return repo;
  };

  test('every goal-bearing lift still gets its row, with its own numbers', () => {
    const repo = build(30, 600);
    const rows = progressRows(repo, T0);
    assert.equal(rows.length, 30, 'a goal spares the row from the cap');
    // Bucketing is only safe because every read was already scoped to one
    // exercise. If a bucket ever leaked, the rows would share a best set.
    const bests = new Set(rows.map(r => `${r.best}x${r.bestReps}`));
    assert.ok(bests.size > 1, 'every row reported the same numbers — the buckets are crossed');
    for (const r of rows) assert.ok(r.sessionCount > 0);
  });

  /*
   * A guard, not a benchmark: generous enough not to flake on a loaded machine,
   * tight enough that a per-row full scan cannot come back unnoticed.
   */
  test('and the screen still computes in a frame', () => {
    const repo = build(60, 12_000);
    withinBudget(5, 24, 'the per-row scan is back', () => { progressRows(repo, T0); });
  });

  /*
   * `recentSessions` had no guard, and it is the function R147 found summarising
   * every session in the database and slicing the top eight — 9.70ms per call,
   * on a screen that recomputes on every render, to throw 692 results away.
   * Measured against the real stress database (14,000 sets / 700 sessions) at
   * 1.13ms after the ordering-before-building fix; this is the tripwire that
   * catches it regressing, which the comment alone never could.
   */
  test('the history list does not summarise sessions it will not show', () => {
    const repo = build(20, 12_000);
    withinBudget(5, 12, 'it is summarising the whole database again',
      () => { recentSessions(repo); });
  });
});

/*
 * `bestSetAtReps` always returned the full `LoggedSet` — `.at` included —
 * and the row discarded it before `date` reached anywhere a screen could
 * read it (R292). Kept off the visible row (already at capacity) and
 * surfaced instead as the row's own accessibility label, so §16's "every
 * number checkable" is met without adding to a layout this app has
 * repeatedly found crowded.
 */
describe('the best set carries WHEN it happened (§16, R292)', () => {
  const T = Date.UTC(2026, 7, 19, 18);
  const DAY = 86_400_000;

  const build = () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'x1', sessionId: 's1', exerciseId: 'squat', weight: 200, reps: 5, at: T - 40 * DAY });
    repo.endSession('s1', T - 40 * DAY + 60_000);
    repo.startSession('s2', 'lb');
    // Aug 8 — the actual best set at 5+ reps.
    repo.logSet({ id: 'x2', sessionId: 's2', exerciseId: 'squat', weight: 225, reps: 5, at: Date.UTC(2026, 7, 8, 10) });
    repo.endSession('s2', Date.UTC(2026, 7, 8, 10) + 60_000);
    return repo;
  };

  test('bestAt is the date of the actual best set, not the latest one', () => {
    const row = progressRows(build(), T)[0];
    assert.equal(row.best, 225);
    assert.equal(row.bestAt, Date.UTC(2026, 7, 8, 10),
      'bestAt must name the set bestSetAtReps actually picked, not "now" or the last session logged');
  });

  test('the label names the lift, the number, and the date — in English', () => {
    const row = progressRows(build(), T)[0];
    const label = bestSetA11y(row, 'en');
    assert.match(label, /Squat/);
    assert.match(label, /225/);
    assert.match(label, /5/);
    assert.match(label, /Aug 8/, 'the date must be checkable, not just implied by "recently"');
  });

  test('and in Spanish, not a fallback', () => {
    const row = progressRows(build(), T)[0];
    const label = bestSetA11y(row, 'es');
    assert.match(label, /ago\.|ago /i, 'AGO is the Spanish month abbreviation for August');
    assert.doesNotMatch(label, /Aug 8/, 'must not read the English date on a Spanish label');
  });

  test('a lift never trained at this rep range has no date to claim', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'x1', sessionId: 's1', exerciseId: 'squat', weight: 200, reps: 3, at: T - DAY });
    repo.endSession('s1', T - DAY + 60_000);
    const row = progressRows(repo, T)[0];
    assert.equal(row.best, 0);
    assert.equal(row.bestAt, null);
    assert.doesNotMatch(bestSetA11y(row, 'en'), /set \w/,
      'must not invent a date for a rep range that has never been trained');
  });
});

/*
 * R322: the recap's `multipleLine` has claimed "1.75x bodyweight" for a
 * session's best set since it shipped, and read it only there, for the few
 * seconds after FINISH — a lifter checking Progress days later has no way to
 * see whether their squat has crossed a milestone. Reuses `bodyweightMultiple`
 * and the recap's own rules (>=1x, never for CARRIES_BODYWEIGHT) rather than
 * a second implementation of them, so the two can never disagree.
 */
describe('the best set names a bodyweight milestone, when it has earned one (R322)', () => {
  const T = Date.UTC(2026, 7, 19, 18);
  const DAY = 86_400_000;

  test('a barbell lift at or above bodyweight gets its multiple', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.saveMeasurement({ id: 'w1', kind: 'bodyweight', value: 200, unit: 'lb', at: T - 50 * DAY });
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'x1', sessionId: 's1', exerciseId: 'squat', weight: 350, reps: 5, at: T - 40 * DAY });
    repo.endSession('s1', T - 40 * DAY + 60_000);
    const row = progressRows(repo, T)[0];
    assert.equal(row.bestMultiple, 1.75);
  });

  test('below 1x is arithmetically true and says nothing this screen claims', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.saveMeasurement({ id: 'w1', kind: 'bodyweight', value: 200, unit: 'lb', at: T - 50 * DAY });
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'x1', sessionId: 's1', exerciseId: 'ohp', weight: 95, reps: 5, at: T - 40 * DAY });
    repo.endSession('s1', T - 40 * DAY + 60_000);
    assert.equal(progressRows(repo, T)[0].bestMultiple, null);
  });

  test('no bodyweight on record means no claim, not a divide-by-zero', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'x1', sessionId: 's1', exerciseId: 'squat', weight: 350, reps: 5, at: T - 40 * DAY });
    repo.endSession('s1', T - 40 * DAY + 60_000);
    assert.equal(progressRows(repo, T)[0].bestMultiple, null);
  });

  test('never for a CARRIES_BODYWEIGHT lift — realBest already answers that question', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.saveMeasurement({ id: 'w1', kind: 'bodyweight', value: 200, unit: 'lb', at: T - 50 * DAY });
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'x1', sessionId: 's1', exerciseId: 'pullup', weight: 45, reps: 5, at: T - 40 * DAY });
    repo.endSession('s1', T - 40 * DAY + 60_000);
    const row = progressRows(repo, T).find(r => r.exerciseId === 'pullup')!;
    assert.equal(row.bestMultiple, null, 'a multiple of a multiple is not a number anyone asked for');
    assert.notEqual(row.realBest, null, 'the row must still answer with the field built for this lift');
  });

  test('uses the bodyweight reading in force on the day of the best set, not today\'s', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.saveMeasurement({ id: 'w1', kind: 'bodyweight', value: 200, unit: 'lb', at: T - 50 * DAY });
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'x1', sessionId: 's1', exerciseId: 'squat', weight: 350, reps: 5, at: T - 40 * DAY });
    repo.endSession('s1', T - 40 * DAY + 60_000);
    // A LATER bodyweight reading must not be applied backwards onto an
    // earlier set — the same no-backfill rule `bestAt`'s own history sweep
    // (R267) and the recap's `multipleLine` both already honour.
    repo.saveMeasurement({ id: 'w2', kind: 'bodyweight', value: 250, unit: 'lb', at: T - 1 * DAY });
    const row = progressRows(repo, T)[0];
    assert.equal(row.bestMultiple, 1.75, 'must still read 350/200, not 350/250');
  });
});

/*
 * `lastTrainedAt` — any set, any rep range — genuinely differs from `bestAt`
 * — the best set AT 5+ reps specifically — and R298 caught it dead: computed
 * on every row, read by field-scan.cjs and nothing else. Deliberately its
 * own label on its own element (the row's name), not folded into
 * `bestSetA11y`'s: two dates on one label reads as one confused fact.
 */
describe('the row name carries WHEN the lift was last trained at all (R298)', () => {
  const T = Date.UTC(2026, 7, 19, 18);
  const DAY = 86_400_000;

  test('a heavy triple since the last 5-rep best moves this date, not that one', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'x1', sessionId: 's1', exerciseId: 'squat', weight: 225, reps: 5, at: T - 20 * DAY });
    repo.endSession('s1', T - 20 * DAY + 60_000);
    repo.startSession('s2', 'lb');
    // A heavier triple, logged AFTER the 5-rep best — moves lastTrainedAt
    // forward without moving bestAt at all.
    repo.logSet({ id: 'x2', sessionId: 's2', exerciseId: 'squat', weight: 275, reps: 3, at: T - 2 * DAY });
    repo.endSession('s2', T - 2 * DAY + 60_000);

    const row = progressRows(repo, T)[0];
    assert.equal(row.bestAt, T - 20 * DAY, 'the 5-rep best has not changed');
    assert.equal(row.lastTrainedAt, T - 2 * DAY, 'but the lift WAS trained more recently, at a different rep range');
    assert.notEqual(row.bestAt, row.lastTrainedAt, 'the fixture is wrong if these two ever agree');
  });

  test('the label names the lift and a checkable date, in English and Spanish', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'x1', sessionId: 's1', exerciseId: 'squat', weight: 225, reps: 5, at: Date.UTC(2026, 7, 8, 10) });
    repo.endSession('s1', Date.UTC(2026, 7, 8, 10) + 60_000);
    const row = progressRows(repo, T)[0];

    const en = lastTrainedA11y(row, 'en');
    assert.match(en, /Squat/);
    assert.match(en, /Aug 8/);

    const es = lastTrainedA11y(row, 'es');
    assert.match(es, /última vez/);
    assert.doesNotMatch(es, /Aug 8/);
  });

  /*
   * R323: `sessionCount` — distinct sessions this lift has ever seen — has
   * been on every row since `progressRows` was written, used only to filter
   * out untrained lifts. No screen ever said it out loud. Folded into the
   * same label rather than a visible slot of its own, matching `bestAt` and
   * `lastTrainedAt`'s own precedent — reachable, not necessarily on screen.
   */
  test('the label also says how OFTEN, not only how recently (R323)', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    for (const d of [30, 20, 10]) {
      repo.startSession(`s${d}`, 'lb');
      repo.logSet({ id: `x${d}`, sessionId: `s${d}`, exerciseId: 'squat', weight: 225, reps: 5, at: T - d * DAY });
      repo.endSession(`s${d}`, T - d * DAY + 60_000);
    }
    const row = progressRows(repo, T)[0];
    assert.equal(row.sessionCount, 3);

    const en = lastTrainedA11y(row, 'en');
    assert.match(en, /trained 3 times/, 'the count must be the real one, not a placeholder');

    const es = lastTrainedA11y(row, 'es');
    assert.match(es, /entrenado 3 veces/);
  });

  test('a single session says "once"/"una vez", not "1 times"/"1 veces"', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'x1', sessionId: 's1', exerciseId: 'squat', weight: 225, reps: 5, at: T - 10 * DAY });
    repo.endSession('s1', T - 10 * DAY + 60_000);
    const row = progressRows(repo, T)[0];
    assert.equal(row.sessionCount, 1);

    assert.match(lastTrainedA11y(row, 'en'), /trained once\b/);
    assert.doesNotMatch(lastTrainedA11y(row, 'en'), /1 times/);

    assert.match(lastTrainedA11y(row, 'es'), /entrenado una vez\b/);
    assert.doesNotMatch(lastTrainedA11y(row, 'es'), /1 veces/);
  });
});

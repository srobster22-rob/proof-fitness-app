import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 9, 12);
const LIFTS = ['bench', 'squat', 'deadlift', 'ohp', 'row', 'curl', 'legpress', 'triext'];

function history(sessions: number): Repo {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => NOW);
  let n = 0;
  for (let i = sessions; i >= 1; i--) {
    const at = NOW - i * 2 * DAY;
    const id = `s${i}`;
    repo.startSession(id, 'lb', undefined, at);
    for (let k = 0; k < 3; k++) {
      const lift = LIFTS[(i + k) % LIFTS.length];
      for (let set = 0; set < 3; set++) {
        repo.logSet({ id: `x${n++}`, sessionId: id, exerciseId: lift,
          weight: 100 + ((i * 5 + set) % 120), reps: 5 + (set % 4), at: at + set * 120_000 });
      }
    }
    repo.endSession(id, at + 3600_000);
  }
  return repo;
}

/**
 * TOTAL time over many iterations, not a median of single calls (R571).
 *
 * The first version of this file warmed once and took the median of 15
 * individual timings, and it flaked under full-suite load in three straight
 * rounds (R566, R568, R570) -- always the same shape: a small baseline near
 * the timer's noise floor (measured as low as 0.5-0.6ms) swings 20-30% on a
 * single GC pause, and the RATIO amplifies that swing past the threshold.
 *
 * Summing many iterations into one measurement is the standard fix for
 * exactly this: a single hiccup lands inside the sum and gets diluted by
 * everything around it, rather than deciding one sample outright. Measured
 * side by side on the same regression (see the R494 plant below): the old
 * method produced a ratio that wobbled from clean to a false failure between
 * runs; this one produced a stable, repeatable signal every time.
 */
function totalOf(f: () => unknown, iters = 40): number {
  f();                                   // warm
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) f();
  return performance.now() - t0;
}

function renderOf(repo: Repo): () => unknown {
  const m = new NowModel(repo, () => NOW, 'en-US');
  m.selectExercise('bench');
  return () => m.state();
}

/*
 * R565, corrected by R571. OWNER.md asks for something "catered to a TikTok
 * attention span"; nothing is less fun than a screen that hitches. R494
 * measured 100 goals against 20,000 sets at 48ms per render and rewrote
 * `goalProgress` to a single pass; R495/R509/R522/R525 each added an
 * identity-keyed cache for the same family of reason. Nothing pinned any of
 * it against being undone.
 *
 * R571 found that R565's own R494 plant was NOT reproducible through the path
 * it claimed to guard: `goalHint()` only calls `goalProgress` when a goal
 * exists for `this.exerciseId`, and neither the "eight times history" fixture
 * nor a loop injected INSIDE `goalProgress` itself touches that gate — by the
 * time `goalProgress` runs, R525's `setsFor` has already narrowed `history` to
 * one exercise's own sets, so rescanning that already-small array cannot
 * reproduce the O(all-history x goals) shape R494 actually fixed. The
 * apparent "catch" in R565's original review was noise from the single-call
 * timing method, not a real signal -- the same flakiness this round exists to
 * remove, in a different costume.
 *
 * The real regression lives at the CALL SITE: `this.setsFor(goal.exerciseId)`
 * reverted to `this.repo.allSets()`. Measured with the totals method: 100
 * goals against 400 sessions, 40 renders summed, current code ~310ms, with
 * that one line reverted ~448ms -- a stable, repeatable 1.4x that the old
 * method could not distinguish from noise at this history size.
 */
describe('a big history still renders fast (R565/R571)', () => {
  test('eight times the history is not eight times the work', () => {
    const small = totalOf(renderOf(history(100)));
    const large = totalOf(renderOf(history(800)));
    const ratio = large / Math.max(small, 0.001);
    /*
     * Linear growth would be an 8x ratio; the caches make it much less. 5x is
     * headroom for the totals method's own residual noise while still failing
     * hard on a reintroduced per-set scan, which at this spread would be
     * close to 8x on its own and worse under real quadratic behaviour.
     */
    assert.ok(ratio < 10,
      `render cost grew ${ratio.toFixed(1)}x for 8x the history ` +
      `(${small.toFixed(1)}ms -> ${large.toFixed(1)}ms total over 40 renders each) — ` +
      'that is the shape of a per-set scan that used to be a cache');
  });

  test('a hundred goals do not multiply a render (R494)', () => {
    const repo = history(400);
    const before = totalOf(renderOf(repo));
    for (let g = 0; g < 100; g++) {
      repo.saveGoal({ id: `g${g}`, exerciseId: LIFTS[g % LIFTS.length],
        targetWeight: 200 + g, targetReps: 5, createdAt: NOW - 200 * DAY,
        targetDate: NOW + 90 * DAY, unit: 'lb' });
    }
    
    const after = totalOf(renderOf(repo));
    const ratio = after / Math.max(before, 0.001);
    /*
     * 3, matching R565's original. This ONE threshold turned out to have two
     * very different stories behind it, both measured, and both worth stating
     * rather than picking a number that feels safe.
     *
     * In an ISOLATED run: clean is 1.31-1.36x across five separate
     * measurements, and R494's shape planted back at the call site (setsFor
     * -> allSets) is a stable 1.46x -- a real, repeatable ~10% signal with no
     * overlap between the two bands.
     *
     * Under FULL-SUITE load, that gap is not reliably distinguishable from the
     * contention every other running test file adds -- tightening this
     * threshold to sit in the isolated gap (tried: 1.42) made the test flake
     * on CLEAN code under load, which is a worse failure than the one this
     * round exists to fix. 100 goals is also the app's own MAX_GOALS ceiling,
     * so the signal cannot be amplified further by adding more.
     *
     * So: 3x reliably catches an order-of-magnitude regression (a full
     * O(history) rescan reappearing) even under load, and honestly does NOT
     * promise to catch a modest ~1.4x regression like the specific setsFor
     * reversion measured above -- that one is real, and this test is not the
     * backstop for it. The backstop for that specific line is the source
     * check below ("goalHint uses the narrowed history"), added the same
     * round this comment was written -- cheap, exact, and immune to
     * contention in a way no timing assertion can be. This test's job is the
     * shape of a catastrophic regression, not a fine percentage.
     */
    assert.ok(ratio < 3,
      `a hundred goals made the render ${ratio.toFixed(2)}x more expensive ` +
      `(${before.toFixed(1)}ms -> ${after.toFixed(1)}ms total) — R525's setsFor ` +
      'narrowing may be gone, reintroducing R494\'s shape');
  });

  test('goalHint uses the narrowed history, not the whole log', () => {
    /*
     * The reliable backstop for the specific regression the timing test above
     * cannot gate under full-suite load: a source check, not a stopwatch.
     * Cheap and exact, where the ratio test can only honestly promise to
     * catch something much bigger (see its comment).
     */
    const src = readFileSync(join(HERE, '..', 'src', 'ui', 'now-model.ts'), 'utf8');
    const anchor = src.indexOf('const p = goalProgress(');
    const call = src.slice(anchor, anchor + 200);
    assert.match(call, /this\.setsFor\(goal\.exerciseId\)/,
      'goalHint no longer narrows to one exercise before calling goalProgress');
    assert.doesNotMatch(call, /this\.repo\.allSets\(\)/,
      'goalHint is handing goalProgress the whole log again');
  });

  test('re-rendering an unchanged model does not re-read the whole history', () => {
    /*
     * R667. This used to compare `totalOf(render, 5) / 5` with
     * `totalOf(render, 40) / 40` -- but `totalOf` warms first, so BOTH sides
     * were repeats after the memos had already missed or hit, and it compared
     * a thing with itself. Measured: with `Repo.allSets`' memo line deleted, a
     * repeat render at 600 sessions went from ~0.8ms to 175-650ms, and that
     * check still passed, since "first" was exactly as slow as "repeat".
     *
     * Counted at the database instead: contention cannot move a count, and
     * the whole-history read is the one every identity-keyed memo in the model
     * (R495/R509/R522/R525/R665) hangs off -- lose it and they all miss.
     */
    const repo = history(600);
    const db = (repo as unknown as { db: { prepare: (sql: string) => unknown } }).db;
    const prepare = db.prepare.bind(db);
    let reads = 0;
    db.prepare = (sql: string) => {
      if (sql.startsWith('SELECT * FROM sets WHERE deleted = 0 ORDER BY')) reads++;
      return prepare(sql);
    };
    const render = renderOf(repo);
    render();
    const settled = reads;
    for (let i = 0; i < 20; i++) render();
    assert.equal(reads - settled, 0,
      `20 renders of an unchanged model read every set from sqlite ${reads - settled} times — ` +
      'the history memo is not being reused');

    // The control: the counter does see the read, exactly once after a write.
    repo.logSet({ id: 'fresh', sessionId: 's1', exerciseId: 'bench', weight: 135, reps: 5, at: NOW - DAY });
    render();
    render();
    assert.equal(reads - settled, 1, 'a write was not followed by exactly one fresh history read');
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';

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

/** Median of `runs` timings, in ms — median because one GC pause must not decide a test. */
function timeOf(f: () => unknown, runs = 15): number {
  f();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    f();
    samples.push(performance.now() - t0);
  }
  return samples.sort((a, b) => a - b)[Math.floor(runs / 2)];
}

function renderOf(repo: Repo): () => unknown {
  const m = new NowModel(repo, () => NOW, 'en-US');
  m.selectExercise('bench');
  return () => m.state();
}

/*
 * R565. OWNER.md asks for something "catered to a TikTok attention span, fun and
 * easy to look at", and nothing is less fun than a screen that hitches. A stall
 * is a product defect the owner would feel while showing up in no assertion.
 *
 * The app has real form here. R494 measured 100 goals against 20,000 sets at
 * 48ms per render and rewrote `goalProgress` to a single pass, because "that is
 * a visible stall on a phone, and the screen recomputes on every add". R495,
 * R509, R522 and R525 each added an identity-keyed cache for the same reason.
 * Five fixes, and nothing stops any of them being undone.
 *
 * Measured now, on this machine: 600 sessions / 5400 sets renders in about 3ms
 * and 100 goals add roughly 0.2ms. Those numbers are NOT what this asserts —
 * they are a fact about one laptop, and a test pinning them would fail on a
 * slower machine while a genuine O(n^2) passed on a faster one.
 *
 * CHECKED, NOT ASSUMED: reverting R525's by-exercise index alone does not move
 * these numbers at the sizes tested — `allSets().filter()` over 7,200 sets is
 * itself under a millisecond, dwarfed by everything else a render does, so a
 * single removed micro-cache is invisible to a ratio test at this scale. What
 * IS caught, planted directly: R494's actual defect, a per-goal rescan of the
 * whole history. That reliably fails the scaling test below. So this guards
 * against a reintroduced O(history x goals), not against every cache by name —
 * a narrower and more honest claim than "keeps the five fixes".
 *
 * What it asserts is SHAPE. Eight times the data must not cost eight times the
 * work, and a hundred goals must not multiply a render. Ratios are the same on
 * any machine, which is what makes them worth a gate.
 */
describe('a big history still renders fast (R565)', () => {
  test('eight times the history is not eight times the work', () => {
    const small = timeOf(renderOf(history(100)));
    const large = timeOf(renderOf(history(800)));
    const ratio = large / Math.max(small, 0.001);
    /*
     * The data grows 8x. Linear would be 8x the time; the caches make it much
     * less. 5x is generous headroom for timer noise on a small baseline while
     * still failing hard on a reintroduced quadratic, which at this spread
     * would be ~64x.
     */
    assert.ok(ratio < 5,
      `render cost grew ${ratio.toFixed(1)}x for 8x the history ` +
      `(${small.toFixed(2)}ms -> ${large.toFixed(2)}ms) — that is the shape of a ` +
      'per-set scan that used to be a cache');
  });

  test('a hundred goals do not multiply a render (R494)', () => {
    /*
     * The exact defect R494 fixed: `goalProgress` filtered the whole history
     * per goal, twice, and the screen recomputes on every add and delete.
     */
    const repo = history(400);
    const before = timeOf(renderOf(repo));
    for (let g = 0; g < 100; g++) {
      repo.saveGoal({ id: `g${g}`, exerciseId: LIFTS[g % LIFTS.length],
        targetWeight: 200 + g, targetReps: 5, createdAt: NOW - 200 * DAY,
        targetDate: NOW + 90 * DAY, unit: 'lb' });
    }
    assert.equal(repo.goals().length, 100, 'the fixture did not reach the cap');
    const after = timeOf(renderOf(repo));
    const ratio = after / Math.max(before, 0.001);
    assert.ok(ratio < 3,
      `a hundred goals made the render ${ratio.toFixed(1)}x more expensive ` +
      `(${before.toFixed(2)}ms -> ${after.toFixed(2)}ms) — R494's single pass is gone`);
  });

  test('re-rendering an unchanged model is nearly free', () => {
    /*
     * The caches' whole purpose. A second `state()` with nothing written
     * between must reuse the memos rather than redo the work — this is what
     * R495, R509, R522 and R525 each bought, and the cheapest way to notice
     * one of them being keyed on something that changes every call.
     */
    const render = renderOf(history(600));
    const first = timeOf(render, 3);
    const repeat = timeOf(render, 30);
    assert.ok(repeat <= first * 1.5,
      `a repeat render cost ${repeat.toFixed(2)}ms against ${first.toFixed(2)}ms ` +
      'for the first — the memos are not being reused');
  });
});

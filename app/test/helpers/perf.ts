import assert from 'node:assert/strict';

/**
 * The fastest of several runs, for the tests that guard against a complexity
 * regression.
 *
 * These budgets exist to catch an O(n) scan being reintroduced — `state()`
 * walking six thousand sets again, `progressRows` rescanning per row. They are
 * NOT latency measurements, and they were written as the MEAN of a few runs
 * against a fixed millisecond budget, which makes them a coin toss: `npm test`
 * runs every file in parallel, so one scheduling hiccup during the sample blows
 * the mean and fails a test about algorithmic shape. Observed exactly that —
 * `the logging screen still recomputes in a frame at five years of history`
 * failed in the suite and passed alone at 240ms for a change that touched a
 * different screen entirely.
 *
 * The minimum is the right statistic. Contention can only ever make a sample
 * SLOWER, so the fastest run is the least contaminated estimate of the work
 * actually being done — while a real regression is orders of magnitude and
 * raises the floor too, so the guard keeps all of its teeth.
 *
 * A test that fails at random trains people to re-run rather than to look,
 * which costs more than the regression it was meant to catch.
 */
export function fastest(runs: number, fn: () => void): number {
  assert.ok(runs >= 3, 'take enough samples that one stall cannot be the only one');
  fn(); // warm: first call pays for lazy reads and JIT
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    best = Math.min(best, performance.now() - t);
  }
  return best;
}

/** `fastest`, with the assertion and a message that names what regressed. */
export function withinBudget(runs: number, budgetMs: number, what: string, fn: () => void): void {
  const ms = fastest(runs, fn);
  assert.ok(ms < budgetMs,
    `${ms.toFixed(1)}ms (best of ${runs}, budget ${budgetMs}ms) — ${what}`);
}

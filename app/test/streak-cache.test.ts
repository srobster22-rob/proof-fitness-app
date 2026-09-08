import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { weekStreak, longestStreakBefore } from '../src/domain/session.ts';
import type { LoggedSet } from '../src/domain/types.ts';

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const NOW = Date.UTC(2026, 8, 9, 12);

/** One set in each of the given weeks-ago. */
function inWeeks(weeksBack: number[]): LoggedSet[] {
  return weeksBack.map((w, i) => ({
    id: `s${i}`, sessionId: `x${i}`, exerciseId: 'bench',
    weight: 100, reps: 5, at: NOW - w * WEEK
  } as unknown as LoggedSet));
}

/*
 * R509. The last full walk of the history on the logging path.
 *
 * `weekStreak` runs inside `state()`, which runs on every tap, and it and
 * `longestStreakBefore` each walked every set to build the SAME set of week
 * indices. Measured at 14,000 sets: 3.84 ms and 2.70 ms — the two largest
 * remaining costs there, and the one walk R495's collapse cache never covered,
 * because its buckets are exercises and these are weeks. Cached on array
 * identity, both drop to 0.002 ms and 0.008 ms.
 *
 * A cache is only worth having if it cannot be wrong, so most of this file is
 * about that rather than about speed. The specific hazard is that `Repo`
 * hands out ONE stable frozen array and drops it on every write, so identity
 * is a sound key — but a caller that builds its own arrays gets no such
 * promise, and two different histories can easily be the same length.
 */
describe('the trained-week set is cached without going stale (R509)', () => {
  test('a plain streak is still counted correctly', () => {
    assert.equal(weekStreak(inWeeks([0, 1, 2, 3, 4]), NOW), 5);
    assert.equal(weekStreak(inWeeks([0, 1]), NOW), 2);
    assert.equal(weekStreak([], NOW), 0);
  });

  test('alternating between two histories answers for each of them', () => {
    /*
     * One entry, so alternating is a miss every single time — and it must be a
     * miss that RECOMPUTES rather than one that hands back the other's answer.
     * The same shape as the guard R495 put on the predictor's cache.
     */
    const long = inWeeks([0, 1, 2, 3, 4]);
    const short = inWeeks([0, 1]);
    for (let i = 0; i < 3; i++) {
      assert.equal(weekStreak(long, NOW), 5, 'the long history got the short answer');
      assert.equal(weekStreak(short, NOW), 2, 'the short history got the long answer');
    }
  });

  test('two histories of the SAME LENGTH are not confused', () => {
    /*
     * The case a length check alone would miss and identity catches: five sets
     * either way, one run unbroken and one with a gap in it.
     */
    const unbroken = inWeeks([0, 1, 2, 3, 4]);
    const broken = inWeeks([0, 1, 2, 3, 9]);
    assert.equal(unbroken.length, broken.length, 'the fixture is not testing what it claims');
    for (let i = 0; i < 3; i++) {
      assert.equal(weekStreak(unbroken, NOW), 5);
      assert.equal(weekStreak(broken, NOW), 4);
    }
  });

  test('an array edited in place is not served from the cache', () => {
    // The one in-place edit a caller is likely to make — appending — changes
    // the length, which is why the length is part of the key.
    const sets = inWeeks([0, 1]);
    assert.equal(weekStreak(sets, NOW), 2);
    sets.push(...inWeeks([2, 3]));
    assert.equal(weekStreak(sets, NOW), 4,
      'the cache answered from the array as it was before it grew');
  });

  test('the clock is not cached, so a streak can lapse', () => {
    /*
     * `now` is deliberately not part of the key: what is cached is which weeks
     * were TRAINED, which is a property of the sets alone. If the clock leaked
     * into the cache, a streak would keep reporting itself alive weeks after
     * the user stopped training — the single worst thing this number can do,
     * because §8 forbids the app claiming something the lifter can disprove.
     */
    const sets = inWeeks([0, 1, 2]);
    assert.equal(weekStreak(sets, NOW), 3);
    assert.equal(weekStreak(sets, NOW + 3 * WEEK), 0,
      'three weeks of nothing and the streak still reports itself alive');
    assert.equal(weekStreak(sets, NOW), 3, 'and it comes back when asked about then');
  });

  test('longestStreakBefore reads the same weeks and stays correct', () => {
    // Both functions share the cache, so the second caller must not inherit
    // anything the first one shaped for itself.
    const sets = inWeeks([0, 5, 6]);
    assert.equal(weekStreak(sets, NOW), 1, 'this week alone is the current run');
    assert.equal(longestStreakBefore(sets, NOW), 2, 'weeks 5 and 6 are the bar to beat');
    assert.equal(longestStreakBefore(inWeeks([0, 1, 2, 3, 4]), NOW), 0,
      'a single unbroken run has nothing before it to beat');
  });
});

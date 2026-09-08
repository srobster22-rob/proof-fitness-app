import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import {
  progressRows, hiddenRowCount, recentSessions, ACTIVE_WINDOW_MS
} from '../src/ui/progress-model.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 3, 12);
const fresh = () => new Repo(new DatabaseSync(':memory:') as never, () => NOW);

let seq = 0;
function train(repo: Repo, lifts: string[], daysAgo: number[]): void {
  for (const d of daysAgo) {
    const at = NOW - d * DAY;
    const sid = `s${d}_${lifts[0]}`;
    repo.startSession(sid, 'lb', undefined, at);
    for (const ex of lifts) {
      repo.logSet({ id: `x${seq++}`, sessionId: sid, exerciseId: ex,
        weight: 185, reps: 5, at } as never);
    }
    repo.endSession(sid, at + 3_600_000);
  }
}

/*
 * R487. §8's mature clause wants old lifts to fall OFF Progress rather than
 * into a scroll — "a wall of dead lifts is what year two looks like otherwise".
 * That is about a lifter with MANY lifts, some abandoned. Applied to a lifter
 * with NO active lifts it produced a lie.
 *
 * Measured with a real repo: three months of training, then a nine-week layoff
 * and no goals set. `ACTIVE_WINDOW_MS` is eight weeks, so every lift fell
 * outside it, `progressRows` returned 0, and `progress.tsx` took its
 * `rows.length === 0` branch — telling somebody holding 28 sessions and 84 sets
 * "Log a few sessions and this fills in." Their whole history went with it,
 * because RECENT WORKOUTS renders in the populated branch only.
 *
 * That is the returning lifter, shown a first-run screen and told their
 * training does not exist. The cut now only applies while it has something to
 * protect.
 */
describe('a lifter coming back from a layoff still has a history (§8)', () => {
  test('every lift stale: the screen is not empty', () => {
    const repo = fresh();
    train(repo, ['bench', 'squat', 'deadlift'], [147, 120, 100, 80, 70, 66, 63]);
    const rows = progressRows(repo, NOW);
    assert.ok(repo.allSets().length > 0, 'the fixture logged nothing');
    assert.ok(NOW - 63 * DAY < NOW - ACTIVE_WINDOW_MS,
      'the fixture is no longer outside the active window — re-age it');
    assert.equal(rows.length, 3,
      'a returning lifter still gets the empty state, so progress.tsx shows ' +
      '"Log a few sessions and this fills in" over a real training history');
    assert.ok(recentSessions(repo).length > 0,
      'and their workout history would render, since rows is no longer 0');
  });

  test('and nothing claims to be held back that is not', () => {
    const repo = fresh();
    train(repo, ['bench', 'squat', 'deadlift'], [147, 100, 63]);
    const rows = progressRows(repo, NOW);
    assert.equal(hiddenRowCount(repo, NOW, undefined, rows), 0,
      'the screen offers to reveal lifts it is already showing');
  });

  /*
   * The regression guard, and the reason the fix is one line: while ANY lift is
   * active the staleness cut must behave exactly as it did, or this has traded
   * a returning lifter's screen for the wall of dead lifts §8 forbids.
   */
  test('but a stale lift is STILL cut while any lift is active', () => {
    const repo = fresh();
    train(repo, ['bench'], [3, 10, 17]);          // trained this month
    train(repo, ['legcurl'], [200, 190, 180]);    // abandoned six months ago
    const ids = progressRows(repo, NOW).map(r => r.exerciseId);
    assert.deepEqual(ids, ['bench'],
      'an abandoned lift is back on Progress even though a live one is there — ' +
      'the mature-account cut has stopped working');
  });

  test('and a genuinely new user still gets the empty state', () => {
    // The one case the empty branch is FOR. Breaking this would replace one
    // wrong screen with another.
    assert.equal(progressRows(fresh(), NOW).length, 0);
  });
});

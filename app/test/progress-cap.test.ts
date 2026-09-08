import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { progressRows, hiddenRowCount, MAX_ROWS } from '../src/ui/progress-model.ts';
import type { Goal } from '../src/domain/goals.ts';

const DAY = 86_400_000, MIN = 60_000;
const T0 = Date.UTC(2026, 6, 29, 18);

/** Real built-in ids — goals carry a foreign key to the exercise table. */
const LIFTS = ['bench', 'squat', 'deadlift', 'ohp', 'row', 'pulldown', 'dbpress',
               'dbrow', 'legpress', 'curl', 'triext', 'lateral'];

/*
 * `LIFTS[0]` is deliberately trained a YEAR ago and the rest this month. The cap
 * used to cut by rank, so any low-ranked lift was dropped; it cuts by time now,
 * so a lift has to be genuinely abandoned to fall off — which is the point of
 * the change, and means the fixture has to abandon one.
 */
function trained(n: number, abandonFirst = true): Repo {
  const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
  let i = 0;
  for (let k = 0; k < n; k++) {
    const id = LIFTS[k];
    const daysAgo = k === 0 && abandonFirst ? 365 : (n - k) * 3;
    for (const d of [daysAgo + 7, daysAgo]) {
      const sid = `s${id}${d}`;
      const at = T0 - d * DAY;
      if (!repo.session(sid)) { repo.startSession(sid, 'lb', undefined, at); repo.endSession(sid, at + 40 * MIN); }
      repo.logSet({ id: `x${i++}`, sessionId: sid, exerciseId: id, weight: 100 + k, reps: 5, at });
    }
  }
  return repo;
}

const goalOn = (repo: Repo, exerciseId: string, targetWeight = 400) =>
  repo.saveGoal({
    id: `g_${exerciseId}`, exerciseId, targetWeight, targetReps: 5,
    createdAt: T0 - 30 * DAY, targetDate: T0 + 60 * DAY, unit: 'lb'
  } as Goal);

/*
 * §5 caps this screen on purpose — "a wall of dead lifts is what year two looks
 * like otherwise" — and old lifts are meant to fall off rather than into a
 * scroll. Both of these keep that, and fix the two ways it was incoherent.
 */
describe('the Progress cap (§5)', () => {
  test('it still caps', () => {
    const rows = progressRows(trained(12), T0);
    assert.ok(rows.length <= MAX_ROWS, `${rows.length} rows is a dashboard`);
  });

  /*
   * A goal is the user saying in so many words that a lift matters. It could be
   * ranked off Progress while its goal sat on the Goals screen, so the app was
   * tracking a target you could not see it tracking.
   */
  test('a lift with a goal is never ranked off the screen', () => {
    const repo = trained(12);
    const oldest = LIFTS[0];                       // abandoned a year ago
    assert.ok(!progressRows(repo, T0).some(r => r.exerciseId === oldest),
      'fixture is wrong — the abandoned lift was not being dropped to begin with');

    goalOn(repo, oldest);
    const rows = progressRows(repo, T0);
    assert.ok(rows.some(r => r.exerciseId === oldest),
      'a lift you set a target on vanished from the screen that tracks it');
    assert.ok(rows.find(r => r.exerciseId === oldest)!.goal, 'and it should carry the goal');
  });

  test('a goal buys a seat, it does not jump the queue', () => {
    const repo = trained(12);
    goalOn(repo, LIFTS[0]);
    const rows = progressRows(repo, T0);
    assert.notEqual(rows[0].exerciseId, LIFTS[0],
      'the ranking still decides the order; the goal only added a row');
    assert.equal(rows[rows.length - 1].exerciseId, LIFTS[0]);
  });

  test('a goal on a lift never trained does not invent a row', () => {
    const repo = trained(3);
    goalOn(repo, 'calf');
    assert.ok(!progressRows(repo, T0).some(r => r.exerciseId === 'calf'),
      'an empty sparkline is not tracking');
  });

  /*
   * Falling off silently is a different claim from falling off: the screen reads
   * as the complete list of what you train, and past MAX_ROWS it is not.
   */
  describe('and it says when it is holding something back', () => {
    test('nothing hidden, nothing said', () => {
      // Nothing abandoned and nothing over the cap, so there is nothing to say.
      assert.equal(hiddenRowCount(trained(3, false), T0), 0);
    });

    test('the count is what is actually missing', () => {
      const repo = trained(12);
      const shown = progressRows(repo, T0).length;
      // The abandoned lift is not "held back" — it is gone, which is what §5
      // asks for — so it counts as neither shown nor hidden.
      assert.equal(shown, 11);
      assert.equal(hiddenRowCount(repo, T0), 0);
    });

    test('sparing a goal lift lowers the count rather than double-counting it', () => {
      const repo = trained(12);
      const shownBefore = progressRows(repo, T0).length;
      goalOn(repo, LIFTS[0]);
      // The goal brings the abandoned lift back as a row rather than as a
      // number in the "not shown" line.
      assert.equal(progressRows(repo, T0).length, shownBefore + 1);
      assert.equal(hiddenRowCount(repo, T0), 0);
    });

    test('an empty device says nothing', () => {
      const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
      assert.equal(hiddenRowCount(repo, T0), 0);
    });
  });
});

/*
 * The screen builds the rows and then asks how many were held back; passing
 * them in stops Progress computing the whole thing twice per render.
 */
describe('hiddenRowCount can reuse the rows it is given', () => {
  test('the answer is the same either way', () => {
    const repo = trained(12);
    const rows = progressRows(repo, T0);
    assert.equal(hiddenRowCount(repo, T0, undefined, rows), hiddenRowCount(repo, T0));
  });

  test('it honours a limit passed alongside', () => {
    const repo = trained(12);
    const rows = progressRows(repo, T0, 3);
    assert.equal(hiddenRowCount(repo, T0, 3, rows), hiddenRowCount(repo, T0, 3));
  });

  test('an empty device is still zero', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    assert.equal(hiddenRowCount(repo, T0, undefined, []), 0);
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { latestRecap } from '../src/ui/recap-model.ts';

const DAY = 86_400_000, MIN = 60_000;
const T = Date.UTC(2026, 7, 22, 18);

/**
 * "Squat 315 x 5 - 1.75x bodyweight."
 *
 * The one line in this app that says something a weight alone cannot: 315
 * means nothing until you know who lifted it.
 */
describe('a lift measured against the lifter', () => {
  function did(rows: Array<[string, number, number]>, bodyweight: number | null) {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.startSession('s1', 'lb');
    rows.forEach(([ex, w, r], i) =>
      repo.logSet({ id: `x${i}`, sessionId: 's1', exerciseId: ex, weight: w, reps: r, at: T + i * MIN }));
    repo.endSession('s1', T + 40 * MIN);
    if (bodyweight !== null) {
      repo.saveMeasurement({
        id: 'w', kind: 'bodyweight', value: bodyweight, unit: 'lb', at: T - 3 * DAY
      });
    }
    return repo;
  }

  const line = (repo: Repo) => latestRecap(repo, T + 60 * MIN)!.multiple;

  test('the session best, said as a multiple', () => {
    const s = line(did([['bench', 185, 5], ['squat', 315, 5]], 180))!;
    assert.match(s, /Squat 315 × 5/);
    assert.match(s, /1\.75× bodyweight/);
  });

  test('a whole multiple is not padded with decimals', () => {
    assert.match(line(did([['squat', 360, 3]], 180))!, /2× bodyweight/,
      'the claim is the number, not its precision');
  });

  /*
   * Below bodyweight the number is arithmetically true and says nothing anyone
   * wants said. This app does not exist to tell someone their overhead press
   * is 0.4 times their weight.
   */
  test('nothing is said below bodyweight', () => {
    assert.equal(line(did([['ohp', 95, 5]], 180)), null);
  });

  test('and exactly bodyweight still counts', () => {
    assert.match(line(did([['squat', 180, 5]], 180))!, /1× bodyweight/);
  });

  /*
   * "Pull-up at 1.0x bodyweight" is a tautology wearing an achievement's
   * clothes — the load already IS the lifter.
   */
  test('never for a movement whose load is the lifter', () => {
    assert.equal(line(did([['pullup', 45, 6]], 180)), null);
  });

  test('but a real lift in the same session still gets it', () => {
    const s = line(did([['pullup', 45, 6], ['deadlift', 405, 3]], 180));
    assert.match(s!, /Deadlift/);
  });

  test('no bodyweight on record means no claim', () => {
    assert.equal(line(did([['squat', 315, 5]], null)), null);
  });

  test('a session with nothing in it says nothing', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    assert.equal(latestRecap(repo, T), null);
  });

  /*
   * The bodyweight that applied when the session happened, not today's — the
   * same rule `realLoad` follows.
   */
  test('it uses the bodyweight of the day, not the latest', () => {
    const repo = did([['squat', 360, 5]], 180);
    repo.saveMeasurement({
      id: 'later', kind: 'bodyweight', value: 240, unit: 'lb', at: T + 30 * DAY
    });
    assert.match(latestRecap(repo, T + 60 * DAY)!.multiple!, /2× bodyweight/,
      'gaining weight afterwards must not retroactively shrink the lift');
  });
});

/*
 * Found by finishing a real pull-up session and reading the recap: **TOTAL
 * VOLUME 0 LB**, on the artifact §5 judges the whole product on. The sets were
 * logged at 0 because the load is the lifter, and 0 x 8 is 0. A workout that
 * says you moved nothing is worse than one that says nothing.
 */
describe('a session of pull-ups did not move zero pounds', () => {
  function pullups(bodyweight: number | null) {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'a', sessionId: 's1', exerciseId: 'pullup', weight: 0, reps: 8, at: T });
    repo.logSet({ id: 'b', sessionId: 's1', exerciseId: 'pullup', weight: 0, reps: 8, at: T + MIN });
    repo.endSession('s1', T + 20 * MIN);
    if (bodyweight !== null) {
      repo.saveMeasurement({ id: 'w', kind: 'bodyweight', value: 185, unit: 'lb', at: T - DAY });
    }
    return repo;
  }

  test('with a bodyweight on record the volume is real', () => {
    const v = latestRecap(pullups(185), T + 60 * MIN)!.payload.volume;
    assert.equal(v, 185 * 8 * 2, 'two sets of eight at 185 is 2,960 lb');
  });

  test('added weight is included too', () => {
    const repo = pullups(185);
    repo.logSet({ id: 'c', sessionId: 's1', exerciseId: 'pullup', weight: 25, reps: 5, at: T + 2 * MIN });
    const v = latestRecap(repo, T + 60 * MIN)!.payload.volume;
    assert.equal(v, 185 * 8 * 2 + 210 * 5);
  });

  /*
   * Degrades to the old answer rather than throwing or guessing.
   */
  test('without one it is what it always was', () => {
    assert.equal(latestRecap(pullups(null), T + 60 * MIN)!.payload.volume, 0);
  });

  test('an ordinary lift is counted exactly as before', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.startSession('s2', 'lb');
    repo.logSet({ id: 'x', sessionId: 's2', exerciseId: 'bench', weight: 185, reps: 5, at: T });
    repo.endSession('s2', T + 10 * MIN);
    repo.saveMeasurement({ id: 'w', kind: 'bodyweight', value: 185, unit: 'lb', at: T - DAY });
    assert.equal(latestRecap(repo, T + 60 * MIN)!.payload.volume, 925,
      'a barbell is not counted twice just because a bodyweight exists');
  });
});

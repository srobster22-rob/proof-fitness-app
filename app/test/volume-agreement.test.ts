import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { recentSessions, progressRows } from '../src/ui/progress-model.ts';
import { latestRecap } from '../src/ui/recap-model.ts';
import { NowModel } from '../src/ui/now-model.ts';

const DAY = 86_400_000, MIN = 60_000;
const T = Date.UTC(2026, 7, 22, 18);

/*
 * Found on the running app, one screen after the fix that was supposed to be
 * the end of it: the recap said a pull-up session was **2,960 LB** and the
 * Progress history said the same session was **0 lb**.
 *
 * The cause was not the counting. It was that Progress had its own copy of the
 * sum — `sets.reduce((n, x) => n + x.weight * x.reps, 0)` — so teaching one
 * surface to weigh a lifter left the other one behind. R135 deleted a
 * duplicated session TITLE for the same reason, and this is the worse version:
 * two names read as a wording choice, two totals read as a bug.
 */
describe('every surface reports one volume', () => {
  function session(bodyweight: number | null) {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'a', sessionId: 's1', exerciseId: 'pullup', weight: 0, reps: 8, at: T });
    repo.logSet({ id: 'b', sessionId: 's1', exerciseId: 'pullup', weight: 25, reps: 5, at: T + MIN });
    repo.endSession('s1', T + 20 * MIN);
    if (bodyweight !== null) {
      repo.saveMeasurement({
        id: 'w', kind: 'bodyweight', value: bodyweight, unit: 'lb', at: T - DAY });
    }
    return repo;
  }

  test('the history and the recap agree, to the pound', () => {
    const repo = session(185);
    const recap = latestRecap(repo, T + 60 * MIN)!;
    const history = recentSessions(repo).find(s => s.id === 's1')!;
    assert.equal(history.volume, recap.payload.volume);
    assert.equal(history.volume, 185 * 8 + 210 * 5, 'and both are right');
  });

  test('and still agree when there is nothing to weigh with', () => {
    const repo = session(null);
    const recap = latestRecap(repo, T + 60 * MIN)!;
    const history = recentSessions(repo).find(s => s.id === 's1')!;
    assert.equal(history.volume, recap.payload.volume);
    assert.equal(history.volume, 125, 'the old answer, unchanged');
  });

  test('an ordinary session is untouched by any of it', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.startSession('s2', 'lb');
    repo.logSet({ id: 'x', sessionId: 's2', exerciseId: 'bench', weight: 185, reps: 5, at: T });
    repo.endSession('s2', T + 10 * MIN);
    repo.saveMeasurement({ id: 'w', kind: 'bodyweight', value: 185, unit: 'lb', at: T - DAY });
    assert.equal(recentSessions(repo).find(s => s.id === 's2')!.volume, 925);
  });

  /*
   * The session's headline lift is picked by e1RM, and `e1rm(0, reps)` is 0 —
   * so a session of pull-ups used to nominate whichever set happened to be
   * first, not the best one.
   */
  test('the lift a session is remembered by is its best set', () => {
    const repo = session(185);
    const history = recentSessions(repo).find(s => s.id === 's1')!;
    assert.equal(history.lifts[0].best, '25 × 5',
      '210 x 5 beats 185 x 8 on Epley; without a bodyweight neither could be ranked');
  });
});

/*
 * And the third surface, which is the one being watched WHILE the sets happen:
 * the running total under the logged sets on the Now screen. It had its own
 * copy of the sum too, so a live pull-up session counted up from 0 and stayed
 * there until the recap suddenly produced a number.
 */
describe('the running total counts the same workout the same way', () => {
  test('a live pull-up session is not counting nothing', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.saveMeasurement({
      id: 'w', kind: 'bodyweight', value: 185, unit: 'lb', at: T - DAY });
    const m = new NowModel(repo, () => T, 'en-US');
    m.selectExercise('pullup');
    m.setReps(8);
    m.log();
    assert.equal(m.state().totalVolume, 1480, 'one set of eight at 185');
  });

  test('and an ordinary lift still counts exactly what it always did', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.saveMeasurement({
      id: 'w', kind: 'bodyweight', value: 185, unit: 'lb', at: T - DAY });
    const m = new NowModel(repo, () => T, 'en-US');
    m.selectExercise('bench');
    m.setWeight(185);
    m.setReps(5);
    m.log();
    assert.equal(m.state().totalVolume, 925);
  });
});

/*
 * Measured at 14,000 sets across 700 sessions: `recentSessions` summarised
 * EVERY session — grouping its sets by lift, ranking them, naming the day,
 * totalling the volume — and then sliced the top eight, throwing 692 away.
 * 9.7ms per call, on a function the Progress screen calls on every render.
 *
 * The order depends only on `lastAt`, which is one pass. These pin the
 * behaviour that made deciding-before-building safe.
 */
describe('the history builds only the workouts it shows', () => {
  function many(count: number) {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    for (let i = count; i >= 1; i--) {
      const at = T - i * DAY;
      repo.startSession(`s${i}`, 'lb', undefined, at);
      repo.logSet({ id: `x${i}`, sessionId: `s${i}`, exerciseId: 'bench',
        weight: 100 + i, reps: 5, at });
      repo.endSession(`s${i}`, at + 10 * MIN);
    }
    return repo;
  }

  test('the newest eight, newest first', () => {
    const rows = recentSessions(many(40));
    assert.equal(rows.length, 8);
    assert.deepEqual(rows.map(r => r.id), ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']);
  });

  test('a smaller limit is honoured', () => {
    assert.equal(recentSessions(many(40), 3).length, 3);
  });

  test('fewer sessions than the limit is not an error', () => {
    assert.equal(recentSessions(many(2)).length, 2);
  });

  test('and none at all is an empty list, not a crash', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    assert.deepEqual(recentSessions(repo), []);
  });

  /*
   * The reason `lastAt` decides the order rather than `startedAt`: a restored
   * backup can give several sessions the same start, and then the order falls
   * back to whatever the map happened to iterate.
   */
  test('order comes from the last set, not the session clock', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    for (const [id, at] of [['a', T - 5 * MIN], ['b', T - 60 * MIN], ['c', T - 30 * MIN]] as const) {
      repo.startSession(id, 'lb', undefined, T);   // identical start for all three
      repo.logSet({ id: `set_${id}`, sessionId: id, exerciseId: 'bench', weight: 100, reps: 5, at });
      repo.endSession(id, at + MIN);
    }
    assert.deepEqual(recentSessions(repo).map(r => r.id), ['a', 'c', 'b']);
  });
});

/*
 * The other thing two surfaces can disagree about, and did: which set a lift is
 * remembered by.
 *
 * `buildRecap` ranked by raw weight then reps; `recentSessions` ranked by e1RM
 * of real load. One workout — bench 200 x 5 then 185 x 10 — read "200 x 5" on
 * the recap card and "185 x 10" in RECENT WORKOUTS, because e1rm(200,5) is
 * 233.3 and e1rm(185,10) is 246.7. Both were defensible; having both was not.
 */
describe('one workout, one best set', () => {
  function benched() {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'a', sessionId: 's1', exerciseId: 'bench', weight: 200, reps: 5, at: T });
    repo.logSet({ id: 'b', sessionId: 's1', exerciseId: 'bench', weight: 185, reps: 10, at: T + MIN });
    repo.endSession('s1', T + 20 * MIN);
    return repo;
  }

  test('the recap and the history name the same set', () => {
    const repo = benched();
    const recap = latestRecap(repo, T + 60 * MIN)!;
    const history = recentSessions(repo).find(s => s.id === 's1')!;
    const onCard = recap.payload.lifts.find(l => l[0] === 'Bench Press')![1];
    assert.equal(history.lifts[0].best.replace(/\s/g, ''), onCard.replace(/\s/g, ''));
  });

  test('and it is the one with the higher estimated max', () => {
    const history = recentSessions(benched()).find(s => s.id === 's1')!;
    assert.equal(history.lifts[0].best, '185 × 10',
      'e1rm(185,10) is 246.7 against e1rm(200,5) at 233.3');
  });

  /*
   * The case raw weight could not rank at all: every strict pull-up in a
   * session is logged at 0, so "heaviest" was whichever happened to be first.
   */
  test('a bodyweight lift is ranked by what it moved', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.saveMeasurement({ id: 'w', kind: 'bodyweight', value: 200, unit: 'lb', at: T - DAY });
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'a', sessionId: 's1', exerciseId: 'pullup', weight: 25, reps: 5, at: T });
    repo.logSet({ id: 'b', sessionId: 's1', exerciseId: 'pullup', weight: 0, reps: 12, at: T + MIN });
    repo.endSession('s1', T + 20 * MIN);
    const history = recentSessions(repo).find(s => s.id === 's1')!;
    // e1rm(225,5) = 262.5 against e1rm(200,12) = 280.
    assert.equal(history.lifts[0].best, 'BW × 12');
  });

  test('the lifts stay in the order they were trained, not ranked', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'a', sessionId: 's1', exerciseId: 'bench', weight: 100, reps: 5, at: T });
    repo.logSet({ id: 'b', sessionId: 's1', exerciseId: 'squat', weight: 300, reps: 5, at: T + MIN });
    repo.endSession('s1', T + 20 * MIN);
    const history = recentSessions(repo).find(s => s.id === 's1')!;
    assert.deepEqual(history.lifts.map(l => l.name), ['Bench Press', 'Squat'],
      'a session has an order, and sorting by load would turn it into a leaderboard');
  });
});

/*
 * NOT a bug, and worth pinning as one: the audit flagged `bestSetAtReps`
 * (the row's headline) and the sparkline as "disagreeing about which set
 * leads a session". Traced with the real code path and they do diverge — but
 * on purpose. `best` is scoped to 5+ reps because that is the range goals are
 * compared in; `spark` is an e1RM trend across every productive rep range,
 * because a heavy single is real information about a lift's trajectory.
 * A session's heaviest single can legitimately be the sparkline's tallest
 * point while sitting nowhere near the headline "best". See the doc comment
 * on `ProgressRow.best` for the full reasoning.
 */
describe('best and spark answer different questions on purpose', () => {
  test('a heavy single can lead the sparkline without being "best"', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'a', sessionId: 's1', exerciseId: 'bench', weight: 275, reps: 3, at: T - 40 * DAY });
    repo.endSession('s1', T - 40 * DAY + MIN);
    repo.startSession('s2', 'lb');
    repo.logSet({ id: 'b', sessionId: 's2', exerciseId: 'bench', weight: 225, reps: 5, at: T - 20 * DAY });
    repo.endSession('s2', T - 20 * DAY + MIN);
    repo.startSession('s3', 'lb');
    repo.logSet({ id: 'c', sessionId: 's3', exerciseId: 'bench', weight: 215, reps: 8, at: T - 5 * DAY });
    repo.endSession('s3', T - 5 * DAY + MIN);

    const row = progressRows(repo, T).find(r => r.exerciseId === 'bench')!;
    assert.equal(row.best, 225, 'the best set at 5+ reps, not the heaviest single ever');
    assert.equal(row.bestReps, 5);
    assert.equal(row.spark[0], 1, 'the 275x3 single is still the sparkline peak');
    assert.ok(row.spark[1] < row.spark[0],
      'the session that IS "best" is not the sparkline peak, and that is correct');
  });
});

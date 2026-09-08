import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { recentSessions, goalTag } from '../src/ui/progress-model.ts';
import { sessionDay } from '../src/domain/split.ts';

const MIN = 60_000, DAY = 86_400_000;
const T0 = Date.UTC(2026, 7, 21, 18);

/*
 * Progress answered "how is this lift going". It could not answer "what did I
 * do on Tuesday" — the question you ask standing in the gym trying to remember
 * whether you have already pressed this week — and the only place that answer
 * existed was inside one recap you could no longer reach.
 */
describe('the last few workouts, day by day', () => {
  function trained() {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    let n = 0;
    const day = (id: string, at: number, rows: Array<[string, number, number]>) => {
      repo.startSession(id, 'lb');
      rows.forEach(([ex, w, r], i) => repo.logSet({
        id: `x${n++}`, sessionId: id, exerciseId: ex, weight: w, reps: r, at: at + i * 4 * MIN
      }));
      repo.endSession(id, at + 50 * MIN);
    };
    day('mon', T0 - 4 * DAY, [['bench', 145, 8], ['bench', 155, 5], ['triext', 40, 12]]);
    day('wed', T0 - 2 * DAY, [['squat', 225, 5], ['legpress', 320, 10]]);
    day('fri', T0, [['row', 135, 8], ['curl', 30, 12]]);
    return repo;
  }

  test('newest first, because that is what you are trying to remember', () => {
    const out = recentSessions(trained());
    assert.deepEqual(out.map(s => s.id), ['fri', 'wed', 'mon']);
  });

  /*
   * This list printed "1 set · 0 lb" directly under a row reading "BW × 12" —
   * contradicting itself in the space of one line. Same false zero R188 took
   * off the recap card, on a surface that round did not reach: `sessionStats`
   * is shared, but only its `volume` was being read and not `volumeKnown`.
   */
  test('a session it cannot total says so, rather than saying zero', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    repo.startSession('bw', 'lb');
    repo.logSet({ id: 'p1', sessionId: 'bw', exerciseId: 'pushup', weight: 0, reps: 12, at: T0 });
    repo.endSession('bw', T0 + 20 * MIN);
    const [only] = recentSessions(repo);
    assert.equal(only.volume, 0, 'the floor is still 0 — nothing was added to the lifter');
    assert.equal(only.volumeKnown, false, 'but the screen must not print it as a total');
  });

  test('an ordinary session is still totalled', () => {
    const fri = recentSessions(trained()).find(s => s.id === 'fri')!;
    assert.equal(fri.volumeKnown, true);
    assert.ok(fri.volume > 0);
  });

  test('each one says what was actually done', () => {
    const mon = recentSessions(trained()).find(s => s.id === 'mon')!;
    assert.equal(mon.setCount, 3);
    assert.deepEqual(mon.lifts.map(l => l.name), ['Bench Press', 'Tricep Extension']);
    /*
     * 145 x 8, not 155 x 5 — and I had this backwards writing the test.
     * "Top set" is by estimated 1RM, the same rule the recap uses, and Epley
     * puts 145 for eight (183.7) above 155 for five (180.8). Picking the
     * heaviest bar instead would make this screen and the recap disagree about
     * what the best set of the same session was.
     */
    assert.equal(mon.lifts[0].best, '145 × 8', 'the top set by e1RM, not the heaviest bar');
  });

  /*
   * Ordered by when the lift STARTED, not by load. The list is a record of a
   * session, and a session has an order; sorting by weight turns "squat, then
   * leg press" into a leaderboard.
   */
  test('lifts stay in the order they were trained', () => {
    const wed = recentSessions(trained()).find(s => s.id === 'wed')!;
    assert.deepEqual(wed.lifts.map(l => l.name), ['Squat', 'Leg Press'],
      'the leg press is heavier and it still comes second');
  });

  test('the day is named when the lifts agree on one', () => {
    const out = recentSessions(trained());
    assert.equal(out.find(s => s.id === 'mon')!.title, 'PUSH DAY');
    assert.equal(out.find(s => s.id === 'wed')!.title, 'LEGS DAY');
  });

  test('the title agrees with the rest of the app about which day it was', () => {
    // Deliberately checked against `sessionDay` rather than against a literal:
    // the recap names the day with the same function, and a history list that
    // called Tuesday something else would be two answers to one question.
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    repo.startSession('mix', 'lb');
    repo.logSet({ id: 'a', sessionId: 'mix', exerciseId: 'bench', weight: 145, reps: 8, at: T0 });
    repo.logSet({ id: 'b', sessionId: 'mix', exerciseId: 'squat', weight: 225, reps: 5, at: T0 + MIN });
    const day = sessionDay(['bench', 'squat']);
    assert.equal(recentSessions(repo)[0].title, day ? `${day.toUpperCase()} DAY` : 'WORKOUT');
  });

  test('volume is the work, not a guess', () => {
    const mon = recentSessions(trained()).find(s => s.id === 'mon')!;
    assert.equal(mon.volume, 145 * 8 + 155 * 5 + 40 * 12);
  });

  test('the list is capped, so a year of training does not print itself', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    for (let i = 0; i < 30; i++) {
      repo.startSession(`s${i}`, 'lb');
      repo.logSet({ id: `x${i}`, sessionId: `s${i}`, exerciseId: 'bench', weight: 100 + i, reps: 5, at: T0 - i * DAY });
      repo.endSession(`s${i}`, T0 - i * DAY + MIN);
    }
    assert.equal(recentSessions(repo).length, 8);
    assert.equal(recentSessions(repo, 3).length, 3);
    assert.equal(recentSessions(repo)[0].id, 's0', 'and the cap keeps the NEWEST');
  });

  test('a fresh install has no history and does not pretend otherwise', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    assert.deepEqual(recentSessions(repo), []);
  });

  test('a live session appears too — today counts before it is finished', () => {
    const repo = trained();
    repo.startSession('now', 'lb');
    repo.logSet({ id: 'z', sessionId: 'now', exerciseId: 'ohp', weight: 95, reps: 5, at: T0 + DAY });
    assert.equal(recentSessions(repo)[0].id, 'now');
  });
});

/*
 * The goal tag on a Progress row. All three states were on screen at once in
 * the seeded app and only one of them read as English.
 */
describe('what the goal tag says', () => {
  test('a gap and its destination, once there is a gap', () => {
    assert.equal(goalTag({ targetWeight: 185, remaining: 40, achieved: false }), '40 TO 185');
  });

  /*
   * Measured on the running app: "108 TO 108", on a lift trained only below its
   * goal's rep count so nothing qualifies and `remaining` IS the target. A gap
   * is a distance from somewhere and there is no somewhere yet.
   */
  test('the target alone, when nothing is on the board yet', () => {
    assert.equal(goalTag({ targetWeight: 108, remaining: 108, achieved: false }), 'GOAL 108');
    assert.doesNotMatch(goalTag({ targetWeight: 108, remaining: 108, achieved: false }), /108 TO 108/);
  });

  test('and a tick with the number once it is hit', () => {
    // It said "GOAL" — a label, next to rows saying "97 TO 222". The tick says
    // what happened and the number says which target it was.
    assert.equal(goalTag({ targetWeight: 185, remaining: 0, achieved: true }), '✓ 185');
  });

  test('a fractional gap is not printed to four decimal places', () => {
    assert.equal(goalTag({ targetWeight: 185, remaining: 12.4999, achieved: false }), '12 TO 185');
  });

  test('it agrees with the Now screen about which state a goal is in', () => {
    // Both screens must call "nothing on the board" the same thing, or the app
    // contradicts itself about the same goal on two screens.
    const untrained = goalTag({ targetWeight: 222, remaining: 222, achieved: false });
    assert.match(untrained, /^GOAL /, 'Now says "goal 222 x 3" for exactly this case');
  });
});

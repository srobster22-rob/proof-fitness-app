import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 23, 18);

/*
 * R692, THE CALL SHEET, slice 2. The line said "try 200" while the dial said
 * 195, the last set logged, which was often a back-off: PT2 had 160×8 under
 * "try 190", and the veteran "had to tap + myself". The dial now opens on the
 * call, weight and reps, so taking it is one tap on LOG SET.
 */

/** Squat sessions 3 days apart, oldest first; each entry is one session's sets as [weight, reps]. */
function lifter(sessions: Array<Array<[number, number]>>) {
  const clock = { now: T0 };
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => clock.now);
  sessions.forEach((sets, i) => {
    const id = `p${i}`, at = T0 - (sessions.length - i) * 3 * DAY;
    repo.startSession(id, 'lb', undefined, at);
    sets.forEach(([weight, reps], k) =>
      repo.logSet({ id: `${id}s${k}`, sessionId: id, exerciseId: 'squat', weight, reps, at: at + k * 120_000 }));
    repo.endSession(id, at + 3_600_000);
  });
  const m = new NowModel(repo, () => clock.now, 'en-US');
  m.selectExercise('squat');
  return { m, clock };
}
const dial = (m: NowModel) => [m.state().weight, m.state().reps];

describe('the call is on the dial (R692)', () => {
  test('a climbing call: the dial opens on its weight and reps, not the last back-off', () => {
    // 195 then 200 for 5, each ending on a 160×8 back-off.
    const { m } = lifter([[[195, 5], [160, 8]], [[200, 5], [160, 8]]]);
    assert.match(m.state().lastTime.head, /try 205/);
    assert.deepEqual(dial(m), [205, 5], 'the dial opened on the back-off set');
  });

  test('a missed climb: the dial opens on the same weight, for the reps asked', () => {
    const { m } = lifter([[[195, 5]], [[200, 5]], [[205, 3]]]);
    assert.equal(m.state().lastTime.head, '205 again — make 5');
    assert.deepEqual(dial(m), [205, 5]);
  });

  test('a deload: the dial opens on the lighter weight and keeps last time\'s reps', () => {
    const { m } = lifter([[[205, 8]], [[205, 7]], [[205, 6]]]);
    assert.match(m.state().lastTime.head, /back off to (\d+)/);
    const back = Number(m.state().lastTime.head.match(/back off to (\d+)/)![1]);
    assert.deepEqual(dial(m), [back, 6]);
  });

  test('a deload after back-off sets takes the top set\'s reps, not the back-off\'s (R692 review)', () => {
    // 205×8, ×7, ×6 at the top, each followed by a light 160×12.
    const { m } = lifter([[[205, 8], [160, 12]], [[205, 7], [160, 12]], [[205, 6], [160, 12]]]);
    const back = Number(m.state().lastTime.head.match(/back off to (\d+)/)?.[1]);
    assert.ok(back > 0, `the fixture no longer deloads: "${m.state().lastTime.head}"`);
    assert.deepEqual(dial(m), [back, 6], 'the dial took the back-off set\'s 12 reps at the deload weight');
  });

  test('with no call, the dial opens on last time, as before', () => {
    const { m } = lifter([[[185, 5]]]);
    assert.doesNotMatch(m.state().lastTime.head, /try|again|back off/);
    assert.deepEqual(dial(m), [185, 5]);
  });

  test('taking the call is one tap, and it says so', () => {
    const { m } = lifter([[[195, 5]], [[200, 5]]]);
    m.log();
    assert.equal(m.state().lastTime.made, true);
    assert.equal(m.state().lastTime.justMade, true);
    assert.equal(m.state().lastTime.head, '205×5 — made it');
  });

  test('once the lift has a set today, the dial is the lifter\'s: coming back to it does not reset it', () => {
    const { m } = lifter([[[195, 5]], [[200, 5]]]);
    m.setWeight(185);
    m.log();
    m.selectExercise('bench');
    m.selectExercise('squat');
    assert.equal(m.state().weight, 185, 'the call took the dial back after a set was logged');
  });

  test('the line and the dial read one call', () => {
    const HERE = path.dirname(fileURLToPath(import.meta.url));
    const model = readFileSync(path.join(HERE, '..', 'src', 'ui', 'now-model.ts'), 'utf8');
    assert.match(model, /coach: this\.coachCall\(\)/);
    // The line's call is the dial's: both go through `callFor` with the same
    // lift, equipment and last-time weight.
    assert.match(model, /return this\.callFor\(this\.exerciseId, this\.equipment, this\.startWeight, this\.startConverted\);/);
    assert.match(model, /const call = this\.callFor\(exerciseId, equipment, p\.weight, startConverted\);\s*if \(call && !this\.repo\.setsInSession\(this\.session\.id\)\.some\(s => s\.exerciseId === exerciseId\)\)/);
  });
});

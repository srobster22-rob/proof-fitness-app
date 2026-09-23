import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Repo } from '../src/data/repo.ts';
import { exportAll, restore } from '../src/data/portable.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { goalLifts } from '../src/ui/goals-model.ts';
import { railPool, railOrder } from '../src/ui/rail-order.ts';
import { BUILTIN, WIDER_LIBRARY, startingWeight } from '../src/domain/coldstart.ts';
import { dayOf } from '../src/domain/split.ts';
import { profileFor } from '../src/domain/muscles.ts';
import type { LoggedSet } from '../src/domain/types.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 22, 12);

/*
 * R678. The library was 32 movements against Strong's 200+ and Hevy's 400+
 * (MARKET.md, gap value 12, the largest). A lifter whose program called for a
 * front squat had to invent one: no starting weight, no day, no muscles for the
 * coach to reason with.
 *
 * Growing the list was the small part. It only reaches a lifter if several other
 * things hold, and each was broken or would have broken:
 *   - an existing database never received a new built-in, because the seed ran
 *     only on a schema upgrade;
 *   - a new lifter's rail was ALPHABETICAL after the suggestion. With no history
 *     every chip tied, so their NEXT after bench was Chest Fly because C comes
 *     early;
 *   - a lifter who had invented "Front Squat" would have seen two;
 *   - `strengthIndex` read every movement as a strength reading, so one set of an
 *     isolation lift from the new list could open a first squat at 290 lb.
 * The independent review of this round found the last three.
 */

const repoOn = (db: DatabaseSync) => new Repo(db as never, () => T0);
const lifter = () => new NowModel(repoOn(new DatabaseSync(':memory:')), () => T0, 'en-US');
const WIDER = new Set(WIDER_LIBRARY.map(e => e.id));
const named = (repo: Repo, name: string) =>
  [...repo.exercises().values()].filter(e => e.name.toLowerCase() === name.toLowerCase()).map(e => e.id);

/** A custom "Front Squat" of the lifter's own, with one set on it. */
function ownFrontSquat(repo: Repo, name = 'Front Squat'): void {
  repo.addExercise('front_squat', name);
  repo.startSession('mine', 'lb', undefined, T0 - DAY);
  repo.logSet({ id: 'mine1', sessionId: 'mine', exerciseId: 'front_squat', weight: 135, reps: 5, at: T0 - DAY });
  repo.endSession('mine', T0 - DAY + 3_600_000);
}

describe('the wider library is in the app, filed and mapped (R678)', () => {
  test('every deadlift pulled from the floor is on pull day (D4)', () => {
    for (const id of ['deadlift', 'sumo-deadlift', 'trap-bar-deadlift']) {
      assert.equal(dayOf(id), 'pull', `${id} left pull day, beside the squats split.ts keeps it away from`);
    }
  });

  test('the movements an ordinary commercial gym has are in it', () => {
    for (const name of ['Front Squat', 'Goblet Squat', 'Bulgarian Split Squat', 'Hack Squat', 'Trap Bar Deadlift',
      'Close-Grip Bench Press', 'Skull Crusher', 'Cable Fly', 'T-Bar Row', 'Barbell Curl', 'Preacher Curl',
      'Seated Calf Raise']) {
      const e = BUILTIN.find(x => x.name === name);
      assert.ok(e, `${name} is not in the library`);
      assert.ok(dayOf(e!.id), `${name} has no split day, so it would fall into YOURS`);
      assert.ok(profileFor(e!.id), `${name} has no muscle profile, so the coach cannot reason about it`);
    }
  });

  test('no new id is one a custom exercise could already hold', () => {
    // A custom id is a slug of [a-z0-9_]. A lifter's old custom "Sumo" is `sumo`,
    // and a built-in with that id would have been silently absorbed into it.
    for (const e of WIDER_LIBRARY) {
      assert.match(e.id, /-/, `${e.id} could collide with a custom exercise's slug`);
    }
  });
});

describe('the wider library reaches every lifter (R678)', () => {
  test('a database opened before the library grew learns the new movements on its next open', () => {
    const db = new DatabaseSync(':memory:');
    repoOn(db);
    // What a phone that installed before R678 looks like: the schema is current
    // and the newer movements were never written.
    db.exec(`DELETE FROM exercises WHERE id IN (${WIDER_LIBRARY.map(e => `'${e.id}'`).join(',')})`);
    const reopened = repoOn(db).exercises();
    assert.ok(reopened.has('front-squat'),
      'reopening a database at the current schema did not add Front Squat: an updated app hides its own library');
    assert.equal(WIDER_LIBRARY.filter(e => reopened.has(e.id)).length, WIDER_LIBRARY.length);
  });

  test('a lifter who invented a movement the library later adds keeps one entry: their own', () => {
    const db = new DatabaseSync(':memory:');
    ownFrontSquat(repoOn(db));
    assert.deepEqual(named(repoOn(db), 'Front Squat'), ['front_squat'],
      'a lifter with their own "Front Squat" sees the built-in beside it');
  });

  test('whatever the case of their name for it', () => {
    const repo = repoOn(new DatabaseSync(':memory:'));
    ownFrontSquat(repo, 'front SQUAT');
    assert.deepEqual(named(repo, 'front squat'), ['front_squat']);
  });

  test('and it survives a restore onto a new phone', () => {
    const phoneA = repoOn(new DatabaseSync(':memory:'));
    ownFrontSquat(phoneA);
    const phoneB = repoOn(new DatabaseSync(':memory:'));
    restore(phoneB, exportAll(phoneA, T0));
    assert.deepEqual(named(phoneB, 'Front Squat'), ['front_squat'],
      'restoring their backup on a new phone put the built-in back beside their own');
  });

  test('an entry they deleted does not hold the name, so the built-in comes back', () => {
    const repo = repoOn(new DatabaseSync(':memory:'));
    repo.addExercise('front_squat', 'Front Squat');
    assert.deepEqual(named(repo, 'Front Squat'), ['front_squat']);
    assert.equal(repo.removeExercise('front_squat'), true);
    assert.deepEqual(named(repo, 'Front Squat'), ['front-squat'],
      'removing their own Front Squat left them with none');
  });

  test('a set logged on the built-in and undone does not bring it back', () => {
    const repo = repoOn(new DatabaseSync(':memory:'));
    ownFrontSquat(repo);
    repo.startSession('oops', 'lb', undefined, T0 - DAY / 2);
    repo.logSet({ id: 'oops1', sessionId: 'oops', exerciseId: 'front-squat', weight: 95, reps: 5, at: T0 - DAY / 2 });
    repo.deleteSet('oops1');   // what UNDO does
    assert.deepEqual(named(repo, 'Front Squat'), ['front_squat'],
      'an undone set on the built-in put a second Front Squat beside their own');
  });

  test('a built-in with sets of its own is never hidden', () => {
    const repo = repoOn(new DatabaseSync(':memory:'));
    ownFrontSquat(repo);
    repo.startSession('lib', 'lb', undefined, T0 - 2 * DAY);
    repo.logSet({ id: 'lib1', sessionId: 'lib', exerciseId: 'front-squat', weight: 95, reps: 5, at: T0 - 2 * DAY });
    assert.deepEqual(named(repo, 'Front Squat').sort(), ['front-squat', 'front_squat'],
      'hiding a built-in with history would orphan the sets logged on it');
  });
});

/** Fills every free byte the database may use, the way a phone with no storage left does. */
function fillTheDisk(db: DatabaseSync) {
  const { page_count } = db.prepare('PRAGMA page_count').get() as { page_count: number };
  db.exec(`PRAGMA max_page_count = ${page_count}`);
  // Deleted custom movements: they take room and appear nowhere.
  const filler = db.prepare('INSERT INTO exercises (id, name, builtin, updated_at, deleted) VALUES (?, ?, 0, 0, 1)');
  try {
    for (let i = 0; ; i++) filler.run(`zz_filler_${i}`, 'filler');
  } catch (e) {
    assert.match((e as Error).message, /full/);
  }
}

/** Runs `open` with `console.warn` captured: what it returns, and what it warned. */
function quietly<T>(open: () => T): { value: T; warned: string } {
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (m: string) => { warned.push(m); };
  try {
    return { value: open(), warned: warned.join('\n') };
  } finally {
    console.warn = warn;
  }
}

describe('a hidden built-in stays hidden everywhere a lifter picks a lift (R678 review)', () => {
  /** Three sessions of their own Front Squat: enough for the pickers to rank history. */
  function veteran(repo: Repo) {
    ownFrontSquat(repo);
    for (const i of [2, 3]) {
      const id = `v${i}`;
      repo.startSession(id, 'lb', undefined, T0 - i * DAY);
      repo.logSet({ id: `${id}s`, sessionId: id, exerciseId: 'front_squat', weight: 135, reps: 5, at: T0 - i * DAY });
      repo.endSession(id, T0 - i * DAY + 3_600_000);
    }
  }
  function offeredBy(repo: Repo) {
    const st = new NowModel(repo, () => T0, 'en-US').state();
    const lifts = goalLifts(repo, T0);
    return {
      'lift picker': st.picker.map(e => e.id),
      'picker groups': st.pickerGroups.flatMap(g => g.exercises.map(e => e.id)),
      'goal sheet': [...lifts.trained, ...lifts.rest].map(e => e.id)
    };
  }
  function assertOne(repo: Repo) {
    for (const [where, ids] of Object.entries(offeredBy(repo))) {
      assert.ok(!ids.includes('front-squat'), `the ${where} offers the built-in Front Squat beside their own`);
      assert.ok(ids.includes('front_squat'), `the ${where} lost their own Front Squat`);
    }
  }

  test('after the update that added the library', () => {
    const db = new DatabaseSync(':memory:');
    veteran(repoOn(db));
    db.exec(`DELETE FROM exercises WHERE id IN (${WIDER_LIBRARY.map(e => `'${e.id}'`).join(',')})`);
    assertOne(repoOn(db));
  });

  test('and after a restore onto a new phone', () => {
    const phoneA = repoOn(new DatabaseSync(':memory:'));
    veteran(phoneA);
    const phoneB = repoOn(new DatabaseSync(':memory:'));
    restore(phoneB, exportAll(phoneA, T0));
    assertOne(phoneB);
  });

  test('and on a first launch, where the Now screen opens on the picker\'s first lift', () => {
    // However it got there (a hand-edited backup, say), their own "Bench Press"
    // stands in for the built-in one, which has no sets.
    const repo = repoOn(new DatabaseSync(':memory:'));
    repo.addExercise('my_bench', 'Bench Press');
    const st = new NowModel(repo, () => T0, 'en-US').state();
    assert.ok(!st.picker.some(e => e.id === 'bench'), 'the first-launch picker offers the hidden built-in');
    assert.equal(st.exercise.id, 'my_bench', 'the Now screen opened on the hidden built-in');
  });
});

describe('a full or locked disk never costs a lifter the app (R678 review)', () => {
  test('a lifter from before R678 whose disk is full still opens the app, and gets the movements once there is room', () => {
    const db = new DatabaseSync(':memory:');
    repoOn(db);
    db.exec(`DELETE FROM exercises WHERE id IN (${WIDER_LIBRARY.map(e => `'${e.id}'`).join(',')})`);
    fillTheDisk(db);
    const { value: full, warned } = quietly(() => repoOn(db));
    assert.equal(full.exercises().size, BUILTIN.length - WIDER_LIBRARY.length,
      'an update that could not write its new movements should open with the library the lifter had');
    assert.match(warned, /full/, 'the failure should still be reported, with what went wrong');
    db.exec('PRAGMA max_page_count = 1000000');
    assert.ok(repoOn(db).exercises().has('front-squat'), 'the movements never arrived once there was room');
  });

  test('a failed seed that leaves its transaction open does not swallow the next workout', () => {
    // SQLite may or may not roll back by itself when a write fails. A trigger that
    // refuses one insert leaves the transaction open, and only the ROLLBACK closes it.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-library-'));
    const file = path.join(dir, 'proof.db');
    try {
      const db = new DatabaseSync(file);
      repoOn(db);
      db.exec(`DELETE FROM exercises WHERE id IN (${WIDER_LIBRARY.map(e => `'${e.id}'`).join(',')})`);
      db.exec(`CREATE TRIGGER refuse_front_squat BEFORE INSERT ON exercises WHEN NEW.id = 'front-squat'
        BEGIN SELECT RAISE(ABORT, 'refused'); END`);
      const { value: repo, warned } = quietly(() => repoOn(db));
      assert.match(warned, /refused/);
      assert.equal(db.isTransaction, false, 'the failed seed left its transaction open');
      assert.equal(repo.exercises().size, BUILTIN.length - WIDER_LIBRARY.length,
        'the failed seed half-wrote the library');
      repo.startSession('after', 'lb', undefined, T0);
      repo.logSet({ id: 'after1', sessionId: 'after', exerciseId: 'bench', weight: 135, reps: 5, at: T0 });
      const other = new DatabaseSync(file, { readOnly: true });
      try {
        assert.ok(other.prepare('SELECT 1 FROM sets WHERE id = ?').get('after1'),
          'the next set was written into a transaction nobody commits');
      } finally {
        other.close();
      }
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an ordinary launch writes nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-library-'));
    const file = path.join(dir, 'proof.db');
    try {
      const rw = new DatabaseSync(file);
      repoOn(rw);
      rw.close();
      // A connection that cannot write stands in for everything that stops a
      // write: a full disk, or another process holding the lock.
      const ro = new DatabaseSync(file, { readOnly: true });
      try {
        const { value: repo, warned } = quietly(() => repoOn(ro));
        assert.equal(warned, '', 'opening an up-to-date database tried to write to it');
        assert.equal(repo.exercises().size, BUILTIN.length);
      } finally {
        ro.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a first launch with no room fails with the error that says so', () => {
    const db = new DatabaseSync(':memory:');
    repoOn(db);
    db.exec('DELETE FROM exercises');   // the library was never written
    fillTheDisk(db);
    assert.throws(() => repoOn(db), (e: Error) => {
      assert.match(e.message, /full/, `the lifter was shown "${e.message}" instead of what went wrong`);
      return true;
    });
  });
});

describe('the rail meets a new lifter in the library\'s order (R678)', () => {
  test('the core of each day comes in the curated order, moved only by the advice', () => {
    /*
     * The exact rails a brand-new lifter meets after the day's first set. They are
     * pinned in full because "not alphabetical" also passes for a shuffle
     * (COACH.md, review 1). The muscle advice moves the first chips (after bench,
     * Tricep Extension "finishes what your compound started"); the rest is the
     * library's own order. A change to either on purpose updates these lists and
     * says why in the log.
     */
    const expected = {
      push: ['Tricep Extension', 'Chest Fly', 'Overhead Press', 'Tricep Pushdown', 'Lateral Raise',
        'DB Bench Press', 'DB Shoulder Press', 'Incline Bench Press', 'Machine Chest Press', 'Push-up', 'Dip'],
      pull: ['Barbell Row', 'DB Row', 'Lat Pulldown', 'Seated Cable Row', 'Bicep Curl', 'Pull-up',
        'Chin-up', 'Hammer Curl', 'Face Pull', 'Reverse Fly', 'Shrug'],
      legs: ['Leg Extension', 'Romanian Deadlift', 'Leg Curl', 'Hip Thrust', 'Calf Raise', 'Leg Press', 'Lunge']
    };
    // Then the wider library, in the room the cap leaves.
    const wider = {
      push: ['Skull Crusher'],
      pull: ['Machine Row'],
      legs: ['Good Morning', 'Hip Abduction', 'Front Squat', 'Seated Calf Raise', 'Kettlebell Swing']
    };
    for (const day of ['push', 'pull', 'legs'] as const) {
      const m = lifter();
      m.setPlan('ppl');
      m.setDay(day);
      m.log();
      const rail = m.state().dayRail.filter(l => !l.done);
      assert.deepEqual(rail.filter(l => !WIDER.has(l.id)).map(l => l.name), expected[day],
        `the ${day} rail is not in the curated order`);
      assert.deepEqual(rail.filter(l => WIDER.has(l.id)).map(l => l.name), wider[day],
        `the ${day} rail's wider library is not in its order`);
    }
  });

  test("the suggestion is the coach's, with its reason", () => {
    const m = lifter();
    m.setPlan('ppl');
    m.setDay('push');
    m.log();
    const next = m.state().dayRail.find(l => l.suggested);
    assert.ok(next, 'no suggestion after the first set of a push day');
    assert.notEqual(next!.reason, '', `NEXT is ${next!.name} with no reason: the advice never saw the untrained lifts`);
  });

  test('a full-body day moves from bench to the legs', () => {
    // Where the library's order shows most. When the advice rates two lifts the
    // same, the library's place decides, and the squat is its second movement.
    // By name, the day went from bench to Barbell Row.
    const m = lifter();
    m.setPlan('full');
    m.setDay('full');
    m.log();
    assert.equal(m.state().dayRail.find(l => l.suggested)?.name, 'Squat');
  });

  test('the wider library never pushes a core lift off, and fills the room there is', () => {
    for (const day of ['push', 'pull', 'legs'] as const) {
      const m = lifter();
      m.setPlan('ppl');
      m.setDay(day);
      m.log();
      const rail = m.state().dayRail.filter(l => !l.done);
      const firstWider = rail.findIndex(l => WIDER.has(l.id));
      const lastCore = rail.map(l => WIDER.has(l.id)).lastIndexOf(false);
      assert.ok(firstWider < 0 || firstWider > lastCore,
        `on ${day} day a wider-library lift sits ahead of a core one: ${rail.map(l => l.name).join(', ')}`);
      if (day === 'legs') assert.ok(firstWider >= 0, 'leg day has room for the wider library and offers none of it');
    }
  });
});

describe('the rail keeps what a lifter actually does (R678)', () => {
  /** Three weeks of push days: bench, then the lift under test. */
  function pushHistory(second: string, weight: number): Repo {
    const repo = repoOn(new DatabaseSync(':memory:'));
    [21, 14, 7].forEach((d, i) => {
      const id = `push${i}`, at = T0 - d * DAY;
      repo.startSession(id, 'lb', undefined, at);
      repo.logSet({ id: `${id}a`, sessionId: id, exerciseId: 'bench', weight: 135, reps: 5, at });
      repo.logSet({ id: `${id}b`, sessionId: id, exerciseId: second, weight, reps: 10, at: at + 600_000 });
      repo.endSession(id, at + 3_600_000);
    });
    return repo;
  }

  test('once trained, a wider-library movement is the suggestion when it is what comes next', () => {
    const m = new NowModel(pushHistory('skull-crusher', 30), () => T0, 'en-US');
    m.setPlan('ppl');
    m.setDay('push');
    m.selectExercise('bench');
    m.log();
    assert.equal(m.state().dayRail.find(l => l.suggested)?.name, 'Skull Crusher');
  });

  test('a lift they do stays ahead of every lift they have never done, even after they tap past it', () => {
    const m = new NowModel(pushHistory('skull-crusher', 30), () => T0, 'en-US');
    m.setPlan('ppl');
    m.setDay('push');
    m.selectExercise('bench');
    m.log();
    m.selectExercise('skull-crusher');   // looked at it...
    m.selectExercise('fly');             // ...and moved on without logging
    const rail = m.state().dayRail.map(l => l.id);
    assert.ok(rail.includes('skull-crusher'), `a lift they do every push day fell off the rail: ${rail.join(', ')}`);
    const untrainedFirst = rail.findIndex(id => id !== 'bench' && id !== 'skull-crusher' && id !== 'fly');
    assert.ok(rail.indexOf('skull-crusher') < untrainedFirst,
      `their Skull Crusher sits behind lifts they have never done: ${rail.join(', ')}`);
  });

  test('movements they invented are never cut from a full push day', () => {
    // A push day now holds more lifts than the rail, so something is cut, and it
    // must not be the ones the lifter made themselves. They rank ahead of the
    // library's untrained lifts, the picker's rule too.
    const repo = repoOn(new DatabaseSync(':memory:'));
    repo.addExercise('sissy_squat', 'Sissy Squat');
    repo.addExercise('jm_press', 'JM Press');
    const m = new NowModel(repo, () => T0, 'en-US');
    m.setPlan('ppl');
    m.setDay('push');
    m.log();
    const rail = m.state().dayRail.map(l => l.id);
    for (const id of ['sissy_squat', 'jm_press']) {
      assert.ok(rail.includes(id), `${id} was cut from the rail: ${rail.join(', ')}`);
    }
  });
});

describe('the rail order itself, from any library order (R678)', () => {
  const lib = BUILTIN.filter(e => dayOf(e.id) === 'push').map(({ id, name }) => ({ id, name }));
  const mine = { id: 'my_press', name: 'My Press' };

  test('untrained lifts come in the library\'s order, whatever order they arrive in', () => {
    const reversed = [...lib].reverse();
    const pool = railPool([...reversed, mine], []);
    assert.equal(pool[0], 'my_press', 'their own movement does not lead the untrained lifts');
    assert.deepEqual(pool.slice(1), lib.map(e => e.id), 'the pool followed the order the rows arrived in');
  });

  test('the predictor\'s ranking leads the pool', () => {
    assert.deepEqual(railPool(lib, ['dip', 'fly']).slice(0, 2), ['dip', 'fly']);
  });

  test('a tie in rank falls to the name, whatever order the rows arrive in', () => {
    const pool = railPool(lib, []);
    // One point of advice moves place 7 to place 1, level with the lift already there.
    const advice = new Map([[pool[7], 1]]);
    const order = (rows: typeof lib) => railOrder(rows, pool, advice, () => false, new Set()).map(e => e.id);
    assert.deepEqual(order([...lib].reverse()), order(lib));
  });

  test('tiers are not crossed by advice, and done lifts go last', () => {
    const pool = railPool(lib, []);
    const advice = new Map([['cable-fly', 50]]);   // enormous advice for a wider lift
    const order = railOrder(lib, pool, advice, id => id === 'dip', new Set(['bench'])).map(e => e.id);
    assert.equal(order[0], 'dip', 'a lift with history does not lead');
    assert.ok(order.indexOf('cable-fly') > order.indexOf('pushdown'), 'advice lifted a wider lift over the core');
    assert.equal(order[order.length - 1], 'bench', 'a lift done today does not go last');
  });
});

describe('a first weight is not inflated by lifts that say nothing about strength (R678)', () => {
  const set = (exerciseId: string, weight: number, reps: number, i: number): LoggedSet =>
    ({ id: `c${i}`, sessionId: 's', exerciseId, weight, reps, at: T0 - i * 60_000 });

  test('one hip abduction set does not move a first squat', () => {
    const benchOnly = [set('bench', 135, 8, 1)];
    const withAbduction = [...benchOnly, set('hip-abduction', 120, 12, 2)];
    assert.equal(startingWeight('squat', withAbduction, 'lb'), startingWeight('squat', benchOnly, 'lb'),
      `a 120 lb hip abduction moved the first squat to ${startingWeight('squat', withAbduction, 'lb')}`);
  });

  test('only the barbell compounds D2 names calibrate a first weight', () => {
    // DECISIONS.md D2. A hip thrust or a DB row read as a strength test brings back
    // the overshoot it was written to stop.
    assert.deepEqual(BUILTIN.filter(e => e.calibrates).map(e => e.id).sort(), [
      'bench', 'close-grip-bench', 'deadlift', 'front-squat', 'incline', 'ohp', 'rdl', 'row',
      'squat', 'sumo-deadlift', 'trap-bar-deadlift'
    ]);
  });

  test('a kilogram bench is read against the kilogram bar', () => {
    // 40 kg is twice the 20 kg bar, so it is a reading. Against the 45 lb bar it
    // would look empty, and the first squat would open at the bar.
    assert.equal(startingWeight('squat', [set('bench', 40, 8, 1)], 'kg'), 47.5);
  });

  test('a light press near the bar is not read as a heavy bench', () => {
    // The R678 review's case: 50 lb of overhead press over its 0.43 read as a 116 lb
    // bench, and opened a 170 lb first deadlift for someone benching 50.
    assert.equal(startingWeight('deadlift', [set('bench', 50, 8, 1), set('ohp', 50, 8, 2)], 'lb'), 80);
    assert.equal(startingWeight('deadlift', [set('bench', 22.5, 8, 1), set('ohp', 22.5, 8, 2)], 'kg'), 37.5);
  });

  test('a dumbbell row, however heavy, does not set a first squat (D2)', () => {
    assert.equal(startingWeight('squat', [set('dbrow', 60, 10, 1)], 'lb'), 45,
      'a 60 lb DB row was read as a strength test, the alternative D2 rejects');
  });

  test('pressing the empty bar is not a strength reading', () => {
    // PT0: a first-timer benched and pressed the bare 45 lb bar, and was then
    // handed a 150 lb first deadlift.
    const barOnly = [set('bench', 45, 8, 1), set('ohp', 45, 8, 2)];
    assert.equal(startingWeight('deadlift', barOnly, 'lb'), 45, 'the empty bar calibrated a deadlift');
    const loaded = [set('bench', 50, 8, 1), set('ohp', 45, 8, 2)];
    assert.ok(startingWeight('deadlift', loaded, 'lb') <= 75,
      `50 lb of bench opened a first deadlift at ${startingWeight('deadlift', loaded, 'lb')}`);
  });
});

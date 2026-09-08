import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import {
  exportAll, serialize, parse, restore, summarise, EXPORT_FORMAT, count } from '../src/data/portable.ts';
import { SCHEMA_VERSION } from '../src/data/schema.ts';
import { MAX_GOALS } from '../src/domain/goals.ts';
import { isStale } from '../src/domain/session.ts';

const DAY = 86_400_000, MIN = 60_000;
const T0 = Date.UTC(2026, 6, 29, 18);
const fresh = () => new Repo(new DatabaseSync(':memory:') as any, () => T0);

let uid = 0;
function populate(repo: Repo) {
  for (let w = 4; w >= 1; w--) {
    const at = T0 - w * 7 * DAY;
    const sid = `s${w}`;
    repo.startSession(sid, 'lb');
    repo.logSet({ id: `x${uid++}`, sessionId: sid, exerciseId: 'squat', weight: 200 + w, reps: 5, at });
    repo.logSet({ id: `x${uid++}`, sessionId: sid, exerciseId: 'bench', weight: 150, reps: 8, at: at + 20 * MIN });
    repo.endSession(sid, at + 45 * MIN);
  }
  repo.addExercise('hack_squat', 'Hack Squat');
  repo.saveGoal({
    id: 'g1', exerciseId: 'squat', targetWeight: 315, targetReps: 5,
    targetDate: T0 + 90 * DAY, unit: 'lb', createdAt: T0 - 30 * DAY
  });
  return repo;
}

describe('export', () => {
  test('captures everything and counts honestly', () => {
    const f = exportAll(populate(fresh()), T0);
    assert.equal(f.format, EXPORT_FORMAT);
    assert.equal(f.schemaVersion, SCHEMA_VERSION);
    assert.equal(f.sets.length, 8);
    assert.equal(f.sessions.length, 4);
    assert.equal(f.goals.length, 1);
    assert.equal(f.counts.sets, f.sets.length);
    assert.equal(f.counts.sessions, f.sessions.length);
    assert.equal(f.counts.goals, f.goals.length);
    assert.equal(f.counts.exercises, f.exercises.length);
  });

  test('includes custom exercises, not just the built-ins', () => {
    const f = exportAll(populate(fresh()), T0);
    assert.ok(f.exercises.some(e => e.id === 'hack_squat'));
  });

  test('sessions come out in chronological order', () => {
    const f = exportAll(populate(fresh()), T0);
    for (let i = 1; i < f.sessions.length; i++) {
      assert.ok(f.sessions[i].startedAt >= f.sessions[i - 1].startedAt);
    }
  });

  // §11 — readable by a human and by something that is not this app.
  test('serialises to plain readable JSON', () => {
    const text = serialize(exportAll(populate(fresh()), T0));
    assert.match(text, /"format": "proof\.export\.v1"/);
    assert.match(text, /"exerciseId": "squat"/, 'self-describing keys, not a blob');
    assert.equal(parse(text).error, null);
  });

  test('an empty database exports a valid empty file', () => {
    const f = exportAll(fresh(), T0);
    assert.equal(f.sets.length, 0);
    assert.equal(f.sessions.length, 0);
    assert.equal(parse(serialize(f)).error, null);
  });
});

describe('parse rejects bad input clearly', () => {
  test('not JSON', () => {
    assert.match(parse('{oops').error!, /not valid json/i);
  });

  test('not an export file', () => {
    assert.match(parse('{"a":1}').error!, /unrecognised format/i);
  });

  test('missing arrays', () => {
    const bad = JSON.stringify({
      format: EXPORT_FORMAT, schemaVersion: 1, exercises: [], sessions: [], sets: []
    });
    assert.match(parse(bad).error!, /goals/);
  });

  // Refusing beats guessing: a newer file may carry columns this build would
  // drop on the next export, losing data on a round trip.
  test('a file from a newer schema is refused, not guessed at', () => {
    const f = exportAll(populate(fresh()), T0);
    const newer = serialize({ ...f, schemaVersion: SCHEMA_VERSION + 5 });
    assert.match(parse(newer).error!, /newer version/i);
  });
});

describe('restore', () => {
  test('round-trips into an empty database', () => {
    const source = populate(fresh());
    const f = parse(serialize(exportAll(source, T0))).file!;
    const target = fresh();
    const r = restore(target, f);

    assert.equal(r.ok, true);
    assert.deepEqual(r.skipped, []);
    assert.equal(target.allSets().length, source.allSets().length);
    assert.equal(target.goals().length, 1);
    assert.equal(target.exercises().get('hack_squat')!.name, 'Hack Squat');
    assert.equal(target.lastSetOf('squat')!.weight, source.lastSetOf('squat')!.weight);
  });

  test('is additive — it never discards sets logged since the export', () => {
    const source = populate(fresh());
    const f = parse(serialize(exportAll(source, T0))).file!;

    const target = fresh();
    target.startSession('local', 'lb');
    target.logSet({
      id: 'local1', sessionId: 'local', exerciseId: 'squat', weight: 999, reps: 1, at: T0
    });

    restore(target, f);
    assert.ok(target.allSets().some(s => s.id === 'local1'),
      'a restore that deletes newer local training is a data-loss button');
    assert.equal(target.allSets().length, f.sets.length + 1);
  });

  test('restoring twice adds nothing the second time', () => {
    const f = parse(serialize(exportAll(populate(fresh()), T0))).file!;
    const target = fresh();
    restore(target, f);
    const second = restore(target, f);
    assert.equal(second.added.sets, 0);
    assert.equal(second.added.sessions, 0);
    assert.equal(target.allSets().length, f.sets.length);
  });

  test('a set whose session is missing is skipped WITH a reason, not dropped', () => {
    const f = parse(serialize(exportAll(populate(fresh()), T0))).file!;
    const lost = f.sessions[0].id;
    f.sessions = f.sessions.slice(1);
    const orphaned = f.sets.filter(s => s.sessionId === lost).length;
    assert.ok(orphaned > 0, 'fixture sanity');

    const r = restore(fresh(), f);
    assert.equal(r.skipped.length, orphaned);
    assert.match(r.skipped[0].reason, /session .* not in file/);
    assert.match(summarise(r), /skipped/);
  });

  test('a set with a missing exercise is skipped rather than failing the FK', () => {
    // Must use a CUSTOM exercise: the built-in twelve are seeded into every
    // database, so dropping "squat" from the file changes nothing — the target
    // already has it. Only a user-created movement can actually go missing.
    const source = populate(fresh());
    source.startSession('custom', 'lb');
    source.logSet({
      id: 'hs1', sessionId: 'custom', exerciseId: 'hack_squat', weight: 300, reps: 8, at: T0
    });
    const f = parse(serialize(exportAll(source, T0))).file!;
    f.exercises = f.exercises.filter(e => e.id !== 'hack_squat');

    const r = restore(fresh(), f);
    assert.ok(r.skipped.some(x => /exercise hack_squat not in file/.test(x.reason)),
      `skipped: ${JSON.stringify(r.skipped)}`);
  });

  test('malformed rows are reported individually', () => {
    const f = parse(serialize(exportAll(populate(fresh()), T0))).file!;
    (f.sets[0] as any).weight = 'heavy';
    (f.sets[1] as any).id = '';
    const r = restore(fresh(), f);
    assert.equal(r.skipped.length, 2);
    assert.ok(r.skipped.every(x => x.kind === 'set'));
  });

  test('an unknown unit is refused rather than stored', () => {
    const f = parse(serialize(exportAll(populate(fresh()), T0))).file!;
    (f.sessions[0] as any).unit = 'stone';
    const r = restore(fresh(), f);
    assert.ok(r.skipped.some(x => x.kind === 'session' && /unknown unit/.test(x.reason)));
  });

  test('hitting the goal cap on restore is reported, not fatal', () => {
    const source = fresh();
    // A hundred goals needs a hundred exercises — see `capSlate` in the goals
    // suites. They are invented here so the export carries them too; a goal
    // whose exercise is not in the file is skipped for that reason instead,
    // which would make this test pass without ever reaching the cap.
    for (let n = 0; n < MAX_GOALS; n++) {
      const ex = `lift${n}`;
      source.addExercise(ex, `Lift ${n}`);
      source.saveGoal({
        id: 'g_' + ex, exerciseId: ex, targetWeight: 300, targetReps: 5,
        targetDate: T0 + 90 * DAY, unit: 'lb', createdAt: T0 - DAY
      });
    }
    source.addExercise('liftExtra', 'Lift Extra');
    const f = parse(serialize(exportAll(source, T0))).file!;
    f.goals.push({
      id: 'g_extra', exerciseId: 'liftExtra', targetWeight: 200, targetReps: 5,
      targetDate: T0 + 90 * DAY, unit: 'lb', createdAt: T0 - DAY
    });

    const r = restore(fresh(), f);
    assert.equal(r.ok, true, 'a full goal list is expected, not corruption');
    assert.equal(r.added.goals, MAX_GOALS);
    assert.ok(r.skipped.some(x => x.kind === 'goal'));
  });

  test('summarise says what happened in one line', () => {
    const f = parse(serialize(exportAll(populate(fresh()), T0))).file!;
    assert.match(summarise(restore(fresh(), f)), /^Restored 8 sets, 4 sessions, 1 goal\.$/);
  });

  /*
   * Restoring a single workout read "Restored 2 sets, 1 sessions." — small, and
   * the kind of small that reads as carelessness on the one screen whose whole
   * job is convincing somebody their training is safe.
   */
  test('one of a thing is not "1 things"', () => {
    assert.equal(count(1, 'set'), '1 set');
    assert.equal(count(0, 'set'), '0 sets');
    assert.equal(count(2, 'set'), '2 sets');
    assert.equal(count(1, 'session'), '1 session');
  });
});

/*
 * §11 — data durability. Both of these were found by an adversarial hunt and
 * reproduced against a real Repo before being believed.
 */
describe('restore does not corrupt what it puts back', () => {
  const MIN = 60_000;
  const mk = (id: string, sid: string, ex: string, w: number, r: number, at: number) =>
    ({ id, sessionId: sid, exerciseId: ex, weight: w, reps: r, at });

  function sourceRepo(SRC: number) {
    let clock = SRC;
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => clock);
    repo.startSession('s1', 'lb');
    repo.logSet(mk('k1', 's1', 'bench', 225, 5, SRC));
    repo.logSet(mk('k2', 's1', 'bench', 235, 5, SRC + 5 * MIN));
    repo.logSet(mk('k3', 's1', 'ohp', 135, 5, SRC + 20 * MIN));
    repo.endSession('s1', SRC + 45 * MIN);
    return repo;
  }

  /*
   * `startSession` had no timestamp parameter, so every restored session was
   * stamped with the RESTORE time while its sets kept their real ones: a
   * 15 July / 45 MIN workout came back as 29 July / 1 MIN, and the database
   * disagreed with itself.
   */
  test('a restored workout keeps the day it happened on', () => {
    const SRC = Date.UTC(2026, 6, 15, 18);
    const LATER = Date.UTC(2026, 6, 29, 18);
    const file = exportAll(sourceRepo(SRC), SRC + 60 * MIN);

    let clock = LATER;
    const tgt = new Repo(new DatabaseSync(':memory:') as any, () => clock);
    restore(tgt, file);

    const session = tgt.session('s1')!;
    assert.equal(session.startedAt, SRC, 'this is the bug: it was stamped with the restore time');
    assert.equal(session.endedAt, SRC + 45 * MIN);
    assert.equal(tgt.setsInSession('s1')[0].at, SRC, 'and the sets always were right');
  });

  /*
   * `allSets()` filters deleted = 0, so an undone set was invisible to the
   * collision check while its row still owned the primary key. The whole
   * restore then aborted with "UNIQUE constraint failed: sets.id".
   */
  test('a backup still restores after the user has undone a set', () => {
    const T = Date.UTC(2026, 6, 29, 18);
    const repo = sourceRepo(T);
    const file = exportAll(repo, T + 60 * MIN);

    repo.deleteSet('k2');                       // the user taps UNDO
    const report = restore(repo, file);         // must not throw

    assert.deepEqual(repo.setsInSession('s1').map(s => s.id), ['k1', 'k3'],
      'a deliberate deletion is not silently reversed by a restore');
    assert.equal(report.added.sets, 0, 'nothing new to add — they were all already here');
    assert.ok(report.skipped.some(x => x.id === 'k2'),
      'and the one it left alone is reported rather than swallowed');
  });

  /*
   * Same rule, a different table. `removeExercise` only ever offers to remove
   * a custom exercise that has never logged a set (§16 on the method itself),
   * so unlike a set there is no history that could go missing — but
   * `addExercise`'s upsert clears the `deleted` flag unconditionally, and an
   * id absent from `exercises()` (which filters deleted=0) looks IDENTICAL
   * whether it never existed or was removed on purpose. Restoring an OLDER
   * backup — from before the deletion — resurrected it.
   */
  test('a backup does not resurrect a custom exercise the user removed', () => {
    const T = Date.UTC(2026, 6, 29, 18);
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.addExercise('cable_curls', 'Cable Curls');
    const file = exportAll(repo, T);            // backup taken while it still exists

    const removed = repo.removeExercise('cable_curls');
    assert.ok(removed, 'test setup: never logged, so this must succeed');

    const report = restore(repo, file);         // the user later restores that OLD backup
    assert.equal(repo.exercises().has('cable_curls'), false,
      'a deliberate deletion is not silently reversed by a restore');
    assert.equal(report.added.exercises, 0);
    assert.ok(report.skipped.some(x => x.id === 'cable_curls'),
      'and the one it left alone is reported rather than swallowed');
  });

  test('restoring the same file twice is a no-op, not an error', () => {
    const T = Date.UTC(2026, 6, 29, 18);
    const repo = sourceRepo(T);
    const file = exportAll(repo, T + 60 * MIN);
    restore(repo, file);
    const second = restore(repo, file);
    assert.equal(second.added.sets, 0);
    assert.equal(repo.setsInSession('s1').length, 3, 'no duplicates');
  });

  /*
   * Same bug as `startedAt` above, one field over, found live rather than by
   * inspection: `startSession` had no way to say WHEN a session's row last
   * changed either, so a restored session — even a still-live one, killed
   * mid-workout and never auto-ended on the source device — was stamped with
   * the RESTORE time. `lastTouch` (session.ts) reads `Math.max(lastSetAt(sets)
   * ?? session.startedAt, session.updatedAt)`, and a restore always happens
   * LATER than every real timestamp in the file, so a wrong `updatedAt` wins
   * that max unconditionally: a session that had already sat idle three hours
   * before it was ever exported came back reading as freshly touched on
   * whatever day the restore happened, and the R333 idle rule never got a
   * chance to fire on it.
   */
  test('a restored LIVE session keeps the staleness it already earned', () => {
    const SRC = Date.UTC(2026, 6, 15, 18);
    const src = new Repo(new DatabaseSync(':memory:') as any, () => SRC);
    src.startSession('s1', 'lb');
    src.logSet(mk('k1', 's1', 'squat', 300, 5, SRC));
    // Exported 3h after the only set — already well past IDLE_END_MS (90min),
    // still live because the app was killed before autoEnd ran.
    const file = exportAll(src, SRC + 3 * 60 * MIN);

    const LATER = Date.UTC(2026, 6, 29, 18);         // restored on a different day
    const tgt = new Repo(new DatabaseSync(':memory:') as any, () => LATER);
    restore(tgt, file);

    const session = tgt.session('s1')!;
    assert.equal(session.endedAt, null, 'still the live session it was exported as');
    assert.ok(
      isStale(session, tgt.setsInSession('s1'), LATER),
      'this is the bug: restoring stamped it with the restore time, so it reads as freshly ' +
      'touched right now instead of already three hours idle when it was exported'
    );
  });

  test('a backup from before updatedAt existed still restores, honestly stamped', () => {
    const SRC = Date.UTC(2026, 6, 15, 18);
    const file = exportAll(sourceRepo(SRC), SRC + 60 * MIN);
    delete (file.sessions[0] as any).updatedAt;      // an older export never had the field

    const LATER = Date.UTC(2026, 6, 29, 18);
    const tgt = new Repo(new DatabaseSync(':memory:') as any, () => LATER);
    restore(tgt, file);

    assert.equal(tgt.session('s1')!.updatedAt, LATER,
      'no recorded value to restore, so the honest answer is the moment it actually happened: now');
  });
});

describe('equipment survives a backup (§11)', () => {
  const MIN2 = 60_000;

  test('export and restore keep what the set was done on', () => {
    const T = Date.UTC(2026, 6, 29, 18);
    let clock = T;
    const src = new Repo(new DatabaseSync(':memory:') as any, () => clock);
    src.startSession('s1', 'lb');
    src.logSet({ id: 'k1', sessionId: 's1', exerciseId: 'lateral', weight: 30, reps: 12,
                 at: T, equipment: 'machine', machine: 'Arsenal' });
    src.logSet({ id: 'k2', sessionId: 's1', exerciseId: 'bench', weight: 185, reps: 5,
                 at: T + MIN2, equipment: 'barbell' });
    src.logSet({ id: 'k3', sessionId: 's1', exerciseId: 'curl', weight: 30, reps: 10,
                 at: T + 2 * MIN2 });
    src.endSession('s1', T + 30 * MIN2);

    const tgt = new Repo(new DatabaseSync(':memory:') as any, () => T);
    restore(tgt, exportAll(src, T + 40 * MIN2));

    const back = tgt.setsInSession('s1');
    assert.equal(back[0].equipment, 'machine');
    assert.equal(back[0].machine, 'Arsenal', 'the machine name is the point of recording it');
    assert.equal(back[1].equipment, 'barbell');
    assert.equal(back[2].equipment, undefined, 'and an unanswered set stays unanswered');
  });

  test('the restored machine is offered again, so the list survives too', () => {
    const T = Date.UTC(2026, 6, 29, 18);
    const src = new Repo(new DatabaseSync(':memory:') as any, () => T);
    src.startSession('s1', 'lb');
    src.logSet({ id: 'k1', sessionId: 's1', exerciseId: 'lateral', weight: 30, reps: 12,
                 at: T, equipment: 'machine', machine: 'Arsenal' });
    src.endSession('s1', T + MIN2);

    const tgt = new Repo(new DatabaseSync(':memory:') as any, () => T);
    restore(tgt, exportAll(src, T + MIN2));
    assert.deepEqual(tgt.knownMachines('lateral'), ['Arsenal']);
  });
});

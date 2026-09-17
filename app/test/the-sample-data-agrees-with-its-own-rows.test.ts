import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { progressRows, recentSessions, weeklyProgress } from '../src/ui/progress-model.ts';
import { latestRecap } from '../src/ui/recap-model.ts';
import { CARRIES_BODYWEIGHT } from '../src/domain/measure.ts';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/*
 * R674. Every model in this suite is tested against fixtures written by hand for
 * the case under test. The app's OWN sample data -- the months of sets `npm run web`
 * generates and the owner opens the preview to look at -- was exercised in
 * exactly one place: the coach line on Now (R666). That is where R666's defect
 * lived, and nothing checked the other screens against it at all.
 *
 * So: build the real seed, then ask each surface whether what it says matches
 * the rows it was built from. Fixtures prove a rule; this proves the rule still
 * holds on the data a person actually sees.
 *
 * The sanity test runs first on purpose. An earlier draft of this sweep, run as
 * a scratch probe, compared fields that do not exist (`best.weight`, `s.sets`)
 * and reported "no disagreements" while every check silently skipped -- the
 * gate-that-cannot-fail shape this project keeps finding. A test over generated
 * data can fail the same way if the generator ever produces nothing, so the
 * size of the sample is asserted before anything is concluded from it.
 */

type Row = { id: string; session_id: string; exercise_id: string; weight: number; reps: number; at: number };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-sample-'));
const out = path.join(dir, 'seed.b64');
execFileSync(process.execPath, ['--no-warnings', path.join(APP, 'tools', 'seed-web.ts')],
  { cwd: APP, env: { ...process.env, PROOF_SEED_OUT: out }, stdio: 'pipe' });
const file = path.join(dir, 'seed.db');
fs.writeFileSync(file, Buffer.from(fs.readFileSync(out, 'utf8'), 'base64'));

const now = Date.now();
const db = new DatabaseSync(file);
const repo = new Repo(db as never, () => now);
const rows = db.prepare(
  'SELECT s.id, s.session_id, s.exercise_id, s.weight, s.reps, s.at ' +
  'FROM sets s JOIN sessions ss ON ss.id = s.session_id WHERE s.deleted = 0'
).all() as unknown as Row[];

after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

type Reading = { value: number; unit: string; at: number };
const readings = db.prepare(
  "SELECT value, unit, at FROM measurements WHERE deleted = 0 AND kind = 'bodyweight' ORDER BY at"
).all() as unknown as Reading[];

/**
 * A set's real load, recomputed from the rows rather than asked of the app (R675).
 *
 * A pull-up or a dip weighs what the lifter weighs plus what they added, using
 * the reading in force AT that set; with no such reading the total is only a
 * floor, which is what `null` means here. Every other lift is its stored weight.
 * No unit conversion: the sanity test asserts the whole sample is in pounds.
 */
const loadOf = (r: Row): number | null => {
  if (!CARRIES_BODYWEIGHT.has(r.exercise_id)) return r.weight;
  const bw = readings.filter(m => m.at <= r.at).pop();
  return bw ? Math.round((bw.value + r.weight) * 10) / 10 : null;
};
const volumeOf = (sets: Row[]) =>
  Math.round(sets.reduce((sum, r) => sum + (loadOf(r) ?? r.weight) * r.reps, 0));
const knowable = (sets: Row[]) => sets.every(r => loadOf(r) !== null);

/** Sets of one lift, heaviest first, at or above the rep floor `best` is scoped to. */
const workingSets = (exerciseId: string) => rows.filter(r => r.exercise_id === exerciseId && r.reps >= 5);

describe('the sample data the owner looks at agrees with its own rows (R674)', () => {
  test('the sample is actually a history, so nothing below can pass by being empty', () => {
    assert.ok(rows.length >= 200, `the seeder produced ${rows.length} sets; this sweep concludes nothing from that`);
    assert.ok(new Set(rows.map(r => r.session_id)).size >= 20, 'too few sessions to exercise the screens');
    assert.ok(progressRows(repo, now).length >= 6, 'Progress shows almost nothing for this history');
    // `loadOf` adds a reading to a weight without converting either, which is only
    // right while every session and every reading is in pounds -- so that is
    // asserted here rather than assumed below.
    const units = new Set((db.prepare('SELECT unit FROM sessions WHERE deleted = 0').all() as Array<{ unit: string }>).map(s => s.unit));
    assert.deepEqual([...units], ['lb'], 'the sample now mixes units; loadOf must convert before it can be trusted');
    assert.ok(readings.every(m => m.unit === 'lb'), 'a bodyweight reading is not in pounds; loadOf must convert it');
  });

  test('every Progress row names a set the lifter actually did', () => {
    for (const row of progressRows(repo, now)) {
      const mine = workingSets(row.exerciseId);
      if (!mine.length) continue;
      const top = mine.reduce((a, b) => (b.weight > a.weight ? b : a));
      assert.equal(row.best, top.weight,
        `Progress says ${row.name}'s best is ${row.best} x ${row.bestReps}; the heaviest set at 5+ reps is ${top.weight} x ${top.reps}`);
      // R675 removed a second check here, that some stored set is exactly
      // `best x bestReps`: `bestSetAtReps` only ever returns a stored set at 5+
      // reps, so on a single-unit sample it could not fail. The value check above
      // is the one that can.
    }
  });

  test('every session in the list carries the sets, volume and lifts its rows hold', () => {
    for (const s of recentSessions(repo)) {
      const mine = rows.filter(r => r.session_id === s.id);
      assert.ok(mine.length > 0, `the list shows session ${s.id}, which has no sets`);
      assert.equal(s.setCount, mine.length, `session ${s.id} is listed with ${s.setCount} sets and holds ${mine.length}`);
      const volume = volumeOf(mine);
      assert.equal(s.volume, volume,
        `session ${s.id} is listed at ${s.volume} volume; its rows, each at its real load, total ${volume}`);
      assert.equal(s.volumeKnown, knowable(mine),
        `session ${s.id} says its total is ${s.volumeKnown ? '' : 'not '}knowable; its rows say it is${knowable(mine) ? '' : ' not'}`);
      assert.equal(s.lifts.length, new Set(mine.map(r => r.exercise_id)).size,
        `session ${s.id} lists ${s.lifts.length} lifts and holds ${new Set(mine.map(r => r.exercise_id)).size}`);
    }
  });

  test("the recap's numbers are that session's own rows", () => {
    const recap = latestRecap(repo, now);
    assert.ok(recap, 'no recap at all for a months-long history');
    const mine = rows.filter(r => r.session_id === recap!.sessionId);
    assert.ok(mine.length > 0, `the recap names session ${recap!.sessionId}, which has no sets`);
    assert.equal(recap!.payload.sets, mine.length,
      `the card claims ${recap!.payload.sets} sets; the session holds ${mine.length}`);
    assert.equal(recap!.payload.volume, volumeOf(mine),
      'the card\'s volume is not the sum of the sets it is reporting, each at its real load');
    // The payload omits the flag when the total is knowable, so absent means true.
    assert.equal(recap!.payload.volumeKnown ?? true, knowable(mine),
      'the card and its own rows disagree about whether the total is knowable');
    assert.equal(recap!.payload.lifts.length, new Set(mine.map(r => r.exercise_id)).size,
      'the card lists a different number of lifts than the session holds');
    const best = recap!.payload.best;
    if (best) {
      const heaviest = rows.filter(r => r.exercise_id === best.exerciseId)
        .reduce((a, b) => (b.weight > a.weight ? b : a));
      assert.ok(best.weight <= heaviest.weight,
        `the card calls ${best.weight} the best ${best.lift}, above anything in the history (${heaviest.weight})`);
    }
  });

  test('the weekly line compares two weights that are in the history', () => {
    const wk = weeklyProgress(repo, now);
    if (!wk) return; // nothing to compare is a legitimate answer; R285 made it one
    // A bodyweight lift is compared at its real load, so either number counts as lifted.
    const lifted = (w: number) => rows.some(r => r.exercise_id === wk.exerciseId && (r.weight === w || loadOf(r) === w));
    assert.ok(lifted(wk.now), `the weekly line's "${wk.now}" is not a set of ${wk.lift} in the history`);
    assert.ok(lifted(wk.then), `the weekly line's "${wk.then}" is not a set of ${wk.lift} in the history`);
  });

  test('the sample shows what bodyweight work really weighs, not only barbell work (R675)', () => {
    // The owner is told to open the preview to see the app. Before R675 the
    // sample held no pull-up, no dip and no bodyweight reading, so every one of
    // these was null there -- shipped, and invisible in the one place anyone looks.
    const progress = progressRows(repo, now);
    assert.ok(progress.some(r => r.realBest != null),
      'no Progress row carries a real load: the sample has no bodyweight lift with a reading behind it');
    assert.ok(progress.some(r => r.bestMultiple != null),
      'no Progress row shows a lift as a multiple of bodyweight');
    assert.ok(latestRecap(repo, now)?.payload.multiple,
      'the recap card carries no bodyweight multiple line');
  });

  test('Now opens on the weight the last set of that lift used', () => {
    const m = new NowModel(repo, () => now, 'en-US');
    const opened = (m as unknown as { exerciseId: string }).exerciseId;
    const mine = rows.filter(r => r.exercise_id === opened);
    if (!mine.length) return; // a lift with no history opens on a seeded guess, by design
    const last = mine.reduce((a, b) => (b.at > a.at ? b : a));
    assert.equal(m.state().weight, last.weight,
      `Now opens ${opened} at ${m.state().weight}; the last set of it was ${last.weight}`);
  });
});

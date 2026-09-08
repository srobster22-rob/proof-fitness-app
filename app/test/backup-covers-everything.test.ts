import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { exportAll, serialize, parse, restore, summarise } from '../src/data/portable.ts';
import { erasureLine } from '../src/ui/progress-model.ts';

const DAY = 86_400_000;
const T = Date.UTC(2026, 7, 24, 9);
const fresh = () => new Repo(new DatabaseSync(':memory:') as any, () => T);

/**
 * The safety net has to cover what the warning names.
 *
 * The erase confirmation on Progress reads "700 workouts, 14,000 sets, 100
 * goals **and 3 measurements** will be deleted" — and the EXPORT MY DATA button
 * directly above it wrote a file containing exercises, sessions, sets and goals
 * and nothing else. The app named what it was about to destroy and offered a
 * backup that did not include it. Preferences were in the same position:
 * `eraseAll` hard-deletes them under the comment "their chosen jump amounts are
 * theirs too", and nothing carried them.
 *
 * §11 calls the export "cheap insurance, and a trust signal for an audience
 * that is deeply sceptical of apps holding their data hostage". Insurance that
 * silently excludes a category is the opposite of a trust signal.
 */
function populated() {
  const repo = fresh();
  repo.startSession('s1', 'lb');
  repo.logSet({ id: 'x1', sessionId: 's1', exerciseId: 'bench', weight: 185, reps: 5, at: T - DAY });
  repo.endSession('s1', T - DAY + 60_000);
  repo.saveGoal({
    id: 'g1', exerciseId: 'bench', targetWeight: 225, targetReps: 5,
    targetDate: T + 90 * DAY, unit: 'lb', createdAt: T - 30 * DAY
  });
  repo.saveMeasurement({ id: 'm1', kind: 'bodyweight', value: 198, unit: 'lb', at: T - 20 * DAY });
  repo.saveMeasurement({ id: 'm2', kind: 'height', value: 180, unit: 'cm', at: T - 20 * DAY });
  repo.saveMeasureGoal({
    id: 'mg1', kind: 'bodyweight', target: 180, unit: 'lb',
    targetDate: T + 180 * DAY, createdAt: T - 10 * DAY
  });
  repo.setPref('jump.lb', '10');
  repo.setPref('unit', 'lb');
  return repo;
}

describe('the export carries everything erase would destroy', () => {
  test('the warning and the backup name the same categories', () => {
    const repo = populated();
    assert.match(erasureLine(repo), /measurement/,
      'the confirmation promises to delete measurements');
    const file = exportAll(repo, T);
    assert.equal(file.measurements!.length, 2, 'so the export has to contain them');
    assert.equal(file.measureGoals!.length, 1);
    assert.ok(Object.keys(file.prefs!).length > 0);
  });

  /*
   * The whole journey, which is the only way this bug was ever going to show:
   * each half looks fine on its own.
   */
  test('export, erase, restore — and nothing is missing', () => {
    const repo = populated();
    const text = serialize(exportAll(repo, T));

    repo.eraseAll();
    assert.deepEqual(repo.measurements(), []);
    assert.deepEqual(repo.measureGoals(), []);
    assert.equal(repo.getPref('jump.lb'), null);

    const { file, error } = parse(text);
    assert.equal(error, null);
    const report = restore(repo, file!);

    assert.equal(report.added.sets, 1);
    assert.equal(report.added.measurements, 2, 'both readings came back');
    assert.equal(report.added.measureGoals, 1, 'the target came back');
    assert.equal(report.added.prefs, 2, 'and the settings they chose');
    assert.equal(repo.getPref('jump.lb'), '10');
    assert.equal(repo.measurements().length, 2);
    assert.equal(repo.measureGoals()[0].target, 180);
  });

  test('a reading round-trips exactly, note and unit included', () => {
    const repo = fresh();
    repo.saveMeasurement({
      id: 'm', kind: 'bodyweight', value: 84.5, unit: 'kg', at: T, note: 'morning' });
    const text = serialize(exportAll(repo, T));
    repo.eraseAll();
    restore(repo, parse(text).file!);
    assert.deepEqual(repo.measurements()[0], {
      id: 'm', kind: 'bodyweight', value: 84.5, unit: 'kg', at: T, note: 'morning' });
  });

  test('the sentence tells the user the new things arrived', () => {
    const repo = populated();
    const text = serialize(exportAll(repo, T));
    repo.eraseAll();
    const line = summarise(restore(repo, parse(text).file!));
    assert.match(line, /measurement/);
    assert.match(line, /setting/);
  });
});

/*
 * Restore's own rules have to hold for the new categories too. It is additive,
 * it never deletes, and it never resurrects something removed on purpose.
 */
describe('restoring measurements obeys the same rules as everything else', () => {
  test('a deleted reading is not resurrected by an older backup', () => {
    const repo = fresh();
    repo.saveMeasurement({ id: 'm', kind: 'bodyweight', value: 198, unit: 'lb', at: T });
    const text = serialize(exportAll(repo, T));
    repo.deleteMeasurement('m');
    const report = restore(repo, parse(text).file!);
    assert.equal(report.added.measurements, 0);
    assert.deepEqual(repo.measurements(), [],
      'the tombstone is a decision, and a restore must not undo it silently');
    assert.equal(report.skipped.some(s => s.kind === 'measurement'), true, 'and it says so');
  });

  test('a preference set on this device wins over the file', () => {
    const repo = fresh();
    repo.setPref('unit', 'lb');
    const text = serialize(exportAll(repo, T));
    repo.setPref('unit', 'kg');
    const report = restore(repo, parse(text).file!);
    assert.equal(repo.getPref('unit'), 'kg',
      'importing an old backup must not reset what they changed this morning');
    assert.equal(report.added.prefs, 0);
  });

  test('a malformed reading is reported, not swallowed', () => {
    const repo = fresh();
    const file = exportAll(repo, T);
    file.measurements = [
      { id: 'bad', kind: 'nonsense', value: 1, unit: 'lb', at: T } as never,
      { id: 'noval', kind: 'bodyweight', at: T } as never
    ];
    const report = restore(repo, file);
    assert.equal(report.added.measurements, 0);
    assert.equal(report.skipped.length, 2);
    assert.match(report.skipped[0].reason, /unknown kind/);
  });

  /*
   * A file written before any of this existed still has to restore — the whole
   * point of a plain-text export is that yesterday's file opens tomorrow.
   */
  test('a backup from before measurements existed still restores', () => {
    const repo = populated();
    const old: Record<string, unknown> = { ...exportAll(repo, T) };
    delete old.measurements;
    delete old.measureGoals;
    delete old.prefs;
    repo.eraseAll();
    const { file, error } = parse(JSON.stringify(old));
    assert.equal(error, null, 'the new fields are optional on read');
    const report = restore(repo, file!);
    assert.equal(report.added.sets, 1);
    assert.equal(report.added.measurements, 0);
    assert.equal(report.added.prefs, 0);
  });
});

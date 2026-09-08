import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { exportAll, serialize, parse, restore, summarise } from '../src/data/portable.ts';

const T0 = Date.UTC(2026, 8, 9, 12);

function seeded(): Repo {
  const r = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  r.startSession('s1', 'lb', undefined, T0 - 86_400_000);
  r.logSet({ id: 'x1', sessionId: 's1', exerciseId: 'bench', weight: 135, reps: 5, at: T0 - 86_400_000 });
  r.endSession('s1', T0 - 86_400_000 + 3600_000);
  return r;
}

/*
 * R568. `report.skipped` has always carried a reason string per row and only
 * the COUNT reached the user — "3 skipped" with no way to learn whether that
 * meant nothing (the file was already restored) or something real (a
 * corrupted or foreign row). Flagged in R560 and held off three rounds behind
 * the owner's open decisions rather than filing a fifth; small and contained
 * enough now to just fix.
 *
 * The design question was noise: naming every skip on a badly mismatched file
 * could mean hundreds of near-identical reasons on a status line, which is the
 * wall of detail §15 keeps this screen quiet against. So: if every skip is the
 * ORDINARY kind — "already on this device", the shape of restoring the same
 * file twice — the count alone still speaks for itself. The moment even one
 * skip is something else, name the first one.
 */
describe('a skipped row explains itself when it is not just a duplicate (R568)', () => {
  test('restoring the same file twice stays quiet', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
    const good = parse(serialize(exportAll(seeded(), T0))).file!;
    restore(repo, good);
    const second = restore(repo, good);
    const line = summarise(second, 'en');
    assert.match(line, /1 skipped\.$/, `a duplicate restore should stay quiet: "${line}"`);
    assert.doesNotMatch(line, /\(/, `a duplicate restore printed a reason nobody needs: "${line}"`);
  });

  test('a real problem is named', () => {
    const orphan = JSON.parse(serialize(exportAll(seeded(), T0)));
    orphan.sessions = [];
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
    const report = restore(repo, parse(JSON.stringify(orphan)).file!);
    const line = summarise(report, 'en');
    assert.match(line, /1 skipped \(session s1 not in file\)\.$/,
      `a real skip reason should reach the user: "${line}"`);
  });

  test('one real reason among many duplicates still gets named', () => {
    /*
     * The order the design has to get right: a mostly-ordinary restore with
     * ONE genuine problem must not let the harmless majority bury it.
     */
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
    const good = parse(serialize(exportAll(seeded(), T0))).file!;
    restore(repo, good);            // everything in `good` is now a duplicate
    const mixed = JSON.parse(JSON.stringify(good));
    mixed.sets.push({ id: 'orphaned', sessionId: 'ghost-session', exerciseId: 'bench',
      weight: 100, reps: 5, at: T0 });
    const report = restore(repo, mixed);
    const line = summarise(report, 'en');
    assert.match(line, /not in file/, `the one real problem got lost among the duplicates: "${line}"`);
  });

  test('the wrapping sentence translates; the diagnostic reason does not', () => {
    /*
     * Same split `applyBackup` already makes for parse errors: the reason is
     * meant to be pasted into a support message as-is, so translating it would
     * mean support has to translate it back.
     */
    const orphan = JSON.parse(serialize(exportAll(seeded(), T0)));
    orphan.sessions = [];
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
    const report = restore(repo, parse(JSON.stringify(orphan)).file!);
    const es = summarise(report, 'es');
    assert.match(es, /omitidos/, `the Spanish line did not translate: "${es}"`);
    assert.match(es, /session s1 not in file/,
      `the diagnostic reason was translated, so it can no longer be pasted into a bug report: "${es}"`);
  });

  test('a device with nothing skipped is unaffected', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
    const report = restore(repo, parse(serialize(exportAll(seeded(), T0))).file!);
    assert.equal(report.skipped.length, 0, 'the fixture unexpectedly skipped something');
    assert.doesNotMatch(summarise(report, 'en'), /skipped/, 'a clean restore now mentions skipping');
  });
});

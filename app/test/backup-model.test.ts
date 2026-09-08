import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { backupFilename, prepareBackup, applyBackup } from '../src/ui/backup-model.ts';

const DAY = 86_400_000, MIN = 60_000;
const T0 = Date.UTC(2026, 6, 29, 18);
const fresh = () => new Repo(new DatabaseSync(':memory:') as any, () => T0);

function populate(repo: Repo) {
  for (let w = 3; w >= 1; w--) {
    const at = T0 - w * 7 * DAY;
    const sid = `s${w}`;
    repo.startSession(sid, 'lb');
    repo.logSet({ id: `x${w}`, sessionId: sid, exerciseId: 'squat', weight: 200 + w, reps: 5, at });
    repo.endSession(sid, at + 40 * MIN);
  }
  return repo;
}

describe('backup filename', () => {
  test('is dated, not timestamped', () => {
    // The exact string, because a loose regex here matched the date's own digits
    // and passed for the wrong reason.
    assert.equal(
      backupFilename(Date.UTC(2026, 6, 29, 18, 42, 7)),
      'proof-backup-2026-07-29.json'
    );
  });

  test('two exports on the same day collide on purpose', () => {
    const a = backupFilename(Date.UTC(2026, 6, 29, 9));
    const b = backupFilename(Date.UTC(2026, 6, 29, 21));
    assert.equal(a, b, 'the second export should replace the first');
  });

  test('pads single-digit months and days', () => {
    assert.equal(backupFilename(Date.UTC(2026, 0, 5, 12)), 'proof-backup-2026-01-05.json');
  });
});

describe('prepareBackup', () => {
  test('says what is in the file before it leaves the device', () => {
    const b = prepareBackup(populate(fresh()), T0);
    assert.equal(b.summary, '3 sets across 3 sessions');
    assert.match(b.text, /"format": "proof\.export\.v1"/);
    assert.match(b.filename, /\.json$/);
  });

  test('an empty log still prepares a valid file', () => {
    const b = prepareBackup(fresh(), T0);
    assert.equal(b.summary, '0 sets across 0 sessions');
    assert.doesNotThrow(() => JSON.parse(b.text));
  });
});

describe('applyBackup', () => {
  test('round-trips through the model layer', () => {
    const text = prepareBackup(populate(fresh()), T0).text;
    const target = fresh();
    const r = applyBackup(target, text);
    assert.equal(r.ok, true);
    assert.match(r.message, /Restored 3 sets/);
    assert.equal(target.allSets().length, 3);
  });

  // Reached from a document picker, so the input is an arbitrary user-chosen
  // file. Crashing would look like the app breaking rather than the file.
  test('never throws on junk input', () => {
    for (const junk of ['', 'not json', '{}', '[]', 'null', '{"format":"other"}']) {
      const r = applyBackup(fresh(), junk);
      assert.equal(r.ok, false, junk);
      assert.ok(r.message.length > 0, `no message for ${JSON.stringify(junk)}`);
    }
  });

  test('a wrong-but-valid JSON file gets a readable reason', () => {
    const r = applyBackup(fresh(), JSON.stringify({ format: 'something.else' }));
    assert.match(r.message, /unrecognised format/i);
  });
});

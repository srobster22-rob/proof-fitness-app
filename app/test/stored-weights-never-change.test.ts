import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { PREF_UNIT } from '../src/ui/display-unit.ts';
import { exportAll, serialize, parse, restore } from '../src/data/portable.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'src', 'data');
const T0 = Date.UTC(2026, 8, 9, 12);
const DAY = 86_400_000;

/** A lb session and a kg session, so a normaliser has something to normalise. */
function mixed(): Repo {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  repo.startSession('lb1', 'lb');
  repo.logSet({ id: 'a', sessionId: 'lb1', exerciseId: 'bench', weight: 225, reps: 5, at: T0 - 3 * DAY });
  repo.endSession('lb1', T0 - 3 * DAY + 3600_000);
  repo.startSession('kg1', 'kg');
  repo.logSet({ id: 'b', sessionId: 'kg1', exerciseId: 'bench', weight: 102.5, reps: 5, at: T0 - DAY });
  repo.endSession('kg1', T0 - DAY + 3600_000);
  return repo;
}

const stored = (repo: Repo) =>
  repo.allSets().map(s => `${s.id}=${s.weight}@${s.sessionId}`).sort().join(' ');

/*
 * R544. `types.ts` states the invariant the last five rounds all rest on:
 *
 *   "Every set is stored in the unit it was logged in and that never changes —
 *    a 225 lb bench stays 225 lb in the database for ever."
 *
 * Every conversion in the app is a DISPLAY conversion performed against
 * `sessionUnits`, and every fix from R537 to R543 assumed the stored number is
 * the fact. Nothing enforced it. I hand-checked it twice across those rounds,
 * which is exactly the pattern that precedes finding a claim false — and it is
 * also the wrong instrument, because the way this breaks is a future write
 * path, not the current one.
 *
 * Two directions, because either alone is easy to satisfy wrongly: the stored
 * bytes must survive the things that plausibly rewrite them, and the data layer
 * must not be in the conversion business at all.
 */
describe('a stored weight is never rewritten (R544)', () => {
  test('changing the unit preference does not touch a single stored weight', () => {
    /*
     * The path a real person takes: train in pounds, decide the app should be
     * in kilos, come back. Converting on write would mean a preference silently
     * rewrote their history — and `convertWeight` round-trips through a float,
     * so 225 comes back 224.9 (types.ts's own reason).
     */
    const repo = mixed();
    const before = stored(repo);
    const m = new NowModel(repo, () => T0, 'en-US');
    repo.setPref(PREF_UNIT, 'kg');
    m.adoptChosenUnit();
    m.state();
    assert.equal(stored(repo), before, 'switching the display unit rewrote stored weights');
    assert.equal(repo.allSets().find(s => s.id === 'a')!.weight, 225,
      'the 225 lb bench is no longer 225 in the database');
  });

  test('an export/restore round trip returns the same numbers', () => {
    /*
     * The other way history gets rewritten: a backup taken on a pound phone
     * and restored on a kilo one. `restore` preserves each session's own unit,
     * and this pins the consequence rather than the mechanism.
     */
    const repo = mixed();
    const before = stored(repo);
    const text = serialize(exportAll(repo, T0));
    const back = new Repo(new DatabaseSync(':memory:') as never, () => T0);
    back.setPref(PREF_UNIT, 'kg');
    const parsed = parse(text);
    assert.equal(parsed.error, null, `the export did not parse back: ${parsed.error}`);
    restore(back, parsed.file!);
    assert.equal(stored(back), before, 'restoring rewrote the weights it was given');
    assert.equal(back.sessionUnits().get('kg1'), 'kg', 'the kg session came back as something else');
    assert.equal(back.sessionUnits().get('lb1'), 'lb', 'the lb session came back as something else');
  });

  test('the data layer does not convert weights at all', () => {
    /*
     * Structural, and the half that catches the NEXT write path rather than
     * the current ones. Storage has no business knowing about units beyond
     * recording which one a session used: the moment anything under src/data
     * reaches for `convertWeight`, the number in the table has stopped being
     * the fact and everything built on it since R537 is unsound.
     */
    const offenders: string[] = [];
    for (const name of fs.readdirSync(DATA)) {
      if (!name.endsWith('.ts')) continue;
      const src = fs.readFileSync(path.join(DATA, name), 'utf8');
      // In a comment it is fine — types.ts's rule is worth quoting. In code it
      // is the defect, so strip comments before looking.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (/\bconvertWeight\s*\(/.test(code)) offenders.push(name);
    }
    assert.deepEqual(offenders, [],
      'the storage layer is converting weights, so the stored number is no longer ' +
      'the number that was logged: ' + offenders.join(', '));
  });

  test('and the invariant is still written down where it is relied on', () => {
    const types = fs.readFileSync(path.join(HERE, '..', 'src', 'domain', 'types.ts'), 'utf8');
    assert.match(types, /stored in the unit it was logged in and that never changes/,
      'types.ts no longer states the rule these tests enforce');
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import { PLATE, REP_JUMP } from '../src/ui/now-steppers.ts';
import { region } from './helpers/source.ts';

const T = Date.UTC(2026, 7, 27, 9);
const fresh = () => new Repo(new DatabaseSync(':memory:') as any, () => T);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.join(HERE, '..', ...p.split('/')), 'utf8');
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

/*
 * Clearing a settings field has to actually clear the setting.
 *
 * Found by clearing the weight-jump field in the running app and reloading.
 * The handler wrote on every keystroke and did `if (!v.trim()) return` on an
 * empty one, so emptying the field never touched the stored value. A user who
 * had set 50 lb, cleared it to go back to a plate, and walked away kept
 * jumping by 50 — while the field showed a greyed "45" placeholder, because
 * the placeholder is the DEFAULT and the default was no longer in force.
 *
 * Two separate defects, and the second is why the first stayed invisible:
 * the value in force was 50, the number on screen was 45, and §16 says every
 * number in the app has to be checkable.
 */
describe('a jump amount can be set back to the default', () => {
  test('clearPref removes the row, so getPref reports no preference again', () => {
    const repo = fresh();
    repo.setPref('jump.lb', '50');
    assert.equal(repo.getPref('jump.lb'), '50');
    repo.clearPref('jump.lb');
    assert.equal(repo.getPref('jump.lb'), null,
      'the old custom jump is still in force after the user cleared the field');
  });

  test('clearing one unit does not disturb the other, or any other pref', () => {
    const repo = fresh();
    repo.setPref('jump.lb', '50');
    repo.setPref('jump.kg', '25');
    repo.setPref('unit', 'kg');
    repo.clearPref('jump.lb');
    assert.equal(repo.getPref('jump.kg'), '25');
    assert.equal(repo.getPref('unit'), 'kg');
  });

  test('clearing something never set is not an error', () => {
    const repo = fresh();
    assert.doesNotThrow(() => repo.clearPref('jump.reps'));
    assert.equal(repo.getPref('jump.reps'), null);
  });

  test('and it can be set again afterwards', () => {
    const repo = fresh();
    repo.setPref('jump.lb', '50');
    repo.clearPref('jump.lb');
    repo.setPref('jump.lb', '2.5');
    assert.equal(repo.getPref('jump.lb'), '2.5');
  });
});

/*
 * Source tests, because the fields live in a `.tsx` no Node test can render —
 * the same approach as `measure-reachable.test.ts` and `accent.test.ts`.
 */
describe('the jump fields are never blank', () => {
  const src = code(read('app/settings.tsx'));

  test('both seed from the value in force, falling back to the real default', () => {
    // §4: an empty number field is a bug. Unset means the app is using PLATE
    // and REP_JUMP, which are numbers — so show them, do not grey them out.
    assert.match(src, /useState\(repo\.getPref\(`jump\.\$\{unit\}`\) \?\? String\(PLATE\[unit\]\)\)/);
    assert.match(src, /useState\(repo\.getPref\('jump\.reps'\) \?\? String\(REP_JUMP\)\)/);
    assert.doesNotMatch(src, /getPref\((`jump\.\$\{unit\}`|'jump\.reps')\) \?\? ''/,
      'a jump field still seeds to an empty string');
  });

  test('an emptied field clears the preference rather than silently keeping it', () => {
    assert.match(src, /if \(!v\.trim\(\)\) return repo\.clearPref\(`jump\.\$\{unit\}`\)/);
    assert.match(src, /if \(!v\.trim\(\)\) return repo\.clearPref\('jump\.reps'\)/);
    assert.doesNotMatch(src, /if \(!v\.trim\(\)\) return;/,
      'an empty field takes the bare early return again, which leaves the old value in force');
  });

  test('and leaving it blank refills it with the default on the way out', () => {
    assert.match(src, /onBlur=\{\(\) => \{ if \(!jump\.trim\(\)\) setJump\(String\(PLATE\[unit\]\)\); \}\}/);
    assert.match(src, /onBlur=\{\(\) => \{ if \(!repJump\.trim\(\)\) setRepJump\(String\(REP_JUMP\)\); \}\}/);
  });

  test('switching units re-seeds to that unit default, not to blank', () => {
    // The unit-change path is a second seeding site and drifted from the first
    // once already — it is what the `jumpKey` remount comment is about.
    const swap = region(src, 'jumpKey.current = unit', 'setError(null);');
    assert.match(swap, /String\(PLATE\[unit\]\)/);
  });

  test('the defaults the screen shows are the ones the app actually uses', () => {
    // If PLATE or REP_JUMP moved, the seeded display would go on being right
    // for free — this pins that they are still the numbers, so the assertions
    // above are about a real value and not a name.
    assert.equal(PLATE.lb, 45);
    assert.equal(PLATE.kg, 20);
    assert.equal(REP_JUMP, 5);
  });
});

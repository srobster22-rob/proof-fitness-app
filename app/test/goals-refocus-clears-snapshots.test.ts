import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const SRC = fs.readFileSync(path.join(APP, 'app', 'goals.tsx'), 'utf8');

/*
 * R581. `editing`, `wiping` and `undo` on the Goals screen all hold a
 * SNAPSHOT of goal data, and none of it used to be cleared on the way back to
 * the screen. Today that costs nothing -- the only way off Goals pops the
 * screen, which destroys its state -- but that safety belongs to the current
 * stack navigation, not to this code, and OWNER.md has an open question about
 * a tab bar, which keeps every tab mounted rather than popping. Measured
 * directly (see goals-model.test.ts): `restoreGoals` is a plain upsert and
 * happily resurrects a wiped goal even after `eraseAll()` -- the one action
 * in this app that explicitly promises "this cannot be undone."
 *
 * The fix mirrors `NowScreen`'s own `resume()`: re-sync stale UI state on
 * `useFocusEffect` rather than trust it survived whatever happened while this
 * screen was not the one on screen.
 */
describe('Goals clears its snapshot state on refocus, not just on its own actions (R581)', () => {
  test('the screen imports useFocusEffect', () => {
    assert.match(SRC, /import\s*\{[^}]*useFocusEffect[^}]*\}\s*from\s*'expo-router'/,
      'Goals no longer imports useFocusEffect -- the refocus guard cannot exist without it');
  });

  test('a useFocusEffect clears editing, wiping and undo together', () => {
    const at = SRC.indexOf('useFocusEffect(useCallback(');
    assert.ok(at >= 0, 'the refocus guard is gone from app/goals.tsx');
    const body = SRC.slice(at, at + 300);
    for (const setter of ['setEditing(null)', 'setWiping(null)', 'setUndo(null)']) {
      // Plain substring, not a regex -- the parentheses in `setEditing(null)`
      // are literal characters here, and escaping them through a heredoc write
      // is exactly the kind of backslash collapse (HANDOFF trap 7) this repo
      // has been bitten by before. indexOf sidesteps the whole class of bug.
      assert.ok(body.includes(setter),
        `the refocus guard no longer clears ${setter} -- a stale snapshot can survive a ` +
        'trip away from this screen again');
    }
  });

  /*
   * R583, one round after R581. `goals` is
   * `useMemo(() => listGoals(repo, now), [repo, tick])` and `tick` only ever
   * changed through this screen's OWN actions -- nothing refreshed the LIST
   * itself on arrival, only the sheet state R581 fixed. The exact defect
   * `NowScreen.resume()`'s comment names for a different screen -- "a
   * restore -- or an erase -- on Progress left this screen showing numbers
   * for sets that no longer existed" -- had never been fixed here, because
   * nothing on Goals ran on focus at all until R581 gave it something to run.
   */
  test('the same useFocusEffect also refreshes the goal list itself', () => {
    const at = SRC.indexOf('useFocusEffect(useCallback(');
    assert.ok(at >= 0, 'the refocus guard is gone from app/goals.tsx');
    const body = SRC.slice(at, at + 300);
    assert.ok(body.includes('setTick(t => t + 1)'),
      'the refocus guard clears the sheet state but no longer refreshes `tick` -- ' +
      'the goal LIST can still show stale data after a restore or erase elsewhere');
  });
});

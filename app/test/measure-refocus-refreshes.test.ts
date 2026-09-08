import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const SRC = fs.readFileSync(path.join(APP, 'app', 'measure.tsx'), 'utf8');

/*
 * R584, applying R581/R583's own fix to the one screen not yet checked for
 * it. Measure had the identical shape Goals had before those two rounds:
 * `rows = useMemo(() => measureRows(repo, now), [repo, tick])`, zero
 * `useFocusEffect` anywhere in the file, left via `useGuardedLeave` (a pop).
 * Safe today only because a pop destroys the component on the way out; real
 * the moment a tab bar keeps it mounted while blurred instead.
 */
describe('Measure refreshes its data and clears its sheets on refocus (R584)', () => {
  test('the screen imports useFocusEffect', () => {
    assert.match(SRC, /import\s*\{[^}]*useFocusEffect[^}]*\}\s*from\s*'expo-router'/,
      'Measure no longer imports useFocusEffect -- the refocus guard cannot exist without it');
  });

  test('a useFocusEffect refreshes the data and closes every sheet', () => {
    const at = SRC.indexOf('useFocusEffect(useCallback(');
    assert.ok(at >= 0, 'the refocus guard is gone from app/measure.tsx');
    const body = SRC.slice(at, at + 400);
    assert.ok(body.includes('refresh()'),
      'the refocus guard no longer refreshes the reading list -- it can show stale ' +
      'data after a restore or erase done elsewhere');
    for (const setter of ['setAdding(null)', 'setOpen(null)', 'setRemoving(null)',
                          'setTargeting(null)', 'setClearing(null)']) {
      assert.ok(body.includes(setter),
        `the refocus guard no longer clears ${setter} -- a stale sheet can survive a ` +
        'trip away from this screen');
    }
  });
});

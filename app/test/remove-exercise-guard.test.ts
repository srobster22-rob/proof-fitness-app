import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.join(HERE, '..', ...p.split('/')), 'utf8');

/*
 * R390: measured live. Two real pointerdown/mousedown/pointerup/mouseup/
 * click sequences at the exercise picker's × (remove) button, at the same
 * screen coordinates with no gap between them, land on the same pre-render
 * DOM node — the row has not disappeared yet to take the second tap's target
 * away. `repo.removeExercise`'s own guard makes the second call harmless to
 * the DATA (it correctly finds the row already gone and returns false), but
 * the UI could not distinguish "already removed" from "refused because it
 * has sets logged", and showed "Can't remove it — it already has sets
 * logged" for an exercise the first tap had just removed successfully. Real
 * evidence: seeded a removable custom exercise, dispatched the double-click,
 * and the false error text appeared on screen even though the exercise was
 * genuinely gone.
 */
describe('the exercise-removal × does not show a false error on a same-tick double tap', () => {
  const src = read('src/ui/NowScreen.tsx');

  test('a synchronous per-id guard sits before onRemove is ever called', () => {
    assert.match(src, /const removedIds = useRef\(new Set<string>\(\)\);/,
      'no guard — a same-tick second tap reaches onRemove and can show the wrong error');
    assert.match(src, /if \(removedIds\.current\.has\(ex\.id\)\) return;/);
    assert.match(src, /if \(ok\) removedIds\.current\.add\(ex\.id\);/,
      'only a SUCCESSFUL removal should be remembered — a refused one (real sets logged) must still be retryable after fixing the reason, not permanently silenced');
  });
});

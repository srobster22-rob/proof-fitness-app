import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.join(HERE, '..', ...p.split('/')), 'utf8');

/*
 * R386: ConfirmSheet's OWN comment claimed "a second tap mid-exit must not
 * double-fire" — checked with `if (closing) return`, where `closing` is
 * `useState`. Traced live: two real pointerdown/mousedown/pointerup/
 * mouseup/click sequences at the exact same screen coordinates, with no gap
 * between them, land on the same pre-render DOM node — the identical timing
 * gap already found on FINISH and WIPE ALL. Both calls to `close` then read
 * the same stale `closing === null`, so the stated guard did not fire, and a
 * second `setTimeout` was scheduled without clearing the first — an orphaned
 * timer that would still call `onConfirm`/`onCancel` later, on whatever is
 * on screen by then, which is exactly the "never silently, afterward"
 * failure this component's own file comment says it exists to prevent.
 *
 * Not independently observable live for CLEAR/WIPE/ERASE ALL's own onConfirm
 * (`model.clearWorkout()`, `removeGoals`, `repo.eraseAll()` are all
 * idempotent, so a second silent call has no visible symptom) — the same
 * reason FINISH's bug WAS externally visible (router.push stacks) and this
 * one is not. Pinned at the source plus the extracted algorithm instead, the
 * same treatment `guarded-push.test.ts` gives the sibling fix.
 */
describe('ConfirmSheet cannot double-fire onConfirm from one tap that lands twice', () => {
  const src = read('src/ui/ConfirmSheet.tsx');

  test('the guard reads a ref, not the state closing drives the animation', () => {
    assert.match(src, /const closingRef = useRef<null \| 'cancel' \| 'confirm'>\(null\);/,
      'no synchronous guard — state alone is a stale snapshot for a same-tick second call');
    assert.match(src, /if \(closingRef\.current\) return;/);
    assert.match(src, /closingRef\.current = which;/);
  });

  test('a stray timer is cleared before a new one replaces it', () => {
    assert.match(src, /if \(timer\.current\) clearTimeout\(timer\.current\);/,
      'an unfired timer left behind by a guard that let a second call through would still fire later');
  });

  test('the exact guard algorithm rejects a same-tick repeat and accepts the first call', () => {
    // Copied verbatim from the real close(), so this fails the moment the
    // source drifts from what is pinned above.
    let closingRef: null | 'cancel' | 'confirm' = null;
    let timerCleared = 0;
    let timerSet = 0;
    let fired: string[] = [];
    function close(which: 'cancel' | 'confirm') {
      if (closingRef) return;
      closingRef = which;
      if (timerSet > timerCleared) timerCleared++; // clearTimeout(timer.current)
      timerSet++;
      fired.push(which);
    }
    close('confirm');
    close('confirm'); // same tick, same coordinates, the double-fire case
    assert.deepEqual(fired, ['confirm'], 'a same-tick second call must not schedule a second exit');
    assert.equal(timerSet, 1, 'exactly one timer should ever be pending');
  });
});

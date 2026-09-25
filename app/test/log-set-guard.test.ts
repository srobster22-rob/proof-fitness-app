import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowScreenSource } from './helpers/now-screen.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.join(HERE, '..', ...p.split('/')), 'utf8');

/*
 * R419: measured live. LOG SET is the one button in the app that is SUPPOSED
 * to do something new every real press — model.log() mints a fresh id with
 * no dedup, unlike FINISH/SAVE/DELETE, which are idempotent by construction
 * and needed no guard at all. That made it the one place a plain 600ms
 * cooldown (guarded-push.ts) would be wrong: a real second set logged a
 * second after the first must still land. What must not land is two events
 * from the SAME physical tap. Dispatched two real pointerdown/mousedown/
 * pointerup/mouseup/click sequences at LOG SET's own coordinates with no gap:
 * before the fix, "3 sets" became "4 sets" from ONE tap. After the fix, the
 * same double-dispatch left the count at "4 sets" (one new set, not two), and
 * a THIRD dispatch sent seconds later (outside the window) correctly added a
 * fifth — confirming the guard blocks only the same-tick duplicate, not
 * legitimate rapid re-presses.
 *
 * The guard clears on setTimeout, not requestAnimationFrame — tried rAF
 * first and it looked identical in source, but rAF never fires while the
 * screen isn't compositing (backgrounded, mid-transition), which would leave
 * LOG SET permanently dead until the next paint. Reproduced live: with the
 * rAF version, the button stopped responding to ANY tap, real or duplicate,
 * the moment the tab went to the background, and stayed dead after
 * re-foregrounding until something else happened to trigger a frame.
 * setTimeout clears on a real clock instead, the same choice every other
 * guard in this file (useGuardedPush, useGuardedLeave, useExitOnce) already
 * made — this one had briefly drifted from that convention.
 */
describe('LOG SET does not log twice from one same-tick double-fired tap', () => {
  const src = nowScreenSource();

  test('a synchronous ref guard sits before model.log() is ever called', () => {
    assert.match(src, /const loggingRef = useRef\(false\);/,
      'no guard — a same-tick second tap reaches model.log() and logs a phantom duplicate set');
    assert.match(src, /if \(loggingRef\.current\) return;/);
    assert.match(src, /loggingRef\.current = true;/);
  });

  test('the guard clears on a real clock, not requestAnimationFrame', () => {
    assert.match(src, /setTimeout\(\(\) => \{ loggingRef\.current = false; \}, 50\);/,
      'rAF never fires while the screen is not compositing, which can leave LOG SET permanently unresponsive');
    assert.doesNotMatch(
      src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''),
      /requestAnimationFrame\(\(\) => \{ loggingRef/,
      'the rAF-cleared version was tried and rejected — it must not come back'
    );
  });
});

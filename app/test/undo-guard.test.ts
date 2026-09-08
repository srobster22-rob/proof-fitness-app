import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.join(HERE, '..', ...p.split('/')), 'utf8');

/*
 * R419 continued: the sibling to log-set-guard.test.ts, same double-tap class,
 * found by asking what else re-derives "the current last thing" on every call
 * the way model.log() mints a fresh id on every call. model.undo() in
 * now-model.ts re-queries setsInSession() and deletes whatever set is LAST at
 * that moment — so two same-tick taps on UNDO delete the two most recent
 * sets, not one. Live evidence: with 5 sets logged, a real same-tick double
 * pointerdown/mousedown/pointerup/mouseup/click on UNDO's own coordinates
 * dropped the count straight to 3, taking two real sets for one physical tap.
 * After the fix the identical double-dispatch left the count at one fewer,
 * not two.
 */
describe('UNDO does not remove two sets from one same-tick double-fired tap', () => {
  const src = read('src/ui/NowScreen.tsx');

  test('a synchronous ref guard sits before model.undo() is ever called', () => {
    assert.match(src, /const undoingRef = useRef\(false\);/,
      'no guard — a same-tick second tap reaches model.undo() and deletes a second, unintended set');
    assert.match(src, /if \(undoingRef\.current\) return;/);
    assert.match(src, /undoingRef\.current = true;/);
    assert.match(src, /setTimeout\(\(\) => \{ undoingRef\.current = false; \}, 50\);/,
      'must clear on a real clock, not requestAnimationFrame — see log-set-guard.test.ts for why');
  });

  test('the guard sits between onPress and model.undo, not after', () => {
    const m = src.match(/onPress=\{\(\) => \{\s*if \(undoingRef\.current\) return;[\s\S]{0,200}?model\.undo\(lift\.exerciseId\);/);
    assert.ok(m, 'the guard must run before model.undo, not merely exist somewhere in the file');
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slop, TARGET } from '../src/ui/target.ts';
import { HIT } from '../src/ui/now-model.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.join(HERE, '..', ...p.split('/')), 'utf8');

/*
 * Measured on the running app at 390x844, against the app's OWN rule rather
 * than Apple's: §4 asks for 56px targets, "for a sweaty thumb, one-handed".
 *
 * The layout honours it — `layoutFor` floors half its measurements at `HIT` —
 * and the individual controls did not. The logged-set chips and UNDO are 36
 * tall, the add-a-set + is 34, and CLEAR and **FINISH**, the control that ends
 * a workout, are 40. None of the five carried any slop at all.
 */
describe('everything you tap is big enough to tap', () => {
  test('the rule is the app’s own, not a second opinion', () => {
    assert.equal(TARGET, HIT, 'two minimums is no minimum');
  });

  test('a short control is grown to the minimum', () => {
    assert.deepEqual(slop(40), { top: 8, bottom: 8, left: 8, right: 8 });
    assert.deepEqual(slop(34), { top: 11, bottom: 11, left: 11, right: 11 });
  });

  test('and one that is already big enough is left alone', () => {
    assert.deepEqual(slop(72), { top: 0, bottom: 0, left: 0, right: 0 });
  });

  /*
   * The half that matters, and the reason this is a function rather than a
   * number typed at each site.
   *
   * The ±45 buttons are 40px boxes drawn 14px apart and carried a flat
   * `hitSlop={14}`, so their touchable regions overlapped across the ENTIRE
   * gap between them. An overlapped region is not a bigger target, it is an
   * ambiguous one — and on that row the two answers are "take 45 off the bar"
   * and "put 45 on".
   */
  test('horizontal slop never reaches its neighbour', () => {
    const gap = 14;
    const s = slop(40, gap);
    assert.ok(s.left + s.right < gap,
      `two ${s.left}px regions across a ${gap}px gap overlap`);
    assert.equal(s.top, 8, 'the vertical axis is still taken to the minimum');
  });

  test('a tight pair gets what the gap allows and no more', () => {
    // UNDO and + sit 6px apart. 2 each side is all there is.
    const s = slop(36, 6);
    assert.equal(s.left, 2);
    assert.ok(s.left * 2 < 6);
    assert.equal(s.top, 10, 'and the height is still fixed');
  });

  test('shoulder to shoulder means no horizontal growth at all', () => {
    assert.equal(slop(36, 1).left, 0);
  });

  /*
   * The five that were found. Named individually rather than swept, because a
   * sweep over `.tsx` cannot know a control's drawn height and would either
   * miss these or flag every Pressable in the app.
   */
  const SITES: Array<[string, RegExp]> = [
    ['the logged-set chip', /hitSlop=\{slop\(36, 14\)\}/],
    ['UNDO', /hitSlop=\{slop\(36, 6\)\}/],
    ['add another set', /hitSlop=\{slop\(34, 6\)\}/],
    ['CLEAR', /hitSlop=\{slop\(40, 12\)\}[\s\S]{0,120}T\('clearWorkoutA11y'\)/],
    ['the jump buttons', /hitSlop=\{slop\(40, 14\)\}/],
    /*
     * The sixth, found by MEASURING rather than reading — §4 calls ≥44pt an
     * acceptance criterion, and nothing had ever checked one. The equipment tag
     * draws 22pt tall and carried a flat `hitSlop={10}`, so its real target was
     * 42pt: under the floor, on the logging path, and invisible to a source
     * sweep because a sweep cannot know a control's drawn height. It sits alone
     * on its row, so it takes the symmetric form with no gap argument.
     */
    ['the equipment tag', /hitSlop=\{slop\(22\)\}/],
    /*
     * The seventh, found the same way as the sixth — not by sweeping the
     * source, but by applying this file's own rule to a control added
     * afterward (R308's exercise-removal ×) rather than assuming a new
     * Pressable had inherited it. Drawn at ~26pt, same shape as the
     * equipment tag: alone on its row's trailing edge, no fixed neighbour
     * gap to respect.
     */
    ['the exercise-removal ×', /hitSlop=\{slop\(26\)\}/]
  ];

  for (const [name, re] of SITES) {
    test(`${name} carries it`, () => {
      assert.match(read('src/ui/NowScreen.tsx'), re);
    });
  }
  /*
   * A sweep for flat `hitSlop={n}` was tried here and removed.
   *
   * The reasoning was that a bare number knows nothing about how tall the thing
   * it pads actually is — which is true, and is how the equipment tag ended up
   * at 42pt. But it flags the "don't ask again" checkbox too, and that one is
   * fine: `paddingVertical: 16` around a 20pt box already draws 52pt before any
   * slop. So the sweep reports a control that passes, which is the failure mode
   * this file's own note at the top describes — a sweep over `.tsx` cannot know
   * a control's drawn height, and one that guesses is worse than the named list
   * it would replace. The sixth site was found by MEASURING the running app,
   * which is the only thing that can find the seventh.
   */


  test('FINISH carries it, which is the one that would hurt', () => {
    const src = read('src/ui/NowScreen.tsx');
    const at = src.indexOf('model.finish(); sync(); onFinish?.();');
    assert.notEqual(at, -1, 'the finish handler moved');
    assert.match(src.slice(at - 1600, at), /hitSlop=\{slop\(40, 12\)\}/);
  });
});

/*
 * Measured on the running app: two real pointerdown/mouseup/click sequences
 * dispatched at FINISH's own screen coordinates, with no gap between them,
 * both land on the SAME pre-render DOM node — React had not yet repainted —
 * so `onFinish?.()` (a bare `router.push('/recap')`, no guard of its own) ran
 * twice. Two recap routes landed on the stack; DONE needed two taps to
 * actually leave, and the second tap dropped onto a screen that had rolled a
 * third session over underneath it. A source test because the guard is a
 * `useRef` living in the component — nothing a domain-model test can reach.
 */
describe('FINISH cannot push the recap route twice from one tap that lands twice', () => {
  const src = read('src/ui/NowScreen.tsx');

  test('a synchronous guard sits between the tap and the push', () => {
    const at = src.indexOf('model.finish(); sync(); onFinish?.();');
    assert.notEqual(at, -1, 'the finish handler moved');
    const before = src.slice(Math.max(0, at - 500), at);
    assert.match(before, /if \(finishedRef\.current\) return;/,
      'no guard — a double-fire on this same-tick click pushes /recap twice');
    assert.match(before, /finishedRef\.current = true;/);
  });

  test('the guard is a ref, not state — state cannot be read synchronously enough', () => {
    assert.match(src, /const finishedRef = useRef\(false\);/);
  });

  test('a fresh workout can still finish — the guard resets on the focus effect that rolls one over', () => {
    const at = src.indexOf('model.startNextIfFinished();');
    assert.notEqual(at, -1);
    assert.match(src.slice(at, at + 300), /finishedRef\.current = false;/,
      'if this never resets, EVERY workout after the first one silently loses its FINISH button\'s effect');
  });
});

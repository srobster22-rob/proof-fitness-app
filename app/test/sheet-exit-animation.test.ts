import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, ...p.split('/')), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

/*
 * A Modal is unmounted by React the instant its caller stops rendering it —
 * there is no "about to close" moment for CSS to animate through unless the
 * CALLER keeps the component mounted a little longer. `ScreenModal`'s
 * entrance already worked this way for the same reason (§ its own file
 * comment); this round gave it a matching `exiting` prop and picked
 * `ConfirmSheet` as the one caller to wire it into, since it is the simplest
 * sheet and used from eight call sites, none of which had to change.
 *
 * `exitMs` itself is not imported and unit-tested directly — every `.tsx`
 * file in this app renders JSX, and this suite runs under plain `node --test`
 * with no JSX loader (`npm test` reads UI source as text everywhere else, via
 * `readFileSync`, never `import`). Read from source instead, matched against
 * the literal durations `ScreenModal`'s own CSS transition uses, so the two
 * cannot drift without a test noticing.
 */
describe('ScreenModal knows how long its own transition takes', () => {
  test('exitMs returns the exact durations the CSS transition uses', () => {
    const src = code(read('src/ui/ScreenModal.tsx'));
    assert.match(src, /reducedMotion \? 110 : 220/,
      'exitMs and the CSS transitionDuration must read the same two numbers');
    assert.match(src, /transitionDuration: `\$\{exitMs\(still\)\}ms`/,
      'the CSS duration has to be COMPUTED from exitMs, not a second hand-typed copy of it');
  });
});

describe('ConfirmSheet fades and rises out instead of teleporting away', () => {
  const src = code(read('src/ui/ConfirmSheet.tsx'));

  test('a tap sets local state rather than calling the real callback straight away', () => {
    assert.doesNotMatch(src, /onPress=\{onCancel\}/,
      'cancel still fires immediately, with no exit to animate through');
    assert.doesNotMatch(src, /onPress=\{onConfirm\}/,
      'confirm still fires immediately, with no exit to animate through');
    assert.match(src, /setClosing\(which\)/);
  });

  test('the deferred call uses the same duration ScreenModal transitions over', () => {
    assert.match(src, /setTimeout\(\(\) => \(which === 'cancel' \? onCancel\(\) : onConfirm\(\)\), exitMs\(still\)\)/,
      'a hand-picked delay here would drift from the CSS transition it is supposed to outlast');
  });

  test('ScreenModal is told to animate out, not just told the sheet is still visible', () => {
    assert.match(src, /exiting=\{closing !== null\}/);
  });

  /*
   * The correctness half. `onConfirm` is `eraseAll`/`wipe` — a database
   * mutation — so a timer that outlives the component and fires anyway would
   * run a destructive action after the screen that warned about it is gone.
   */
  test('unmounting mid-exit cancels the pending action rather than deferring it further', () => {
    assert.match(src, /useEffect\(\(\) => \(\) => \{ if \(timer\.current\) clearTimeout\(timer\.current\); \}, \[\]\)/,
      'no cleanup means a confirm tap right before navigating away still fires the mutation late');
  });

  /*
   * R386: this test's own name was the claim, and it was false. `closing` is
   * `useState`, a snapshot from the last render — two real
   * pointerdown/mousedown/pointerup/mouseup/click sequences dispatched at
   * the same screen coordinates with no gap between them (measured live)
   * land on the same pre-render DOM node, so both calls to `close` read the
   * same stale `closing === null` and BOTH pass `if (closing) return`. The
   * check this test pinned was never fast enough to catch the case it is
   * named for. See test/confirm-sheet.test.ts for the fix and the live trace.
   */
  test('a second tap mid-exit cannot double-fire or restart the clock', () => {
    assert.match(src, /if \(closingRef\.current\) return;/,
      'state alone cannot see a same-tick second call coming — see test/confirm-sheet.test.ts');
  });
});

/*
 * The second sheet wired into the pattern. Simpler than ConfirmSheet in one
 * way that mattered for the design: `save()` commits the jump-amount prefs to
 * the repo BEFORE calling `close()`, so delaying the close only defers the
 * animation and the parent's refresh — never a write. There is no equivalent
 * of ConfirmSheet's "onConfirm IS the mutation" risk here, which is why this
 * one needed the unmount-cancel guard for tidiness (no dangling timer / no
 * setState-after-unmount) rather than for correctness.
 */
/*
 * `SettingsSheet` had a block here until R232 deleted the file. It was the
 * jump-amounts sheet from when §9 still banned a settings SCREEN; the owner
 * overruled that and the full screen replaced it, but the sheet survived as a
 * second control labelled SETTINGS showing different things. `ConfirmSheet`
 * above is now the only sheet with an exit to check.
 */

/*
 * The third sheet, and the one with no local `visible` flag at all —
 * `dayOpen` at the call site is derived straight from `state.dayAsked`, so
 * there was nothing to defer at the OUTER layer. Deferring the CALL to
 * `onSkip`/`onPickDay` instead — rather than the derived flag — keeps the
 * model unchanged (and the derived flag therefore still true) for the whole
 * animation, which is the same trick as the other two sheets from a
 * different angle: whichever piece of state the caller reads to decide
 * whether to render gets left alone until the timer lands.
 */
describe('DayChooser fades and rises out too, without a visible flag to defer', () => {
  const src = code(read('src/ui/NowScreen.tsx'));
  const chooser = region(src, 'function DayChooser', 'function ExercisePicker');

  test('both ways out — skip and picking a day — go through the same deferred leave', () => {
    assert.doesNotMatch(chooser, /onPress=\{onSkip\}/, 'a direct call skips the exit');
    assert.doesNotMatch(chooser, /onPress=\{\(\) => onPickDay\(d\)\}/);
    assert.match(chooser, /const skip = \(\) => leave\(onSkip\);/);
    assert.match(chooser, /const pickDay = \(d: PlanDay\) => leave\(\(\) => onPickDay\(d\)\);/);
  });

  test('choosing a plan does not leave the sheet, so it is not wrapped', () => {
    // The split step and the day step are one sheet with two internal states
    // — picking a plan just flips `choosingPlan`, it never unmounts anything,
    // so wrapping it in the exit machinery would be animating a step that
    // never actually closes.
    assert.match(chooser, /onPress=\{\(\) => \{ onPickPlan\(p\); setChoosingPlan\(false\); \}\}/);
  });

  test('ScreenModal is told to animate out', () => {
    assert.match(chooser, /exiting=\{closing\}/);
  });
});

/*
 * The fourth sheet, and the shape closest to ConfirmSheet: three exits
 * (close, save, remove), none needing a synchronous answer back the way
 * ExercisePicker's `onAdd` does, so each one wraps cleanly.
 */
describe('EditSetSheet fades and rises out on all three of its exits', () => {
  const src = code(read('src/ui/NowScreen.tsx'));
  const sheet = region(src, 'function EditSetSheet', 'function EquipmentSheet');

  test('close, save and remove all go through the same deferred leave', () => {
    assert.doesNotMatch(sheet, /onPress=\{onClose\}/);
    assert.doesNotMatch(sheet, /onPress=\{onRemove\}/);
    assert.match(sheet, /const close = \(\) => leave\(onClose\);/);
    assert.match(sheet, /const save = \(patch: \{ weight: number; reps: number; note: string \| null \}\) => leave\(\(\) => onSave\(patch\)\);/);
    assert.match(sheet, /const remove = onRemove \? \(\) => leave\(onRemove\) : undefined;/);
  });

  test('ScreenModal is told to animate out', () => {
    assert.match(sheet, /exiting=\{closing\}/);
  });
});

/*
 * The fifth sheet, and the one with the widest mix of exits: `onPick` closes
 * (six call sites — barbell, dumbbell, a known machine chip, the machine-name
 * field's return key, "don't ask again", and CLEAR), while `onApply` and
 * `onSkipMachine` never close at all — they land a value and keep the
 * machine-name step open, the same "internal step, not an exit" shape
 * `DayChooser`'s `onPickPlan` already established. Only the closing half
 * needed wrapping.
 */
describe('EquipmentSheet fades and rises out on every one of its six closing chips', () => {
  const src = code(read('src/ui/NowScreen.tsx'));
  const sheet = region(src, 'function EquipmentSheet', 'function Jump');

  test('every call that closes goes through pick(), not onPick() directly', () => {
    // Exactly one `onPick(` call site should remain: inside `pick` itself.
    // Any JSX handler still calling `onPick(` directly would skip the exit.
    const calls = sheet.match(/\bonPick\(/g) ?? [];
    assert.equal(calls.length, 1, `expected onPick( called once (inside pick()), found ${calls.length}`);
    assert.match(sheet, /const pick = \(k: Equipment \| null, m\?: string\) => leave\(\(\) => onPick\(k, m\)\);/);
  });

  test('onApply and onSkipMachine are untouched — they never close the sheet', () => {
    assert.match(sheet, /onApply\(e, machine\);/, 'machine must still keep the sheet open for its name');
    assert.match(sheet, /onSkipMachine\(false\); return; \}/);
  });

  test('ScreenModal is told to animate out', () => {
    assert.match(sheet, /exiting=\{closing\}/);
  });
});

/*
 * The sixth and last sheet — the one R170 skipped because `onAdd` returns a
 * boolean the component needs SYNCHRONOUSLY to decide whether to reset its
 * own add-exercise form. The unlock: `addCustomExercise` (the domain function
 * behind `onAdd`) only ever returns falsy for a BLANK name, and the submit
 * button is already `disabled={!name.trim()}` — so guarding `submit()` on
 * the same condition before deferring means the deferred call can be
 * unconditional. Nothing here reads `onAdd`'s answer back at all any more.
 */
describe('ExercisePicker fades and rises out, including the add-a-movement path', () => {
  const src = code(read('src/ui/NowScreen.tsx'));
  const sheet = region(src, 'function ExercisePicker', 'function EquipmentSheet');

  test('picking a lift and submitting a new one both go through the deferred leave', () => {
    assert.doesNotMatch(sheet, /onPress=\{\(\) => onPick\(ex\.id\)\}/);
    assert.match(sheet, /const pick = \(id: string\) => leave\(\(\) => onPick\(id\)\);/);
    assert.match(sheet, /const submit = \(\) => \{ if \(name\.trim\(\)\) leave\(\(\) => onAdd\(name\)\); \};/,
      'the blank-name guard has to run BEFORE leave(), not inside the deferred call');
  });

  test('ScreenModal is told to animate out', () => {
    assert.match(sheet, /exiting=\{closing\}/);
  });
});

describe("ScreenModal's exit style mirrors its entrance", () => {
  const src = code(read('src/ui/ScreenModal.tsx'));

  test('exiting reuses the same hidden style entering already computes', () => {
    // One branch for both, not two copies of the same opacity/transform pair
    // that could drift apart the next time either is tuned.
    assert.match(src, /entering \|\| exiting/);
  });

  test('the exiting prop is stripped before reaching the real Modal', () => {
    assert.match(src, /const \{ exiting, \.\.\.modalProps \} = props;/,
      'passing `exiting` straight through to <Modal> would land on an unknown DOM/native prop');
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { region, around } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.join(HERE, '..', ...p.split('/')), 'utf8');

/*
 * "Everything erased." is the most alarming sentence this app can print, and
 * for a while it printed on a tap that erased nothing.
 *
 * The settings sheet was mounted with `onClose={() => { setSettings(false);
 * onErased(); }}`, and `onErased` is `buzz.destroyed()` plus the message plus a
 * refresh. So dismissing settings with the backdrop — changing nothing, saving
 * nothing — fired the heavy destructive haptic and told the user their entire
 * training log had just been deleted, on the one screen whose whole job is to
 * reassure them about their data.
 *
 * The refresh was all that was ever wanted. It arrived attached to an
 * announcement, because one callback was carrying two meanings.
 *
 * These are source tests because the claim lives in a `.tsx` that no Node test
 * can render. They read the file the same way `accent.test.ts` does.
 */
describe('the app only claims to have erased when it erased', () => {
  const src = read('app/progress.tsx');

  test('the destructive announcement has exactly one caller', () => {
    // `onErased()` — the call, not the prop declaration or the JSX binding.
    const calls = [...src.matchAll(/onErased\(\)/g)].length;
    assert.equal(calls, 1,
      'more than one path fires the "Everything erased." message, and only ' +
      'repo.eraseAll() has earned it');
  });

  test('and that caller is the one that actually erases', () => {
    // The label goes through the translation table now, so the anchor moves to
    // the key. What is guarded is unchanged: the erase confirmation must be
    // what calls `onErased`.
    const confirm = region(src, "confirmLabel={T('eraseLabel')}", '/>');
    assert.match(confirm, /repo\.eraseAll\(\)/,
      'the erase confirmation must be what calls it');
    assert.match(confirm, /onErased\(\)/);
  });

  /*
   * The Settings control must not be able to reach the erase path.
   *
   * It used to open `SettingsSheet` over Progress and the guard was that
   * dismissing it called `onChanged` and never `onErased` — a sheet that writes
   * only preferences must not announce a loss. R232 deleted that sheet (the
   * owner's overrule replaced it with the Settings SCREEN, and it had survived
   * as a second control labelled SETTINGS showing different things), so the
   * control now navigates. The rule is the same and the shape is simpler:
   * going to Settings destroys nothing, so it cannot say anything was
   * destroyed.
   */
  test('opening settings destroys nothing and claims nothing', () => {
    const control = around(src, 'onPress={onSettings}', 200, 200);
    assert.doesNotMatch(control, /onErased/,
      'the settings control can reach the erase path');
    // R649: Settings is reached through goTab, not pushed over Progress, so a
    // round trip no longer stacks copies of either screen.
    assert.match(src, /onSettings=\{\(\) => goTab\(router, 'settings'\)\}/,
      'the control no longer goes to the one Settings');
  });

  /*
   * The other half of the rule: `onChanged` must stay silent. If somebody later
   * gives it a message it becomes the same bug wearing a different name.
   */
  test('the quiet callback is quiet', () => {
    for (const m of src.matchAll(/onChanged=\{([^}]*(?:\}[^}]*)?)\}/g)) {
      assert.doesNotMatch(m[1], /buzz\.|setNote/,
        `onChanged fired a message or a haptic: ${m[1]}`);
      assert.match(m[1], /setTick/, 'onChanged exists to re-read, so it must');
    }
  });

  /*
   * `buzz.destroyed` is the heaviest haptic the app owns. haptics.ts reserves
   * it for data that is gone; anything else using it is crying wolf by touch,
   * which is worse than by text because there is no wording to soften it.
   */
  test('the heaviest haptic is spent only on real destruction', () => {
    // Both `<Backup>` call sites declare the same `onErased`, and only one is
    // mounted at a time — so counting declarations against erasures is the
    // wrong shape. What matters is that no `buzz.destroyed()` sits anywhere
    // ELSE: on this screen the only thing that destroys is the erase confirm,
    // which reaches the haptic through `onErased`.
    const stray = [...src.matchAll(/buzz\.destroyed\(\)/g)]
      .map(m => src.slice(Math.max(0, m.index! - 140), m.index!))
      .filter(before => !/onErased=\{/.test(before));
    assert.deepEqual(stray, [],
      'a destructive haptic fires outside the erase path');
  });

  /*
   * `eraseBody` says "this cannot be undone" — the one destructive claim in
   * the app with no restore anywhere behind it, unlike WIPE ALL and CLEAR,
   * both of which keep what they removed so UNDO can hand it back. Confirmed
   * from the other end too: `repo.eraseAll()` (src/data/repo.ts) is four
   * hard `DELETE FROM` statements with nothing captured first — there is
   * no snapshot for an undo to restore even if one existed.
   */
  test('the erase screen offers no undo — the claim has nothing standing behind it', () => {
    assert.doesNotMatch(src, /setUndo|undoBar|restoreGoals|repo\.saveGoal\(/,
      'progress.tsx has something that looks like an undo path near the erase control, ' +
      'which would make "this cannot be undone" false');
  });
});

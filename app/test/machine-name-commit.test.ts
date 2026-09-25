import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { around } from './helpers/source.ts';
import { nowScreenSource } from './helpers/now-screen.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const SCREEN = nowScreenSource();
const T0 = Date.UTC(2026, 8, 9, 12);

/*
 * R557. Walking the equipment picker turned up no defect in the model — the
 * colon in a machine name, a blank name, and switching kit are all already
 * covered — but one behaviour is a DECISION nothing pins: the typed machine
 * name commits on Return and on nothing else, so dismissing the sheet keeps the
 * kit and drops the name.
 *
 * That is filed for the owner rather than changed, for a reason worth stating:
 * the fix is one line, and focus events are not delivered to the preview pane
 * (HANDOFF trap 17), so it could not be verified in the product. An
 * unverifiable change does not ship.
 *
 * These pin the two halves that ARE checkable — that the model saves whatever
 * it is given, and that the screen still has exactly one commit path — so the
 * filing cannot go stale without something failing.
 */
describe('the machine name has one commit path, and the model keeps what it gets (R557)', () => {
  function onLateral(): NowModel {
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
    const m = new NowModel(repo, () => T0, 'en-US');
    m.selectExercise('lateral');
    return m;
  }

  test('the model persists a machine name across a fresh launch', () => {
    /*
     * The existing tests re-select an exercise on the SAME model. A relaunch is
     * what the product does every morning, and it reads the pref back through a
     * different code path.
     */
    const m = onLateral();
    m.setEquipment('machine', 'Hammer Strength: Iso Row');
    const repo = (m as unknown as { repo: Repo }).repo;
    assert.equal(repo.getPref('kit.lateral'), 'machine:Hammer Strength: Iso Row');

    const fresh = new NowModel(repo, () => T0, 'en-US');
    fresh.selectExercise('lateral');
    assert.equal(fresh.state().machine, 'Hammer Strength: Iso Row',
      'a relaunch lost the machine name, or truncated it at the separator');
    assert.equal(fresh.state().equipment, 'machine');
  });

  /*
   * R642: the owner answered R557 -- "save the machine name on tap away". So
   * this no longer pins ONE commit path; it pins all three: Return (commit and
   * close), losing focus (commit, stay), and dismissing the sheet (commit,
   * close) -- the last two only when the name changed.
   */
  test('the name commits on Return, on losing focus, and on dismissing the sheet', () => {
    /*
     * If a second commit path appears — an onBlur, a save button — the owner
     * filing in OWNER.md is answered and should be removed rather than left
     * describing behaviour the app no longer has.
     */
    /*
     * `around`, not slice(indexOf(...)). The repo has a gate against the bare
     * form and it caught this test on its first FULL run: `indexOf` returns -1
     * when an anchor moves and `slice` does not throw, so the region silently
     * becomes the wrong text and every assertion inside it reads something
     * else. `around` throws instead. Sixth blind instrument this session, and
     * the first one a gate caught before I did.
     *
     * Anchored on the PLACEHOLDER, which appears once. Anchoring on
     * `onSubmitEditing=` picked the first match — the typed-weight field, six
     * hundred lines away, which legitimately has an `onBlur` — so the test read
     * the wrong control and failed. Loudly, which is the difference the helper
     * buys: the bare form would have passed while reading nothing relevant.
     */
    const field = around(SCREEN, 'machineNamePlaceholder', 700, 200);
    assert.match(field, /onSubmitEditing=\{\(\) => pick\('machine', machine\)\}/,
      'Return is no longer the commit for the machine name');
    assert.match(field, /onBlur=\{keepName\}/,
      'tapping away from the machine field drops the typed name again');
    assert.match(SCREEN, /const close = \(\) => \{ keepName\(\); leave\(onClose\); \};/,
      'dismissing the equipment sheet no longer keeps the typed name');
    assert.match(SCREEN,
      /kit === 'machine' && machine\.trim\(\) !== \(state\.machine \?\? ''\)\) onApply\('machine', machine\)/,
      'keepName records on every blur, or outside the machine step');
  });

  test('the owner\'s answer is recorded, and the filing is closed', () => {
    const owner = fs.readFileSync(path.join(APP, '..', 'OWNER.md'), 'utf8');
    assert.match(owner, /Machine name saves on tap away -- SHIPPED R642/,
      'the answered decision is not in the Done list of OWNER.md');
    assert.doesNotMatch(owner, /FILED R557/,
      'the R557 filing is still open in OWNER.md after the owner answered it');
  });
});

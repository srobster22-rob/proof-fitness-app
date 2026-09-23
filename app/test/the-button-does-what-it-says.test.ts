import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { fill, t } from '../src/domain/i18n.ts';
import { around } from './helpers/source.ts';
import type { Unit } from '../src/domain/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODEL_SRC = fs.readFileSync(path.join(HERE, '..', 'src', 'ui', 'now-model.ts'), 'utf8');
const T0 = Date.UTC(2026, 8, 9, 12);

function withJump(jump: string, unit: Unit = 'lb'): NowModel {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  repo.setPref('pref.unit', unit);
  repo.setPref(`jump.${unit}`, jump);
  const m = new NowModel(repo, () => T0, 'en-US');
  m.selectExercise('bench');
  return m;
}

/*
 * R563. Two fixes of mine each caused a defect two rounds later — R548's grid
 * work made a Settings sentence false, R550's snap broke the custom plate jump
 * — and both were found by walking a DIFFERENT screen than the one I changed,
 * by luck rather than by method.
 *
 * The common thread is one promise: the plate button is LABELLED with the jump
 * and its accessible name says "Add 7 lb", while what it actually did was move
 * 5. §16 asks that every number be checkable, and a control that states its own
 * effect is the easiest number in the app to check — the user presses it and
 * watches. It was wrong for two rounds and no test asked.
 */
describe('the plate button moves what its label promises (R563)', () => {
  for (const [unit, jump] of [
    ['lb', '45'], ['lb', '25'], ['lb', '7'], ['lb', '2.5'],
    ['kg', '20'], ['kg', '3'], ['kg', '1.25']
  ] as Array<[Unit, string]>) {
    test(`${unit}: the button says ${jump} and moves ${jump}`, () => {
      const m = withJump(jump, unit);
      const s = m.state();
      // What the screen renders on the button and reads to VoiceOver.
      const label = `+${s.plateJump}`;
      const spoken = fill(t('en', 'addUnit'), { n: s.plateJump, unit: s.session.unit });

      const from = unit === 'lb' ? 135 : 60;   // on-grid, so nothing is rescued
      m.setWeight(from);
      m.bumpPlate(1);
      const moved = m.state().weight - from;

      assert.equal(s.plateJump, Number(jump), 'the model did not take the stored jump');
      assert.equal(label, `+${jump}`, 'the button prints something other than the jump');
      assert.match(spoken, new RegExp(`Add ${jump.replace('.', '\.')} ${unit}`));
      assert.equal(moved, Number(jump),
        `the button says "${spoken}" and moved ${moved}`);
    });
  }

  test('and it still rescues a weight that is off the grid', () => {
    // The other half of R550/R562: the label promises a jump, and from an
    // off-grid start the app deliberately lands on plates instead. That is the
    // one case where the button does not move exactly what it says, and it is
    // the case that gets a lifter back to numbers a rack can make.
    const m = withJump('45');
    m.setWeight(189.5);
    m.bumpPlate(1);
    assert.equal(m.state().weight, 235,
      'an off-grid weight was left off-grid, which is what R550 fixed');
  });

  test('the coach is handed each option exactly once', () => {
    /*
     * R548's edit ran twice and left a duplicate `grid:` key in the call. The
     * value was identical so nothing behaved differently, and the duplicate
     * also pushed R541's comment away from the line it describes — the comment
     * for `base` ended up sitting above `grid`. Invisible in every test and in
     * the product, which is exactly why it survived two rounds.
     */
    // 1400, not 700: R573's fix for the equipment-lookup bug (base:
    // EQUIPMENT_BASE[...]) added a longer explanatory comment ahead of it,
    // which pushed `base:` past the old window and made this test stop
    // seeing it at all -- silently checking three keys instead of four and
    // still reporting green. Widened to the real distance plus headroom.
    // Since R692 the call lives in `coachCall()`, shared by the line and the dial.
    const call = around(MODEL_SRC, 'private coachCall(): Suggestion | null {', 0, 1400);
    for (const key of ['unit:', 'goal:', 'grid:', 'base:']) {
      const times = call.split(key).length - 1;
      assert.equal(times, 1, `the coach call passes ${key} ${times} times`);
    }
  });
});

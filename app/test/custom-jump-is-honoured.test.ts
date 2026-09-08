import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel, WEIGHT_STEP } from '../src/ui/now-model.ts';
import type { Unit } from '../src/domain/types.ts';

const T0 = Date.UTC(2026, 8, 9, 12);

/** Press the plate button once from `from`, with `jump` set in Settings. */
function press(jump: string, from: number, unit: Unit = 'lb', steps = 1): number {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  repo.setPref('pref.unit', unit);
  repo.setPref(`jump.${unit}`, jump);
  const m = new NowModel(repo, () => T0, 'en-US');
  m.selectExercise('bench');
  m.setWeight(from);
  m.bumpPlate(steps);
  return m.state().weight;
}

/*
 * R562, and the defect is mine from R550.
 *
 * That round stopped the plate buttons stranding a lifter off the grid, and did
 * it by rounding EVERY result. Settings lets a lifter set their own plate jump,
 * and a jump that is not a multiple of the grid was then silently overridden:
 * `jump.lb` at 7 moved them 5, `jump.kg` at 3 moved 2.5. Ask for seven, get
 * five, with nothing said.
 *
 * Found by walking Settings and asking what each control is worth — the screen
 * stores the number correctly and the app quietly declined to use it, which is
 * invisible from Settings itself and from the Now screen alike.
 *
 * The two goals only looked opposed. A weight already on the grid plus the
 * lifter's own jump is exactly what they asked for; a weight OFF the grid is
 * the case R550 existed for. Snapping only the second honours both.
 */
describe('a plate jump the lifter set is the jump they get (R562)', () => {
  for (const [unit, jump, from] of [
    ['lb', '7', 135], ['lb', '3', 200], ['kg', '3', 60], ['kg', '1.5', 80]
  ] as Array<[Unit, string, number]>) {
    test(`${unit}: a jump of ${jump} moves ${jump}, not ${WEIGHT_STEP[unit]}`, () => {
      const up = press(jump, from, unit);
      assert.equal(up, from + Number(jump),
        `asked for +${jump} from ${from} and moved to ${up}`);
      const down = press(jump, from, unit, -1);
      assert.equal(down, from - Number(jump), `stripping a plate moved the wrong amount`);
    });
  }

  test('the ordinary jumps are untouched', () => {
    // Every default and every multiple of the grid behaved correctly before and
    // must still: this fix is only allowed to change the non-multiple case.
    for (const [jump, from, expected] of [['45', 135, 180], ['25', 135, 160],
                                          ['2.5', 135, 137.5], ['1.25', 135, 136.25]] as Array<[string, number, number]>) {
      assert.equal(press(jump, from), expected, `a jump of ${jump} from ${from}`);
    }
  });

  test('an off-grid weight is still rescued — R550 is not undone', () => {
    /*
     * The half that must not regress. 189.5 is 86 kg converted, and before
     * R550 every plate press kept the half for ever: 234.5, 279.5, 144.5.
     */
    assert.equal(press('45', 189.5), 235, '+45 from an off-grid weight left it off-grid');
    assert.equal(press('45', 189.5, 'lb', -1), 145, '-45 from an off-grid weight left it off-grid');
  });

  test('and a custom jump still rescues an off-grid weight', () => {
    // Both rules at once: the start is off-grid, so it snaps, even though the
    // jump is the lifter's own. Getting back onto real plates wins there.
    const up = press('7', 189.5);
    assert.equal(up % WEIGHT_STEP.lb, 0,
      `from 189.5 with a jump of 7 the app left ${up}, which is not loadable`);
  });
});

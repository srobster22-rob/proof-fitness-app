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

  test('a jump of 7 keeps moving 7, press after press (R668)', () => {
    /*
     * R562 checked ONE press from 135. The second press is where it broke:
     * 182 is off a 5 lb grid only because of the 7 the lifter asked for, and
     * the off-grid rescue snapped it -- 175 -> 182 -> 190 -> 197 -> 205.
     */
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
    repo.setPref('jump.lb', '7');
    const m = new NowModel(repo, () => T0, 'en-US');
    m.selectExercise('curl');
    m.setWeight(175);
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) { m.bumpPlate(1); seen.push(m.state().weight); }
    assert.deepEqual(seen, [182, 189, 196, 203], `a jump of 7 went ${[175, ...seen].join(' -> ')}`);
    for (let i = 0; i < 4; i++) m.bumpPlate(-1);
    assert.equal(m.state().weight, 175, 'stripping four jumps of 7 did not return to the start');
  });

  test('and the coach climbs by the same 7 (R668)', () => {
    // 175 then 182 on dumbbells that step by 7: the next dumbbell is 189, the
    // + button goes to 189, and the coach must name 189 -- not 190.
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
    repo.setPref('jump.lb', '7');
    [[175, 4], [182, 2]].forEach(([weight, daysAgo], i) => {
      const id = `s${i}`, at = T0 - daysAgo * 86_400_000;
      repo.startSession(id, 'lb', undefined, at);
      for (let k = 0; k < 3; k++) {
        repo.logSet({ id: `${id}x${k}`, sessionId: id, exerciseId: 'curl', weight, reps: 10, at: at + k * 60_000 });
      }
      repo.endSession(id, at + 3_600_000);
    });
    const m = new NowModel(repo, () => T0, 'en-US');
    m.selectExercise('curl');
    const { head, tail } = m.state().lastTime;
    assert.match(`${head}${tail}`, /try 189\b/, `the coach said "${head}${tail}"`);
  });

  test('and a custom jump still rescues an off-grid weight', () => {
    // Both rules at once: the start is off-grid, so it snaps, even though the
    // jump is the lifter's own. Getting back onto real plates wins there.
    const up = press('7', 189.5);
    assert.equal(up % WEIGHT_STEP.lb, 0,
      `from 189.5 with a jump of 7 the app left ${up}, which is not loadable`);
  });
});

/** Bench sessions oldest first as [weight, reps] in `histUnit`, then a model in `sessUnit` with `jump`. */
function lifter(histUnit: Unit, sessions: Array<[number, number]>, sessUnit: Unit, jump: string): NowModel {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  sessions.forEach(([weight, reps], i) => {
    const id = `h${i}`, at = T0 - (2 + 3 * (sessions.length - 1 - i)) * 86_400_000;
    repo.startSession(id, histUnit, undefined, at);
    for (let k = 0; k < 2; k++) {
      repo.logSet({ id: `${id}x${k}`, sessionId: id, exerciseId: 'bench', weight, reps, at: at + k * 60_000 });
    }
    repo.endSession(id, at + 3_600_000);
  });
  repo.setPref('pref.unit', sessUnit);
  repo.setPref(`jump.${sessUnit}`, jump);
  const m = new NowModel(repo, () => T0, 'en-US');
  m.selectExercise('bench');
  return m;
}

const coachSaid = (m: NowModel) => { const { head, tail } = m.state().lastTime; return `${head} ${tail ?? ''}`; };

/*
 * R669, and the defect is mine from R668.
 *
 * R668 judged "on the grid" by the finest weight the stepper and the jump both
 * land on. For a kilo jump that does not divide 2.5 -- 1, 1.5, 2, 3 -- that is
 * 0.5 kg, which is exactly what a converted weight is rounded to, so every
 * conversion passed as the lifter's own and R550's rescue quietly stopped. And
 * the coach, handed the same grid, named numbers no button reaches: "try 178"
 * at a plateau of 175 on dumbbells by 7, where it had said 180.
 *
 * Found by checking R668's own comment ("converted weights land on halves, so
 * 189.5 lb is still off it") in kilos, where it is false.
 */
describe('a conversion is still rescued, and the coach still names reachable weights (R669)', () => {
  test('a bench last logged in pounds is put back on the 2.5 kg grid, whatever the kilo jump', () => {
    for (const [jump, expected] of [['1.5', 85], ['3', 87.5]] as Array<[string, number]>) {
      const m = lifter('lb', [[175, 5], [180, 5], [185, 5]], 'kg', jump);
      assert.equal(m.state().weight, 84, 'fixture: 185 lb should open as 84 kg');
      m.bumpPlate(1);
      assert.equal(m.state().weight, expected,
        `a jump of ${jump} kg from the converted 84 left ${m.state().weight}, off the 2.5 kg grid`);
    }
    const lb = lifter('kg', [[80, 5], [83, 5], [86, 5]], 'lb', '1.5');
    assert.equal(lb.state().weight, 189.5, 'fixture: 86 kg should open as 189.5 lb');
    lb.bumpPlate(1);
    assert.equal(lb.state().weight, 190, `a jump of 1.5 lb from the converted 189.5 left ${lb.state().weight}`);
  });

  test('and a weight reached on their own jump is still theirs: R668 is not undone', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
    repo.setPref('pref.unit', 'kg');
    repo.setPref('jump.kg', '1.5');
    const m = new NowModel(repo, () => T0, 'en-US');
    m.selectExercise('bench');
    m.setWeight(80);
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) { m.bumpPlate(1); seen.push(m.state().weight); }
    assert.deepEqual(seen, [81.5, 83, 84.5], `a jump of 1.5 kg went ${[80, ...seen].join(' -> ')}`);
    const own = lifter('kg', [[80, 8], [81.5, 8], [83, 8]], 'kg', '1.5');
    own.bumpPlate(1);
    assert.equal(own.state().weight, 84.5, 'their own logged 83 was snapped as if it were a conversion');
  });

  test('the coach names a weight a button reaches, not the finest common grid', () => {
    const plateau = coachSaid(lifter('lb', [[175, 8], [175, 8], [175, 8]], 'lb', '7'));
    assert.match(plateau, /try 180(?![\d.])/, `dumbbells by 7, stuck at 175: "${plateau}"`);
    const deload = coachSaid(lifter('lb', [[182, 8], [182, 7], [182, 6]], 'lb', '7'));
    assert.match(deload, /back off to 165(?![\d.])/, `dumbbells by 7, grinding at 182: "${deload}"`);
    const kilos = coachSaid(lifter('kg', [[84, 8], [84, 8], [84, 8]], 'kg', '3'));
    assert.match(kilos, /try 85(?![\d.])/, `a 3 kg jump, stuck at 84: "${kilos}"`);
  });

  test('a climb by whole jumps is still taken as it is -- but not a converted one', () => {
    const climb = coachSaid(lifter('kg', [[80, 8], [81.5, 8], [83, 8]], 'kg', '1.5'));
    assert.match(climb, /try 84\.5(?![\d.])/, `climbing by their 1.5 kg jump: "${climb}"`);
    // 175 -> 182 lb reads as 79.5 -> 82.5 kg: a step of exactly 3 by rounding
    // alone. They never loaded a 3 kg jump, so it is not their plates.
    const converted = lifter('lb', [[175, 10], [182, 10]], 'kg', '3');
    const said = coachSaid(converted);
    assert.match(said, /82\.5 and climbing/, `fixture stopped being a converted climb: "${said}"`);
    assert.match(said, /try 85(?![\d.])/, `a converted climb was taken as a 3 kg jump: "${said}"`);
  });
});

/*
 * R671. R592 rounded the coach to multiples of the lifter's jump counted from
 * ZERO, and the lifter does not stand at zero. With a 1.5 kg jump a plateau at
 * 85 said "try 87": the plate button goes 86.5, 88 and the stepper 87.5, 90, so
 * no button pressed repeatedly could dial it in. 123 of the 608 suggestions in
 * R670's sweep were this shape; the sweep itself is now a test
 * (coach-names-weights-a-button-dials-in).
 */
describe('the coach counts the lifter\'s jumps from where they stand (R671)', () => {
  test('a 1.5 kg plateau at 85 says 86.5 -- one plate press -- not 87', () => {
    const m = lifter('kg', [[85, 8], [85, 8], [85, 8]], 'kg', '1.5');
    const said = coachSaid(m);
    assert.match(said, /try 86\.5(?![\d.])/, `a 1.5 kg jump, stuck at 85: "${said}"`);
    m.bumpPlate(1);
    assert.equal(m.state().weight, 86.5, 'one press of the plate button is not the number the coach named');
  });

  test('a deload lands on their jumps too: 85 on a 2 kg jump backs off to 77', () => {
    const said = coachSaid(lifter('kg', [[85, 8], [85, 7], [85, 6]], 'kg', '2'));
    assert.match(said, /back off to 77(?![\d.])/, `a 2 kg jump, grinding at 85: "${said}"`);
  });

  test('but not from a weight the plate button would snap first', () => {
    // 83 is not a whole number of 1.25s, so +1.25 from it goes to 85, not
    // 84.25. The coach names the stepper's 85, not a jump nothing reaches.
    const said = coachSaid(lifter('kg', [[83, 8], [83, 8], [83, 8]], 'kg', '1.25'));
    assert.match(said, /try 85(?![\d.])/, `a 1.25 kg jump, stuck at an off-lattice 83: "${said}"`);
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import type { Unit } from '../src/domain/types.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 9, 12);
/** Presses of one button before giving up. The furthest real case, a 10% deload on a 1 lb jump, is 18. */
const PRESSES = 40;

/*
 * R671, from the instrument R670 built.
 *
 * R592 promised that "every weight the coach names is one the lifter can reach
 * in the app AND load on the bar", and every test of that promise checked a
 * handful of hand-picked weights. Swept instead -- both units, nineteen plate
 * jumps, two goals, plateau / deload / climbing, native and converted history
 * -- 163 of 608 suggestions were numbers no button could dial in by pressing
 * it: 187.5 lb said "try 190" over a + that went to 195 (R670), and a 1.5 kg
 * jump at 85 said "try 87" between a plate button at 86.5 and a stepper at
 * 87.5 (R671).
 *
 * "Reach" is one button pressed repeatedly, not any mix of buttons: mixing
 * reaches all 608 within eight presses (85 -> 82.5 -> 84 -> 85.5 -> 87), which
 * is true and useless -- nobody told "try 87" works that out mid-set.
 *
 * The jumps here are two of each kind that behaved differently in that sweep
 * (dividing the stepper coarser and finer, not dividing it coarser and finer),
 * which keeps this under a couple of seconds in a suite that runs in parallel.
 */

function lifter(histUnit: Unit, sessions: Array<[number, number]>, sessUnit: Unit, jump: string, goal?: string): NowModel {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  if (goal) repo.setPref('pref.goal', goal);
  sessions.forEach(([weight, reps], i) => {
    const id = `h${i}`, at = T0 - (2 + 3 * (sessions.length - 1 - i)) * DAY;
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

/**
 * Whether some one of the four weight buttons, pressed repeatedly from `from`,
 * lands on `target`. A run stops once it passes the target or stops moving, so
 * getting this wrong can only report a miss that is not there -- never hide one.
 */
function dialsIn(m: NowModel, from: number, target: number): boolean {
  // The field is read directly: `state()` per press makes this sweep several
  // times slower. Checked to be a number, so a rename fails here loudly instead
  // of comparing undefineds.
  const weight = () => (m as unknown as { weight: number }).weight;
  assert.equal(typeof weight(), 'number', 'NowModel no longer keeps its weight in `weight`; update this sweep');
  const buttons: Array<[() => void, number]> = [
    [() => m.bumpWeight(1), 1], [() => m.bumpWeight(-1), -1], [() => m.bumpPlate(1), 1], [() => m.bumpPlate(-1), -1]
  ];
  for (const [press, direction] of buttons) {
    m.setWeight(from);
    for (let i = 0; i < PRESSES; i++) {
      const before = weight();
      press();
      const now = weight();
      if (now === target) return true;
      if (now === before || (now - target) * direction > 0) break;
    }
  }
  return false;
}

const JUMPS: Record<Unit, string[]> = {
  lb: ['45', '10', '2.5', '1', '7', '3', '1.5'],
  kg: ['20', '5', '1.25', '1', '2', '3', '1.5']
};

const plateau = (w: number): Array<[number, number]> => [[w, 8], [w, 8], [w, 8]];
const deload = (w: number): Array<[number, number]> => [[w, 8], [w, 7], [w, 6]];
const climb = (a: number, b: number): Array<[number, number]> => [[a, 10], [b, 10]];
/** History in the unit it was LOGGED in; 83 kg and 182 lb sit off the 2.5 / 5 grids on purpose. */
const HISTORIES: Record<Unit, Array<Array<[number, number]>>> = {
  lb: [plateau(135), plateau(185), plateau(182), deload(185), deload(182), climb(175, 182), climb(180, 185), climb(130, 135)],
  kg: [plateau(60), plateau(85), plateau(83), deload(85), deload(83), climb(80, 81.5), climb(82.5, 85), climb(58, 60)]
};

describe('every weight the coach names, one button dials in (R671)', () => {
  for (const sessUnit of ['lb', 'kg'] as Unit[]) {
    for (const provenance of ['native', 'converted'] as const) {
      const histUnit: Unit = provenance === 'native' ? sessUnit : (sessUnit === 'lb' ? 'kg' : 'lb');
      test(`${sessUnit} session, ${provenance} history`, () => {
        let checked = 0;
        const misses: string[] = [];
        for (const jump of JUMPS[sessUnit]) {
          for (const goal of [undefined, 'strength']) {
            for (const history of HISTORIES[histUnit]) {
              const m = lifter(histUnit, history, sessUnit, jump, goal);
              const { head, tail } = m.state().lastTime;
              const line = `${head} ${tail ?? ''}`.trim();
              const named = line.match(/(?:try|back off to)\s+(\d+(?:\.\d+)?)/);
              if (!named) continue;
              checked++;
              // From last time's weight, not the dial: since R692 the dial opens
              // ON the call, and the question is still whether one button gets a
              // lifter from where they stood to the number named.
              const from = (m as unknown as { startWeight: number }).startWeight;
              assert.equal(m.state().weight, Number(named[1]), `the dial did not open on the call: "${line}"`);
              if (!dialsIn(m, from, Number(named[1]))) {
                misses.push(`jump ${jump} ${sessUnit}, ${goal ?? 'size'}, field at ${from}: "${line}"`);
              }
            }
          }
        }
        assert.ok(checked >= 50, `only ${checked} suggestions to check -- the fixtures stopped reaching the coach`);
        assert.equal(misses.length, 0,
          `${misses.length} of ${checked} suggestions no single button dials in:\n  ${misses.slice(0, 6).join('\n  ')}`);
      });
    }
  }
});

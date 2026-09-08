import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel, WEIGHT_STEP, PLATE } from '../src/ui/now-model.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 9, 12);

/** Two plateaued sessions at `weight`, with `jumpPref` set as the custom plate jump. */
function plateaued(unit: 'lb' | 'kg', weight: number, jumpPref: string): Repo {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  repo.setPref(`jump.${unit}`, jumpPref);
  let n = 0;
  for (const d of [10, 3]) {
    const id = `s${d}`;
    repo.startSession(id, unit);
    repo.logSet({ id: `x${n++}`, sessionId: id, exerciseId: 'bench', weight, reps: 8, at: T0 - d * DAY });
    repo.endSession(id, T0 - d * DAY + 3600_000);
  }
  return repo;
}

function suggestedWeight(repo: Repo): number | undefined {
  const m = new NowModel(repo, () => T0, 'en-US');
  m.selectExercise('bench');
  // The coach's Suggestion is rendered straight into `head` (i18n `key` +
  // `params`) rather than exposed as a raw object — see now-model.ts's own
  // comment on why the coach line takes over this slot. "try 61.25" is the
  // last number in the sentence.
  const head = m.state().lastTime.head;
  const nums = [...head.matchAll(/\d+(?:\.\d+)?/g)].map(m2 => Number(m2[0]));
  return nums.length ? nums[nums.length - 1] : undefined;
}

/*
 * R592, continuing R548. `jump.<unit>`'s own docstring names a lifter who
 * "runs microplates" and wants a jump FINER than WEIGHT_STEP's default -- and
 * until this round the coach's suggestion ignored that preference entirely,
 * always rounding to the coarser fixed grid. Someone who told the app they
 * load in 1.25 kg steps got told to add 2.5 anyway, exactly the jump their
 * own setting exists to avoid, while the + button one row below would have
 * taken them to the finer number.
 */
describe('the coach honours a plate jump finer than the fixed stepper (R592)', () => {
  test('a 1.25 kg custom jump gets a 1.25 kg suggestion, not the fixed 2.5', () => {
    assert.ok(WEIGHT_STEP.kg > 1.25, 'WEIGHT_STEP.kg no longer 2.5 -- re-check this fixture');
    const repo = plateaued('kg', 60, '1.25');
    assert.equal(suggestedWeight(repo), 61.25,
      'the coach suggested a weight off the lifter\'s own declared 1.25 kg grid');
  });

  test('a 1 lb custom jump gets a whole-pound suggestion, not the fixed 5', () => {
    // size's own step (2.5 lb) lands on 137.5 before rounding; a 5 lb grid
    // would send that to 140, a 1 lb grid to the nearest pound, 138.
    const repo = plateaued('lb', 135, '1');
    assert.equal(suggestedWeight(repo), 138,
      'the coach suggested a weight off the lifter\'s own declared 1 lb grid');
  });

  test('a jump coarser than the default is unaffected (no regression)', () => {
    const repo = plateaued('lb', 135, String(PLATE.lb));
    assert.equal(suggestedWeight(repo), 140,
      'a default-or-coarser jump changed the suggestion -- this should be untouched');
  });
});

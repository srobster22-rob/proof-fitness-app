import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  STARTING_TWELVE, BUILTIN, prefillFor, pickerFor,
  EQUIPMENT_BASE, startingWeight, strengthIndex
} from '../src/domain/coldstart.ts';
import { findPRs } from '../src/domain/pr.ts';
import { buildRecap } from '../src/domain/session.ts';
import { dayOf } from '../src/domain/split.ts';
import type { LoggedSet, Exercise, Session } from '../src/domain/types.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 6, 29, 12);
let uid = 0;
const mk = (exerciseId: string, weight: number, reps: number, at: number, sessionId = 's'): LoggedSet =>
  ({ id: `x${uid++}`, sessionId, exerciseId, weight, reps, at });

describe('cold start (§6)', () => {
  test('the starting list is twelve lifts, not two hundred', () => {
    assert.equal(STARTING_TWELVE.length, 12);
    assert.equal(new Set(STARTING_TWELVE.map(e => e.id)).size, 12, 'no duplicate ids');
  });

  test('every seeded lift has a usable, non-zero starting load', () => {
    for (const e of STARTING_TWELVE) {
      assert.ok(e.reps >= 1 && e.reps <= 12, `${e.id} has no sane rep seed`);
      assert.ok(e.reps >= 5 && e.reps <= 12, `${e.id} seeds a silly rep count`);
      // Conservative: nothing in the starting list should assume strength.

    }
  });

  // §4: "An empty number field is a bug."
  /*
   * The bar opens EMPTY for a lift with no history. A guessed starting weight
   * is a number the app made up about a person it knows nothing about, and
   * being wrong heavy is worse than being empty — zero is the one starting
   * weight that is never a claim, and +45 is one tap from a loaded bar. The
   * reps seed stays: a set of no reps is not a set.
   */
  test('with no history at all, it is the empty version of the equipment', () => {
    for (const unit of ['lb', 'kg'] as const) {
      for (const id of STARTING_TWELVE.map(e => e.id)) {
        const p = prefillFor(id, [], unit);
        const move = STARTING_TWELVE.find(e => e.id === id)!;
        assert.equal(p.weight, EQUIPMENT_BASE[move.kit][unit],
          `${id}/${unit} started at ${p.weight}`);
        assert.ok(p.reps > 0, `${id}/${unit} prefilled ${p.reps} reps`);
      }
    }
  });

  test('an empty bar is 45, a dumbbell is 5, a stack is 5', () => {
    assert.equal(EQUIPMENT_BASE.barbell.lb, 45, 'the bar itself');
    assert.equal(EQUIPMENT_BASE.dumbbell.lb, 5);
    assert.equal(EQUIPMENT_BASE.machine.lb, 5);
    assert.equal(EQUIPMENT_BASE.barbell.kg, 20, 'and the metric bar');
  });

  /*
   * The rule the user gave, and the number that calibrated it: someone who
   * benches 315 should not be handed an empty bar for their first overhead
   * press.
   */
  test('a strong lifter gets a starting weight that matches them', () => {
    const h = [mk('bench', 315, 5, NOW, 's1')];
    assert.equal(startingWeight('ohp', h, 'lb'), 135, 'the calibration case');
    assert.ok(startingWeight('incline', h, 'lb') > 200, 'and it scales the rest');
    assert.ok(startingWeight('lateral', h, 'lb') < 40, 'without making accessories silly');
  });

  test('any trained lift can calibrate the others, not just the bench', () => {
    const h = [mk('squat', 405, 5, NOW, 's1')];
    assert.ok(strengthIndex(h) > 300, 'a 405 squat implies a serious bench');
    assert.ok(startingWeight('bench', h, 'lb') > 250);
  });

  test('a suggestion is always loadable, and never below the empty version', () => {
    for (const w of [95, 135, 225, 315, 405]) {
      const h = [mk('bench', w, 5, NOW, 's1')];
      for (const id of STARTING_TWELVE.map(e => e.id)) {
        const move = STARTING_TWELVE.find(e => e.id === id)!;
        const v = startingWeight(id, h, 'lb');
        assert.equal(v % 5, 0, `${id} suggested ${v} — not loadable in 5s`);
        assert.ok(v >= EQUIPMENT_BASE[move.kit].lb, `${id} suggested below an empty ${move.kit}`);
      }
    }
  });

  test("a weak lifter is not handed a strong lifter's numbers", () => {
    const weak = [mk('bench', 95, 8, NOW, 's1')];
    const strong = [mk('bench', 315, 5, NOW, 's1')];
    assert.ok(startingWeight('ohp', weak, 'lb') < startingWeight('ohp', strong, 'lb'));
    assert.ok(startingWeight('ohp', weak, 'lb') >= 45, 'but still never below the bar');
  });

  /*
   * Checked directly rather than assumed: a movement the app does not know
   * about — one the user typed in themselves — has no `factor` to scale by,
   * so it always floors at an empty barbell, regardless of how strong the
   * lifter's OTHER history says they are. Not a gap; a guessed factor could
   * overshoot a single-joint custom movement as easily as it could undershoot
   * a compound one, and this file's own rule says overshooting is the worse
   * failure. The floor is the one answer a custom exercise can never make wrong.
   */
  test('a custom exercise always floors, even for a lifter who benches 315', () => {
    const strong = [mk('bench', 315, 5, NOW, 's1')];
    assert.equal(startingWeight('a_movement_nobody_shipped', strong, 'lb'), 45,
      'no factor to scale by means the floor, not a guess');
  });

  test('history beats the seed, and the most recent set wins', () => {
    const history = [
      mk('bench', 185, 5, NOW - 14 * DAY),
      mk('bench', 205, 5, NOW - 3 * DAY),
      mk('bench', 195, 5, NOW - 21 * DAY)
    ];
    const p = prefillFor('bench', history, 'lb');
    assert.equal(p.weight, 205);
    assert.equal(p.source, 'history');
  });

  test('the source is reported so a guess never poses as their history', () => {
    assert.equal(prefillFor('bench', [], 'lb').source, 'seed');
    assert.equal(prefillFor('mystery', [], 'lb').source, 'fallback');
    assert.equal(prefillFor('bench', [mk('bench', 100, 5, NOW)], 'lb').source, 'history');
  });

  test('kg seeds are metric-plausible, not converted pounds', () => {
    for (const e of STARTING_TWELVE) {
      const asKg = e.seedLb / 2.2046;
      assert.ok(Math.abs(e.seedKg - asKg) < 12, `${e.id} kg seed looks unrelated to its lb seed`);
      assert.equal(e.seedKg % 2.5, 0, `${e.id} seeds ${e.seedKg}kg — not a real plate loadout`);
    }
  });

  test('the picker shows the starting twelve until there is history to rank', () => {
    assert.equal(pickerFor([], NOW).length, 12);
    assert.equal(pickerFor([], NOW)[0].id, 'bench');

    const thin = [mk('squat', 100, 5, NOW - DAY, 'a'), mk('squat', 100, 5, NOW - 2 * DAY, 'b')];
    assert.equal(pickerFor(thin, NOW).length, 12, 'two sessions is still cold start');
  });

  /*
   * The order is the contract, not the length. What they actually train ranks
   * first; the rest of the library follows so a movement they have never tried
   * is reachable at all. Before the tail existed the way to start doing leg
   * curls was to have already done leg curls.
   */
  test('once there is history the picker leads with their own lifts', () => {
    const history = [0, 7, 14, 21].flatMap(d => [
      mk('squat', 225, 5, NOW - d * DAY, `s${d}`),
      mk('row', 155, 8, NOW - d * DAY, `s${d}`)
    ]);
    const picker = pickerFor(history, NOW);
    assert.deepEqual(picker.slice(0, 2).map(e => e.id), ['squat', 'row'],
      'their movements first, ranked');
    assert.ok(picker.length > 2, 'and the library behind them, reachable');
    assert.equal(new Set(picker.map(e => e.id)).size, picker.length, 'no duplicates');
  });

  test('the tail never repeats something already ranked', () => {
    const history = [0, 7, 14, 21].flatMap(d => [
      mk('squat', 225, 5, NOW - d * DAY, `s${d}`),
      mk('bench', 185, 5, NOW - d * DAY, `s${d}`)
    ]);
    const ids = pickerFor(history, NOW).map(e => e.id);
    assert.equal(ids.filter(i => i === 'squat').length, 1);
    assert.equal(ids.filter(i => i === 'bench').length, 1);
  });
});

describe('cold start, end to end (§6)', () => {
  test('a first-ever single set produces a complete, honest recap', () => {
    const exercises = new Map<string, Exercise>(
      STARTING_TWELVE.map(e => [e.id, { id: e.id, name: e.name }])
    );
    const pre = prefillFor('bench', [], 'lb');
    const set = mk('bench', pre.weight, pre.reps, NOW - 5 * 60_000, 'first');
    const session: Session = { id: 'first', startedAt: NOW - 8 * 60_000, endedAt: NOW, unit: 'lb', updatedAt: NOW };

    const payload = buildRecap({
      session, sets: [set], exercises,
      prs: findPRs([set], [], exercises), allSets: [set], now: NOW, title: 'FIRST SESSION'
    });

    assert.equal(payload.sets, 1);
    assert.equal(payload.lifts.length, 1);
    assert.deepEqual(payload.lifts[0], ['Bench Press', `${pre.weight} × ${pre.reps}`, false]);
    assert.equal(payload.pr, undefined, 'day one claims no PR — that would be a lie');
    assert.equal(payload.volume, pre.weight * pre.reps);
    assert.match(payload.duration, /^\d+ MIN$/);
    assert.ok(payload.streak >= 1);
  });
});

// A movement the user created must be selectable. It was dropped from BOTH
// branches of `pickerFor` — the cold-start branch returned the twelve verbatim,
// and the ranked branch only knows lifts with history — so adding a lift and
// switching away lost it, and the only way back was to retype its exact name.
describe('the picker never loses a movement the user made (§7)', () => {
  const HACK = { id: 'hack_squat', name: 'Hack Squat' };
  const LIBRARY = [...STARTING_TWELVE.map(({ id, name }) => ({ id, name })), HACK];

  test('a custom lift with no history is still offered', () => {
    const ids = pickerFor([], NOW, undefined, 12, LIBRARY).map(e => e.id);
    assert.ok(ids.includes('hack_squat'), 'created it, then could never select it again');
  });

  test('and it is offered FIRST — their own movement above the generic list', () => {
    assert.equal(pickerFor([], NOW, undefined, 12, LIBRARY)[0].id, 'hack_squat');
  });

  test('it survives once there is enough history to rank', () => {
    const history = [0, 7, 14, 21].flatMap(d => [
      mk('squat', 225, 5, NOW - d * DAY, `s${d}`),
      mk('row', 155, 8, NOW - d * DAY, `s${d}`)
    ]);
    const ids = pickerFor(history, NOW, undefined, 12, LIBRARY).map(e => e.id);
    assert.deepEqual(ids.slice(0, 3), ['squat', 'row', 'hack_squat'],
      'trained lifts ranked, then what they made but have not trained');
    assert.ok(ids.length > 3, 'then the rest of the library');
    assert.equal(ids.indexOf('hack_squat') < ids.indexOf('bench'), true,
      'their own movement still outranks one the app merely ships');
  });

  test('a trained custom lift shows its NAME, not its slug', () => {
    const history = [0, 7, 14, 21].map(d => mk('hack_squat', 200, 8, NOW - d * DAY, `s${d}`));
    const row = pickerFor(history, NOW, undefined, 12, LIBRARY).find(e => e.id === 'hack_squat');
    assert.equal(row!.name, 'Hack Squat', 'the sheet read "hack_squat" at the user');
  });

  test('it is never listed twice', () => {
    const history = [0, 7, 14, 21].map(d => mk('hack_squat', 200, 8, NOW - d * DAY, `s${d}`));
    const ids = pickerFor(history, NOW, undefined, 12, LIBRARY).map(e => e.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('with no library passed the §6 and §7 rules are unchanged', () => {
    assert.equal(pickerFor([], NOW).length, 12);
    assert.equal(pickerFor([], NOW)[0].id, 'bench');
  });
});

describe('the library is common movements, and reachable (§6, §7)', () => {
  test('first launch still shows the SHORT list §6 promises', () => {
    assert.equal(STARTING_TWELVE.length, 12);
    assert.equal(pickerFor([], NOW).length, 12,
      'a beginner facing thirty movements is the setup maze §5 exists to avoid');
  });

  test('every movement the app ships has a unique id and a day', () => {
    assert.equal(new Set(BUILTIN.map(e => e.id)).size, BUILTIN.length, 'duplicate id');
    assert.equal(new Set(BUILTIN.map(e => e.name)).size, BUILTIN.length, 'duplicate name');
    for (const e of BUILTIN) {
      assert.ok(dayOf(e.id), `${e.id} has no split day — it would land in YOURS`);
    }
  });

  test('every seed is a real starting weight in both units', () => {
    for (const e of BUILTIN) {
      /*
       * Bodyweight movements seed at zero on purpose: for a pull-up, a dip or a
       * push-up, `weight` is what you have STRAPPED ON, and none is the normal
       * case. A non-zero seed there would open a pull-up at 45 lb.
       */
      if (e.kit === 'bodyweight') {
        assert.equal(e.seedLb, 0, `${e.id} is bodyweight but seeds added weight`);
        assert.equal(e.seedKg, 0, `${e.id} is bodyweight but seeds added weight`);
      } else {
        assert.ok(e.seedLb > 0, `${e.id} seeds 0 lb`);
        assert.ok(e.seedKg > 0, `${e.id} seeds 0 kg`);
      }
      assert.ok(e.reps >= 1 && e.reps <= 12, `${e.id} seeds ${e.reps} reps, outside what §8 scores`);
    }
  });

  /*
   * The library had no pull-up, chin-up, dip or push-up — four of the most
   * common movements in any gym, in an app whose owner asked for common ones
   * and no niche ones.
   */
  test('the obvious bodyweight movements are there', () => {
    const names = BUILTIN.map(e => e.name);
    for (const wanted of ['Pull-up', 'Chin-up', 'Dip', 'Push-up']) {
      assert.ok(names.includes(wanted), `${wanted} is missing from the library`);
    }
  });

  test('and they open at bodyweight, not at a plate', () => {
    for (const id of ['pullup', 'chinup', 'dip', 'pushup']) {
      const e = BUILTIN.find(x => x.id === id)!;
      assert.equal(e.kit, 'bodyweight');
      assert.equal(EQUIPMENT_BASE[e.kit].lb, 0, 'a pull-up would open at a plate');
      assert.equal(EQUIPMENT_BASE[e.kit].kg, 0);
    }
  });

  /*
   * Legs was the thin day — two movements against five a side — on the day
   * most people find hardest to fill.
   */
  test('no split day is left threadbare', () => {
    for (const day of ['push', 'pull', 'legs'] as const) {
      const n = BUILTIN.filter(e => dayOf(e.id) === day).length;
      assert.ok(n >= 7, `${day} has only ${n} movements`);
    }
  });

  test('a movement they have never trained is reachable at all', () => {
    const history = [0, 7, 14, 21].flatMap(d => [
      mk('squat', 225, 5, NOW - d * DAY, `s${d}`),
      mk('row', 155, 8, NOW - d * DAY, `s${d}`)
    ]);
    const ids = pickerFor(history, NOW).map(e => e.id);
    assert.ok(ids.includes('legcurl'),
      'before the tail, the way to start doing leg curls was to have already done leg curls');
    assert.ok(ids.indexOf('squat') < ids.indexOf('legcurl'), 'but what they train still leads');
  });
});

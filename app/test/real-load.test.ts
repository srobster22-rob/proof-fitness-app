import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CARRIES_BODYWEIGHT, realLoad, bodyweightMultiple, type Measurement
} from '../src/domain/measure.ts';
import { BUILTIN } from '../src/domain/coldstart.ts';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { progressRows } from '../src/ui/progress-model.ts';

const DAY = 86_400_000;
const T = Date.UTC(2026, 7, 22, 8);

const weighed = (value: number, unit: 'lb' | 'kg', daysAgo: number): Measurement =>
  ({ id: `w${daysAgo}`, kind: 'bodyweight', value, unit, at: T - daysAgo * DAY });

const set = (exerciseId: string, weight: number, daysAgo = 0) =>
  ({ exerciseId, weight, at: T - daysAgo * DAY });

/*
 * The reason bodyweight is worth having at all: four movements in the library
 * log at weight 0 because the load IS the lifter, so their hardest work was
 * recorded as their lightest.
 */
describe('a pull-up weighs what you weigh', () => {
  const history = [weighed(190, 'lb', 60), weighed(185, 'lb', 10)];

  test('the four bodyweight movements are the ones marked bodyweight', () => {
    const marked = BUILTIN.filter(l => l.kit === 'bodyweight').map(l => l.id).sort();
    assert.deepEqual([...CARRIES_BODYWEIGHT].sort(), marked,
      'the two lists must not drift — one decides the input, the other the truth');
  });

  test('added weight is added to the lifter, not reported alone', () => {
    assert.deepEqual(realLoad(set('pullup', 25), history), { load: 210, unit: 'lb' });
  });

  test('an unweighted pull-up is not zero', () => {
    assert.deepEqual(realLoad(set('pullup', 0), history), { load: 185, unit: 'lb' });
  });

  /*
   * A set done at 190 lb bodyweight does not become heavier because you gained
   * weight afterwards.
   */
  test('it uses the reading that applied on the day, not the latest', () => {
    assert.equal(realLoad(set('dip', 0, 30), history)!.load, 190,
      '30 days ago they weighed 190, and that set still weighed 190');
    assert.equal(realLoad(set('dip', 0, 1), history)!.load, 185);
  });

  test('an ordinary lift is left alone', () => {
    assert.equal(realLoad(set('bench', 225), history), null,
      'a barbell weighs what it weighs');
  });

  /*
   * The honest answer, and the reason this is nullable rather than falling back
   * to the bar: a pull-up recorded as 25 lb is wrong, and quietly calling it
   * 25 lb again while claiming to know better would be worse.
   */
  test('no bodyweight on record means no answer, not a guess', () => {
    assert.equal(realLoad(set('pullup', 25), []), null);
    assert.equal(realLoad(set('pullup', 25, 90), history), null,
      'a set logged before they ever weighed themselves has nothing to add');
  });

  test('the answer comes back in the unit they weighed in', () => {
    const kg = [weighed(84, 'kg', 5)];
    assert.deepEqual(realLoad(set('chinup', 10), kg), { load: 94, unit: 'kg' });
  });
});

/*
 * "2x bodyweight squat" — the milestone people actually chase, and the one
 * number here that says something a raw weight cannot: 315 means nothing
 * without knowing who lifted it.
 */
describe('a lift as a multiple of the lifter', () => {
  const history = [weighed(180, 'lb', 5)];

  test('the multiple a lifter would quote', () => {
    assert.equal(bodyweightMultiple(360, 'lb', history, T), 2);
    assert.equal(bodyweightMultiple(315, 'lb', history, T), 1.75);
  });

  test('mixed units still compare, because both go through one base', () => {
    const kg = [weighed(80, 'kg', 5)];
    // 176.4 lb bodyweight against a 352.8 lb lift is 2x.
    assert.equal(bodyweightMultiple(352.8, 'lb', kg, T), 2);
  });

  /*
   * The other direction, which was not covered: a kg SESSION against an lb
   * reading. Both operands are converted before the division, so the ratio is
   * unit-free — but only one direction was pinned, and a "simplification" that
   * converted just one side would still pass that test while halving or
   * doubling this one.
   */
  test('and in the other direction — a kg lift against an lb reading', () => {
    const lb = [weighed(180, 'lb', 5)];
    // 180 lb is 81.6 kg; a 163.2 kg lift is 2x that.
    const v = bodyweightMultiple(163.2, 'kg', lb, T)!;
    assert.ok(Math.abs(v - 2) < 0.01, `got ${v}, expected 2x`);
  });

  test('two decimals, because 1.7243 is arithmetic showing off', () => {
    const v = bodyweightMultiple(311, 'lb', history, T)!;
    assert.equal(Math.round(v * 100), v * 100);
  });

  test('nothing to divide by means no claim', () => {
    assert.equal(bodyweightMultiple(315, 'lb', [], T), null);
  });

  test('and a set from before the first weigh-in makes no claim either', () => {
    assert.equal(bodyweightMultiple(315, 'lb', history, T - 30 * DAY), null);
  });
});

/*
 * The payoff, on the screen that shows it. `realLoad` existing changes nothing
 * until something consumes it.
 */
describe('Progress reports what a pull-up actually weighed', () => {
  const DAY2 = 86_400_000;
  const T2 = Date.UTC(2026, 7, 22, 8);

  function trained(withBodyweight: boolean) {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T2);
    repo.startSession('s1', 'lb');
    // Two sessions so the row survives the "no scoring sets" filter.
    repo.logSet({ id: 'a', sessionId: 's1', exerciseId: 'pullup', weight: 25, reps: 8, at: T2 - 7 * DAY2 });
    repo.endSession('s1', T2 - 7 * DAY2 + 60_000);
    repo.startSession('s2', 'lb');
    repo.logSet({ id: 'b', sessionId: 's2', exerciseId: 'pullup', weight: 35, reps: 8, at: T2 - DAY2 });
    repo.endSession('s2', T2 - DAY2 + 60_000);
    if (withBodyweight) {
      repo.saveMeasurement({ id: 'w', kind: 'bodyweight', value: 185, unit: 'lb', at: T2 - 30 * DAY2 });
    }
    return repo;
  }

  test('with a bodyweight on record, the row carries the real load', () => {
    const row = progressRows(trained(true), T2).find(r => r.exerciseId === 'pullup')!;
    assert.equal(row.best, 35, 'the number they typed is still the number they typed');
    assert.equal(row.realBest, 220, '185 + 35');
  });

  /*
   * The honest answer. A pull-up logged as "35" is not a light set, it is a set
   * the app has no bodyweight for — and inventing one would be worse than
   * saying nothing.
   */
  test('without one it says nothing rather than guessing', () => {
    const row = progressRows(trained(false), T2).find(r => r.exerciseId === 'pullup')!;
    assert.equal(row.best, 35);
    assert.equal(row.realBest, null);
  });

  test('an ordinary lift never grows a second number', () => {
    const repo = trained(true);
    repo.startSession('s3', 'lb');
    repo.logSet({ id: 'c', sessionId: 's3', exerciseId: 'bench', weight: 185, reps: 5, at: T2 });
    repo.endSession('s3', T2 + 60_000);
    const row = progressRows(repo, T2).find(r => r.exerciseId === 'bench')!;
    assert.equal(row.realBest, null, 'a barbell weighs what it weighs');
  });
});

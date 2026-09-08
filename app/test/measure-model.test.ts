import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import {
  measureRows, readingsFor, recordMeasurement, prefillFor, trendLine
} from '../src/ui/measure-model.ts';
import { trendOf } from '../src/domain/measure.ts';
import { PREF_UNIT } from '../src/ui/display-unit.ts';

const DAY = 86_400_000;
const T = Date.UTC(2026, 7, 22, 8);
const fresh = () => new Repo(new DatabaseSync(':memory:') as any, () => T);

function weighed(repo: Repo, value: number, daysAgo: number, unit: 'lb' | 'kg' = 'lb') {
  repo.saveMeasurement({
    id: `w${daysAgo}_${value}`, kind: 'bodyweight', value, unit, at: T - daysAgo * DAY
  });
}

describe('the measurements screen', () => {
  /*
   * This screen is the only place the app says bodyweight exists. A kind that
   * only appears once you have already used it cannot be discovered.
   */
  test('every kind gets a row, even one never recorded', () => {
    const rows = measureRows(fresh(), T);
    assert.deepEqual(rows.map(r => r.kind), ['bodyweight', 'height']);
    assert.equal(rows[0].current, null);
    assert.equal(rows[0].line, null, 'nothing to report is not the same as filler');
  });

  test('a recorded kind shows its newest reading', () => {
    const repo = fresh();
    weighed(repo, 190, 40);
    weighed(repo, 185, 2);
    const row = measureRows(repo, T)[0];
    assert.equal(row.current, '185 lb');
  });

  /*
   * Somebody who records in kilos should not have to change the unit every
   * time (§4 — never ask what it can answer).
   */
  test('the entry unit defaults to the one they last used', () => {
    const repo = fresh();
    weighed(repo, 84, 3, 'kg');
    assert.equal(measureRows(repo, T)[0].unit, 'kg');
    assert.equal(measureRows(fresh(), T)[0].unit, 'lb', 'and to the kind default before that');
  });

  /*
   * R303: a never-recorded kind used to guess `KINDS[kind].units[0]` no
   * matter who was asking — 'lb' for bodyweight, 'cm' for height — so an
   * imperial (lb) lifter's first-ever height entry opened on centimetres
   * while their weight entries opened on pounds. The guess now follows
   * `displayUnit`, the one place the app already knows which system a
   * person is in, translated across for a kind (height) whose own units
   * are not a weight `Unit` at all.
   */
  test('a never-recorded kind guesses the SAME system as weight, not a hardcoded one', () => {
    assert.equal(measureRows(fresh(), T)[1].unit, 'in',
      'an imperial (lb) lifter should not be defaulted into centimetres');

    const kg = fresh();
    kg.setPref(PREF_UNIT, 'kg');
    assert.equal(measureRows(kg, T)[1].unit, 'cm',
      'a metric (kg) lifter should not be defaulted into inches');
  });

  /*
   * R315: the same "how has this actually moved" question a lift's sparkline
   * answers, given to bodyweight and height — the NUMBER already says "down
   * 4 lb since May", this is the same history in a form a glance can compare.
   */
  describe('the sparkline (R315)', () => {
    test('nothing until there are two readings to draw a line between', () => {
      const one = fresh();
      weighed(one, 185, 3);
      assert.deepEqual(measureRows(one, T)[0].spark, [],
        'a single point is not a trend — nothing to compare it against yet');
      assert.deepEqual(measureRows(fresh(), T)[0].spark, []);
    });

    test('two readings draw a real line, low end to high end', () => {
      const repo = fresh();
      weighed(repo, 180, 10);
      weighed(repo, 190, 1);
      const spark = measureRows(repo, T)[0].spark;
      assert.equal(spark.length, 2);
      assert.equal(spark[0], 0, 'the lighter, older reading anchors the bottom');
      assert.equal(spark[1], 1, 'the heavier, newer reading anchors the top');
    });

    test('a flat history draws a flat line, not a division by zero', () => {
      const repo = fresh();
      weighed(repo, 185, 10);
      weighed(repo, 185, 1);
      assert.deepEqual(measureRows(repo, T)[0].spark, [0.5, 0.5]);
    });

    test('a history that switched units still draws one consistent shape', () => {
      // 84 kg is ~185 lb — logged in kg partway through an lb history, this
      // must not read as a cliff down to 84 on a chart sharing lb's scale.
      const repo = fresh();
      weighed(repo, 180, 20, 'lb');
      weighed(repo, 84, 10, 'kg');
      weighed(repo, 190, 1, 'lb');
      const row = measureRows(repo, T)[0];
      assert.equal(row.unit, 'lb');
      // 180 -> ~0.05, 84kg (~185.2lb) -> ~0.52, 190 -> 1 — monotonically rising,
      // not the kg entry reading as a trough near zero.
      assert.equal(row.spark.length, 3);
      assert.ok(row.spark[0] < row.spark[1], 'the converted middle reading must sit above the first');
      assert.ok(row.spark[1] < row.spark[2], 'and below the last');
    });

    test('only the most recent window is drawn, oldest of it first', () => {
      const repo = fresh();
      for (let d = 15; d >= 1; d--) weighed(repo, 200 - d, d);
      const spark = measureRows(repo, T)[0].spark;
      assert.equal(spark.length, 10, 'capped to the same window Progress uses');
      assert.equal(spark[spark.length - 1], 1, 'the newest, heaviest reading is last');
    });
  });
});

/*
 * "Down 4 lb" invites "since when", and a trend whose baseline you cannot see
 * is a number you cannot check — especially here, where one kind measures over
 * 90 days and the other over three years.
 */
describe('what the trend line says', () => {
  const line = (repo: Repo) => trendLine('bodyweight', trendOf('bodyweight', repo.measurements(), T));

  test('direction, amount, and when it is measuring from', () => {
    const repo = fresh();
    weighed(repo, 190, 60);
    weighed(repo, 185.8, 1);
    const s = line(repo)!;
    assert.match(s, /^Down/);
    assert.match(s, /4\.2 lb/);
    assert.match(s, /since Jun/, 'the baseline has to be visible');
  });

  test('a rise says up', () => {
    const repo = fresh();
    weighed(repo, 180, 60);
    weighed(repo, 186, 1);
    assert.match(line(repo)!, /^Up 6 lb since/);
  });

  test('inside the noise floor it says steady rather than picking a side', () => {
    const repo = fresh();
    weighed(repo, 185, 30);
    weighed(repo, 185.4, 1);
    assert.match(line(repo)!, /^Steady since/);
  });

  test('one reading says nothing, because the number is already on the row', () => {
    const repo = fresh();
    weighed(repo, 185, 1);
    assert.equal(line(repo), null);
  });

  test('a baseline in another year names the year', () => {
    const repo = fresh();
    weighed(repo, 170, 700);   // outside bodyweight's 90-day window
    weighed(repo, 178, 80);
    weighed(repo, 182, 1);
    const s = line(repo)!;
    assert.match(s, /since [A-Z][a-z]{2}/);
  });
});

describe('recording one', () => {
  test('a plausible number is saved, rounded to a tenth', () => {
    const repo = fresh();
    assert.deepEqual(recordMeasurement(repo, 'bodyweight', '185.44', 'lb', T), { ok: true });
    assert.equal(repo.measurements()[0].value, 185.4);
  });

  /*
   * The message says what is wrong with the NUMBER, never what a bodyweight
   * ought to be.
   */
  test('a typo is refused, and the wording is about the number', () => {
    const repo = fresh();
    const r = recordMeasurement(repo, 'bodyweight', '5', 'lb', T);
    assert.equal(r.ok, false);
    assert.match(r.error!, /does not look like a bodyweight/);
    assert.doesNotMatch(r.error!, /should|must|too (light|heavy)/i);
    assert.deepEqual(repo.measurements(), [], 'and nothing was written');
  });

  test('rubbish input is refused rather than stored as NaN', () => {
    const repo = fresh();
    assert.equal(recordMeasurement(repo, 'bodyweight', 'abc', 'lb', T).ok, false);
    assert.equal(recordMeasurement(repo, 'bodyweight', '', 'lb', T).ok, false);
    assert.deepEqual(repo.measurements(), []);
  });

  test('a note rides along when there is one', () => {
    const repo = fresh();
    recordMeasurement(repo, 'bodyweight', '185', 'lb', T, '  after training  ');
    assert.equal(repo.measurements()[0].note, 'after training');
    const repo2 = fresh();
    recordMeasurement(repo2, 'bodyweight', '185', 'lb', T, '   ');
    assert.equal(repo2.measurements()[0].note, undefined);
  });

  test('height is recorded in its own units', () => {
    const repo = fresh();
    assert.equal(recordMeasurement(repo, 'height', '178', 'cm', T).ok, true);
    assert.equal(recordMeasurement(repo, 'height', '70', 'in', T + 1).ok, true);
    assert.equal(recordMeasurement(repo, 'height', '5', 'in', T + 2).ok, false, 'they typed feet');
  });
});

describe('the input is never blank', () => {
  test('it opens on the last reading', () => {
    const repo = fresh();
    weighed(repo, 185, 3);
    assert.equal(prefillFor(repo, 'bodyweight', 'lb', T), '185');
  });

  test('converted when the unit differs, so the number still means the same thing', () => {
    const repo = fresh();
    weighed(repo, 185, 3);
    assert.equal(prefillFor(repo, 'bodyweight', 'kg', T), '83.9');
  });

  test('and it is empty when there is genuinely nothing to offer', () => {
    assert.equal(prefillFor(fresh(), 'bodyweight', 'lb', T), '',
      'a made-up starting bodyweight would be a fact about nobody');
  });
});

describe('the history list', () => {
  test('newest first, capped', () => {
    const repo = fresh();
    for (let i = 0; i < 40; i++) weighed(repo, 180 + i, i);
    const rows = readingsFor(repo, 'bodyweight');
    assert.equal(rows.length, 30);
    assert.equal(rows[0].at > rows[1].at, true);
    assert.equal(rows[0].value, 180, 'the most recent is the smallest daysAgo');
  });

  test('one kind never shows another', () => {
    const repo = fresh();
    weighed(repo, 185, 1);
    repo.saveMeasurement({ id: 'h', kind: 'height', value: 180, unit: 'cm', at: T });
    assert.equal(readingsFor(repo, 'height').length, 1);
    assert.equal(readingsFor(repo, 'bodyweight').length, 1);
  });
});

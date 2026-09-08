import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  KINDS, kindOf, plausible, convertMeasure, trendOf, readingAt, formatMeasure,
  type Measurement, type MeasurementKind, type MeasureUnit
} from '../src/domain/measure.ts';

const DAY = 86_400_000;
const T = Date.UTC(2026, 7, 22, 8);
let n = 0;
const m = (
  kind: MeasurementKind, value: number, unit: MeasureUnit, daysAgo: number
): Measurement => ({ id: `m${n++}`, kind, value, unit, at: T - daysAgo * DAY });

/*
 * Every other number in this app is a fact about a LIFT. These are facts about
 * the person doing it, and they have a history — which is what makes them
 * measurements rather than fields in a profile.
 */
describe('what a measurement is', () => {
  test('each kind carries its own units, the first one the default', () => {
    assert.deepEqual([...KINDS.bodyweight.units], ['lb', 'kg']);
    assert.deepEqual([...KINDS.height.units], ['cm', 'in']);
  });

  /*
   * Bodyweight moves week to week; height moves over years. On one axis the
   * first looks like noise and the second looks like a flat line that failed
   * to load.
   */
  test('and its own idea of how long a trend takes', () => {
    assert.ok(kindOf('height').windowDays > kindOf('bodyweight').windowDays * 5,
      'height measured on a bodyweight window is a flat line');
  });

  test('a typo is rejected, a person is not judged', () => {
    assert.equal(plausible('bodyweight', 185, 'lb'), true);
    assert.equal(plausible('bodyweight', 84, 'kg'), true);
    assert.equal(plausible('bodyweight', 5, 'lb'), false, 'a 5 lb human is a typo');
    assert.equal(plausible('height', 178, 'cm'), true);
    assert.equal(plausible('height', 70, 'in'), true);
    assert.equal(plausible('height', 5, 'in'), false, 'someone typed feet');
    assert.equal(plausible('bodyweight', 0, 'lb'), false);
    assert.equal(plausible('bodyweight', NaN, 'lb'), false);
  });

  test('bounds are checked in the base unit, not whichever was typed', () => {
    // 400 kg is out of bounds even though 400 sits inside a 40-1000 lb range.
    assert.equal(plausible('bodyweight', 400, 'kg'), false);
  });
});

describe('converting without rewriting', () => {
  test('numbers a person would recognise', () => {
    assert.equal(convertMeasure('bodyweight', 185, 'lb', 'kg'), 83.9);
    assert.equal(convertMeasure('height', 180, 'cm', 'in'), 70.9);
    assert.equal(convertMeasure('height', 72, 'in', 'cm'), 182.9);
  });

  test('rounded to a tenth, because a scale and a tape do not resolve past one', () => {
    for (const v of [185, 200.4, 77.7]) {
      const out = convertMeasure('bodyweight', v, 'lb', 'kg');
      assert.equal(Math.round(out * 10), out * 10, `${out} is finer than a scale reads`);
    }
  });

  test('the same unit is a no-op', () => {
    assert.equal(convertMeasure('bodyweight', 185, 'lb', 'lb'), 185);
  });
});

describe('what has happened lately', () => {
  test('newest against the oldest inside the window', () => {
    const all = [
      m('bodyweight', 190, 'lb', 60), m('bodyweight', 185, 'lb', 30), m('bodyweight', 182, 'lb', 1)
    ];
    const t = trendOf('bodyweight', all, T);
    assert.equal(t.change, -8);
    assert.equal(t.direction, 'down');
    assert.equal(t.count, 3);
  });

  /*
   * A lifter three years in does not want their bodyweight trend measured from
   * the day they started.
   */
  test('readings older than the window do not set the baseline', () => {
    const all = [
      m('bodyweight', 240, 'lb', 900), m('bodyweight', 186, 'lb', 40), m('bodyweight', 182, 'lb', 1)
    ];
    assert.equal(trendOf('bodyweight', all, T).change, -4, 'not -58');
  });

  /*
   * Bodyweight swings across a day on water alone, so a small "increase" is the
   * scale rather than information.
   */
  test('a change inside the noise floor is flat, not a direction', () => {
    const all = [m('bodyweight', 185, 'lb', 20), m('bodyweight', 185.4, 'lb', 1)];
    assert.equal(trendOf('bodyweight', all, T).direction, 'flat');
  });

  test('height moves less and still counts, because its floor is finer', () => {
    const all = [m('height', 178, 'cm', 700), m('height', 179.2, 'cm', 10)];
    const t = trendOf('height', all, T);
    assert.equal(t.direction, 'up');
    assert.equal(t.change, 1.2);
  });

  test('the change is in the unit you are currently thinking in', () => {
    const all = [m('bodyweight', 200, 'lb', 30), m('bodyweight', 88, 'kg', 1)];
    const t = trendOf('bodyweight', all, T);
    // 200 lb is 90.7 kg, so this is a loss of 2.7 kg — not "a loss of 6 lb".
    assert.equal(t.to!.unit, 'kg');
    assert.equal(t.change, -2.7);
  });

  test('one reading is a value with no direction, not an error', () => {
    const t = trendOf('bodyweight', [m('bodyweight', 185, 'lb', 1)], T);
    assert.equal(t.count, 1);
    assert.equal(t.change, null);
    assert.equal(t.direction, null);
    assert.equal(t.to!.value, 185);
  });

  test('nothing logged reports nothing rather than zero', () => {
    const t = trendOf('bodyweight', [], T);
    assert.deepEqual([t.from, t.to, t.change, t.direction, t.count], [null, null, null, null, 0]);
  });

  test('everything stale still reports the reading, with no direction', () => {
    const t = trendOf('bodyweight', [m('bodyweight', 185, 'lb', 400)], T);
    assert.equal(t.to!.value, 185);
    assert.equal(t.direction, null, 'a year-old number has no trend to claim');
  });

  test('kinds do not contaminate each other', () => {
    const all = [m('bodyweight', 185, 'lb', 10), m('height', 180, 'cm', 5)];
    assert.equal(trendOf('bodyweight', all, T).count, 1);
    assert.equal(trendOf('height', all, T).count, 1);
  });
});

/*
 * The app stores every reading rather than deciding which one was true. When
 * something needs ONE number it wants what the lifter actually knew at the time.
 */
describe('the reading that applied at a moment', () => {
  const all = [
    m('bodyweight', 190, 'lb', 60), m('bodyweight', 185, 'lb', 30), m('bodyweight', 180, 'lb', 2)
  ];

  test('the most recent at or before it', () => {
    assert.equal(readingAt('bodyweight', all, T - 40 * DAY)!.value, 190);
    assert.equal(readingAt('bodyweight', all, T)!.value, 180);
  });

  test('never a future reading', () => {
    assert.equal(readingAt('bodyweight', all, T - 70 * DAY), null,
      'a set logged before you ever weighed yourself has no bodyweight behind it');
  });
});

describe('saying the number the way a person would', () => {
  test('weights keep their unit', () => {
    assert.equal(formatMeasure(185, 'lb'), '185 lb');
    assert.equal(formatMeasure(83.9, 'kg'), '83.9 kg');
  });

  test('centimetres stay centimetres', () => {
    assert.equal(formatMeasure(180, 'cm'), '180 cm');
  });

  test('inches become feet and inches, because nobody says "71 inches"', () => {
    assert.equal(formatMeasure(71, 'in'), '5\'11"');
    assert.equal(formatMeasure(72, 'in'), '6\'0"');
  });

  test('a sub-foot value is not dressed up as a height', () => {
    // Somebody typing centimetres into an inches field. 0'9" would look like
    // an answer; "9 in" looks like the mistake it is.
    assert.equal(formatMeasure(9, 'in'), '9 in');
  });

  test('whole numbers do not grow a decimal', () => {
    assert.equal(formatMeasure(185.0, 'lb'), '185 lb');
  });
});

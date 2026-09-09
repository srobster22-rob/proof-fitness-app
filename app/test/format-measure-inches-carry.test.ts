import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatMeasure } from '../src/domain/measure.ts';

/*
 * R603. `formatMeasure` splits an inches value into feet and a remainder,
 * then rounds the remainder to a tenth SEPARATELY from the split. A
 * remainder just under a whole foot (11.96) rounds up to 12.0 after the
 * split already happened, printing `5'12"` for 71.96 in instead of `6'0"`.
 * Reachable from more than a typed decimal: `measure-goal.ts`'s `remaining`
 * is a plain subtraction, which lands on an arbitrary fraction whenever the
 * goal and the reading came from different units.
 */
describe('formatMeasure never lets the inches remainder round up to 12 (R603)', () => {
  test('a remainder that rounds to 12 carries into the next foot', () => {
    assert.equal(formatMeasure(71.96, 'in'), `6'0"`);
    assert.equal(formatMeasure(23.96, 'in'), `2'0"`);
  });

  test('an ordinary remainder is unaffected', () => {
    assert.equal(formatMeasure(71, 'in'), `5'11"`);
    assert.equal(formatMeasure(72, 'in'), `6'0"`);
    assert.equal(formatMeasure(71.9, 'in'), `5'11.9"`);
  });
});

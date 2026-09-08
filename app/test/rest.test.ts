import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { restSince, formatRest, COLD_AFTER_SECONDS } from '../src/domain/rest.ts';

const T0 = Date.UTC(2026, 6, 29, 18);
const S = 1000;

describe('rest timing (§5 / §8b)', () => {
  test('nothing logged yet means nothing to show', () => {
    const r = restSince(null, T0);
    assert.equal(r.seconds, null);
    assert.equal(r.label, null);
    assert.equal(r.cold, false);
  });

  test('counts up from the last set', () => {
    assert.equal(restSince(T0 - 45 * S, T0).seconds, 45);
    assert.equal(restSince(T0 - 45 * S, T0).label, '0:45');
    assert.equal(restSince(T0 - 95 * S, T0).label, '1:35');
  });

  test('a clock that has gone backwards reads zero, not negative', () => {
    const r = restSince(T0 + 10 * S, T0);
    assert.equal(r.seconds, 0);
    assert.equal(r.label, '0:00');
  });

  test('goes cold at the threshold, not before', () => {
    assert.equal(restSince(T0 - (COLD_AFTER_SECONDS - 1) * S, T0).cold, false);
    assert.equal(restSince(T0 - COLD_AFTER_SECONDS * S, T0).cold, true);
  });

  test('formats mm:ss below an hour', () => {
    assert.equal(formatRest(0), '0:00');
    assert.equal(formatRest(9), '0:09');
    assert.equal(formatRest(60), '1:00');
    assert.equal(formatRest(599), '9:59');
    assert.equal(formatRest(3599), '59:59');
  });

  // §8 allows 90 idle minutes before auto-end, so a phone left on a bench
  // really does get here — and "127:04" reads like a bug.
  test('formats h:mm:ss past an hour', () => {
    assert.equal(formatRest(3600), '1:00:00');
    assert.equal(formatRest(7624), '2:07:04');
  });

  test('never emits a negative or fractional label', () => {
    assert.equal(formatRest(-30), '0:00');
    assert.equal(formatRest(45.9), '0:45');
  });
});

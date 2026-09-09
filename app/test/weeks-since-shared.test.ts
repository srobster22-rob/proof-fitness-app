import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { weeksSince } from '../src/domain/weekly.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/*
 * R607. `weeklyLine` and `weeklyCard` used to each round `days` into weeks
 * with their own copy of `Math.max(1, Math.round(days / 7))` -- harmless
 * only because nobody had edited either copy yet (HANDOFF trap 13's shape:
 * a hand-maintained duplicate drifts the day someone touches one and not
 * the other). Extracted into one function both now call.
 */
describe('weeksSince is the one place this rounding happens (R607)', () => {
  test('rounds to the nearest week, floored at one', () => {
    assert.equal(weeksSince(1), 1);
    assert.equal(weeksSince(6), 1);
    assert.equal(weeksSince(7), 1);
    assert.equal(weeksSince(10), 1);
    assert.equal(weeksSince(11), 2);
    assert.equal(weeksSince(28), 4);
  });

  test('both weekly.ts callers use it rather than their own copy', () => {
    const weeklyTs = fs.readFileSync(path.join(HERE, '..', 'src', 'domain', 'weekly.ts'), 'utf8');
    const progressTs = fs.readFileSync(path.join(HERE, '..', 'src', 'ui', 'progress-model.ts'), 'utf8');
    // A plain substring on the CALL, not the formula -- `days` gets rounded
    // by an unrelated computation elsewhere in this same file (the cutoff's
    // own day count), so matching the formula text again would be exactly
    // the kind of blind-instrument false positive this repo has been bitten
    // by before (HANDOFF trap 16).
    assert.match(weeklyTs, /const weeks = weeksSince\(c\.days\)/,
      'weeklyCard no longer calls the shared weeksSince');
    assert.match(progressTs, /const weeks = weeksSince\(c\.days\)/,
      'weeklyLine no longer calls the shared weeksSince');
  });
});

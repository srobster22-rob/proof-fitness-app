import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { monthsFrom } from '../src/ui/measure-model.ts';
import { DAYS_PER } from '../src/ui/goals-model.ts';

const label = (t: number) =>
  new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

/*
 * R489. Measure's target sheet offers three chips — 3 MO, 6 MO, 12 MO — and
 * computed the date as `now + months * 30 * DAY`, then rendered it as a bare
 * month name. So the chip and the date under it contradicted each other, and
 * with no day shown there was nothing to reconcile them with.
 *
 * Measured across a year of start dates before the fix: 3 MO named the wrong
 * month on 20 of 365, 6 MO on 37, and 12 MO on 60 — a one-year bodyweight
 * target set on 1 January displayed "Dec 2026", a month inside the year the
 * lifter was still in. `targetDate` is SAVED, so that was the real deadline and
 * the pace it drives, not just a label.
 *
 * The fix is scoped to Measure on purpose, and the boundary is disclosure:
 * Goals keeps its nominal 30-day month because there the user types a number
 * and a unit and is shown "90 days — 2 Dec 2026", so the rule is on screen and
 * checkable (§16). Here the user presses a chip that says MONTHS, so months is
 * what it has to mean. Both halves are pinned below so the divergence is a
 * stated decision rather than something that drifted.
 */
describe('a target set in months lands in that month (§16)', () => {
  test('the case that made this obvious: 12 MO from 1 January', () => {
    const jan1 = new Date(2026, 0, 1, 12).getTime();
    assert.equal(label(monthsFrom(jan1, 12)), 'Jan 2027');
    // What it used to do, kept as the contrast rather than described.
    assert.equal(label(jan1 + 12 * 30 * 86_400_000), 'Dec 2026');
  });

  test('every chip, from every start date in a year, names its own month', () => {
    let checked = 0;
    const wrong: string[] = [];
    for (const months of [3, 6, 12]) {
      for (let d = 0; d < 365; d++) {
        const start = new Date(2026, 0, 1 + d, 12);
        const want = new Date(start.getFullYear(), start.getMonth() + months, 1, 12);
        checked++;
        if (label(monthsFrom(start.getTime(), months)) !== label(want.getTime())) {
          wrong.push(`${start.toDateString()} + ${months}mo`);
        }
      }
    }
    assert.equal(checked, 365 * 3, 'the sweep did not run over what it claims');
    assert.deepEqual(wrong.slice(0, 5), [], `${wrong.length} of ${checked} land in the wrong month`);
  });

  test('a month-end start clamps instead of overshooting', () => {
    // 31 January has no 31st to land on a month later. JavaScript rolls that
    // into March; the whole point of the clamp is that it must not.
    assert.equal(label(monthsFrom(new Date(2026, 0, 31, 12).getTime(), 1)), 'Feb 2026');
    assert.equal(new Date(monthsFrom(new Date(2026, 0, 31, 12).getTime(), 1)).getDate(), 28);
    // And a leap year gets the extra day rather than losing it.
    assert.equal(new Date(monthsFrom(new Date(2024, 0, 31, 12).getTime(), 1)).getDate(), 29);
    // 31 May + 1 month is 30 June, not 1 July.
    assert.equal(new Date(monthsFrom(new Date(2026, 4, 31, 12).getTime(), 1)).getDate(), 30);
    assert.equal(label(monthsFrom(new Date(2026, 4, 31, 12).getTime(), 1)), 'Jun 2026');
  });

  test('the time of day survives, so a deadline is not quietly moved', () => {
    const at = new Date(2026, 2, 15, 9, 30, 15, 250).getTime();
    const out = new Date(monthsFrom(at, 6));
    assert.equal(out.getHours(), 9);
    assert.equal(out.getMinutes(), 30);
  });

  /*
   * The other half of the decision. Goals is a DIFFERENT question — a typed
   * number plus a unit, rendered with its own day count — and its comment says
   * why 30 is deliberate there. This fails if somebody "fixes" that too,
   * which would silently change every existing goal's deadline.
   */
  test('and Goals keeps its nominal month, which it discloses', () => {
    assert.equal(DAYS_PER.months, 30);
    assert.equal(DAYS_PER.years, 365);
  });
});

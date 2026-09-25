import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { region } from './helpers/source.ts';
import { nowScreenSource } from './helpers/now-screen.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = nowScreenSource();

/**
 * The one interval in the app, pinned.
 *
 * Measured on the running screen: 125 DOM nodes, and **2 mutations across 3
 * seconds** of an active rest timer — React reconciles down to the single text
 * node that changed, so the once-a-second tick is not the churn it looks like
 * in the source. Startup on the dev bundle was 218ms to DOMContentLoaded.
 * Nothing here needed optimising.
 *
 * What it needs is to stay that way, because the failure modes are invisible:
 * an interval that starts before there is anything to count, or one that is
 * never cleared, costs nothing you can see and everything you cannot. The
 * numbers above were measured against THIS shape.
 */
describe('the rest timer only runs when it has something to count', () => {
  const effect = region(SOURCE, 'const lastAt = state.loggedThisSession.length', '/**');

  test('nothing ticks until a set has been logged', () => {
    assert.match(effect, /if \(lastAt == null \|\| !focused\) return;/,
      'an interval running before the first set counts time nobody is resting');
  });

  /*
   * R491. That guard was the whole guard, and `lastAt` does not change when the
   * workout ends or when another screen opens over this one — and this screen
   * stays MOUNTED through both. Counted live: log a set and one 1000ms interval
   * exists; tap FINISH and it is STILL there with the recap on top. So the clock
   * re-rendered the whole Now tree once a second behind the screen the lifter
   * reads and shares from.
   */
  test('and it stops while another screen is over this one', () => {
    assert.match(effect, /!focused/,
      'the rest clock runs behind the recap, and behind Progress or Goals if ' +
      'the lifter checks either mid-session');
    assert.match(SOURCE, /setFocused\(true\)/,
      'nothing sets the focus flag, so it can only ever be its initial value');
    assert.match(SOURCE, /return \(\) => setFocused\(false\)/,
      'focus is never released, so the flag stays true for the life of the screen');
  });

  test('the interval is cleared', () => {
    assert.match(effect, /return \(\) => clearInterval\(id\)/,
      'an uncleared interval outlives the screen and keeps re-rendering it');
  });

  test('it is keyed on the last set, so a new set restarts it', () => {
    /*
     * `focused` joins `lastAt`, and nothing else. The reason this test exists
     * is unchanged — a dependency that moves on every render would restart the
     * clock constantly — and `focused` only moves when the screen is actually
     * covered or uncovered, which is exactly when the interval should stop and
     * start.
     */
    assert.match(effect, /\}, \[lastAt, focused\]\);/,
      'keyed on anything broader and every unrelated render restarts the clock');
  });

  test('one second, not one frame', () => {
    assert.match(effect, /setInterval\(.*, 1000\)/,
      'the readout is mm:ss — anything faster renders for digits that cannot change');
  });
});

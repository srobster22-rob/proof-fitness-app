import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

function sources(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const dir of [path.join(ROOT, 'app'), path.join(ROOT, 'src', 'ui')]) {
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.tsx')) out.push([f, readFileSync(path.join(dir, f), 'utf8')]);
    }
  }
  return out;
}

/*
 * R475. `Spark.tsx`'s own docstring said the sparkline had been "pulled out
 * once Measure needed the same shape". It had not: `progress.tsx` kept a
 * private copy of the component and never imported the module, so every
 * improvement to the Progress sparkline stopped at the file it was made in.
 *
 * The two had already drifted, measured in the running app on the same
 * ten-point history:
 *
 *     bar width   Progress 14px   Measure 4px
 *     gap         Progress  4px   Measure 3px
 *     baseline    Progress  1px   Measure none
 *
 * — the same "how has this moved" question drawn 3.5x narrower on one of the
 * two screens that asks it, while a comment in the shared file asserted they
 * were one shape. Nothing could have caught that, because nothing was looking:
 * the claim lived in prose, and prose does not fail.
 *
 * This is the same shape as `SettingsSheet.tsx` (R232, a second drifting copy
 * of the Settings screen) and as the Swift port, which HANDOFF lists as five
 * changes behind `recap.js` — this said FOUR until R528, because the count
 * moved when R476 extended it and prose citing another document's number has
 * no way to notice. Two of those three were found by a person noticing. This
 * one gets a test instead, and so now does the count itself.
 *
 * All three are since accounted for: the sparkline by the tests below,
 * `SettingsSheet.tsx` by being deleted, and the Swift port by
 * `swift-parity.test.ts`'s acknowledged list — checked in R528 rather than
 * assumed, because a comment naming three siblings is worth exactly as much
 * as whether anybody followed it up.
 */
describe('the sparkline is one component, not a shape each screen redraws', () => {
  test('exactly one file declares it', () => {
    const decl = sources().filter(([, src]) => /function Spark\b/.test(src));
    assert.deepEqual(decl.map(([f]) => f), ['Spark.tsx'],
      'a second copy of the sparkline exists — that is how the first two drifted ' +
      'to 14px bars on Progress and 4px on Measure while a comment claimed they were one');
  });

  test('and every screen that draws one imports it from there', () => {
    // Counted: an empty sweep satisfies the loop below perfectly, and an
    // instrument reporting no problems must say how much it examined
    // (HANDOFF trap 10).
    let drawing = 0;
    for (const [name, src] of sources()) {
      if (name === 'Spark.tsx') continue;
      if (!/<Spark\b/.test(src)) continue;
      drawing++;
      assert.match(src, /import \{ Spark \} from '[^']*Spark\.tsx'/,
        `${name}: renders <Spark> without importing the shared one`);
    }
    assert.ok(drawing >= 2,
      `only ${drawing} screens found drawing a sparkline — Progress and Measure both should`);
  });

  test('its geometry is importable, so the budget test reads real numbers', () => {
    // `Spark.tsx` imports `react-native`, which `node --test` cannot parse, so
    // the numbers live one module down. Without that split the row-fits
    // arithmetic has to regex them back out of a StyleSheet — which is what it
    // did, and which is part of why the numbers looked like Progress's own.
    const geom = readFileSync(path.join(ROOT, 'src', 'ui', 'spark-geom.ts'), 'utf8');
    assert.doesNotMatch(geom, /from 'react-native'/,
      'spark-geom must stay importable from node --test');
    assert.match(
      readFileSync(path.join(ROOT, 'src', 'ui', 'Spark.tsx'), 'utf8'),
      /from '\.\/spark-geom\.ts'/,
      'the component no longer renders from the geometry the tests check');
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const SCREENS_DIR = path.join(APP, 'app');

/*
 * R585. Goals (R581/R583) and Measure (R584) each had a `useMemo` reading the
 * repo, gated on a local `tick` counter that only ever changed through the
 * screen's OWN actions -- nothing refreshed it on ARRIVAL. Both were "safe"
 * only because `useGuardedLeave` pops and destroys the screen on the way out,
 * a safety net the OWNER.md tab-bar decision would remove.
 *
 * Rather than trust the next screen with this shape to be caught by hand,
 * this scans every screen for the shape itself: a `useMemo` whose dependency
 * array mentions `tick`, and checks that the same file also refreshes `tick`
 * from inside a `useFocusEffect`. A screen with no tick-gated memo at all
 * (recap.tsx, settings.tsx) is not this shape and is skipped -- this test is
 * about the specific pattern that bit Goals and Measure, not a blanket
 * "every screen must use useFocusEffect" rule.
 */
describe('every tick-gated data memo has a refocus refresh (R585)', () => {
  const files = fs.readdirSync(SCREENS_DIR)
    .filter(f => f.endsWith('.tsx') && !f.startsWith('_') && !f.startsWith('+'));

  for (const file of files) {
    const src = fs.readFileSync(path.join(SCREENS_DIR, file), 'utf8');
    const usesTickMemo = /useMemo\([^]*?\[[^\]]*\btick\b[^\]]*\]\)/.test(src);
    if (!usesTickMemo) continue;

    test(`${file}: a tick-gated memo is refreshed on focus, not just on its own actions`, () => {
      const hasFocusEffect = src.includes('useFocusEffect(');
      assert.ok(hasFocusEffect,
        `${file} has a useMemo keyed on \`tick\` but no useFocusEffect at all -- ` +
        'its data can go stale the moment this screen is not always destroyed on the way out');

      // The useFocusEffect body must be the thing that bumps tick -- not some
      // unrelated focus effect that happens to coexist with a stale memo.
      const at = src.indexOf('useFocusEffect(');
      const body = src.slice(at, at + 500);
      assert.ok(/setTick\(|refresh\(\)/.test(body),
        `${file}'s useFocusEffect does not refresh \`tick\` (directly or via a ` +
        '`refresh()` helper) -- the tick-gated memo can still show stale data after ' +
        'a restore or erase done on another screen');
    });
  }
});

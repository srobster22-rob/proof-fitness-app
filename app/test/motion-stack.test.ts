import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const pkg = JSON.parse(readFileSync(path.join(APP, 'package.json'), 'utf8'));
const handoff = readFileSync(path.join(APP, '..', 'HANDOFF.md'), 'utf8');

/*
 * §12 names Reanimated and Skia. This app uses neither, on purpose.
 *
 * Motion is React Native's core `Animated` plus a transient-style pattern, and
 * the reason is written into `Arrive.tsx` and `ScreenModal.tsx`: the RESTING
 * style has to be the visible one, because `Animated` is driven by
 * `requestAnimationFrame`, which does not fire while the page is hidden —
 * measured at 0 frames in 500ms. An entrance built on it can strand its
 * content invisible.
 *
 * Skia is a subtler case: §12's own video-pipeline section settles that the
 * shipped recap is drawn by NATIVE code, with `spike/recap.js` as the Canvas2D
 * design source of truth ported to Swift — there is no composition step left
 * for Skia to do.
 *
 * This test does not enforce the deviation. It makes it impossible to reverse
 * or to forget SILENTLY: adding either package is fine, and whoever does it has
 * to update the record that says why it was not there.
 */
describe('the motion stack is a decision, not an accident', () => {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  test('neither package is installed', () => {
    for (const name of ['react-native-reanimated', '@shopify/react-native-skia']) {
      assert.equal(name in deps, false,
        `${name} was added — update HANDOFF's record of why §12 was not followed`);
    }
  });

  test('and nothing imports them behind the dependency list', () => {
    // A transitive install would not show up above, and an import that
    // resolves is a decision made by accident.
    for (const dir of ['app', path.join('src', 'ui')]) {
      for (const f of readdirSync(path.join(APP, dir))) {
        if (!f.endsWith('.tsx') && !f.endsWith('.ts')) continue;
        const src = readFileSync(path.join(APP, dir, f), 'utf8');
        assert.doesNotMatch(src, /from 'react-native-reanimated'|from '@shopify\/react-native-skia'/,
          `${dir}/${f} imports a motion library §12 names but this app does not use`);
      }
    }
  });

  test('the reason survives where the code is', () => {
    // The rule that actually matters is subtle enough to be "tidied away" by
    // someone refactoring an entrance into a normal Animated one.
    for (const f of ['Arrive.tsx', 'ScreenModal.tsx']) {
      const src = readFileSync(path.join(APP, 'src', 'ui', f), 'utf8');
      assert.match(src, /resting style is the visible one/i,
        `${f} lost the reason its entrance is built the way it is`);
    }
  });

  test('and the deviation is on the record for the owner', () => {
    assert.match(handoff, /§12 names Reanimated and Skia; the app uses neither, deliberately/,
      'the deviation is no longer written down, so it reads as an oversight');
  });
});

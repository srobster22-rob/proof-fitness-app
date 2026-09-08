import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

/**
 * Every .tsx that could render a sheet.
 *
 * Throws rather than returning an empty list. `readdirSync` already throws if a
 * directory moves, but the FILTER can go stale silently — and every test here
 * is a `doesNotMatch` over whatever this returns, so an empty list is a clean
 * run of a suite that examined nothing. Verified by changing the extension to
 * one nothing uses: the whole file went green, 1,362 passing, having read zero
 * source files.
 */
const MIN_SOURCES = 8;

function sources(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const dir of [path.join(ROOT, 'app'), path.join(ROOT, 'src', 'ui')]) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.tsx')) continue;
      out.push([f, fs.readFileSync(path.join(dir, f), 'utf8')]);
    }
  }
  if (out.length < MIN_SOURCES) {
    throw new Error(
      `sweep found only ${out.length} .tsx files (expected at least ${MIN_SOURCES}) — ` +
      'the tests below would pass without looking at anything'
    );
  }
  return out;
}

/**
 * A modal must not outlive the screen that opened it.
 *
 * React Native's Modal is not a child of the tree that renders it — on
 * react-native-web it is portalled into a div on `document.body`, and the
 * navigator's only way of hiding a screen is to hide the screen's own view. So
 * the modal survives the navigation.
 *
 * Measured on the running app: open the day chooser on the logging screen, tap
 * PROGRESS, and it was still there — painted over Progress, and still
 * hit-testable, so `elementFromPoint(187, 700)` returned its PULL chip and the
 * day of a workout could be changed from a screen with nothing to do with
 * workouts. Every sheet in the app had it.
 *
 * `ScreenModal` unmounts on blur. These tests exist because the bug is a
 * property of Modal itself: the next sheet anyone writes would have it too, and
 * nothing else in the suite would notice.
 */
describe('no sheet outlives its screen', () => {
  test('nothing renders a bare <Modal>', () => {
    for (const [name, src] of sources()) {
      if (name === 'ScreenModal.tsx') continue;   // the one place it is allowed
      assert.doesNotMatch(src, /<Modal[\s>]/,
        `${name} renders a raw Modal, which keeps painting after the navigator ` +
        'hides its screen — use ScreenModal');
    }
  });

  test('ScreenModal is the only importer of Modal', () => {
    for (const [name, src] of sources()) {
      if (name === 'ScreenModal.tsx') continue;
      const imports = src.match(/import \{[^}]*\} from 'react-native';/s);
      if (!imports) continue;
      assert.doesNotMatch(imports[0], /\bModal\b/,
        `${name} still imports Modal from react-native`);
    }
  });

  test('ScreenModal actually unmounts rather than hiding', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'ScreenModal.tsx'), 'utf8');
    assert.match(src, /if \(!focused\) return null;/,
      'hiding it with a style would leave the portal in place and still hit-testable');
    assert.match(src, /useFocusEffect/, 'nothing tracks whether the screen is focused');
    assert.match(src, /useState\(true\)/,
      'starting unfocused blanks every sheet for a frame on the way up — focus ' +
      'effects do not run until after the first commit');
  });

  test('the sheets that existed when this was found all use it', () => {
    // `SettingsSheet.tsx` was on this list until R232 deleted it: it was the
    // jump-amounts sheet from when §9 still banned a settings SCREEN, and it
    // survived the owner's overrule as a second control labelled SETTINGS
    // showing different things from the first.
    for (const f of ['NowScreen.tsx', 'ConfirmSheet.tsx']) {
      const src = fs.readFileSync(path.join(ROOT, 'src', 'ui', f), 'utf8');
      assert.match(src, /<ScreenModal/, `${f} lost its ScreenModal`);
    }
    assert.match(fs.readFileSync(path.join(ROOT, 'app', 'goals.tsx'), 'utf8'), /<ScreenModal/);
  });
});

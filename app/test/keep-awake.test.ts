import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { region, upTo } from './helpers/source.ts';
import { nowScreenSource } from './helpers/now-screen.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = nowScreenSource();
const PKG = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));

/**
 * The screen stays lit while a workout is on.
 *
 * §4's claim is that this is the fastest way to record a set, and the phone
 * locking during a three-minute rest undoes it for every set after the first —
 * you come back to a lock screen, unlock, and only then are you where you
 * already were. `expo-keep-awake` had been sitting in package.json unused since
 * the project started.
 *
 * The behaviour itself cannot be asserted here — it is a platform lock — and it
 * cannot be verified in the web preview either, because the pane renders with
 * `document.visibilityState === 'hidden'` and the Wake Lock API refuses a
 * request from a page that is not visible. What was verified there is the shape:
 * no request before the first set, exactly one after it, and the refusal
 * swallowed without disturbing the log. These pin the decisions behind that.
 */
describe('the screen does not sleep mid-workout (§4)', () => {
  test('the dependency it needs is declared', () => {
    assert.ok(PKG.dependencies['expo-keep-awake'],
      'expo-keep-awake was removed — the effect below will throw at runtime');
  });

  test('the hold is tied to an active workout, not to the screen being open', () => {
    assert.match(SOURCE, /const working = state\.canFinish;/,
      'gating on mount would hold the lock any time the app is open, which is ' +
      'battery spent on a screen nobody is using');
    assert.match(SOURCE, /if \(!working\) return;/);
    assert.match(SOURCE, /\}, \[working\]\);/, 'the effect must re-run when the workout starts or ends');
  });

  test('it is released, not just taken', () => {
    const block = region(SOURCE, 'const working = state.canFinish;');
    const effect = upTo(block, '}, [working]);');
    assert.match(effect, /return \(\) => \{[^}]*deactivateKeepAwake/,
      'without a cleanup the lock survives FINISH and leaving the screen');
  });

  test('a platform that refuses does not cost a set', () => {
    const block = region(SOURCE, 'const working = state.canFinish;');
    const effect = upTo(block, '}, [working]);');
    // Measured: on web the request rejects with NotAllowedError whenever the
    // page is not visible, which is a normal state, not an error case.
    assert.match(effect, /feedback\(\(\) => KeepAwake\.activateKeepAwakeAsync/,
      'a bare call would surface a routine rejection as an unhandled promise');
    assert.match(effect, /feedback\(\(\) => KeepAwake\.deactivateKeepAwake/,
      'deactivate throws when no lock is held for the tag — which is exactly ' +
      'what happens after a request was refused');
  });

  test('the tag is namespaced, so releasing ours cannot cancel somebody else\'s', () => {
    assert.match(SOURCE, /const KEEP_AWAKE_TAG = 'proof-workout';/);
    assert.doesNotMatch(SOURCE, /activateKeepAwakeAsync\(\)/,
      'the default tag is shared with every other holder in the process');
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOTS = [path.join(HERE, '..', 'src', 'ui'), path.join(HERE, '..', 'app')];

/**
 * The app's sense of touch stopped at the edge of one file.
 *
 * Twelve haptic calls on the logging screen and **none** on Goals, Progress or
 * Settings — so stepping a rep count by one buzzed, and wiping all thirty-one
 * of your targets did not. `haptics.ts` names four verbs by intent so the next
 * screen does not pick an intensity at random.
 */
describe('destructive actions are felt, not just seen', () => {
  function read(name: string): string {
    for (const root of ROOTS) {
      const p = path.join(root, name);
      if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    }
    throw new Error(`no ${name}`);
  }

  test('wiping goals is the heaviest thing the goals screen does, and feels it', () => {
    assert.match(read('goals.tsx'), /buzz\.destroyed\(\)/,
      'you can destroy a year of targets from this screen');
  });

  test('and putting them back is felt too', () => {
    assert.match(read('goals.tsx'), /buzz\.undid\(\)/);
  });

  test('erasing everything is felt, on both routes to it', () => {
    const progress = read('progress.tsx');
    assert.equal((progress.match(/buzz\.destroyed\(\)/g) || []).length, 2,
      'the empty-state and the populated screen each have their own erase path');
  });

  test('preferences acknowledge the tap', () => {
    assert.match(read('settings.tsx'), /buzz\.chose\(\)/,
      'a preference that changes with no sound leaves you tapping it twice');
  });

  /*
   * The reason every call is swallowed: this is invoked from inside write
   * paths, and expo-haptics is a no-op on web that can still reject.
   */
  test('a phone that cannot buzz never breaks a write', () => {
    const src = read('haptics.ts');
    assert.match(src, /catch\?\.\(\(\) => \{\}\)/, 'the promise must be caught');
    assert.match(src, /try \{/, 'and the synchronous throw caught too');
  });

  test('the verbs are named for what happened, not how hard it buzzes', () => {
    const src = read('haptics.ts');
    for (const verb of ['chose', 'did', 'undid', 'destroyed']) {
      assert.match(src, new RegExp(`${verb}:`), `missing verb ${verb}`);
    }
  });
});

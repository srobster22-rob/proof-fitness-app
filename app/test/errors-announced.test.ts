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
 * R658. Nothing in the app was a live region, so an error that appeared after
 * an action -- a bad jump value in Settings, an empty RECORD IT on Measure, a
 * share sheet that cannot open -- was painted and never read. Focus does not
 * move to it, and a screen-reader user tapped a button and heard nothing.
 *
 * Each of these renders only once there is an error. `role="alert"` is the
 * semantics that gets announced on insertion; `aria-live` on a node that is not
 * in the page until it has text is often missed. react-native-web 0.21 emits
 * the role straight through.
 */
describe('an error that appears after an action is announced (R658)', () => {
  test('every conditionally rendered error message is an alert', () => {
    let found = 0;
    const offenders: string[] = [];
    for (const [name, src] of sources()) {
      for (const m of src.matchAll(/\{\s*(\w*[eE]rror)\s*&&\s*(<Text\b[^>]*>)/g)) {
        found++;
        if (!/accessibilityRole="alert"/.test(m[2])) {
          offenders.push(`${name}:${src.slice(0, m.index).split('\n').length} (${m[1]})`);
        }
      }
    }
    assert.deepEqual(offenders, [],
      'these error messages appear after an action and are never announced -- give them accessibilityRole="alert"');
    assert.ok(found >= 5,
      `found ${found} error messages; Goals, both Measure sheets, Settings and Recap make five, so the scan went stale`);
  });
});

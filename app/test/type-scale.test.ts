import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { TYPE, TEXT_SCALE, NUMERAL_SCALE } from '../src/ui/type.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOTS = [path.join(HERE, '..', 'src', 'ui'), path.join(HERE, '..', 'app')];

/**
 * The app had reached 28 distinct font sizes, eight of them half-points.
 *
 * A half-point difference is never a decision anyone made — it is what happens
 * when each screen gets nudged on its own, and the result is that the same KIND
 * of text is set differently depending on which screen you are looking at.
 * That is what makes an app feel unfinished when every screen looks fine.
 *
 * This is the guard. It reads the stylesheets, so the twenty-ninth size fails
 * here rather than shipping.
 */
describe('the type scale is the only source of sizes', () => {
  const ALLOWED = new Set<number>([...TEXT_SCALE, ...NUMERAL_SCALE]);

  function sources(): Array<{ name: string; text: string }> {
    const out: Array<{ name: string; text: string }> = [];
    for (const root of ROOTS) {
      for (const f of fs.readdirSync(root)) {
        if (!/\.tsx?$/.test(f)) continue;
        out.push({ name: f, text: fs.readFileSync(path.join(root, f), 'utf8') });
      }
    }
    return out;
  }

  test('there are stylesheets to check', () => {
    assert.ok(sources().length >= 6);
  });

  test('no literal font size is off the scale', () => {
    const stray: string[] = [];
    for (const { name, text } of sources()) {
      for (const m of text.matchAll(/fontSize:\s*([0-9]+(?:\.[0-9]+)?)/g)) {
        const n = Number(m[1]);
        if (!ALLOWED.has(n)) stray.push(`${name}: ${n}px`);
      }
    }
    assert.deepEqual([...new Set(stray)].sort(), [],
      'pick the nearest step in TEXT_SCALE, or add it to the scale on purpose');
  });

  /*
   * The specific thing that had gone wrong. Named so a regression says what it
   * is rather than just "off the scale".
   */
  test('no half-point sizes anywhere', () => {
    const halves: string[] = [];
    for (const { name, text } of sources()) {
      for (const m of text.matchAll(/fontSize:\s*([0-9]+\.[0-9]+)/g)) halves.push(`${name}: ${m[1]}`);
    }
    assert.deepEqual(halves, [], 'a half-point difference is always a mistake');
  });

  test('the steps are far enough apart to read as steps', () => {
    for (let i = 1; i < TEXT_SCALE.length; i++) {
      assert.ok(TEXT_SCALE[i] - TEXT_SCALE[i - 1] >= 1,
        `${TEXT_SCALE[i - 1]} and ${TEXT_SCALE[i]} are a nudge, not a step`);
    }
  });

  test('every named role in TYPE is on the scale it belongs to', () => {
    for (const [role, size] of Object.entries(TYPE)) {
      assert.ok((TEXT_SCALE as readonly number[]).includes(size),
        `TYPE.${role} = ${size} is not a step of the text scale`);
    }
  });

  test('the two scales do not overlap, or the distinction means nothing', () => {
    const both = TEXT_SCALE.filter(n => (NUMERAL_SCALE as readonly number[]).includes(n));
    assert.deepEqual(both, []);
  });
});

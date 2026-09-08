import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const TOOL = path.join(APP, 'tools', 'screen-render.cjs');
const DOC = readFileSync(path.join(APP, '..', 'BUILD_LOOP.md'), 'utf8');

/*
 * The screen renderer stands in for a screenshot this environment cannot take.
 *
 * The Browser pane does not composite frames unless it is displayed, so every
 * judgement about the four screens came from an accessibility tree — which
 * catches a clipped string and says nothing about whether a block floats. The
 * tool draws real `getBoundingClientRect` boxes with real colours and sizes.
 *
 * It is worth a test because it is the ONLY way anyone here can look at a
 * screen, and because its first version silently dropped content: see below.
 */
describe('a screen can be drawn from its measured geometry', () => {
  const capture = {
    vw: 200, vh: 120,
    els: [
      { x: 0, y: 0, w: 200, h: 120, fs: 14, c: '#ffffff', bg: '#08090a', bb: null, fw: 400, t: '' },
      { x: 10, y: 10, w: 90, h: 20, fs: 14, c: '#ffffff', bg: null, bb: null, fw: 800, t: 'HELLO' },
      { x: 10, y: 40, w: 180, h: 40, fs: 12, c: '#000000', bg: '#ccff00', bb: null, fw: 900, t: 'LOG SET' }
    ]
  };

  const run = (body: unknown, name: string) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'proof-cap-'));
    const file = path.join(dir, 'cap.json');
    writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
    const out = execFileSync('node', [TOOL, file, name], { cwd: APP, encoding: 'utf8' });
    return { out, png: path.join(APP, 'out', name + '.png') };
  };

  test('it draws a capture and reports what it drew', () => {
    const { out, png } = run(capture, 'test-screen');
    assert.match(out, /200x120, 3 elements/);
    assert.ok(statSync(png).size > 300, 'the PNG is too small to contain anything');
  });

  test('it survives the shapes a saved tool result actually arrives in', () => {
    // A large browser result reaches disk as [{ type, text }] with the JSON
    // inside `text` and a human-readable trailer after it. Guessing that depth
    // wrong cost three attempts, so both shapes are pinned.
    const wrapped = JSON.stringify([{ type: 'text', text: JSON.stringify(capture) }]) +
      '\n\nTab Context:\n- Executed on tabId: seed\n';
    const { out } = run(wrapped, 'test-wrapped');
    assert.match(out, /3 elements/);
  });

  test('a capture with no elements is refused, not silently drawn blank', () => {
    // Same rule the sweeps learned: an empty run must not look like a clean one.
    assert.throws(() => run({ vw: 100, vh: 100 }, 'test-empty'));
  });

  test('the documented capture takes DIRECT text nodes, not leaves only', () => {
    /*
     * The first version used `e.children.length ? '' : e.innerText`, which
     * looks like the obvious way to avoid drawing a string once per ancestor.
     * It drops any element holding text AND an element child — on the Now
     * screen the rep VALUE is exactly that (`9` beside a nested ` reps`), so
     * the render came out with steppers around an empty space.
     */
    const section = region(DOC, '## Seeing a screen when you cannot screenshot one', '## The sweep');
    // Positive assertions only. An earlier version also asserted the broken
    // rule was ABSENT, and failed on the paragraph that quotes it in order to
    // explain it — the documentation of a bug is not the bug.
    assert.match(section, /const t = \[\.\.\.e\.childNodes\]/,
      'the capture no longer reads direct text nodes — nested values will vanish');
    assert.match(section, /nodeType === 3/);
    assert.match(section, /elementFromPoint/,
      'the capture draws content that is scrolled away or behind an overlay, over whatever is really there');
    assert.match(section, /checkVisibility/,
      'the capture would include screens hidden behind the current route');
    // And the reason has to survive next to it, or the rule looks arbitrary.
    assert.match(section, /rep VALUE/,
      'the explanation of why leaves-only fails has been removed');
  });
});

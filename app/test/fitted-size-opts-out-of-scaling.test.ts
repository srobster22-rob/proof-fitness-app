import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');

/**
 * Files that legitimately use layoutFor's fitted sizes on-screen text.
 * Extend this when a new screen adopts the same "already fitted to the
 * screen" pattern -- the population is small and explicit on purpose.
 */
const FILES = ['src/ui/NowScreen.tsx'];

/*
 * R569. layoutFor's whole job is fitting a number to the screen it renders on
 * -- L.hero IS the answer to "how big can this be and still fit". Dynamic
 * Type multiplies a system font scale on TOP of whatever fontSize a Text or
 * TextInput is given, regardless of which element carries that fontSize, so
 * anything styled from a layoutFor value has to opt out or it gets fitted
 * twice: once by layoutFor, once by the OS, off the edge of the phone.
 *
 * R339 found and fixed this on the RESTING <Text>. The identical TextInput
 * that opens when a lifter taps that number to type a new one was never
 * checked -- same fontSize, same risk, no allowFontScaling prop at all -- and
 * thirty-nine individual exemptions had been added across three files by
 * hand, one crash at a time, with nothing checking the set was complete.
 *
 * This is structural rather than a fixed list of elements: it finds every
 * `fontSize: L.<something>` (or any layout-derived identifier) and requires
 * `allowFontScaling={false}` to appear before the next JSX tag closes, so a
 * FUTURE element built the same way is covered without anyone remembering to
 * add it here.
 */
describe('a font size fitted to the screen never gets fitted twice (R569)', () => {
  test('the scan finds fitted-size elements to check', () => {
    let found = 0;
    for (const file of FILES) {
      const src = fs.readFileSync(path.join(APP, file), 'utf8');
      found += (src.match(/fontSize:\s*L\.\w+/g) ?? []).length;
    }
    assert.ok(found >= 2, `only found ${found} fitted-size elements -- the pattern has drifted`);
  });

  test('every element styled from a fitted size opts out of Dynamic Type', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const src = fs.readFileSync(path.join(APP, file), 'utf8');
      const lines = src.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!/fontSize:\s*L\.\w+/.test(lines[i])) continue;
        // Look forward to the element's own closing `>` -- allowFontScaling
        // can sit on the same line, the next, or further down among other
        // props, but must appear before this element's tag ends. Comments are
        // stripped first: the fix this test found for itself put a `<Text>`
        // inside an explanatory /* */ comment right above the prop, and a `>`
        // inside PROSE closed the scan before it reached the real prop,
        // reporting the very element it had just been fixed on.
        const aheadRaw = lines.slice(i, i + 12).join('\n');
        const ahead = aheadRaw.replace(/\/\*[\s\S]*?\*\//g, '');
        const closesAt = ahead.indexOf('>');
        const scanned = closesAt >= 0 ? ahead.slice(0, closesAt + 1) : ahead;
        if (!/allowFontScaling=\{false\}/.test(scanned)) {
          offenders.push(`${file}:${i + 1} — ${lines[i].trim()}`);
        }
      }
    }
    assert.deepEqual(offenders, [],
      'these elements use a font size already fitted to the screen but do not opt out ' +
      'of Dynamic Type, so the OS scales an already-maximal number a second time:\n' +
      offenders.join('\n'));
  });

  test('the R339 fix this round found a sibling of is still in place', () => {
    const src = fs.readFileSync(path.join(APP, 'src', 'ui', 'NowScreen.tsx'), 'utf8');
    assert.match(src, /R569: the sibling of the R339 fix/,
      'the note explaining why the typed-weight field needs this is gone');
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onState } from '../src/ui/press-style.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

/** Every `<Pressable ...>` opening tag in a file, whole. */
function pressables(src: string): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  const re = /<Pressable\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + '<Pressable'.length, depth = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push([m.index, src.slice(m.index, i + 1)]);
  }
  return out;
}

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
 * R474. `SELECTED` is a colour swap, and colour is exactly what a screen-reader
 * user does not get.
 *
 * Measured in the running app before any of this was written: on Settings, the
 * chosen split, the chosen unit and the chosen language were each painted
 * `rgb(26, 31, 10)` against transparent siblings, and all three reported
 * `aria-selected`, `aria-checked` AND `aria-pressed` as null. The one screen
 * whose entire job is showing current settings could not say what any of them
 * were. Fifteen controls were silent this way; one spoke, and it spoke through
 * `accessibilityState`, which react-native-web 0.21 no longer forwards at all —
 * so on the surface every round of this project verifies against, the count of
 * controls announcing their selection was ZERO.
 *
 * The population is derived from source rather than listed, because a list is
 * the thing that drifts (HANDOFF trap 13): anything whose STYLE paints a
 * conditional selected state has to SAY it, and a chip added next year enters
 * the checked set by being written the same way as its neighbours.
 */

/** A style entry that only applies when this control is the chosen one. */
const PAINTS_SELECTED = /&&\s*s\.\w*On\b|&&\s*SELECTED\b/;

/*
 * Exemptions, by name and with a reason. Nothing is excluded silently — a
 * positive assertion must fail loudly unless somebody wrote down why it does
 * not apply.
 */
const EXEMPT: Array<{ file: string; why: string; match: RegExp }> = [
  {
    file: 'settings.tsx',
    why: 'the skip-machine checkbox: a checkbox says `aria-checked`, not selected',
    match: /aria-checked=/
  },
  {
    file: 'NowScreen.tsx',
    why: 'the skip-machine checkbox, same reason',
    match: /aria-checked=/
  }
];

describe('a selected control says so (§4)', () => {
  test('the helper emits both attributes, because neither platform takes one', () => {
    // iOS reads `aria-selected` (React Native maps it to the selected trait);
    // the web ignores it on role=button and reads `aria-pressed`. Pinned here
    // so dropping either half fails rather than silently halving the coverage.
    assert.deepEqual({ ...onState(true) }, { 'aria-selected': true, 'aria-pressed': true });
    assert.deepEqual({ ...onState(false) }, { 'aria-selected': false, 'aria-pressed': false });
  });

  test('every control that PAINTS a selection also announces one', () => {
    // Counted: `assert` inside an empty loop passes perfectly, and an
    // instrument that reports no problems must report how much it examined
    // (HANDOFF trap 10).
    let painted = 0;
    const offenders: string[] = [];
    for (const [name, src] of sources()) {
      for (const [idx, tag] of pressables(src)) {
        if (!PAINTS_SELECTED.test(tag)) continue;
        painted++;
        if (/\{\.\.\.onState\(/.test(tag)) continue;
        const excused = EXEMPT.find(e => e.file === name && e.match.test(tag));
        if (excused) continue;
        offenders.push(`${name}:${src.slice(0, idx).split('\n').length}`);
      }
    }
    assert.deepEqual(offenders, [],
      'these controls change colour when chosen and say nothing about it — ' +
      'spread {...onState(<the same condition the style uses>)} onto them');
    assert.ok(painted >= 15,
      `only ${painted} selection-painting controls found — the scan went stale`);
  });

  test('nothing reaches for accessibilityState, which the web silently drops', () => {
    // react-native-web 0.21 removed it from the forwarded props entirely, so a
    // control using it looks correct in the source and announces nothing in the
    // browser. This is how the one control that DID speak was still silent.
    for (const [name, src] of sources()) {
      assert.doesNotMatch(src, /accessibilityState=/,
        `${name}: use aria-checked, or onState() — accessibilityState is dropped on web`);
    }
  });
});

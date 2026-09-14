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

/**
 * A Pressable's OWN children: the text from the end of its opening tag to its
 * matching `</Pressable>`, with every nested Pressable cut out. `tags` maps a
 * tag's start index to its full text, so a nested self-closing tag is skipped
 * without changing the depth.
 */
function ownChildren(src: string, from: number, tags: Map<number, string>): string {
  let out = '', depth = 1, i = from;
  const re = /<Pressable\b|<\/Pressable>/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (depth === 1) out += src.slice(i, m.index);
    if (m[0] === '</Pressable>') {
      depth--;
      if (depth === 0) return out;
    } else {
      const tag = tags.get(m.index) ?? '<Pressable';
      if (!tag.endsWith('/>')) depth++;
      re.lastIndex = m.index + tag.length;
    }
    i = re.lastIndex;
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

  /*
   * R654. The sweep above reads only each Pressable's OPENING TAG, so a control
   * that paints its selected state on its CHILDREN escaped it. The tab bar did:
   * `on && s.tabGlyphOn` sits on the Texts inside each tab, and the tab you were
   * on reported `aria-disabled` -- measured on Progress -- with nothing saying
   * selected. This reads each Pressable's OWN children, with nested Pressables
   * cut out: a sheet's backdrop contains every chip in the sheet, and each chip
   * is judged by its own tag rather than charged to the backdrop.
   */
  test('a control that paints its selection on its children announces it too (R654)', () => {
    let childPainted = 0;
    const offenders: string[] = [];
    for (const [name, src] of sources()) {
      const tags = new Map(pressables(src));
      for (const [idx, tag] of tags) {
        if (tag.endsWith('/>') || PAINTS_SELECTED.test(tag)) continue;
        if (!PAINTS_SELECTED.test(ownChildren(src, idx + tag.length, tags))) continue;
        childPainted++;
        if (/\{\.\.\.onState\(/.test(tag)) continue;
        // Same named exemptions as the tag sweep: the skip-machine checkbox
        // colours its child box and says `aria-checked`, which is right for a
        // checkbox (measured live on Settings: aria-checked "false").
        if (EXEMPT.find(e => e.file === name && e.match.test(tag))) continue;
        offenders.push(`${name}:${src.slice(0, idx).split('\n').length}`);
      }
    }
    assert.deepEqual(offenders, [],
      'these controls colour their children when chosen and say nothing about it -- ' +
      'spread {...onState(<the same condition>)} onto the Pressable itself');
    assert.ok(childPainted >= 1,
      `found ${childPainted} child-painted controls; the tab bar alone should count, so the scan went stale`);
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

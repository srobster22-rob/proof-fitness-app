import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

/** Each `<Pressable ...>` opening tag with its OWN children (up to the next Pressable tag). */
function controls(src: string): Array<{ line: number; tag: string; children: string }> {
  const out: Array<{ line: number; tag: string; children: string }> = [];
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
    const tag = src.slice(m.index, i + 1);
    if (tag.endsWith('/>')) continue;
    const rest = src.slice(i + 1);
    const stop = rest.search(/<Pressable\b|<\/Pressable>/);
    out.push({
      line: src.slice(0, m.index).split('\n').length,
      tag,
      children: rest.slice(0, stop < 0 ? rest.length : stop)
    });
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
 * R657. A control that opens and closes something showed its state with a
 * caret (open, closed) and nothing else -- and a button's own label replaces
 * its children, so the caret was never read. Goals' unit picker said only
 * which unit was chosen; a screen-reader user tapped it and was not told a
 * menu had opened. react-native-web 0.21 forwards `aria-expanded` (it drops
 * `accessibilityState`), so that is the attribute used.
 */
describe('a control that opens something says whether it is open (R657)', () => {
  test('every caret-toggling control carries aria-expanded', () => {
    let carets = 0;
    const offenders: string[] = [];
    for (const [name, src] of sources()) {
      for (const c of controls(src)) {
        if (!/\?\s*'▴'\s*:\s*'▾'/.test(c.children)) continue;
        carets++;
        if (!/aria-expanded=\{/.test(c.tag)) offenders.push(`${name}:${c.line}`);
      }
    }
    assert.deepEqual(offenders, [],
      'these controls flip an open/closed caret and never tell a screen reader which it is -- add aria-expanded');
    assert.ok(carets >= 2,
      `found ${carets} caret toggles; Goals' unit picker and Measure's readings toggle should both count, so the scan went stale`);
  });

  test('the two known disclosures use their own open state', () => {
    const goals = readFileSync(path.join(ROOT, 'app', 'goals.tsx'), 'utf8');
    const measure = readFileSync(path.join(ROOT, 'app', 'measure.tsx'), 'utf8');
    assert.match(goals, /aria-expanded=\{unitOpen\}/, 'the unit picker does not say whether its menu is open');
    assert.match(measure, /aria-expanded=\{expanded\}/, 'the readings toggle does not say whether the list is open');
  });
});

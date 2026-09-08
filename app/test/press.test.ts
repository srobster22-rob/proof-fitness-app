import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pressStyle, dangerPressStyle } from '../src/ui/press-style.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.join(HERE, '..', ...p.split('/')), 'utf8');

/*
 * Every real .tsx that actually calls pressStyle(...), derived rather than
 * hand-picked — a hand-maintained list here is the exact shape R405 found in
 * RepoGate.tsx: the one file added later for a genuinely different reason is
 * also the one nobody remembers to add to a remembered array.
 */
function allTsxFiles(): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(path.join(HERE, '..', dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.tsx')) out.push(rel);
    }
  }
  walk('src/ui');
  walk('app');
  return out;
}
const pressStyleUsers = () => allTsxFiles().filter(f => /\bpressStyle\(/.test(read(f)));

/** Both style functions return an array with `null`s mixed in — flatten to one object to assert on. */
const flatten = (style: unknown): Record<string, unknown> =>
  (style as Array<Record<string, unknown> | null>).filter((x): x is Record<string, unknown> => x != null)
    .reduce((acc, s) => ({ ...acc, ...s }), {});

/*
 * R137 found "158 Pressables, 4 acknowledged a press" and built `pressStyle`
 * to fix it. `dangerPressStyle` (R272) exists because that fix's own `surface`
 * kind is wrong for exactly one control: `ConfirmSheet`'s destructive CONFIRM
 * button, whose held state is a fixed neutral grey that would wipe the danger
 * red the button is red to communicate. These are style FUNCTIONS returned by
 * a factory, not components — testable directly, without a renderer.
 */
describe('press feedback actually changes something', () => {
  test('pressStyle: the pressed state differs from the resting one', () => {
    const style = pressStyle({ padding: 10 }, 'surface', false);
    const resting = style({ pressed: false });
    const held = style({ pressed: true });
    assert.notDeepEqual(resting, held, 'a tap must visibly change something');
  });

  test('dangerPressStyle: pressed deepens the SUPPLIED colour, not a fixed grey', () => {
    const RESTING = '#2A1416';
    const style = dangerPressStyle({ backgroundColor: RESTING }, '#3A1418', false);
    const flat = flatten(style({ pressed: true }));
    assert.equal(flat.backgroundColor, '#3A1418',
      'pressed must show the danger colour deepening, not press.ts\'s fixed grey');
    assert.notEqual(flat.backgroundColor, '#161C22', // HELD.surface's grey
      'this must not be the generic surface grey — that would erase the warning colour');
  });

  test('dangerPressStyle: still (reduced motion) drops the scale but keeps the colour', () => {
    const style = dangerPressStyle({}, '#3A1418', true);
    const flat = flatten(style({ pressed: true }));
    assert.equal(flat.backgroundColor, '#3A1418');
    assert.equal(flat.transform, undefined, 'reduced motion must not scale the button');
  });

  test('dangerPressStyle: resting state does not carry the pressed colour', () => {
    const style = dangerPressStyle({ backgroundColor: '#2A1416' }, '#3A1418', false);
    const flat = flatten(style({ pressed: false }));
    assert.equal(flat.backgroundColor, '#2A1416', 'the button must not look pressed before it is');
  });
});

/*
 * R137's rule ("every Pressable acknowledges a press") had no regression
 * guard, and it regressed: `app/progress.tsx` shipped six Pressables — DONE,
 * the YOU row, EXPORT, RESTORE, SETTINGS, ERASE EVERYTHING — with zero
 * `pressStyle`/`dangerPressStyle` calls between them (found and fixed R279).
 * Two of those are the app's only data-destroying controls outside
 * `ConfirmSheet` itself.
 *
 * Scoped to this one screen rather than swept across all of them: running the
 * same count against `NowScreen.tsx` (39 Pressables, 13 treated) and
 * `ConfirmSheet.tsx` (4 Pressables, 2 treated — but those 2 are the backdrop
 * and the sheet's own tap-passthrough, neither a button) shows the rule is
 * genuinely more nuanced than 1:1 everywhere, and asserting a number on files
 * nobody has audited risks pinning a gap rather than catching one. Left as a
 * named next step rather than a failing or a silently-loosened test.
 */
test('app/progress.tsx: as many press treatments as Pressables', () => {
  const src = read('app/progress.tsx');
  const pressables = (src.match(/<Pressable\b/g) ?? []).length;
  const treated = (src.match(/\bpressStyle\(|\bdangerPressStyle\(/g) ?? []).length;
  assert.ok(pressables > 0, 'no Pressable found — did the file move?');
  assert.equal(treated, pressables,
    `${pressables} Pressables but only ${treated} press-style calls — find the bare one(s)`);
});

/*
 * The follow-up R279 named: `NowScreen.tsx` was 39 Pressables against 13
 * press-style calls. Audited by hand (a blunt regex count double-counts a
 * treatment that sits past a long comment, and undercounts nothing — both
 * false positives were checked individually before trusting them) and fixed
 * 11 real gaps: the settings gear, the equipment tag, both hero numbers, the
 * rail chips, EDIT SET's save and remove, the exercise picker's ADD and
 * "something else", the equipment sheet's kit/machine chips, its checkbox
 * and CLEAR, and the day-chooser's plan-swap link and day chips. Two of the
 * day-chooser's SKIP buttons also called `pressStyle` without `still`,
 * silently ignoring reduced-motion — fixed alongside, same round.
 *
 * Four backdrop `Pressable`s and four `stopPropagation` passthroughs are
 * real exceptions, not gaps — tapping outside a sheet to dismiss it, or the
 * sheet's own body absorbing a tap so it doesn't reach the backdrop under it,
 * are not buttons and must not look pressable. Counted by name so the
 * exemption cannot silently grow to cover a real gap later.
 */
/*
 * The same audit, same round (R281), on `app/goals.tsx` — 23 Pressables
 * against 6 press-style calls. Fixed 15 real gaps: the undo/dismiss pair,
 * CHANGE and WIPE on every card, the "got it" close button, both exercise
 * chips, the target stepper and jump pair, both rep chips, and the BY-unit
 * button and its menu items. Two more instances of the missing-`still`
 * bug NowScreen's SKIP buttons had (R280) turned up here too — SET GOAL and
 * "got it" both called `pressStyle(..., 'primary')` with no third argument,
 * silently ignoring reduced-motion.
 */
test('app/goals.tsx: as many press treatments as Pressables, minus named exceptions', () => {
  const src = read('app/goals.tsx');
  const pressables = (src.match(/<Pressable\b/g) ?? []).length;
  const backdrops = (src.match(/style=\{s\.backdrop\}/g) ?? []).length;
  const passthroughs = (src.match(/onPress=\{e => e\.stopPropagation\(\)\}/g) ?? []).length;
  const treated = (src.match(/\bpressStyle\(|\bdangerPressStyle\(|\{\s*pressed\s*\}/g) ?? []).length;
  assert.ok(pressables > 15, `expected roughly 23 Pressables, found ${pressables} — did the file change shape?`);
  assert.equal(backdrops, 1, 'the named backdrop exemption count drifted');
  assert.equal(passthroughs, 1, 'the named passthrough exemption count drifted');
  assert.ok(treated >= pressables - backdrops - passthroughs,
    `${pressables} Pressables, ${backdrops + passthroughs} exempt by name, but only ${treated} ` +
    'press-style calls — a real control shipped with no press feedback');
});

/*
 * A different bug class than the coverage tests below, found while writing
 * them (R283): `pressStyle(x, 'kind')` called with no THIRD argument silently
 * defaults `still` to false — the control still gets its press treatment, but
 * ignores the system's reduced-motion setting regardless of what the user
 * asked for. Found five live instances this way: measure.tsx's unit chips
 * and two SAVE buttons, and NowScreen's plan-picker row — on top of the two
 * DayChooser SKIP buttons R280 already fixed by hand. A coverage count
 * cannot catch this (the call IS present); only reading each one's argument
 * list does.
 */
describe('every pressStyle(...) call passes its own still, not the default', () => {
  const SCREENS = pressStyleUsers();

  test('the scan actually found files that call pressStyle', () => {
    assert.ok(SCREENS.length >= 5, 'the scan found nothing, so it proves nothing');
  });

  for (const file of SCREENS) {
    test(file, () => {
      const src = read(file);
      // A bare `pressStyle(...)` call, stripped of nested parens/brackets so
      // a multi-arg style array inside it does not confuse the arg count —
      // then split on top-level commas and checked for a third argument.
      const calls = [...src.matchAll(/\bpressStyle\(/g)];
      const bad: string[] = [];
      for (const m of calls) {
        let depth = 1, i = m.index! + m[0].length;
        while (depth > 0 && i < src.length) {
          if (src[i] === '(' || src[i] === '[' || src[i] === '{') depth++;
          else if (src[i] === ')' || src[i] === ']' || src[i] === '}') depth--;
          i++;
        }
        const args = src.slice(m.index! + m[0].length, i - 1);
        // Top-level commas only — a naive split would cut inside `[a, b]`.
        let d = 0, commas = 0;
        for (const ch of args) {
          if ('([{'.includes(ch)) d++;
          else if (')]}'.includes(ch)) d--;
          else if (ch === ',' && d === 0) commas++;
        }
        if (commas < 2) bad.push(args.slice(0, 40));
      }
      assert.deepEqual(bad, [], `${file}: pressStyle called with no third (still) argument — ${bad.join(' | ')}`);
    });
  }
});

/*
 * The rest of the app, same round (R282). `app/measure.tsx` (16 Pressables,
 * 2 backdrops + 2 passthroughs, the rest already treated) needed nothing —
 * genuinely clean, confirmed rather than assumed. `app/settings.tsx` and
 * `app/recap.tsx` each had exactly one gap: Settings' EXPORT DATA · RESTORE
 * link to Progress, and Recap's BACK button on the "nothing logged" empty
 * state — the one screen state a first-ever user reaching this screen with
 * no session yet would actually see.
 */
for (const [file, backdrops, passthroughs] of [
  ['app/measure.tsx', 2, 2],
  ['app/settings.tsx', 0, 0],
  ['app/recap.tsx', 0, 0]
] as const) {
  test(`${file}: as many press treatments as Pressables, minus named exceptions`, () => {
    const src = read(file);
    const pressables = (src.match(/<Pressable\b/g) ?? []).length;
    const foundBackdrops = (src.match(/s\.backdrop/g) ?? []).length;
    const foundPassthroughs = (src.match(/onPress=\{e => e\.stopPropagation\(\)\}/g) ?? []).length;
    const treated = (src.match(/\bpressStyle\(|\bdangerPressStyle\(|\{\s*pressed\s*\}/g) ?? []).length;
    assert.ok(pressables > 0, `${file}: no Pressable found — did the file move?`);
    assert.equal(foundBackdrops, backdrops, `${file}: the named backdrop exemption count drifted`);
    assert.equal(foundPassthroughs, passthroughs, `${file}: the named passthrough exemption count drifted`);
    assert.ok(treated >= pressables - foundBackdrops - foundPassthroughs,
      `${file}: ${pressables} Pressables, ${foundBackdrops + foundPassthroughs} exempt by name, but only ` +
      `${treated} press-style calls — a real control shipped with no press feedback`);
  });
}

test('src/ui/NowScreen.tsx: as many press treatments as Pressables, minus named exceptions', () => {
  const src = read('src/ui/NowScreen.tsx');
  const pressables = (src.match(/<Pressable\b/g) ?? []).length;
  const backdrops = (src.match(/<Pressable style=\{s\.backdrop\}/g) ?? []).length;
  const passthroughs = (src.match(/onPress=\{e => e\.stopPropagation\(\)\}/g) ?? []).length;
  const treated = (src.match(/\bpressStyle\(|\bdangerPressStyle\(|\{\s*pressed\s*\}/g) ?? []).length;
  assert.ok(pressables > 30, `expected roughly 39 Pressables, found ${pressables} — did the file change shape?`);
  assert.equal(backdrops, 4, 'the named backdrop exemption count drifted — check what changed');
  assert.equal(passthroughs, 4, 'the named passthrough exemption count drifted — check what changed');
  assert.ok(treated >= pressables - backdrops - passthroughs,
    `${pressables} Pressables, ${backdrops + passthroughs} exempt by name, but only ${treated} ` +
    'press-style calls — a real control shipped with no press feedback');
});

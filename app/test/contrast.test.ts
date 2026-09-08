import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOTS = [path.join(HERE, '..', 'src', 'ui'), path.join(HERE, '..', 'app')];

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: string, b: string): number {
  const x = luminance(a) + 0.05, y = luminance(b) + 0.05;
  return Math.round((Math.max(x, y) / Math.min(x, y)) * 100) / 100;
}

/**
 * Every ground the app paints text on. The screen is the darkest and therefore
 * the most forgiving; a colour is only safe if it clears the LIGHTEST ground,
 * which is the text input fill.
 */
const GROUNDS = {
  screen: '#08090A',
  sheet: '#0C0E10',
  card: '#0E1114',
  input: '#111417'
};

const MIN = 4.5;

/**
 * The app's greys had drifted below legibility.
 *
 * Measured on the running Now screen: ten distinct text colours failing, the
 * worst at **1.83:1** where 4.5 is required — and one of them was the
 * NAVIGATION. `#39414A` at 1.93, `#4E5760` at 2.71, `#5A646E` at 3.31. Not one
 * of them was a deliberate "disabled" state; they were ordinary labels, hints,
 * the rest timer and the PROGRESS / GOALS links.
 *
 * The fix could not be "lighten each one a bit", because the first grey in the
 * ramp that actually passes is `#7C8792` at 5.05 and there is no room for four
 * distinct legible steps below it. So the four illegible greys were DELETED and
 * folded into the two legible ones already in the palette, and the fine-grained
 * de-emphasis they were doing is carried by the type scale instead — size,
 * weight and letter-spacing, which cost no contrast.
 *
 * This test is the guard. It reads the stylesheets rather than the rendered
 * app, because the rendered app only shows the colours on screen right now and
 * the next illegible grey will be added to a sheet nobody has open.
 */
describe('every text colour is legible on the ground it sits on', () => {
  /**
   * Comments stripped before anything is matched.
   *
   * Without this the guard fails on its own history: a comment explaining why
   * `#39414A` was removed CONTAINS `#39414A`, so documenting the fix trips the
   * test that enforces it — and the cheapest way to make that failure go away
   * is to delete the explanation. A rule that punishes writing down the reason
   * teaches people to stop writing down reasons.
   */
  function code(text: string): string {
    // `.` already stops at a line break without the `s` flag, which avoids
    // needing an escape that a shell heredoc will eat.
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  }

  function sources(): Array<{ name: string; text: string }> {
    const out: Array<{ name: string; text: string }> = [];
    for (const root of ROOTS) {
      for (const f of fs.readdirSync(root)) {
        if (!/\.tsx?$/.test(f)) continue;
        out.push({ name: f, text: code(fs.readFileSync(path.join(root, f), 'utf8')) });
      }
    }
    return out;
  }

  test('there are stylesheets to check', () => {
    assert.ok(sources().length >= 6, 'the sweep found nothing, so it proves nothing');
  });

  /*
   * Only `color:` and `placeholderTextColor` — a border or a fill is not text
   * and answers to a different threshold. Picking those up would ban the
   * hairlines this design is built from.
   */
  test('no colour used for text falls below 4.5:1 on any ground', () => {
    const bad: string[] = [];
    const RE = /(?:\bcolor:\s*|placeholderTextColor=)["']?(#[0-9A-Fa-f]{6})["']?/g;
    for (const { name, text } of sources()) {
      for (const m of text.matchAll(RE)) {
        const hex = m[1].toUpperCase();
        // The volt accent and near-white are the app's own; black is only ever
        // painted ON volt, which is checked separately below.
        if (hex === '#000000' || hex === '#000') continue;
        const worst = Math.min(...Object.values(GROUNDS).map(g => contrast(hex, g)));
        if (worst < MIN) bad.push(`${name}: ${hex} is ${worst}:1, needs ${MIN}`);
      }
    }
    assert.deepEqual([...new Set(bad)], [],
      'text below 4.5:1 — fold it into an existing legible grey rather than ' +
      'inventing another dim one, and let size and weight carry the hierarchy');
  });

  test('the four greys that failed are gone from the source entirely', () => {
    // Named, so the failure says which one came back and what it measured.
    const DELETED: Record<string, number> = {
      '#39414A': 1.83, '#3B444C': 1.86, '#4E5760': 2.51, '#5A646E': 3.07
    };
    const back: string[] = [];
    for (const { name, text } of sources()) {
      for (const [hex, was] of Object.entries(DELETED)) {
        if (text.toUpperCase().includes(hex)) back.push(`${name}: ${hex} (measured ${was}:1)`);
      }
    }
    assert.deepEqual(back, []);
  });

  test('black on volt is legible, since that is what every primary button is', () => {
    assert.ok(contrast('#000000', '#CCFF00') >= 4.5);
    // And the pressed shade, which is a different colour under the same text.
    assert.ok(contrast('#000000', '#B2DE00') >= 4.5);
  });

  test('the accent itself reads on every ground', () => {
    for (const [where, g] of Object.entries(GROUNDS)) {
      assert.ok(contrast('#CCFF00', g) >= MIN, `volt on ${where}`);
    }
  });

  /*
   * A guard on the guard: if the maths were wrong, everything would pass.
   */
  test('the calculator agrees with known values', () => {
    assert.equal(contrast('#FFFFFF', '#000000'), 21);
    assert.equal(contrast('#08090A', '#08090A'), 1);
    assert.ok(Math.abs(contrast('#39414A', '#08090A') - 1.93) < 0.02,
      'the grey that started this measured 1.93:1 on the screen ground');
  });
});

/*
 * A palette change can silently erase a state.
 *
 * R117 folded `#39414A` into `#7C8792` because it measured 1.83:1 against a
 * required 4.5 — correct for text, and it made `backupBusy` (which was
 * #39414A) identical to `backupLink` (#7C8792). The export/restore controls
 * stopped looking any different while an export was running: the disabled state
 * still existed in the code and had no effect on screen.
 *
 * Disabled styling is exempt from the contrast floor precisely because it is
 * meant to recede, so it has to say so some other way than a colour that the
 * next legibility pass can fold away.
 */
describe('a state that means "not right now" looks different', () => {
  const PROGRESS = fs.readFileSync(path.join(HERE, '..', 'app', 'progress.tsx'), 'utf8');

  /*
   * `region`, not a regex. Written as a `new RegExp` template first and the
   * shell ate the backslashes on the way in — `\n` arrived as a real newline —
   * which is the third time that has happened in this project. The helper takes
   * plain strings and cannot be mangled.
   */
  function styleOf(name: string): string {
    return region(PROGRESS, `  ${name}: {`, '}');
  }

  test('the busy style is not just the resting colour again', () => {
    const resting = (styleOf('backupLink').match(/color:\s*'(#[0-9A-Fa-f]{6})'/) || [])[1];
    const busy = (styleOf('backupBusy').match(/color:\s*'(#[0-9A-Fa-f]{6})'/) || [])[1];
    assert.notEqual(busy, resting,
      'busy and resting are the same colour, so nothing on screen changes while it works');
  });

  test('and it says "not right now" with opacity, which no palette pass can fold', () => {
    assert.match(styleOf('backupBusy'), /opacity:/);
  });
});

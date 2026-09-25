import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowScreenSource } from './helpers/now-screen.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = nowScreenSource();

function style(name: string): string {
  const m = SOURCE.match(new RegExp(`\\n  ${name}:\\s*\\{([^}]*)\\}`, 's'));
  assert.ok(m, `no style named "${name}" — it was renamed or removed`);
  return m![1];
}

/*
 * R514, for OWNER.md #1. The day rail scrolls horizontally and nothing said
 * so: the row stopped mid-word at the screen edge — "DB Shoul" — which reads
 * as broken rather than as more-to-come, and is a fair part of what the owner
 * called sloppy.
 *
 * A fade is the standard answer and a gradient would be a dependency, which
 * §12 forbids. So it is a ramp of solid background slices at rising opacity.
 * The properties below are what make that correct rather than merely present,
 * and each one is a way it could be built wrong:
 *
 *   - ABSOLUTE, because R512 established this column has no vertical slack at
 *     all (the 568px phone was already over budget). Anything here must cost
 *     zero layout height.
 *   - pointerEvents none, or the overlay eats taps on the chip underneath —
 *     and the chip underneath is the partially visible one a user is most
 *     likely to be reaching for.
 *   - the slice colour must be the background, or it is a grey bar rather than
 *     a fade. This is also what makes the overlay self-hiding when the chips do
 *     not reach the edge: background drawn over background.
 *   - the ramp must ascend and END opaque, or text bleeds through the last
 *     slice and the cut is back.
 */
describe('the day rail says it scrolls, and costs nothing to say it (R514)', () => {
  const ramp = (() => {
    const m = /const RAIL_FADE = \[([^\]]*)\]/.exec(SOURCE);
    assert.ok(m, 'RAIL_FADE is gone; the fade has no ramp to draw');
    return m![1].split(',').map(v => Number(v.trim()));
  })();

  test('the ramp ascends and finishes opaque', () => {
    assert.ok(ramp.length >= 4, `only ${ramp.length} steps — that bands rather than fades`);
    for (let i = 1; i < ramp.length; i++) {
      assert.ok(ramp[i] > ramp[i - 1],
        `step ${i} (${ramp[i]}) is not brighter than step ${i - 1} (${ramp[i - 1]})`);
    }
    assert.equal(ramp[ramp.length - 1], 1,
      'the last slice is not fully opaque, so the chip text bleeds past the fade');
    assert.ok(ramp[0] < 0.25, `the first slice is ${ramp[0]}, which starts as a visible edge`);
  });

  test('it costs the column no height', () => {
    // The R512 constraint, stated as a test rather than remembered.
    assert.match(style('railFade'), /position:\s*'absolute'/,
      'the fade is in the layout flow, so it takes height from a column that has none');
    assert.match(style('railFade'), /right:\s*0/, 'the fade is not at the edge it exists to soften');
  });

  test('it does not eat taps on the chip beneath it', () => {
    assert.match(SOURCE, /<View style=\{s\.railFade\} pointerEvents="none">/,
      'the overlay is interactive, so it swallows presses on the partly visible chip');
  });

  test('the slices are the background colour, which is what makes it a fade', () => {
    assert.match(style('railFadeSlice'), /backgroundColor:\s*BG/,
      'the slices are not the background colour, so this is a coloured bar, not a fade');
  });

  test('and the wrapper it sits in sets no size of its own', () => {
    /*
     * `railBand` has no explicit height on purpose — its own comment records
     * being pinned to a model number twice and being wrong both times. A
     * wrapper that introduced a height would put that back.
     */
    const wrapper = style('railScroller');
    assert.match(wrapper, /position:\s*'relative'/);
    assert.doesNotMatch(wrapper, /height|flex:/,
      'the fade wrapper sizes itself, so the band is no longer as tall as its content');
  });
});

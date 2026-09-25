import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { layoutFor, columnHeight } from '../src/ui/now-layout.ts';
import { nowScreenSource } from './helpers/now-screen.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = nowScreenSource();

function style(name: string): string {
  const m = SOURCE.match(new RegExp(`\\n  ${name}:\\s*\\{([^}]*)\\}`, 's'));
  assert.ok(m, `no style named "${name}" — it was renamed or removed`);
  return m![1];
}

/*
 * R515, for OWNER.md #1. The logging controls sit on a surface now.
 *
 * The screen was one flat field with everything floating on it, and nothing
 * grouped the three rows that are in fact ONE control. That is most of what
 * the owner meant by "too together" and "not app-appropriate": the app already
 * owned the card vocabulary (#111417 on #2A323A at radius 12-14, used by the
 * plan chooser) and had never applied it to the control the screen exists for.
 *
 * The whole difficulty is that a normal card pads its contents, and this
 * column has no room to give. R512 measured the shortest shipping phone at
 * 624px of unshrinkable content against 568px of screen: EIGHT pixels of top
 * padding was enough to push LOG SET below the fold, and that is exactly how
 * R511 broke it.
 *
 * So the panel is an absolute child with negative insets. It reaches out past
 * the rows to look like padding and contributes no height whatsoever.
 * Confirmed in the running app by A/B rather than by argument: LOG SET sits at
 * y475 and the document is 1175px tall, with the surface and without it,
 * unchanged to the pixel.
 *
 * These tests exist because that property is invisible on a big screen. The
 * panel would look completely correct while quietly costing 24px, and the
 * phone it breaks is the one nobody develops on.
 */
describe('the logging panel is a surface that costs no height (R515)', () => {
  test('it is drawn behind the rows, not wrapped around them', () => {
    assert.match(style('logPanelSurface'), /position:\s*'absolute'/,
      'the panel is in the layout flow, so it takes height from a column that ' +
      'has none — this is the R511 regression, rebuilt');
    for (const side of ['top', 'bottom', 'left', 'right']) {
      assert.match(style('logPanelSurface'), new RegExp(`${side}:\\s*-\\d+`),
        `${side} is not a negative inset, so the panel crops the rows instead of ` +
        'reaching out past them');
    }
  });

  test('its container adds nothing of its own', () => {
    /*
     * A wrapper was needed to give the absolute child a positioning context,
     * and a wrapper is the easy place to reintroduce exactly the cost this
     * design avoids — one `padding` here and the phone is over budget again.
     */
    const panel = style('logPanel');
    assert.match(panel, /position:\s*'relative'/);
    assert.doesNotMatch(panel, /padding|margin|height|flex:/,
      'the panel container has taken on a size of its own, which is height the ' +
      '568px phone does not have');
  });

  test('it cannot swallow a tap meant for the steppers', () => {
    // It covers the entire control. Without this it is a 294px-tall button
    // that does nothing, sitting on top of every stepper on the screen.
    assert.match(SOURCE, /<View style=\{s\.logPanelSurface\} pointerEvents="none" \/>/,
      'the surface is interactive and sits over the whole logging control');
  });

  test('and the shortest shipping phone still fits, exactly as before', () => {
    /*
     * The real guard. `columnHeight` is what R512's regression tripped, so it
     * is what should be asked here — and asked at the size that broke, not at
     * a comfortable one.
     *
     * This is a model-level check and the panel is a stylesheet-level change,
     * which is the point: if the two ever stop agreeing — a panel that pads,
     * a wrapper that grows — the fit math will not know, so this pins the
     * budget it was passing before the panel existed.
     */
    for (const [w, h] of [[320, 568], [375, 667], [390, 844]] as [number, number][]) {
      const L = layoutFor(w, h);
      assert.ok(columnHeight(L) <= h + 48,
        `at ${w}x${h} the column needs ${columnHeight(L)}px against ${h}px of screen`);
    }
  });
});

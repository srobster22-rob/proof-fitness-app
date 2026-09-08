import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const require_ = createRequire(import.meta.url);

const RecapRender = require_(path.join(ROOT, 'spike', 'recap.js'));
const { createCanvas, GlobalFonts } = require_('@napi-rs/canvas');
GlobalFonts.loadSystemFonts();

/** The claim slab's own top baseline — `drawClaim` draws both labels at y + 58. */
const TOP_BASELINE = 850 + 58;

type Draw = { text: string; x: number; align: string; w: number };

/**
 * Render a card and capture every string drawn on the claim slab's top row,
 * as the box it actually occupies.
 *
 * Recording draws rather than reading pixels, because the two labels are
 * different colours on some cards and the same colour on others — the PR slab
 * is black-on-volt for both — so an ink-based check cannot tell which glyph
 * belonged to which string, which is the one thing this test needs to know.
 * `tracked()` draws its label one character at a time, so the left label
 * arrives as a run of single-character draws and is unioned back together.
 */
function topRow(data: Record<string, unknown>): { left: Draw | null; right: Draw | null } {
  const c = createCanvas(RecapRender.W, RecapRender.H);
  const ctx = c.getContext('2d');
  const hits: Draw[] = [];
  const real = ctx.fillText.bind(ctx);
  ctx.fillText = (text: string, x: number, y: number) => {
    if (Math.abs(y - TOP_BASELINE) < 0.5) {
      hits.push({ text: String(text), x, align: ctx.textAlign, w: ctx.measureText(String(text)).width });
    }
    return real(text, x, y);
  };
  RecapRender.render(ctx, RecapRender.DURATION, { data });

  const lefts = hits.filter(h => h.align === 'left');
  const rights = hits.filter(h => h.align === 'right');
  const left = lefts.length
    ? {
        text: lefts.map(h => h.text).join(''),
        x: Math.min(...lefts.map(h => h.x)),
        align: 'left',
        // The union of the character boxes: where the last glyph actually ends.
        w: Math.max(...lefts.map(h => h.x + h.w)) - Math.min(...lefts.map(h => h.x))
      }
    : null;
  return { left, right: rights[0] ?? null };
}

const COMMON = {
  volume: 9800, sets: 12, streak: 14, unit: 'lb', watermark: 'PROOF',
  lifts: [['Squat', '225 × 5', true], ['Leg Press', '400 × 10', false]]
};
const BEST = { lift: 'Bulgarian Split Squat', weight: 225, reps: 5 };

/** Every claim state that fills the slab, in both languages the app speaks. */
const CASES: Array<[string, Record<string, unknown>]> = [];
for (const lang of ['en', 'es']) {
  const L = (o: Record<string, unknown>) => ({
    ...COMMON, title: 'LEGS DAY', date: 'THU 27 AUG', duration: '48 MIN',
    ...(lang === 'en' ? {} : { lang }), ...o
  });
  CASES.push([`${lang} · PR`, L({ pr: { lift: 'Squat', weight: 225, reps: 5, prev: 215, gain: 10 } })]);
  // `gain: null` is the branch whose right-hand label falls back to the
  // BEST YET wording — the longest string this row ever has to carry, and the
  // one that broke in Spanish.
  CASES.push([`${lang} · PR, no gain`,
    L({ pr: { lift: 'Squat', weight: 225, reps: 5, prev: null, gain: null, heaviest: false } })]);
  CASES.push([`${lang} · best yet`, L({ best: BEST, bestYet: { prev: 215 } })]);
  CASES.push([`${lang} · first session`, L({ firstSession: true, best: BEST })]);
}

/*
 * R476. Canvas has no layout engine: every string is placed at an absolute
 * coordinate, so anything too long draws over its neighbour. R84-R88 swept the
 * card for exactly this and fixed four instances — and missed the claim slab's
 * TOP row, where two strings are drawn towards each other from opposite edges
 * and NEITHER was measured. The bottom row of the same slab had been fitted
 * since that sweep, which is what made the omission invisible: the function
 * looked like it already handled its own overflow.
 *
 * Found by rendering the card sheet and looking at it. In Spanish the PR slab
 * drew "NUEVO RÉCORD PERSONAL" straight through "LO MEJOR HASTA AHORA" and
 * came out as "NUEVO RÉCORD PERSOÑOAMEJOR HASTA AHORA" — on the card §5 says
 * the whole product is judged on, in the state that is most worth posting.
 * English fits, which is why every earlier look said the card was fine, and
 * why the fixture's own comment ("the slab label is NOT passed through fit()")
 * had stood for rounds while pointing at the right function and the wrong row.
 *
 * Two texts sharing pixels is unambiguous — unlike a clipped string there is
 * no honest version of it — so this asserts on the boxes rather than on a
 * character budget that would need re-tuning for every new translation.
 */
describe('the claim slab\'s two top labels never share pixels (§5)', () => {
  for (const [name, data] of CASES) {
    test(name, () => {
      const { left, right } = topRow(data);
      assert.ok(left, `${name}: no claim label was drawn at all`);
      if (!right) return; // Some states carry no right-hand context; nothing to collide with.

      const leftEnd = left!.x + left!.w;
      const rightStart = right.x - right.w;
      assert.ok(leftEnd <= rightStart,
        `${name}: "${left!.text}" runs to x${Math.round(leftEnd)} and ` +
        `"${right.text}" starts at x${Math.round(rightStart)} — ` +
        `${Math.round(leftEnd - rightStart)}px of overprint`);
    });
  }

  /*
   * The claim is what the card is claiming; the right-hand label qualifies it.
   * When only one can fit, the qualifier is the one that gives way — written
   * the other way round (the first attempt at this fix) Spanish kept a full
   * "LO MEJOR HASTA AHORA" and cut the claim to "NUEVO RÉCORD PE…".
   */
  test('and when space runs out it is the qualifier that yields, not the claim', () => {
    const es = CASES.find(([n]) => n === 'es · PR, no gain')![1];
    const { left, right } = topRow(es);
    assert.ok(left && !left.text.includes('…'),
      `the claim itself was truncated ("${left?.text}") — the qualifier should have yielded first`);
    assert.ok(right, 'the qualifier vanished entirely rather than being trimmed');
  });
});

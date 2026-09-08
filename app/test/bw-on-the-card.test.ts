import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { loadLabel } from '../src/domain/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const require_ = createRequire(import.meta.url);
const R = require_(path.join(ROOT, 'spike', 'recap.js'));
const { createCanvas, GlobalFonts } = require_('@napi-rs/canvas');
GlobalFonts.loadSystemFonts();

function drawn(data: unknown): string[] {
  const c = createCanvas(R.W, R.H);
  const ctx = c.getContext('2d');
  const seen: string[] = [];
  const real = ctx.fillText.bind(ctx);
  ctx.fillText = (t: string, x: number, y: number) => {
    seen.push(String(t));
    return real(t, x, y);
  };
  R.render(ctx, R.DURATION, { data });
  return seen;
}

const base = {
  title: 'PULL DAY', date: 'TUE 28 JUL', volume: 0, volumeKnown: false,
  sets: 3, duration: '22 MIN', streak: 3, unit: 'lb', watermark: 'PROOF'
};

/*
 * R486. A bodyweight movement is stored at the weight ADDED, so a strict
 * pull-up is 0. The app writes that as "BW" everywhere — `loadLabel` in
 * types.ts, used by the in-app card at all four of its weight sites — and the
 * shared renderer concatenated the number raw.
 *
 * So one card drew "0 x 12" in the claim slab, in the largest type on it, while
 * the lift row directly beneath said "BW x 12": the same set, twice, and the
 * loud one claiming the lifter moved nothing. The sender's own screen was
 * right; only the artifact that LEAVES the device was wrong — the same
 * sender/recipient split as R484, one slab over.
 *
 * It lands hardest on the first-session card, which §6 makes the hook, because
 * a first workout of pull-ups is exactly the cold-start case the app is built
 * around.
 */
describe('a bodyweight set says BW on the card, as it does in the app (§16)', () => {
  for (const [name, data] of [
    ['first session', { ...base, firstSession: true,
      best: { lift: 'Pull-up', weight: 0, reps: 12 },
      lifts: [['Pull-up', 'BW × 12', true]] }],
    ['best yet', { ...base, best: { lift: 'Pull-up', weight: 0, reps: 12 },
      bestYet: { prev: 10 }, lifts: [['Pull-up', 'BW × 12', true]] }],
    ['personal record', { ...base,
      pr: { lift: 'Pull-up', weight: 0, reps: 15, prev: 12, gain: 3, heaviest: true },
      lifts: [['Pull-up', 'BW × 15', true]] }]
  ] as Array<[string, unknown]>) {
    test(`${name}: the slab and the lift row agree`, () => {
      const seen = drawn(data);
      assert.ok(!seen.some(t => /^0 ×/.test(t)),
        `the ${name} slab drew a raw "0 ×" — the card says the lifter moved ` +
        `nothing while the row beneath it says BW: ${JSON.stringify(seen.filter(t => /×/.test(t)))}`);
      assert.ok(seen.some(t => /^BW ×/.test(t)), 'the slab lost its BW label');
    });
  }

  test('a loaded set is unaffected', () => {
    const seen = drawn({ ...base, volume: 5400, volumeKnown: true,
      pr: { lift: 'Bench Press', weight: 225, reps: 5, prev: 215, gain: 10, heaviest: true },
      lifts: [['Bench Press', '225 × 5', true]] });
    assert.ok(seen.some(t => /^225 ×/.test(t)), 'a real weight stopped rendering as itself');
    assert.ok(!seen.some(t => /^BW ×/.test(t)), 'a loaded set is claiming to be bodyweight');
  });

  test('the renderer states the rule the same way the app does', () => {
    // Two implementations of one rule, because a standalone Canvas2D file
    // cannot import TS — the boundary bundle-parity.test.ts exists for. So the
    // agreement is asserted rather than commented.
    const src = fs.readFileSync(path.join(ROOT, 'spike', 'recap.js'), 'utf8');
    assert.match(src, /function loadLabel\(w\) \{[\s\S]{0,80}w === 0 \? 'BW'/,
      'the card no longer has the app\'s BW rule');
    for (const w of [0, 5, 225, 1250]) {
      assert.equal(w === 0 ? 'BW' : String(w), loadLabel(w),
        'the app\'s own loadLabel changed — the card\'s copy needs the same change');
    }
    // And no weight is concatenated raw any more.
    assert.doesNotMatch(src, /big: D\.\w+\.weight \+/,
      'a claim slab is building its number from a raw weight again');
  });
});

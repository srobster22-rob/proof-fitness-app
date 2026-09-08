/*
 * Renders recap frames to PNG in Node, using the same recap.js the browser uses.
 *
 *   node render-frames.cjs            -> key frames to ./out
 *   node render-frames.cjs --bench    -> per-frame timing over the full 6s
 */
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const Recap = require('./recap.js');

GlobalFonts.loadSystemFonts();

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const canvas = createCanvas(Recap.W, Recap.H);
const ctx = canvas.getContext('2d');

if (process.argv.includes('--bench')) {
  /*
   * Two numbers, because they answer different questions and only one of them
   * is about this project.
   *
   * This used to time `render()` and `encodeSync('png')` together and print the
   * total as "avg / frame". Measured today that reads **68.8 ms**, which would
   * tell anyone checking §12's "~4 ms/frame, budget is not a concern" that the
   * renderer is seventeen times over budget. Split apart, the drawing is
   * **0.52 ms** and the other 68 is PNG compression — which exists only so this
   * harness can write files, and which the shipped pipeline never does: on
   * device the frame goes to an `AVAssetWriter`, not to a `.png`.
   *
   * The encode is still reported, because it is most of the wall clock when you
   * run this and wonder why it takes twelve seconds.
   */
  const N = Math.round(Recap.DURATION * Recap.FPS);
  const sample = (fn) => {
    for (let i = 0; i < 10; i++) fn(i / Recap.FPS);   // warm the JIT
    const t = [];
    for (let i = 0; i < N; i++) {
      const a = process.hrtime.bigint();
      fn(i / Recap.FPS);
      t.push(Number(process.hrtime.bigint() - a) / 1e6);
    }
    t.sort((a, b) => a - b);
    return { avg: t.reduce((s, v) => s + v, 0) / N, p95: t[Math.floor(N * 0.95)], worst: t[N - 1] };
  };

  const draw = sample(s => Recap.render(ctx, s));
  const full = sample(s => { Recap.render(ctx, s); canvas.encodeSync('png'); });

  console.log(`frames        ${N} @ ${Recap.W}x${Recap.H}`);
  console.log('');
  console.log('DRAWING — this is the number §12 is about:');
  console.log(`  avg/frame   ${draw.avg.toFixed(2)} ms`);
  console.log(`  p95/frame   ${draw.p95.toFixed(2)} ms`);
  console.log(`  worst       ${draw.worst.toFixed(2)} ms`);
  console.log(`  180 frames  ${(draw.avg * N / 1000).toFixed(2)} s`);
  console.log('');
  console.log('harness only — PNG compression, which the device pipeline never does:');
  console.log(`  avg/frame   ${(full.avg - draw.avg).toFixed(2)} ms`);
  process.exit(0);
}

// Key moments: mid count-up, PR slab landing, the finished frame, and the same
// finished frame with the host-app chrome overlaid to prove nothing is occluded.
const marks = [
  [1.2, 'a-countup', false],
  [3.0, 'b-pr', false],
  [5.4, 'c-final', false],
  [5.4, 'd-safe-area', true]
];
for (const [t, name, safeGuides] of marks) {
  Recap.render(ctx, t, { safeGuides });
  fs.writeFileSync(path.join(OUT, `${name}.png`), canvas.encodeSync('png'));
  console.log(`wrote out/${name}.png  (t=${t}s)`);
}

/*
 * Renders the clip artifact to PNG in Node, over a synthetic stand-in for
 * footage. Deliberately BRIGHT and busy in the lower third — that is where the
 * burned-in type goes, and gym footage is often a bright wall or window there.
 * If the scrim can't hold legibility against this, it won't hold against a real
 * clip either.
 */
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const Clip = require('./clip.js');

GlobalFonts.loadSystemFonts();

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

function fakeFootage(w, h) {
  const c = createCanvas(w, h);
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, w * 0.4, h);
  g.addColorStop(0, '#2B3138'); g.addColorStop(0.55, '#6E7A85'); g.addColorStop(1, '#C9D2DA');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  // blown-out window / mirror glare, right where the type lands
  const r = x.createRadialGradient(w * 0.62, h * 0.78, 0, w * 0.62, h * 0.78, w * 0.62);
  r.addColorStop(0, 'rgba(255,255,255,0.92)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = r; x.fillRect(0, 0, w, h);
  // rack uprights
  x.fillStyle = 'rgba(20,24,28,0.55)';
  x.fillRect(w * 0.12, 0, w * 0.055, h);
  x.fillRect(w * 0.83, 0, w * 0.055, h);
  return c;
}

const canvas = createCanvas(Clip.W, Clip.H);
const ctx = canvas.getContext('2d');
const fake = fakeFootage(1440, 1080);   // landscape, like a filmed-sideways clip
const source = { image: fake, width: fake.width, height: fake.height };

const data = {
  lift: 'Bench Press', weight: 225, reps: 5,
  // PROOF, not APPNAME. This harness generates the material for §13's kill
  // test, and §5's mark spec is explicit that the mark IS the acquisition
  // mechanism on a feed — handing ten lifters clips branded with a
  // placeholder would undermine the one thing the test measures.
  unit: 'lb', isPR: true, watermark: 'PROOF'
};

const jobs = [
  ['clip-pr', source, data, {}],
  ['clip-pr-safe', source, data, { safeGuides: true }],
  ['clip-nopr', source, { ...data, isPR: false }, {}],
  ['clip-nofootage', null, data, {}]
];

for (const [name, src, d, opts] of jobs) {
  Clip.render(ctx, src, d, opts);
  fs.writeFileSync(path.join(OUT, `${name}.png`), canvas.encodeSync('png'));
  console.log(`wrote out/${name}.png`);
}

// Thumbnail legibility: the watermark is the whole acquisition mechanism, and in
// a feed it is first seen at roughly this size.
const thumb = createCanvas(216, 384);
const tctx = thumb.getContext('2d');
Clip.render(ctx, source, data, {});
tctx.drawImage(canvas, 0, 0, 216, 384);
fs.writeFileSync(path.join(OUT, 'clip-thumbnail.png'), thumb.encodeSync('png'));
console.log('wrote out/clip-thumbnail.png (216×384 — feed thumbnail scale)');

/*
 * Dev-only: draw an app SCREEN from its measured geometry, because this
 * environment cannot screenshot one.
 *
 * The Browser pane does not composite frames unless it is displayed, so
 * `computer{action:'screenshot'}` times out — every judgement about the four
 * screens has therefore come from an accessibility tree plus arithmetic. That
 * is enough to catch a clipped string and useless for the things R208, R215 and
 * R222 turned on: whether a block floats, whether two groups read as related,
 * whether a gap is a margin or a hole.
 *
 * This is not a screenshot and does not pretend to be one. It draws each
 * element's real `getBoundingClientRect`, its real colour and its real type
 * size, so spacing, alignment, overlap and voids are exactly as the browser
 * laid them out. Glyph shapes are the only thing invented.
 *
 * Collect in the page (see BUILD_LOOP), save the tool result, then:
 *
 *   node tools/screen-render.cjs <capture.json> [out-name]
 *
 * The capture may be the raw object, or the MCP tool-result wrapper
 * [{ type, text }] — a large result is written to a file in that shape, and
 * unwrapping it here means never having to read it back into a context window.
 */
const fs = require('fs');
const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
GlobalFonts.loadSystemFonts();

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/screen-render.cjs <capture.json> [out-name]');
  process.exit(1);
}

function load(p) {
  let raw = fs.readFileSync(p, 'utf8');
  /*
   * Peel until it stops being a string.
   *
   * A large tool result reaches disk as `[{ type, text }]` where `text` is
   * itself JSON — sometimes JSON-encoded a second time — followed by a
   * human-readable "Tab Context:" trailer. Guessing the depth got this wrong
   * three times running, so unwrap in a loop and stop when there is an object.
   */
  for (let i = 0; i < 4; i++) {
    if (typeof raw === 'string') { raw = JSON.parse(firstJson(raw)); continue; }
    if (Array.isArray(raw) && raw.length && raw[0] && typeof raw[0] === 'object'
        && typeof raw[0].text === 'string') {
      raw = raw.map(x => x.text).join('');
      continue;
    }
    break;
  }
  return raw;
}

function firstJson(text) {
  const oi = text.indexOf('{'), ai = text.indexOf('[');
  const start = ai >= 0 && (oi < 0 || ai < oi) ? ai : oi;
  if (start < 0) throw new Error('no JSON value in the capture');
  const open = text[start], close = open === '[' ? ']' : '}';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error('unterminated JSON value in the capture');
}

const cap = load(file);
if (!cap || !Array.isArray(cap.els)) {
  console.error('capture has no `els` array — is this the right file?');
  process.exit(1);
}

const W = cap.vw || 390;
const H = Math.max(cap.vh || 844, cap.scrollH || 0);
const PAD = 40;

const c = createCanvas(W + PAD * 2, H + PAD * 2);
const ctx = c.getContext('2d');

// The page ground, so contrast reads the way it does on the device.
ctx.fillStyle = '#08090A';
ctx.fillRect(0, 0, c.width, c.height);

// A frame at the viewport edge, and a line at the fold — the single most
// useful thing to see, and the one an accessibility tree cannot tell you.
ctx.strokeStyle = '#2A323A';
ctx.lineWidth = 1;
ctx.strokeRect(PAD - 0.5, PAD - 0.5, W + 1, H + 1);

const UI = 'ui-sans-serif,system-ui,"Segoe UI",Helvetica,Arial,sans-serif';

for (const e of cap.els) {
  const x = PAD + e.x, y = PAD + e.y;
  if (e.bg) {
    ctx.fillStyle = e.bg;
    ctx.fillRect(x, y, e.w, e.h);
  }
  if (e.bb) {
    ctx.strokeStyle = e.bb;
    ctx.beginPath();
    ctx.moveTo(x, y + e.h - 0.5);
    ctx.lineTo(x + e.w, y + e.h - 0.5);
    ctx.stroke();
  }
  if (e.t) {
    ctx.fillStyle = e.c || '#fff';
    // Weight and size are the real ones; the face is whatever this machine has.
    ctx.font = `${e.fw || 400} ${e.fs || 14}px ${UI}`;
    ctx.textBaseline = 'middle';
    // Clipped to the element's own box, so text that overflows its container
    // looks overflowing here too rather than being quietly redrawn wider.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y - 2, e.w + 2, e.h + 4);
    ctx.clip();
    ctx.fillText(e.t, x, y + e.h / 2);
    ctx.restore();
  }
}

if (cap.vh && H > cap.vh) {
  ctx.strokeStyle = '#CCFF00';
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(PAD, PAD + cap.vh + 0.5);
  ctx.lineTo(PAD + W, PAD + cap.vh + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#CCFF00';
  ctx.font = `600 11px ${UI}`;
  ctx.fillText('fold', PAD + W + 4, PAD + cap.vh + 4);
}

const out = path.join(__dirname, '..', 'out');
fs.mkdirSync(out, { recursive: true });
const name = (process.argv[3] || 'screen') + '.png';
const dest = path.join(out, name);
fs.writeFileSync(dest, c.toBuffer('image/png'));
console.log(`wrote out/${name}  ${W}x${H}, ${cap.els.length} elements`);

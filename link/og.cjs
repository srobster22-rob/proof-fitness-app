/*
 * Renders the static Open Graph image for chat unfurls (1200x630).
 *
 * This is generic on purpose. The workout lives in the URL fragment, which chat
 * clients never send to a server, so there is nothing to personalise it with —
 * see README.md. Its job is to look deliberate rather than broken in the seconds
 * before someone taps.
 */
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

GlobalFonts.loadSystemFonts();

const W = 1200, H = 630;
const VOLT = '#CCFF00';
const FONT = '"Arial Black","Helvetica Neue",Impact,sans-serif';
const UI = 'ui-sans-serif,system-ui,"Segoe UI",Helvetica,Arial,sans-serif';

const c = createCanvas(W, H);
const x = c.getContext('2d');

x.fillStyle = '#08090A';
x.fillRect(0, 0, W, H);

const glow = x.createRadialGradient(210, 180, 0, 210, 180, 900);
glow.addColorStop(0, 'rgba(204,255,0,0.14)');
glow.addColorStop(1, 'rgba(204,255,0,0)');
x.fillStyle = glow;
x.fillRect(0, 0, W, H);

const M = 84;

// mark — the same solid-shape lockup the clip burns in, so the two are
// recognisably the same product
const box = 62;
x.fillStyle = VOLT;
x.fillRect(M, 96, box, box);
x.fillStyle = '#08090A';
x.fillRect(M + 16, 120, 30, 11);

x.fillStyle = '#fff';
x.font = '52px ' + FONT;
x.textAlign = 'left';
let cx = M + box + 24;
for (const ch of require('./copy.js').NAME) { x.fillText(ch, cx, 145); cx += x.measureText(ch).width + 3; }

// headline
x.fillStyle = '#fff';
x.font = '86px ' + FONT;
x.fillText('A LIFT WORTH', M, 336);
x.fillText('SHOWING YOU', M, 428);

x.fillStyle = VOLT;
x.fillRect(M, 470, 132, 8);

x.fillStyle = '#8B959E';
x.font = '500 30px ' + UI;
x.fillText('Free. No account, no trial, no paywall.', M, 546);

fs.writeFileSync(path.join(__dirname, 'og.png'), c.encodeSync('png'));
console.log(`wrote og.png (${W}x${H})`);

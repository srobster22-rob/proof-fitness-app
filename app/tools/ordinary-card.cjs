/*
 * Dev-only: render the card for an ORDINARY session and look at it.
 *
 * `npm run e2e` renders the flattering case — it has a PR, a goal line and a
 * streak, so it shows the card at its best. §5 judges the product on what
 * actually gets sent, and most sessions are not that: §8 makes PRs rare on
 * purpose, plenty of lifters set no goals, and the claim slot is then empty.
 *
 * This writes the plain version beside it so both can be looked at.
 *
 *   node tools/ordinary-card.cjs
 */
const fs = require('fs');
const path = require('path');
// Same renderer the e2e tool uses, with the system fonts it needs — the card
// is measured type, so an unregistered face changes every layout decision.
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
GlobalFonts.loadSystemFonts();

const ROOT = path.join(__dirname, '..', '..');
const RecapRender = require(path.join(ROOT, 'spike', 'recap.js'));

const data = {
  title: 'PULL DAY',
  date: 'THU 27 AUG',
  volume: 14_820,
  sets: 18,
  duration: '54 MIN',
  streak: 6,
  unit: 'lb',
  watermark: 'PROOF',
  // No pr, no goalLine, no firstSession, no bestYet — the claim slot is empty,
  // which is the common case and the one nothing has looked at.
  lifts: [
    ['Barbell Row', '185 × 8', false],
    ['Lat Pulldown', '150 × 10', false],
    ['DB Row', '70 × 10', false],
    ['Face Pull', '40 × 15', false],
    ['Bicep Curl', '35 × 12', false]
  ]
};

/*
 * The same card in Spanish, because the renderer's own labels were English
 * literals until R221 and nothing had ever looked at the translated card.
 */
const spanish = {
  ...data,
  lang: 'es',
  title: 'DÍA DE TIRÓN',
  date: 'JUE 27 AGO',
  duration: '54 MIN',
  pr: { lift: 'Barbell Row', weight: 185, reps: 8, prev: 175, gain: 10 }
};

const out = path.join(__dirname, '..', 'out');
fs.mkdirSync(out, { recursive: true });

const c = createCanvas(RecapRender.W, RecapRender.H);
RecapRender.render(c.getContext('2d'), RecapRender.DURATION, { data });
const file = path.join(out, 'ordinary-card.png');
fs.writeFileSync(file, c.toBuffer('image/png'));
console.log('wrote ' + path.relative(ROOT, file));
console.log('claim slot: ' + (data.pr || data.goalLine || data.firstSession ? 'filled' : 'EMPTY (the common case)'));

const c2 = createCanvas(RecapRender.W, RecapRender.H);
RecapRender.render(c2.getContext('2d'), RecapRender.DURATION, { data: spanish });
const file2 = path.join(out, 'spanish-card.png');
fs.writeFileSync(file2, c2.toBuffer('image/png'));
console.log('wrote ' + path.relative(ROOT, file2) + '  (lang=es, PR slab filled)');

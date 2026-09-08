/*
 * Dev-only: every claim state the shared card can be in, on one image.
 *
 * `npm run e2e` renders exactly one card — a session with a PR — and §8 makes
 * PRs rare on purpose, so the case it shows is the least common one. Three
 * separate rounds found layout defects that only a rendered image could show,
 * and each time the state at fault had never been drawn: the empty claim slot
 * left a 290px void (R208), the goal card truncated real lift names (R215),
 * the renderer's own labels were English on a Spanish card (R221). R222 then
 * shipped-and-reverted a change that every one of 1,376 tests approved of and
 * one PNG rejected.
 *
 * The common thread is that looking was expensive, so it was skipped. This
 * makes it one command:
 *
 *   node tools/card-sheet.cjs
 *
 * Writes out/card-sheet.png — the five claim states across, English on the top
 * row and Spanish beneath, so a difference between them is a difference you
 * can see rather than one you have to remember to look for.
 */
const fs = require('fs');
const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
GlobalFonts.loadSystemFonts();

const ROOT = path.join(__dirname, '..', '..');
const R = require(path.join(ROOT, 'spike', 'recap.js'));

/** Shared by every cell, so the only variable across the sheet is the claim. */
const COMMON = {
  volume: 9800,
  sets: 12,
  streak: 14,
  unit: 'lb',
  watermark: 'PROOF',
  lifts: [
    ['Squat', '225 × 5', true],
    ['Leg Press', '400 × 10', false],
    ['Romanian Deadlift', '185 × 8', false]
  ]
};

/*
 * A deliberately long name in the claim slab. It is the string that has to
 * share a line with the right-hand column, and the slab label is NOT passed
 * through `fit()` — so this is where an overprint would show up first.
 */
const BEST = { lift: 'Bulgarian Split Squat', weight: 225, reps: 5 };

const WORDS = {
  en: { title: 'LEGS DAY', date: 'THU 27 AUG', duration: '48 MIN',
        goal: '30 lb from a 225 squat' },
  es: { title: 'DÍA DE PIERNA', date: 'JUE 27 AGO', duration: '48 MIN',
        goal: '30 lb para un sentadilla de 225' }
};

/** The five things the claim slot can be. Order runs common to rare. */
const STATES = [
  ['no claim', () => ({})],
  ['goal', w => ({ goalLine: w.goal })],
  ['best yet', () => ({ best: BEST, bestYet: { prev: 215 } })],
  ['first session', () => ({ firstSession: true, best: BEST })],
  ['PR', () => ({ pr: { lift: 'Squat', weight: 225, reps: 5, prev: 215, gain: 10 } })],
  // Orthogonal to the claim slot — R271's volt accent on the STREAK cell,
  // not a competing claim — so it rides on top of "no claim" rather than
  // getting its own claim fixture. Absent from this sheet since R271 shipped
  // it until R286 noticed: a reference sheet built specifically to show every
  // claim state had never shown this one, so nobody driving it saw the accent
  // next to everything else it has to sit beside.
  ['streak record (R271)', () => ({ streakRecord: true })],
  ['weekly (§10)', null]
];

/*
 * §10's weekly card, built by the APP's own builder rather than hand-written
 * here. A fixture that imitates the payload proves the renderer draws the
 * fixture; only the real `weeklyCard` proves it draws what a user would get.
 */
const { weeklyComparison, weeklyCard } = require(path.join(__dirname, '..', 'src', 'domain', 'weekly.ts'));

const WEEK = 7 * 86_400_000;
const WEEKLY_NOW = 1_800_000_000_000;
const WEEKLY_SETS = [
  { id: 'a', sessionId: 'old', exerciseId: 'legpress', weight: 220, reps: 10, at: WEEKLY_NOW - 5 * WEEK },
  { id: 'b', sessionId: 'new', exerciseId: 'legpress', weight: 240, reps: 10, at: WEEKLY_NOW - 2 * 86_400_000 }
];
const WEEKLY_EX = new Map([['legpress', { id: 'legpress', name: 'Leg Press' }]]);

/*
 * The weekly card builds its own payload from real sets, so it does NOT take
 * the row fixture the way every other cell does — which meant the two
 * worst-case rows drew a cell identical to the ordinary one, and this column
 * of the sheet was measuring nothing (R477, caught in this round's own work by
 * looking at the image it had just produced — HANDOFF trap 10 again).
 *
 * So the hard variant gets hard SETS: a typed name at the length the picker
 * really allows, and four-figure weights.
 */
function weeklyFor(lang, hard) {
  const sets = hard
    ? WEEKLY_SETS.map(x => ({ ...x, weight: x.weight * 5 }))
    : WEEKLY_SETS;
  const ex = hard
    ? new Map([['legpress', { id: 'legpress', name: TYPED }]])
    : WEEKLY_EX;
  const c = weeklyComparison(sets, ex, WEEKLY_NOW, 'lb');
  if (!c) throw new Error('the weekly fixture no longer produces a comparison');
  return weeklyCard(c, 'lb', 'PROOF', lang);
}

/*
 * The WORST realistic card, which is the one this sheet existed to show and
 * never did (R477).
 *
 * Every cell above shares three short lift names and a four-digit volume, so
 * for as long as the sheet has existed it has rendered fourteen cards that
 * physically cannot overprint. R476 found a 69px overprint on the Spanish PR
 * slab BY EYE — the instrument built to make exactly that visible was
 * calibrated to a case where it could not happen. Same family as HANDOFF's
 * trap 10: an instrument that reports no problems has to be run against a case
 * whose answer is already known.
 *
 * Lengths are DERIVED, not typed out. The lift names come from the real
 * library, longest first, so adding a longer movement rebuilds the worst case
 * automatically instead of leaving this fixture describing a library that has
 * moved on.
 */
require(path.join(ROOT, 'app', 'dist', 'proof-domain.js'));
const LONGEST = globalThis.Domain.BUILTIN
  .map(e => e.name)
  .sort((a, b) => b.length - a.length);

/*
 * A name the user typed. §8's library is the FLOOR on name length, not the
 * ceiling: the picker takes free text, and this exact string is already quoted
 * in recap.js's own comment as the case that printed straight across the
 * weight before `fit()` reached the slab's bottom row.
 */
const TYPED = 'Single-Arm Cable Lateral Raise (Left Side, Slow Eccentric)';

const HARD = {
  // Seven figures. A year-two lifter's leg day genuinely reaches this, and the
  // digits are the widest glyphs on the card.
  volume: 1284600,
  sets: 148,
  streak: 104,
  unit: 'lb',
  watermark: 'PROOF',
  lifts: [
    [TYPED, '1250 × 12', true],
    [LONGEST[0], '405 × 10', false],
    [LONGEST[1], '385 × 12', false],
    [LONGEST[2], '225 × 15', false]
  ]
};

/** The claim slab, carrying the longest thing it can be asked to carry. */
const HARD_BEST = { lift: TYPED, weight: 1250, reps: 12 };

const HARD_WORDS = {
  en: { title: 'FULL BODY', date: 'WED 27 AUG', duration: '148 MIN',
        goal: '250 lb from a 1,250 single-arm cable lateral raise' },
  es: { title: 'CUERPO COMPLETO', date: 'MIÉ 27 AGO', duration: '148 MIN',
        goal: '250 lb para un elevación lateral en polea a un brazo de 1,250' }
};

const HARD_STATES = STATES.map(([name, claim]) => {
  if (claim === null) return [name, null];
  return [name, w => {
    const c = claim(w);
    if (c.best) c.best = HARD_BEST;
    // `prev` has to belong to the same lifter as `best` — left at the ordinary
    // fixture's 215 it drew "UP FROM 215" beside a 1,250 lb set, which is not a
    // card the app can produce and so not a case worth looking at.
    if (c.bestYet) c.bestYet = { prev: 1215 };
    if (c.pr) c.pr = { lift: TYPED, weight: 1250, reps: 12, prev: 1215, gain: 35 };
    return c;
  }];
});

/*
 * Four rows: each language as it usually looks, then each language under the
 * worst case. Side by side, because the failure R476 found was not "the card
 * is broken" — it was "the card is broken in one language and fine in the
 * other", and that is only obvious when both are on the same image.
 */
const ROWS = [
  ['en', WORDS, COMMON, STATES], ['es', WORDS, COMMON, STATES],
  ['en · hard', HARD_WORDS, HARD, HARD_STATES],
  ['es · hard', HARD_WORDS, HARD, HARD_STATES]
];
const LANGS = ROWS;

// Big enough to read a label, small enough that ten fit on one screen.
const CW = 324, CH = 576, GAP = 18, HEAD = 34, LABEL = 26;

const sheet = createCanvas(
  GAP + STATES.length * (CW + GAP),
  HEAD + ROWS.length * (CH + LABEL + GAP)
);
const s = sheet.getContext('2d');
s.fillStyle = '#141719';
s.fillRect(0, 0, sheet.width, sheet.height);

s.fillStyle = '#E8EAED';
s.font = '600 20px ui-sans-serif,system-ui,Segoe UI,Helvetica,Arial,sans-serif';
s.textBaseline = 'middle';
s.fillText('PROOF — shared card, every claim state', GAP, HEAD / 2);

ROWS.forEach(([rowName, words, common, states], row) => {
  // "es · hard" is still the `es` wire language — the suffix names the fixture.
  const lang = rowName.split(' ')[0];
  const w = words[lang];
  states.forEach(([name, claim], col) => {
    // The weekly card is not a session, so it does not take COMMON at all.
    const data = claim === null
      ? weeklyFor(lang, common === HARD)
      : { ...common, ...w, ...claim(w) };
    // English is the default and rides absent, exactly as on the wire.
    if (lang !== 'en' && claim !== null) data.lang = lang;
    // `goalLine` is not a slab claim on its own unless nothing outranks it;
    // the renderer decides, which is the point of rendering rather than
    // reasoning about it.
    if (claim !== null) delete data.goal;

    const cell = createCanvas(R.W, R.H);
    R.render(cell.getContext('2d'), R.DURATION, { data });

    const x = GAP + col * (CW + GAP);
    const y = HEAD + row * (CH + LABEL + GAP);
    s.fillStyle = '#9AA5AF';
    s.font = '600 15px ui-sans-serif,system-ui,Segoe UI,Helvetica,Arial,sans-serif';
    s.fillText(rowName.toUpperCase() + '  ·  ' + name, x, y + LABEL / 2);
    s.drawImage(cell, x, y + LABEL, CW, CH);
  });
});

const out = path.join(__dirname, '..', 'out');
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, 'card-sheet.png');
fs.writeFileSync(file, sheet.toBuffer('image/png'));
console.log(
  'wrote ' + path.relative(ROOT, file) +
  '  (' + STATES.length + ' states × ' + ROWS.length + ' rows: each language, ordinary and worst-case)'
);

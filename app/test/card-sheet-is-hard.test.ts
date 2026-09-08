import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const require_ = createRequire(import.meta.url);

const RecapRender = require_(path.join(ROOT, 'spike', 'recap.js'));
const { createCanvas, GlobalFonts } = require_('@napi-rs/canvas');
GlobalFonts.loadSystemFonts();
require_(path.join(ROOT, 'app', 'dist', 'proof-domain.js'));
const BUILTIN = (globalThis as unknown as {
  Domain: { BUILTIN: Array<{ name: string }> }
}).Domain.BUILTIN;

const sheetSrc = fs.readFileSync(path.join(ROOT, 'app', 'tools', 'card-sheet.cjs'), 'utf8');

/*
 * R477. `tools/card-sheet.cjs` exists so a layout defect on the shared card is
 * something you SEE rather than something you have to remember to check —
 * HANDOFF credits it with four rounds of defects a green suite could not find.
 *
 * And for every one of those rounds it rendered fourteen cards that shared
 * three short lift names, a four-digit volume and a two-digit streak: a case
 * that physically cannot overprint. So when R476 found 69px of overprint on
 * the Spanish PR slab, it was found BY EYE, on a card the sheet was drawing
 * happily. The instrument was calibrated to the easy case — the same family as
 * HANDOFF trap 10, where a sweep reports clean having examined nothing.
 *
 * The sheet now carries two more rows at the worst realistic case. These tests
 * guard the FIXTURE, not the renderer: a worst case that quietly stops being
 * the worst case is exactly how this happened the first time, and it happens by
 * the library growing a longer name or somebody tidying the numbers down.
 */
describe('the card sheet\'s worst case is actually the worst case', () => {
  test('its lift names are derived from the real library, not typed out', () => {
    // The specific failure this prevents: a new movement longer than anything
    // in the fixture, so the sheet keeps drawing a case the app has outgrown.
    assert.match(sheetSrc, /globalThis\.Domain\.BUILTIN[\s\S]{0,120}sort\(/,
      'the hard fixture no longer derives its names from BUILTIN — a longer ' +
      'movement added to the library would not reach the sheet');
  });

  test('and it carries a name longer than any built-in one', () => {
    const longestBuiltIn = Math.max(...BUILTIN.map(e => e.name.length));
    const typed = sheetSrc.match(/const TYPED = '([^']+)'/);
    assert.ok(typed, 'the typed-name fixture is gone');
    assert.ok(typed![1].length > longestBuiltIn,
      `the typed name (${typed![1].length}) is no longer than the longest built-in ` +
      `movement (${longestBuiltIn}) — but the picker takes free text, so the ` +
      'library is the floor on name length, not the ceiling');
  });

  test('its volume reaches seven figures', () => {
    // Anchored to the HARD block. Unanchored, this matched COMMON's `volume:
    // 9800` forty lines earlier and reported the fixture as soft while it was
    // fine — a check reading the wrong part of the file, which is the very
    // thing `region` exists to make impossible (see helpers/source.ts).
    const hard = region(sheetSrc, 'const HARD = {', '};');
    const vol = hard.match(/volume: (\d+),/);
    assert.ok(vol && Number(vol[1]) >= 1_000_000,
      'the hard volume dropped below seven figures — digits are the widest ' +
      'glyphs on the card and the volume is the largest type on it');
  });

  /*
   * The one that actually matters. The two above check the fixture's INPUTS;
   * this checks its EFFECT — that the case is still at or over the card's
   * limit, so it is genuinely testing an edge rather than sitting comfortably
   * inside one. If the card is ever widened, or the fixture softened, this
   * fails and says the worst case needs to get worse again.
   */
  test('and rendering it still forces the card to trim something', () => {
    const TYPED = sheetSrc.match(/const TYPED = '([^']+)'/)![1];
    const data = {
      title: 'FULL BODY', date: 'WED 27 AUG', duration: '148 MIN',
      volume: 1284600, sets: 148, streak: 104, unit: 'lb', watermark: 'PROOF',
      pr: { lift: TYPED, weight: 1250, reps: 12, prev: 1215, gain: 35 },
      lifts: [[TYPED, '1250 × 12', true], ['Incline Bench Press', '405 × 10', false]]
    };
    const c = createCanvas(RecapRender.W, RecapRender.H);
    const ctx = c.getContext('2d');
    const drawn: string[] = [];
    const real = ctx.fillText.bind(ctx);
    ctx.fillText = (t: string, x: number, y: number) => {
      drawn.push(String(t));
      return real(t, x, y);
    };
    RecapRender.render(ctx, RecapRender.DURATION, { data });

    assert.ok(drawn.some(t => t.includes('…')),
      'nothing on the worst-case card was trimmed — the fixture is no longer ' +
      'reaching the card\'s limits, so it cannot show the next overprint either');
  });
});

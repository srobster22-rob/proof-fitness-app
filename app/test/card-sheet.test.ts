import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const TOOL = path.join(APP, 'tools', 'card-sheet.cjs');
const src = readFileSync(TOOL, 'utf8');

/*
 * The contact sheet has to keep working, because it is the cheap way to look.
 *
 * Three rounds found defects that only a rendered image could show — the 290px
 * void behind an empty claim slot (R208), real lift names truncating (R215),
 * English labels on a Spanish card (R221) — and in each case the state at fault
 * had never been drawn, because `npm run e2e` renders only a session with a PR
 * and §8 makes that the rarest case. R222 then shipped and reverted a change
 * that all 1,376 tests approved of and one PNG rejected.
 *
 * A tool that silently stops running takes the habit with it, so the suite runs
 * it rather than trusting somebody to.
 */
describe('every claim state can still be rendered', () => {
  test('the sheet builds, and is a real image', () => {
    const out = execFileSync('node', [TOOL], { cwd: APP, encoding: 'utf8' });
    assert.match(out, /wrote .*card-sheet\.png/);
    const file = path.join(APP, 'out', 'card-sheet.png');
    // A blank or one-cell sheet would still be a valid PNG; ten 324x576 cells
    // of a dark card with type on it does not compress below this.
    assert.ok(statSync(file).size > 40_000,
      `card-sheet.png is only ${statSync(file).size} bytes — it probably drew nothing`);
  });

  test('it covers every state the claim slot can be in', () => {
    // The renderer picks the slab from these four, in this order of precedence;
    // "no claim" is the fifth case and the most common one, because §8 makes
    // PRs rare and plenty of lifters set no goals.
    const states = region(src, 'const STATES = [', '];');
    for (const s of ['no claim', 'goal', 'best yet', 'first session', 'PR', 'streak record', 'weekly']) {
      assert.ok(states.includes(s), `the sheet no longer renders the "${s}" state`);
    }
  });

  test('and renders both languages, since that is where R221 hid', () => {
    /*
     * R477 turned the two language rows into four — each language ordinary,
     * then each language at the worst realistic case — so this now asserts
     * against ROWS. Both languages must still appear in BOTH halves: R476's
     * overprint was language-specific AND length-specific, and either half
     * alone would have drawn a clean card.
     */
    const rows = region(src, 'const ROWS = [', '];');
    for (const r of ["'en'", "'es'", "'en · hard'", "'es · hard'"]) {
      assert.ok(rows.includes(r), `the sheet no longer renders the ${r} row`);
    }
    // English rides the wire absent; the sheet has to match that, or it would
    // be testing a payload shape the app never produces.
    assert.match(src, /if \(lang !== 'en' && claim !== null\) data\.lang = lang;/);
    // The weekly card carries its own language, from the app's own builder.
    assert.match(src, /weeklyCard\(c, 'lb', 'PROOF', lang\)/);
  });

  test('the weekly card is built by the app, not imitated by the fixture', () => {
    // A hand-written payload proves the renderer draws the fixture. Only the
    // real `weeklyCard` proves it draws what a user would actually get.
    assert.match(src, /require\(path\.join\(__dirname, '\.\.', 'src', 'domain', 'weekly\.ts'\)\)/);
    assert.match(src, /throw new Error\('the weekly fixture no longer produces a comparison'\)/,
      'a fixture that stops producing a comparison would silently draw nothing');
  });

  test('the slab label used is one long enough to collide', () => {
    // The slab label is NOT passed through `fit()`, so a short fixture would
    // prove nothing about the case that actually breaks.
    assert.match(src, /Bulgarian Split Squat/);
  });

  test('npm run cards reaches it', () => {
    const pkg = JSON.parse(readFileSync(path.join(APP, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts?.cards, 'node tools/card-sheet.cjs');
  });
});

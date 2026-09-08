import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const DOCS = ['HANDOFF.md', 'BUILD_LOOP.md'].map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')] as const);
const TOOL = fs.readFileSync(path.join(ROOT, 'app', 'tools', 'screen-render.cjs'), 'utf8');

/*
 * R531. HANDOFF's trap list is the first thing every session reads, so a trap
 * that has stopped being true costs more than an untidy document: it is
 * believed, and it stops work that would have succeeded.
 *
 * Trap 11 said "Screenshots do not work in this environment —
 * `computer{action:'screenshot'}` times out". They work. Dozens were taken in
 * R511-R530, including both tab-bar variants at two phone sizes for an owner
 * decision that was literally phrased as "screenshot each and put the two side
 * by side". A session that believed the trap would have told the owner their
 * request was impossible, and reached for a worse artifact instead.
 *
 * The real behaviour is narrower and still worth knowing: a hidden or
 * minimised pane can stop the page drawing and the call times out after 5s, at
 * which point calling it again works — which the tool's own error message
 * already says.
 *
 * This test cannot verify that screenshots work; a test cannot take one. What
 * it CAN do is stop the false claim reappearing, which is the failure that
 * actually happened — the sentence outlived the condition that produced it and
 * was copied into three other files.
 */
describe('the docs do not claim screenshots are impossible (R531)', () => {
  test('no document says screenshots do not work', () => {
    for (const [name, src] of DOCS) {
      assert.doesNotMatch(src, /Screenshots do not work/i,
        `${name} claims screenshots do not work. They do — R511 through R530 are full of ` +
        'them, including an owner comparison that asked for exactly that');
    }
  });

  test('nor that the screenshot call simply times out', () => {
    /*
     * The narrower wording matters. "It times out" is a statement about every
     * call; "it can time out on a hidden pane, and retrying fixes it" is a
     * statement about a condition, and only the second one is true. So the
     * check is that any mention of a timeout carries the retry beside it.
     */
    for (const [name, src] of [...DOCS, ['screen-render.cjs', TOOL] as const]) {
      for (const m of src.matchAll(/[^\n]*screenshot'\}` times out[^\n]*/gi)) {
        assert.match(m[0], /retry|retrying|used to claim/i,
          `${name} says the screenshot call times out without saying that retrying fixes it: ` +
          `"${m[0].trim()}"`);
      }
    }
  });

  test('the traps that have been re-measured say so, with their numbers', () => {
    /*
     * R531 found trap 11 false and corrected it. R532 re-measured traps 4 and
     * 8 and found both exactly right. Recording WHICH have been checked, and
     * against what, is the part that stops the next session either trusting a
     * stale claim or — the failure I nearly made — doubting a sound one
     * because a neighbour turned out to be wrong.
     *
     * The numbers are the point, not the round number: a trap that says "this
     * was measured and here is what it read" can be re-run by anybody. This
     * asserts the evidence stays attached.
     */
    const handoff = DOCS.find(([n]) => n === 'HANDOFF.md')![1];
    for (const [what, evidence] of [
      ['the click sequence (trap 4)', /pointer-only 0 sets, bare click 1/],
      ['reading a typed field (trap 8)', /el\.value === '205'/]
    ] as Array<[string, RegExp]>) {
      assert.match(handoff, evidence,
        `${what} no longer carries the measurement it was verified with, so the ` +
        'next session cannot tell an evidenced claim from an inherited one');
    }
  });

  test('and the geometry tool is kept for the reason it is actually good for', () => {
    /*
     * `screen-render.cjs` was justified as the ONLY way to see a screen, which
     * was false. It survives on its real merit — a photo cannot tell you an
     * element is 3px wide or 8px past the fold — and that is worth stating
     * where somebody deciding which to reach for will read it.
     */
    assert.match(TOOL, /photo cannot report geometry as numbers/,
      'the tool no longer says why it exists alongside a working screenshot');
  });
});

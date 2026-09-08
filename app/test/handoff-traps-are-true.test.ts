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
      ['reading a typed field (trap 8)', /el\.value === '205'/],
      ['same-execution reads (trap 12)', /SAME execution reports 0 sets/],
      /*
       * Trap 10's count is the claim, not decoration: it said "three times" while
       * eleven further rounds had hit it, which made the most common failure in
       * this repo read as a curiosity. The defence it now carries is the part
       * that would have caught most of them.
       */
      ['the blind-instrument count (trap 10)', /at least FOURTEEN times/],
      ['the defence trap 10 teaches', /ACTUALLY FIRED AND ACTUALLY APPLIED/],
      /*
       * Trap 13 held up `lang` as its example of a properly stated exemption,
       * and R526 found that exemption FALSE — recap.tsx does read payload.lang.
       * The entry was teaching a pattern from a case that did not work, which is
       * worse than an out-of-date count: a count misleads about frequency, an
       * exemplar misleads about method.
       */
      ['trap 13 no longer teaches from the false exemption', /A stated reason is necessary and is not/],
      ['trap 13 names what actually defines a list', /asking what DEFINES the list/],
      // Gated like trap 10s, for the same reason and for consistency: both are
      // frequency claims whose force IS the number. Two-versus-eight is the
      // difference between a curiosity and the thing to expect.
      ['the drifting-list count (trap 13)', /Eight times now/],
      // Trap 7 was scoped to the Bash heredoc while two of the six hits came
      // through a template literal and a raw CR. The defence is the part that
      // has actually worked every time: remove a layer rather than escape harder.
      ['trap 7 covers more than the heredoc', /three distinct mechanisms/],
      ['trap 7 keeps the defence that works', /REMOVE A LAYER/],
      /*
       * Trap 14 was measured in R473 and re-measured in R545 with a sharper
       * result: the effect is not react-native-web's, and not specific to a
       * div-role-button. A REAL `<button>` element goes anonymous the moment
       * its text sits inside any child element. That distinction is what stops
       * the next reader concluding the trap does not apply to their case.
       */
      ['trap 14 was re-measured with real probes', /RE-MEASURED R545/],
      ['trap 14 says it is not specific to react-native-web', /loses name-from-content the moment its text sits inside a child/],
      /*
       * Trap 15 is a claim about a DEPENDENCY VERSION, which is the kind that
       * rots without anybody touching the repo. R546 re-probed it against the
       * installed react-native-web and both halves held — so the entry now
       * carries the version it was verified against, and the check below pins
       * that the version named is the version installed.
       */
      ['trap 15 was re-probed', /NOT ONE of `aria-selected`, `aria-disabled` or `aria-busy`/],
      /*
       * And the caveat, which is the part most likely to be tidied away: every
       * getComputedStyle reading was taken on a HIDDEN page, so the advice is
       * verified but the mechanism is not. Dropping that sentence would turn a
       * measurement into a folk explanation.
       */
      ['trap 15 keeps its caveat', /do not repeat the mechanism as though it were/],
      /*
       * Trap 5 is the second one found FALSE (after trap 11's screenshots).
       * The correction has two halves and both have to survive: the claim it
       * used to make did not reproduce, and the practice it recommended is
       * still right for a different reason. Losing the first half restores a
       * false claim; losing the second invites somebody to delete a
       * conditional render that the enter/exit animation depends on.
       */
      ['trap 5 records that the web bug did not reproduce', /`visible=\{false\}` hides a transparent modal/],
      ['trap 5 keeps the real reason to render conditionally', /has no unmount to animate out of/],
      /*
       * Trap 16 is the only one written from a defect this session caused
       * rather than found, and its value is entirely in the DIRECTION it
       * states: an empty pattern does not read as "no match", it reads as the
       * first branch, on every input. Lose that sentence and the entry becomes
       * a vague warning about empty lists.
       */
      ['trap 16 states which way an empty matcher fails', /it reads as "the FIRST branch", on every input/],
      ['trap 16 keeps its one-line defence', /make the empty case throw or fail,/],
      /*
       * Trap 17 is device-blocked territory, and its value is the NUMBER: zero
       * focus events fired while activeElement demonstrably moved. Without that
       * the entry reads as a vague warning and the next session re-runs the
       * same hour to rediscover it.
       */
      ['trap 17 carries the measurement', /ZERO events fired/],
      ['trap 17 names the wrong conclusion it prevents', /is not what happened/]
    ] as Array<[string, RegExp]>) {
      assert.match(handoff, evidence,
        `${what} no longer carries the measurement it was verified with, so the ` +
        'next session cannot tell an evidenced claim from an inherited one');
    }
  });

  test('a re-measurement note never lands mid-sentence', () => {
    /*
     * R534 found this in R533's own work. The note recording that trap 12 had
     * been verified was inserted after an anchor line ending "before concluding
     * a control" -- mid-clause -- so the trap then read "...before concluding a
     * control / RE-MEASURED R533 ... / is unresponsive." The advice was cut in
     * half by the evidence for it.
     *
     * Prose has no compiler. An anchored insert into a document is exactly as
     * capable of landing in the wrong place as one into code, and nothing said
     * so: the suite was green, the claim was true, and the sentence was broken.
     * Two of the three notes were fine, which is why reading one and assuming
     * the rest would not have caught it.
     *
     * The rule is checkable: a note begins a new thought, so the line before it
     * must have finished one.
     */
    const handoff = DOCS.find(([n]) => n === 'HANDOFF.md')![1];
    const lines = handoff.split(/\r?\n/);
    const bad: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*(RE-)?MEASURED R\d+/.test(lines[i])) continue;
      /*
       * The last NON-BLANK line, not literally the previous one (R545). A blank
       * line before a note is a paragraph break and finishes nothing, so the
       * original form rejected a correctly placed note — and the fix has to
       * keep catching the case this was built for, which is a note landing
       * inside an unfinished sentence. Skipping blanks does exactly that:
       * the text it lands after is still the text that has to have ended.
       */
      let p = i - 1;
      while (p >= 0 && lines[p].trim() === '') p--;
      const prev = (lines[p] ?? '').trim();
      if (!/[.:!?]$/.test(prev)) {
        bad.push(`"${prev.slice(-45)}" is followed by "${lines[i].trim().slice(0, 35)}..."`);
      }
    }
    assert.deepEqual(bad, [],
      'a measurement note interrupts an unfinished sentence: ' + bad.join(' | '));
  });

  test('the react-native-web version trap 15 names is the one installed', () => {
    /*
     * The whole point of trap 15 is that a named version behaved a certain
     * way. If the installed version moves, the measurement is about a
     * dependency the repo no longer has, and the next session should re-probe
     * rather than inherit it — which they can only know if something checks.
     */
    const handoff = DOCS.find(([n]) => n === 'HANDOFF.md')![1];
    const claimed = /react-native-web\s+(\d+\.\d+(?:\.\d+)?)/.exec(handoff);
    assert.ok(claimed, 'trap 15 no longer names a react-native-web version');
    const installed = JSON.parse(fs.readFileSync(
      path.join(ROOT, 'app', 'node_modules', 'react-native-web', 'package.json'), 'utf8')).version;
    assert.ok(installed.startsWith(claimed[1]),
      `HANDOFF measured react-native-web ${claimed[1]} and ${installed} is installed — ` +
      're-probe trap 15 rather than trusting it');
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

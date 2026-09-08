import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.join(HERE, '..', ...p.split('/')), 'utf8');

/** Every file that draws chrome, so a new screen cannot quietly opt out. */
const SCREENS = [
  'src/ui/NowScreen.tsx',
  'app/goals.tsx',
  'app/progress.tsx',
  'app/recap.tsx',
  'app/settings.tsx',
  'app/measure.tsx'
];

/**
 * Named exemptions. One entry, and it has to stay that way: the value of the
 * rule is that a reader can trust a filled volt block to be pressable.
 *
 * R464: found with no reason attached, the exact shape the peer's audit of
 * orphan-scan.cjs's ACKNOWLEDGED list warned about — a bare name reads as a
 * decision already made, and nobody re-checks a decision that looks settled.
 * Checked what `boxOn` actually draws: `settings.tsx`'s SKIP MACHINE
 * checkbox, a 20px tick box inside a `Pressable` (`app/settings.tsx:186`) —
 * confirmed the only user of the name (`grep -rn boxOn` across src/ and app/
 * turns up exactly the style declaration and the one JSX use), matching this
 * comment's own "one entry" claim. It fills solid when checked rather than
 * using the border-and-tint treatment §15's SELECTED constant defines for
 * everything else the rule calls "selection" — a real, if narrow, deviation
 * from the rule's stated mechanism, not from its stated PURPOSE: a checkbox
 * that fills when checked is a near-universal convention (there is no
 * ambiguity about whether a ticked checkbox is "on"), and unlike a chip or a
 * card, its own tick glyph already carries the state — the fill reinforces
 * rather than competes with a reading a user could get wrong. It does not
 * contend with the screen's one filled action (DONE) for weight, because
 * nothing on Settings ever renders both at once with equal visual force —
 * DONE is the header's own control, distant from this row.
 */
/*
 * R465: applying the peer's filter after the fact — a reason is only as
 * strong as what can independently check it. Split for `boxOn` below:
 *
 * VERIFIED, mechanically, by this suite itself: that it is the only entry
 * (a second `...On` block filling VOLT anywhere in the six screens would
 * show up unexempted and fail the sweep above, so "one entry" is not a
 * claim resting on anyone's memory) and that it lives where it says it does
 * (`the one exemption is stated, not forgotten`, below, greps settings.tsx
 * for the literal declaration).
 *
 * NOT independently verifiable by any test here, named rather than left
 * implicit: that a filled checkbox "reads as a near-universal convention"
 * and "does not compete for weight" with Settings' DONE control is a visual
 * design judgment about what a user perceives — the same kind of claim §16
 * already declines to fake for real-device checks. Recorded as a judgment
 * this loop made, not a fact this suite proved, so nobody mistakes the test
 * passing for that question having been settled.
 */
const EXEMPT: Record<string, string> = {
  boxOn: 'settings.tsx\'s SKIP MACHINE checkbox (app/settings.tsx:186) — a filled tick box, not a ' +
    'selection chip. Checkboxes filling solid when checked is a near-universal convention the ' +
    'accent rule was never aimed at; the tick glyph itself already carries the state, so the fill ' +
    'reinforces rather than substitutes for a reading a filled ACTION block would invite (R464). ' +
    'That convention claim is a design judgment, not something this suite verifies — see the note ' +
    'above (R465). Removes when: this checkbox is redesigned to the border-and-tint SELECTED ' +
    'treatment used elsewhere, or a second checkbox appears and the pattern earns a real, ' +
    'non-exempted rule.'
};

/** Comments explain the rule and quote the thing it bans — strip them first. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/*
 * §15 asks for one accent on near-black, and by R137 it had thirty-odd distinct
 * jobs. Every one of them was defensible on its own; together they meant a
 * screen could show six volt things at once, which is not an accent.
 *
 * The rule that survived the audit is about WEIGHT, not hue: a filled volt
 * block is an action, and there is at most one per screen. Selection — "this is
 * the unit you are in", "this is the equipment you chose" — keeps the accent as
 * border and text over a tinted ground, which is what the Now screen's lift
 * rail had been doing correctly all along.
 */
describe('one accent, one job', () => {
  // press.ts pulls in react-native, which does not load under a bare Node
  // test. SELECTED itself lives in press-style.ts (R272) precisely so pure
  // style logic like this CAN load under one — read the same way regardless,
  // since a source-reading test should not care which file won that split.
  test('selection is defined once, not per screen', () => {
    const press = code(read('src/ui/press-style.ts'));
    assert.match(press, /export const SELECTED = \{ backgroundColor: '#1A1F0A', borderColor: '#CCFF00' \}/,
      'the accent is kept as the border, not the fill');
    assert.match(press, /export const SELECTED_TEXT = \{ color: '#CCFF00' \}/);
  });

  for (const file of SCREENS) {
    test(`${file} fills volt only for actions`, () => {
      const src = code(read(file));
      // Anything named `...On` is a state, not an action. Those are exactly the
      // styles that used to be `backgroundColor: VOLT`.
      const filledStates = [...src.matchAll(/(\w*On)\s*:\s*\{([^}]*)\}/g)]
        .filter(m => /backgroundColor:\s*VOLT/.test(m[2]))
        .map(m => m[1])
        .filter(name => !(name in EXEMPT));
      assert.deepEqual(filledStates, [],
        `these draw a selected state as loudly as the primary action: ${filledStates}`);
    });

    test(`${file} never puts black text on the accent for a state`, () => {
      const src = code(read(file));
      const blackStates = [...src.matchAll(/(\w*(?:Text|text)On)\s*:\s*\{([^}]*)\}/g)]
        .filter(m => /color:\s*'#000'/.test(m[2]))
        .map(m => m[1]);
      assert.deepEqual(blackStates, [],
        `black on volt is the filled-action treatment: ${blackStates}`);
    });
  }

  /*
   * The recap is the one screen with two filled volt blocks, and they must not
   * be the same shape — the record is bigger, higher and directly above the
   * button, so if both are rounded rectangles the hand goes to the wrong one.
   */
  test('the record is a band and the button is a button', () => {
    const src = code(read('app/recap.tsx'));
    const slab = /prSlab:\s*\{([^}]*)\}/.exec(src)![1];
    const share = /[^a-zA-Z]share:\s*\{([^}]*)\}/.exec(src)![1];
    assert.match(slab, /backgroundColor: VOLT/, 'a record still earns the fill');
    assert.match(slab, /borderRadius: 0/, 'and stops being shaped like a control');
    assert.match(slab, /marginHorizontal: -24/, 'full-bleed, so it reads as a band');
    assert.match(share, /backgroundColor: VOLT/);
    assert.match(share, /borderRadius: 16/, 'the button keeps the button shape');
  });

  /*
   * The checkbox is deliberately exempt and worth writing down so the next
   * audit does not "fix" it: a 20px box is not a block, a tick inside one is
   * the least ambiguous affordance in interface design, and drawing it as an
   * outline would make checked and unchecked differ only by a glyph.
   */
  test('the one exemption is stated, not forgotten', () => {
    const src = read('app/settings.tsx');
    assert.match(src, /boxOn: \{ backgroundColor: VOLT/, 'the checkbox still fills');
    assert.match(src, /checkbox/i, 'and the file says why');
  });

  /*
   * R464: found with EXEMPT as a bare Set and no reason attached to `boxOn`
   * anywhere — the exact shape flagged elsewhere tonight (orphan-scan.cjs's
   * ACKNOWLEDGED list) as indistinguishable from something silenced. A
   * reason living only in a comment ABOVE the set is one accidental deletion
   * away from an unexplained name; the reason belongs ON the entry.
   */
  test('the exemption itself carries a real reason, not just the comment above it', () => {
    const reason = EXEMPT.boxOn;
    assert.ok(reason && reason.length > 40,
      'boxOn has no attached reason — an exemption without one is indistinguishable from ' +
      'something silenced rather than decided');
  });
});

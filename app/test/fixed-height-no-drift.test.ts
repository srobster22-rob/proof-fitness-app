import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = fs.readFileSync(path.join(HERE, '..', 'src', 'ui', 'NowScreen.tsx'), 'utf8');
const MODEL = fs.readFileSync(path.join(HERE, '..', 'src', 'ui', 'now-model.ts'), 'utf8');

/*
 * R512. `fixedHeight` decides whether the Now screen fits, and it does that
 * from constants hand-copied out of the stylesheet.
 *
 * Its own comment admits the price — "every constant here is duplicated from
 * the stylesheet... that makes measuring them against the real thing a
 * periodic job, not a one-off" — and the file records two times the copy went
 * stale: STEP_HINT was 12 against a real 40, HEADER_TEXT was 58 against a real
 * 79. Both were silent. Both understated the column. Both made the screen
 * promise a fit it did not deliver.
 *
 * It happened a third time in R511, by my own hand and within one round: the
 * main-screen work raised `root.paddingTop` from 8 to 16 for the breathing
 * room the owner asked for, and ROOT_PAD stayed at 8. Every fit test still
 * passed, because they check this arithmetic against ITSELF.
 *
 * A periodic job nobody is scheduled to do is not a control. This reads the
 * value out of the stylesheet instead, so the next person who changes the
 * padding — and the owner's redesign will change several of these — is told
 * immediately rather than shipping a column that is 8px optimistic.
 *
 * Only the constants that correspond to a single stylesheet number are checked
 * here. The composite ones (HEADER_TEXT is three lines plus their gaps) cannot
 * be derived from one declaration and stay measured by hand against the running
 * app; those are named below so it is clear what this does NOT cover.
 */
describe('fixedHeight does not drift from the stylesheet (R512)', () => {
  /** A numeric property out of NowScreen's StyleSheet, by style name. */
  function styleValue(styleName: string, prop: string): number | null {
    const block = new RegExp(`\\b${styleName}:\\s*\\{([\\s\\S]*?)\\n  \\}|\\b${styleName}:\\s*\\{([^}]*)\\}`)
      .exec(SCREEN);
    if (!block) return null;
    const body = block[1] ?? block[2] ?? '';
    const m = new RegExp(`\\b${prop}:\\s*(\\d+)`).exec(body);
    return m ? Number(m[1]) : null;
  }

  /** A `const NAME = n` from fixedHeight's constant line. */
  function modelConst(name: string): number | null {
    const m = new RegExp(`\\b${name} = (\\d+)`).exec(MODEL);
    return m ? Number(m[1]) : null;
  }

  test('the constants and the styles are both still findable', () => {
    /*
     * Guard on the instrument. If either regex stops matching — a rename, a
     * reformat — every comparison below passes vacuously, which is precisely
     * the failure mode this file exists to end.
     */
    assert.equal(typeof modelConst('ROOT_PAD'), 'number',
      'ROOT_PAD is no longer written as `ROOT_PAD = n`; this guard reads nothing');
    assert.equal(typeof styleValue('root', 'paddingTop'), 'number',
      'root.paddingTop is no longer a literal; this guard reads nothing');
  });

  test('ROOT_PAD is the padding the screen actually uses', () => {
    assert.equal(modelConst('ROOT_PAD'), styleValue('root', 'paddingTop'),
      'fixedHeight budgets a different top padding than the screen draws, so ' +
      'every "does it fit" answer is wrong by the difference');
  });

  test('and it is the top padding, not the horizontal one', () => {
    // A guard on the guard: `root` also carries paddingHorizontal, and reading
    // that instead would compare two unrelated numbers and pass by luck.
    assert.equal(styleValue('root', 'paddingHorizontal'), 20,
      'the fixture no longer matches the stylesheet it reads');
    assert.notEqual(styleValue('root', 'paddingTop'), styleValue('root', 'paddingHorizontal'),
      'the two paddings are equal, so this test can no longer tell them apart');
  });

  test('the hand-measured constants are declared as such', () => {
    /*
     * These cannot be derived: each is several stylesheet values plus the gaps
     * between them, measured on the running app. Naming them here keeps the
     * boundary of this file honest — it says which numbers are guarded and
     * which are still a periodic job.
     */
    for (const name of ['TOP_BAR', 'HEADER_TEXT', 'STEP_HINT', 'REPS_ROW', 'REST_ROW', 'FOOTER']) {
      assert.equal(typeof modelConst(name), 'number', `${name} is gone from fixedHeight`);
    }
    assert.match(MODEL, /duplicated from the stylesheet/,
      'the note explaining why these are hand-measured has been removed');
  });
});

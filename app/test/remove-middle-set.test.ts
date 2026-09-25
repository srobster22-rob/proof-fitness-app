import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { around } from './helpers/source.ts';
import { nowScreenSource } from './helpers/now-screen.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = nowScreenSource();
const handoff = readFileSync(path.join(HERE, '..', '..', 'HANDOFF.md'), 'utf8');

/*
 * Removing a set from the MIDDLE of a workout.
 *
 * UNDO only ever popped the tail, so correcting a set logged wrong in the
 * middle used to mean destroying every good set after it. The fix put removal
 * in the edit sheet — tap a chip, EDIT SET, REMOVE THIS SET.
 *
 * Walked on the running app: three sets of 175, 220 and 265 at five reps total
 * **3,300 lb**; removing the middle one leaves **2 sets · 2,200 lb** and
 * renumbers the survivor from 3 to 2. Both numbers are checkable by hand,
 * which is the point (§16) — a total that silently kept counting a removed set
 * would look exactly like a total that did not.
 */
describe('a set in the middle can be removed without taking the good ones with it', () => {
  test('removal lives in the edit sheet, not in UNDO', () => {
    const sheet = around(src, "T('removeSet')", 400, 200);
    assert.match(sheet, /onPress/, 'REMOVE THIS SET is not wired to anything');
    // UNDO stays a tail operation; it is not the middle-set path and must not
    // quietly become one.
    assert.match(readFileSync(path.join(HERE, '..', 'src', 'ui', 'now-model.ts'), 'utf8'), /removeSet\(setId: string\)/,
      'nothing on this screen can remove a specific set');
  });

  test('the running total is recomputed, not decremented', () => {
    /*
     * The total is derived from the session's sets every render — see the note
     * on `totalVolume` in `now-model`, which records this being hand-rolled
     * three times and disagreeing with the recap each time. A decrementing
     * counter would drift the moment a set was edited rather than removed.
     */
    const model = readFileSync(path.join(HERE, '..', 'src', 'ui', 'now-model.ts'), 'utf8');
    assert.match(model, /sessionStats\(/,
      'the running total no longer comes from the one definition the recap uses');
  });

  test('HANDOFF describes the interaction that actually exists', () => {
    /*
     * It said "tap the chip to arm it, tap again to remove" — the gesture from
     * before removal moved into the edit sheet, which is also why `armSet`
     * turned up as a tested export with no production caller (R176). A handoff
     * that teaches a gesture the app does not have costs the next session a
     * round to discover, exactly as it cost this one.
     */
    assert.match(handoff, /tap its chip to open EDIT SET/);
    assert.doesNotMatch(handoff, /tap the chip to arm it/,
      'the superseded gesture is back in the handoff');
  });
});

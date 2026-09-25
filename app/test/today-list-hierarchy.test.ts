import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TYPE } from '../src/ui/type.ts';
import { nowScreenSource } from './helpers/now-screen.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = nowScreenSource();

/** One style block out of NowScreen's stylesheet, as text. */
function style(name: string): string {
  const m = SOURCE.match(new RegExp(`\\n  ${name}:\\s*\\{([^}]*)\\}`, 's'))
    ?? SOURCE.match(new RegExp(`\\n  ${name}:\\s*([^,\\n]*)`));
  assert.ok(m, `no style named "${name}" — it was renamed or removed`);
  return m![1];
}

function size(name: string): number {
  const m = /fontSize:\s*(?:TYPE\.(\w+)|(\d+))/.exec(style(name));
  assert.ok(m, `${name} has no readable fontSize`);
  return m![1] ? (TYPE as Record<string, number>)[m![1]] : Number(m![2]);
}

/*
 * R513, for OWNER.md #1 — "nothing that reads as generated filler".
 *
 * THIS WORKOUT's hierarchy was inverted. Each lift's SET CHIPS are 15px at
 * #E8EAED, and the lift NAME that groups them was 12px at #9AA5AF: the label
 * was quieter than its own contents. Nothing anchored a group, so three
 * exercises read as one undifferentiated field of small numbers — which is
 * exactly what makes a list look like a debug view instead of a workout.
 *
 * Pinned as an ORDERING rather than as three font sizes, because the sizes are
 * a judgement that may reasonably change and the ordering is the thing that
 * must not. Three tiers, loudest last:
 *
 *   chrome labels (THIS WORKOUT, NEXT ON PUSH DAY)  <  lift name  <=  set chip
 *
 * The middle one is the fix; the outer two are what stop the fix going too
 * far. A name louder than the numbers would be the same mistake pointed the
 * other way, and R511 already made that mistake once with the hero.
 */
describe('the workout list has a hierarchy a lifter can read (R513)', () => {
  test('the lift name belongs to the content tier, not the chrome tier', () => {
    /*
     * Asked as WHICH TIER IT IS NEARER, which is the only form of this that
     * discriminates. The first version asserted merely that the name is larger
     * than the chrome label — and 12px was already larger than the 10px label,
     * so it passed against the exact state it was written to rule out. Planting
     * the pre-R513 values is what exposed that; the assertion was decoration.
     *
     * Before: 12px, which is 2 above the chrome label and 3 below the set
     * chips — nearer the chrome, and it read that way.
     * After:  14px, which is 4 above and 1 below — nearer the content.
     */
    const chrome = Math.max(size('todayHeading'), size('railLabel'));
    const name = size('liftName');
    const content = size('chipText');
    assert.ok(name - chrome > content - name,
      `the lift name (${name}px) sits ${name - chrome} above the chrome labels ` +
      `(${chrome}px) and ${content - name} below the set numbers (${content}px), so it ` +
      'reads as another label rather than as the heading of a group');
  });

  test('but never outranks the numbers themselves', () => {
    /*
     * The guard on the other side. A lifter reads the sets; the name is how
     * they find which sets. §4 puts the numbers at the centre of this screen
     * and a group heading must not take that.
     */
    assert.ok(size('liftName') <= size('chipText'),
      `the lift name (${size('liftName')}px) is larger than the set numbers ` +
      `(${size('chipText')}px) it is only supposed to introduce`);
  });

  test('the lift you are on is still brighter than the ones you finished', () => {
    // Raising the base name's colour could have swallowed this distinction —
    // it is the only thing marking where you are in the list.
    assert.match(style('liftNameCurrent'), /color:\s*'#E8EAED'/);
    const base = /color:\s*'(#[0-9A-Fa-f]{6})'/.exec(style('liftName'))?.[1];
    assert.ok(base && base.toUpperCase() !== '#E8EAED',
      'the current lift and every finished lift are now the same colour');
  });

  test('the groups are separated by more than a hairline of luck', () => {
    // Type alone did not do it: the blocks also needed room, and the room is
    // free here because this list is inside the scroller.
    const pad = Number(/paddingVertical:\s*(\d+)/.exec(style('liftBlock'))?.[1]);
    assert.ok(pad >= 12, `liftBlock has ${pad}px of vertical padding; the groups run together`);
  });
});

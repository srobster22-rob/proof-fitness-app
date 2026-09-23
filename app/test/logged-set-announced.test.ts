import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { region, upTo } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = readFileSync(path.join(HERE, '..', 'src', 'ui', 'NowScreen.tsx'), 'utf8');

/**
 * The opening `<Text ...` tag nearest before the first occurrence of `marker`,
 * read through the guarded helpers so a moved anchor throws instead of quietly
 * reading the wrong text (the repo gate against bare indexOf slicing).
 */
function enclosingText(marker: string): string {
  const before = upTo(SCREEN, marker);
  const open = before.lastIndexOf('<Text');
  assert.ok(open >= 0, `no <Text before ${marker}`);
  const tag = region(before.slice(open), '<Text', '>');
  // A tag cut short would let the doesNotMatch below pass by reading nothing.
  assert.match(tag, /style=/, `the tag before ${marker} was not read whole: ${tag}`);
  return tag;
}

/*
 * R660. LOG SET only buzzes, so a screen-reader user got no word that the set
 * landed. The line under the lift answers exactly that -- "Just did 175 x 5",
 * the goal gap, the coach -- and it is always mounted and changes in place,
 * the case a polite live region announces dependably. It changes only on the
 * lifter's own actions (logging, switching lifts), never on a timer. Not on
 * every set, though: a lift with history reads "Last time" or the coach's
 * call, which hold still, and since R682 a coached lift's line changes only
 * when the call is made. A per-set confirmation for those is backlogged.
 */
describe('logging a set is confirmed to a screen reader (R660)', () => {
  test('the line under the lift is a polite status', () => {
    // The head's own expression, which R682 wraps in volt once a call is made.
    const tag = enclosingText('{state.lastTime.made ?');
    assert.match(tag, /style=\{s\.lastTime\}/, 'the anchor no longer sits in the last-time line');
    assert.match(tag, /role="status"/, 'the confirmation line is not a status');
    assert.match(tag, /aria-live="polite"/, 'the confirmation line is not a live region');
  });

  test('the rest timer is not a live region, or it would talk every second', () => {
    const tag = enclosingText("{T('resting')}");
    assert.doesNotMatch(tag, /aria-live|role="status"|role="timer"/,
      'the RESTING countdown became a live region and will be read out on every tick');
  });
});

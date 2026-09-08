import assert from 'node:assert/strict';

/**
 * A named region of a source file, for the tests that read source.
 *
 * These tests exist because some rules have no model to assert against — a
 * style that must not be absolute, a control that must sit outside a scroller —
 * and the only place the rule lives is the file itself. They work by slicing
 * out the block they care about and matching inside it.
 *
 * The slicing is where they go wrong, and it goes wrong SILENTLY. `indexOf`
 * returns -1 when the anchor has moved, and `slice(-1)` does not throw: it
 * hands back the last character of the file, or — with two anchors — the empty
 * string. Every `assert.match` against that fails and every `assert.doesNotMatch`
 * passes, so the test either invents a confident, specific, wrong diagnosis or
 * quietly stops testing anything at all.
 *
 * Measured: renaming one prop from `{s.body}` to `{[s.body, ...]}` made a
 * passing test report "the add button is inside the scrolling list again" about
 * a button that had not moved. Nothing about the failure pointed at the anchor.
 *
 * So the anchors are checked, and a missing one says which one it was.
 */
export function region(src: string, from: string, to?: string): string {
  const start = src.indexOf(from);
  assert.notEqual(start, -1,
    `anchor not found: ${JSON.stringify(from)} — it was renamed or removed, ` +
    `so this test is about to read the wrong part of the file`);
  if (to === undefined) return src.slice(start);

  const end = src.indexOf(to, start);
  assert.notEqual(end, -1,
    `closing anchor not found after ${JSON.stringify(from)}: ${JSON.stringify(to)}`);
  return src.slice(start, end);
}

/** Everything up to an anchor, with the same guarantee. */
export function upTo(src: string, to: string): string {
  const end = src.indexOf(to);
  assert.notEqual(end, -1,
    `anchor not found: ${JSON.stringify(to)} — this test is about to read the whole file`);
  return src.slice(0, end);
}

/**
 * A window around an anchor, for the checks that care about what sits NEAR a
 * line rather than inside a named block.
 *
 * `before` and `after` are character counts. They are a blunt instrument and
 * known to be one: the point of routing them through here is that a moved
 * anchor fails loudly instead of returning the first 400 characters of the file
 * and matching something irrelevant.
 */
export function around(src: string, anchor: string, before: number, after: number): string {
  const at = src.indexOf(anchor);
  assert.notEqual(at, -1, `anchor not found: ${JSON.stringify(anchor)}`);
  return src.slice(Math.max(0, at - before), at + anchor.length + after);
}

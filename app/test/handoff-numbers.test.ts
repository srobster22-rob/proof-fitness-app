import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_GOALS } from '../src/domain/goals.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HANDOFF = fs.readFileSync(path.join(HERE, '..', '..', 'HANDOFF.md'), 'utf8');

/*
 * R529. HANDOFF is the first file every session reads, so a number in it that
 * has stopped being true is worse than no number: it is read as current by
 * somebody with no way to check.
 *
 * It quoted "npm test  # 1,561 green" against a real 1,973 — stale by 412
 * tests, and stale in the one direction that matters, because a reader who
 * runs the suite and sees a different number cannot tell whether the doc is
 * old or their tree is broken.
 *
 * The fix for THAT one is not a gate. A suite count changes every round, so
 * any test pinning it would fail on every round that adds a test, and the
 * repair would be to edit the doc — which is a tax, not a control. PROMPT §12
 * already had the right answer for the same problem: "run `npm test` for the
 * current count". So the number is gone and the pointer replaces it, and this
 * pins that it stays gone.
 *
 * The numbers HANDOFF states that CAN stay true are pinned against the thing
 * that defines them instead, so they cannot drift the way the Swift count did
 * in R528.
 */
describe('the numbers in HANDOFF are ones that can stay true (R529)', () => {
  test('it does not quote a suite count', () => {
    /*
     * The specific shape: a figure attached to `npm test`. Not any number in
     * the file — most of them are round numbers, R-numbers or measurements
     * that belong there.
     */
    const line = /npm test[^\n]*/.exec(HANDOFF);
    assert.ok(line, 'the quickstart no longer shows `npm test`, so this reads nothing');
    assert.doesNotMatch(line[0], /[\d,]{3,}\s*(green|passing|tests)/,
      `HANDOFF quotes a suite count — "${line[0].trim()}" — which is stale the ` +
      'next time anybody adds a test. Point at the command instead, as PROMPT §12 does');
  });

  test('the goals cap it states is the cap the code enforces', () => {
    const stated = /Goals are capped at (\d+)/.exec(HANDOFF);
    assert.ok(stated, 'HANDOFF no longer states the goals cap; this guard reads nothing');
    assert.equal(Number(stated[1]), MAX_GOALS,
      `HANDOFF says goals are capped at ${stated[1]} and MAX_GOALS is ${MAX_GOALS}`);
  });

  test('the test count it attributes to db-location is real', () => {
    /*
     * This one is accurate today — verified by running that file — and it is
     * exactly the kind of number that goes quietly wrong, because nothing
     * connects the sentence to the suite it describes.
     */
    const stated = /(\d+) tests pin them/.exec(HANDOFF);
    assert.ok(stated, 'the db-location claim was reworded; update or drop this guard');
    const src = fs.readFileSync(path.join(HERE, 'db-location.test.ts'), 'utf8');
    const actual = (src.match(/^\s*test\(/gm) ?? []).length;
    assert.equal(actual, Number(stated[1]),
      `HANDOFF says ${stated[1]} tests pin the database location and ` +
      `db-location.test.ts declares ${actual}`);
  });
});

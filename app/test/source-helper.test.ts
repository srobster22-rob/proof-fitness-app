import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { region, upTo, around } from './helpers/source.ts';

/**
 * The guard on the guards.
 *
 * Twenty-four source-reading assertions across twelve files sliced with a bare
 * `indexOf`, and `slice(-1)` does not throw — it returns the last character, or
 * the empty string when both anchors are missing. Every `assert.match` against
 * that fails and every `assert.doesNotMatch` passes: the test either invents a
 * confident wrong diagnosis or silently stops testing.
 *
 * Measured: renaming one prop from `{s.body}` to `{[s.body, ...]}` made a
 * passing layout test report "the add button is inside the scrolling list
 * again" about a button that had not moved.
 */
describe('reading a region of source fails loudly when the anchor moves', () => {
  const SRC = 'alpha BEGIN middle END omega';

  test('a region between two anchors is what sits between them', () => {
    assert.equal(region(SRC, 'BEGIN', 'END'), 'BEGIN middle ');
  });

  test('and with one anchor, everything from it', () => {
    assert.equal(region(SRC, 'END'), 'END omega');
  });

  test('a missing opening anchor throws, and says which one', () => {
    assert.throws(() => region(SRC, 'MISSING'), /MISSING/);
    // The behaviour being replaced: this is what `slice(-1)` handed back.
    assert.equal(SRC.slice(SRC.indexOf('MISSING')), 'a', 'the trap itself still works this way');
  });

  test('a missing closing anchor throws too', () => {
    assert.throws(() => region(SRC, 'BEGIN', 'MISSING'), /MISSING/);
  });

  test('the closing anchor is looked for AFTER the opening one', () => {
    // Otherwise a tag that also appears above the block silently produces an
    // empty region, which passes every doesNotMatch in the suite.
    assert.equal(region('END alpha BEGIN middle END', 'BEGIN', 'END'), 'BEGIN middle ');
  });

  test('upTo stops at its anchor and throws without one', () => {
    assert.equal(upTo(SRC, 'BEGIN'), 'alpha ');
    assert.throws(() => upTo(SRC, 'MISSING'), /MISSING/);
  });

  test('around takes a window either side, and throws without the anchor', () => {
    assert.equal(around(SRC, 'middle', 6, 4), 'BEGIN middle END');
    assert.throws(() => around(SRC, 'MISSING', 10, 10), /MISSING/);
  });

  test('around clamps at the start rather than wrapping', () => {
    assert.equal(around('abc', 'a', 500, 0), 'a');
  });
});

/*
 * And the sweep, so it stays swept. Twenty-four sites were converted in one
 * pass; the twenty-fifth is the one that matters, and it will be written by
 * someone who has never read any of this.
 */
describe('no test slices source with a bare indexOf', () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const BARE = /\.slice\([^)]*\bindexOf\(/;

  test('every source-reading test goes through the guarded helpers', () => {
    const offenders: string[] = [];
    for (const f of fs.readdirSync(HERE)) {
      // The trap itself is quoted in this file on purpose, as the thing being
      // demonstrated — it is asserted about rather than relied on.
      if (!f.endsWith('.test.ts') || f === 'source-helper.test.ts') continue;
      const lines = fs.readFileSync(path.join(HERE, f), 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (BARE.test(line)) offenders.push(`${f}:${i + 1}  ${line.trim()}`);
      });
    }
    assert.deepEqual(offenders, [],
      'slice(indexOf(...)) returns the last character rather than throwing when ' +
      'the anchor moves — use region / upTo / around from helpers/source.ts');
  });

  test('the sweep is actually reading files, and the pattern still matches one', () => {
    const seen = fs.readdirSync(HERE).filter(f => f.endsWith('.test.ts'));
    assert.ok(seen.length >= 40, `only ${seen.length} test files found — the sweep proves nothing`);
    assert.ok(BARE.test("const x = SOURCE.slice(SOURCE.indexOf('a'))"),
      'the pattern no longer matches the thing it is meant to catch');
    assert.ok(!BARE.test("const x = region(SOURCE, 'a')"), 'and it must not flag the fix');
  });
});

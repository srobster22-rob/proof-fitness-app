import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PARITY = readFileSync(path.join(HERE, 'bundle-parity.test.ts'), 'utf8');

/*
 * R662. `npm test` runs its files as parallel processes, and several of them
 * require dist/proof-domain.js at load. bundle-parity.test.ts used to rewrite
 * that same file mid-suite -- swapping drift in and back to prove --check
 * reports staleness, and rebuilding it to prove a plain build still writes.
 * Its writes were temp+rename, but on Windows a reader that opens the file
 * during a rename can fail outright, so a loaded box turned the suite red for
 * reasons that had nothing to do with the change under test (R660's gate).
 *
 * build-domain.cjs honours PROOF_BUNDLE_OUT and writes nothing else, so both
 * tests now work on a temp path. These guards fail if either one goes back to
 * the shipped artifact.
 */
describe('the suite never rewrites the shipped bundle (R662)', () => {
  test('the staleness check works on a temp copy, not dist/proof-domain.js', () => {
    const body = region(PARITY,
      "test('--check reports staleness rather than curing it'",
      "test('a plain build still writes");
    assert.match(body, /mkdtempSync\(/, 'the staleness test no longer works in a temp directory');
    assert.match(body, /run\(\['build-domain\.cjs', '--check'\], copy\)/,
      'the staleness check is not pointed at the copy');
    assert.doesNotMatch(body, /'dist'|renameSync/,
      'the staleness test writes the real shipped bundle again');
  });

  test('the plain build writes into a temp path', () => {
    const body = region(PARITY, "test('a plain build still writes, so --check is opt-in'", 'finally');
    assert.match(body, /run\(\['build-domain\.cjs'\], out\)/,
      'the plain build rebuilds the shipped bundle while other tests load it');
  });

  test('the run helper forwards the output path to the build', () => {
    assert.match(PARITY, /PROOF_BUNDLE_OUT: out/,
      'run() no longer passes PROOF_BUNDLE_OUT, so every build it starts writes dist/');
  });
});

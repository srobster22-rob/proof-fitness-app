import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');

/*
 * R500. The gate that decides whether everything passed could not see
 * everything.
 *
 * `npm test` ran `node --test test/[star].test.ts` — one level, no more.
 * Nothing lived in a subdirectory yet, so the suite count was honest and the
 * hole was invisible; it would open the first time somebody grouped a few
 * files into `test/ui/`. Demonstrated before fixing rather than argued: a file
 * planted at `test/sub/canary.test.ts` containing `assert.equal(1, 2)` ran
 * green — 1852 passed, 0 failed, EXIT CODE 0. A deliberately failing test
 * could not make the build fail.
 *
 * That is the worst class of defect this repo can hold, because it is not
 * wrong about the product — it is wrong about the EVIDENCE. Every round's
 * "suite green" is an inference from this one command, so a blind spot here
 * silently weakens every claim made from it, backwards and forwards.
 *
 * The check below derives from the DISK rather than restating the pattern:
 * walk the tree, and require that anything ending `.test.ts` is somewhere the
 * configured glob actually reaches. A test that asserted the string in
 * package.json equals some expected string would pass just as happily while
 * the real hole reopened underneath it.
 */
describe('the suite gate can see every test file there is', () => {
  const script = (JSON.parse(
    fs.readFileSync(path.join(APP, 'package.json'), 'utf8')
  ) as { scripts: Record<string, string> }).scripts.test;

  const patterns = [...script.matchAll(/"?(test\/[^\s"]*\.test\.ts)"?/g)].map(m => m[1]);

  /** Every *.test.ts under test/, relative to app/, slash-separated. */
  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return e.name.endsWith('.test.ts')
        ? [path.relative(APP, full).split(path.sep).join('/')]
        : [];
    });
  }

  const files = walk(path.join(APP, 'test'));

  test('there are test files to be found at all', () => {
    // Guard on the instrument: an empty walk, or a script line this regexp
    // cannot read, would make every check below vacuous — which is the exact
    // failure this whole file exists to catch.
    assert.ok(files.length > 100, `only found ${files.length} test files`);
    assert.ok(patterns.length > 0, `no test pattern found in: ${script}`);
  });

  test('the run pattern reaches into subdirectories', () => {
    for (const p of patterns) {
      assert.ok(p.includes('**'),
        `the suite runs "${p}", which stops at the top level — a test file in ` +
        'a subdirectory would never run, and could not fail the build');
    }
  });

  test('every file on disk is reached by the pattern', () => {
    // The glob as a regexp: ** crosses separators, a lone * does not.
    /*
     * `**\/` is parked under a named token while the lone `*` is expanded,
     * so the second replace cannot chew through the first one's output.
     *
     * The token used to be a raw control character, which worked and was a
     * bad idea: it made this file BINARY to grep, diff and every review tool,
     * and an invisible byte is not something a reader can check. A word is
     * just as safe here — no path contains it — and can be read.
     */
    const GLOBSTAR = '__GLOBSTAR__';
    const res = patterns.map(p => new RegExp('^' + p
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, GLOBSTAR)
      .replace(/\*/g, '[^/]*')
      .replaceAll(GLOBSTAR, '(?:.*/)?') + '$'));
    const missed = files.filter(f => !res.some(r => r.test(f)));
    assert.deepEqual(missed, [],
      `${missed.length} test file(s) exist that the suite never runs`);
  });
});

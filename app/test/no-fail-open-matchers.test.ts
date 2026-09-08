import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');

/** Every .ts under test/ and every scan tool — the places that build patterns. */
function sources(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const dir of ['test', 'tools']) {
    const full = path.join(APP, dir);
    for (const name of fs.readdirSync(full)) {
      if (!/\.(ts|cjs|mjs)$/.test(name)) continue;
      out.push([`${dir}/${name}`, fs.readFileSync(path.join(full, name), 'utf8')]);
    }
  }
  return out;
}

/*
 * R554, for HANDOFF trap 16.
 *
 * A matcher built from a list is the one construction in this repo that fails
 * OPEN. `[].join('|')` is the empty string, `new RegExp('')` matches every
 * string, and the result is not "nothing matched" — it is "the FIRST branch
 * matched", on every input. R553 hit it and spent two passes reporting product
 * defects that did not exist, because a parse had quietly found nothing.
 *
 * The population is small on purpose. This is not a sweep for every dynamic
 * regex — most interpolate a name captured by a pattern that cannot be empty,
 * which is why `field-scan.cjs` and `orphan-scan.cjs` are safe and stay safe.
 * It is a rule for the one shape that has actually gone wrong: a pattern
 * assembled from a COLLECTION, whose size nothing has checked.
 */
describe('a pattern built from a list cannot be built from an empty one (R554)', () => {
  /*
   * `[^;]*`, not `[^)]*`. The first version could not cross the `)` in
   * `labels.map(quote).join('|')` — the exact line it was written to find —
   * and reported zero offenders, which is a pass. The "rule has something to
   * protect" test below caught it on the first run, which is the only reason
   * this paragraph is a note rather than a shipped no-op.
   */
  const FROM_LIST = /new RegExp\([^;]*\.join\(/;

  test('the scan sees the files it is supposed to', () => {
    // Trap 16's own sibling: an empty population here would pass this file for
    // free, which would be a fail-open test about fail-open tests.
    const files = sources();
    assert.ok(files.length > 100, `only ${files.length} files scanned`);
    assert.ok(files.some(([n]) => n.endsWith('card-and-message-agree.test.ts')),
      'the file this rule came from is not being scanned');
  });

  test('every list-built pattern refuses an empty list', () => {
    const offenders: string[] = [];
    for (const [name, src] of sources()) {
      const lines = src.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!FROM_LIST.test(lines[i])) continue;
        /*
         * The guard has to be in the same function, and "throws or asserts on
         * empty" is the only thing that counts — a comment saying the list is
         * never empty is exactly the reasoning trap 16 records as wrong.
         */
        const window = lines.slice(Math.max(0, i - 12), i + 3).join('\n');
        const guarded = /if \(!\w+\.length\) throw|assert\.ok\(\w+\.length/.test(window);
        if (!guarded) offenders.push(`${name}:${i + 1} — ${lines[i].trim()}`);
      }
    }
    assert.deepEqual(offenders, [],
      'a regex is being assembled from a list with nothing checking the list is ' +
      'non-empty. An empty one matches EVERY string (HANDOFF trap 16):\n' +
      offenders.join('\n'));
  });

  test('the rule has something to protect', () => {
    /*
     * A rule whose population is zero is indistinguishable from a rule that
     * does not work, and this file would pass either way. So: the known
     * instance must still be there, and must still be guarded.
     */
    const src = fs.readFileSync(path.join(APP, 'test', 'card-and-message-agree.test.ts'), 'utf8');
    assert.match(src, FROM_LIST, 'the worked example is gone; this rule now guards nothing');
    assert.match(src, /if \(!labels\.length\) throw/,
      'the worked example lost its guard, which is the whole trap');
  });
});

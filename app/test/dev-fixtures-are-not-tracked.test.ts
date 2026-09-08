import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const ROOT = path.join(APP, '..');
const PUBLIC = path.join(APP, 'public');

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

/*
 * R566. Eight `tools/seed-*.ts` files write `.b64` fixtures into `public/`, and
 * `.gitignore` named four of them one at a time. Seven more -- written this
 * session, 1.5MB total -- were never added, so `git add -A` committed real
 * training-history fixtures into the repo for real.
 *
 * That is not a hygiene nitpick: `expo export --platform web`, run for real
 * this round, copies `public/` VERBATIM into `dist/`. Every fixture shipped in
 * the actual production export, which is the one thing `.gitignore` is
 * supposed to make impossible.
 *
 * Fixed with a wildcard (`public/*.b64`) rather than a fifth name added to a
 * list -- the failure mode was the list falling behind, and a wildcard cannot.
 * `sql-wasm.wasm` is excluded on purpose: it is a real web dependency, not a
 * fixture, and the pattern must not swallow it by being too broad.
 */
describe('a seed fixture in public/ can never be tracked or shipped (R566)', () => {
  test('every .b64 file under public/ is untracked', () => {
    const files = fs.readdirSync(PUBLIC).filter(f => f.endsWith('.b64'));
    assert.ok(files.length > 0, 'no .b64 fixtures on disk -- this test is checking nothing');
    const tracked = git(['ls-files', 'app/public/']).split(/\r?\n/).filter(Boolean);
    const trackedB64 = tracked.filter(f => f.endsWith('.b64'));
    assert.deepEqual(trackedB64, [],
      'these fixtures are tracked by git and will ship in a real export: ' + trackedB64.join(', '));
  });

  test('git ignores every .b64 in public/, derived from the pattern rather than a list', () => {
    const files = fs.readdirSync(PUBLIC).filter(f => f.endsWith('.b64'));
    const args = files.map(f => 'app/public/' + f);
    const checked = git(['check-ignore', '-v', ...args]);
    const ignoredCount = checked.trim().split(/\r?\n/).filter(Boolean).length;
    assert.equal(ignoredCount, files.length,
      'only ' + ignoredCount + ' of ' + files.length + ' fixtures are ignored -- the pattern has a gap');
  });

  test('sql-wasm.wasm is not swallowed by the fixture pattern', () => {
    // A real dependency, not a fixture -- the web build serves sql.js from it,
    // and a pattern broad enough to catch every seed must not catch this too.
    assert.ok(fs.existsSync(path.join(PUBLIC, 'sql-wasm.wasm')), 'sql-wasm.wasm is missing entirely');
    let ignored = false;
    try { git(['check-ignore', 'app/public/sql-wasm.wasm']); ignored = true; } catch { /* exit 1 = not ignored */ }
    assert.equal(ignored, false, 'sql-wasm.wasm is gitignored -- a real dependency would stop being tracked');
  });

  test('the ignore rule is a pattern, not a hand-kept list', () => {
    const gi = fs.readFileSync(path.join(APP, '.gitignore'), 'utf8');
    assert.match(gi, /public\/\*\.b64/,
      'the wildcard is gone -- check whether it reverted to naming files one at a time');
  });
});

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const LINK = path.join(ROOT, 'link');
const SRC = path.join(LINK, 'index.html');
/*
 * R596. Was `path.join(LINK, 'dist', 'index.html')` — the REAL, shared
 * dist/, which `build.cjs` deletes and rewrites on every call this file
 * makes (three per run, one deliberately broken). `node --test` runs test
 * files concurrently, and two other files read that same real dist/ as the
 * shipped page (landing-page.test.ts, share-card.test.ts) — a live, once-
 * reproduced flake in this project's own suite, not a theoretical one.
 * `PROOF_LINK_DIST` (added alongside this fix) redirects the build to a
 * private temp directory instead, so this file's rebuilds — including the
 * one that leaves a build artifact deliberately broken — can never be the
 * thing another test happens to read mid-write.
 */
const TMP_DIST = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-link-dist-'));
const OUT = path.join(TMP_DIST, 'index.html');
const BUILD_ENV = { ...process.env, PROOF_LINK_DIST: TMP_DIST };

/*
 * R504. The share landing page is copied into a self-contained dist/, and one
 * path has to be rewritten on the way: the source loads `../spike/recap.js` so
 * it runs in place during development, and dist/ carries its own copy.
 *
 * That rewrite was `srcHtml.replace('../spike/recap.js', './recap.js')` -- a
 * STRING first argument, which rewrites the first occurrence and no others.
 * The build already refused a rewrite that matched nothing, and that guard is
 * the reason this looked safe; it cannot see the other failure. Add a second
 * `<script src="../spike/recap.js">` and the build reports success while
 * shipping a page whose script path does not exist inside dist/. There is
 * exactly one occurrence today, which is precisely why nobody would notice the
 * day there are two.
 *
 * The fix is `replaceAll` plus an invariant that does not depend on counting
 * anything: dist/ is self-contained, so nothing in it may point outside
 * itself. The test below plants the second occurrence and drives the REAL
 * build script, because the claim is about what gets deployed.
 */
describe('the built landing page never points outside dist/ (R504)', () => {
  let original: string;

  before(() => { original = fs.readFileSync(SRC, 'utf8'); });
  after(() => {
    // Restore the source page regardless of how the tests above left it.
    // No rebuild of the REAL dist/ needed any more — this file never wrote
    // to it in the first place, see TMP_DIST above — so there is nothing
    // left to put back there.
    fs.writeFileSync(SRC, original);
    fs.rmSync(TMP_DIST, { recursive: true, force: true });
  });

  function build(): { code: number; out: string } {
    const r = spawnSync(process.execPath, ['link/build.cjs'], { cwd: ROOT, encoding: 'utf8', env: BUILD_ENV });
    return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') };
  }

  test('the unmodified page builds, and the build is what deploys', () => {
    const { code, out } = build();
    assert.equal(code, 0, out);
    assert.doesNotMatch(fs.readFileSync(OUT, 'utf8'), /\.\.\//,
      'the deployed page contains a parent-relative path');
  });

  test('a SECOND reference to the dev path is rewritten too', () => {
    /*
     * The whole round in one fixture. Under the old string `replace` this
     * build succeeded and produced a page still carrying one `../spike/`,
     * which 404s wherever it is deployed.
     */
    const marker = '<script src="../spike/recap.js"></script>';
    assert.ok(original.includes(marker), 'the fixture no longer matches the page it plants into');
    fs.writeFileSync(SRC, original.replace(marker, marker + '\n' + marker));

    const { code, out } = build();
    assert.equal(code, 0, `the build refused a page with two dev-path scripts:\n${out}`);
    const built = fs.readFileSync(OUT, 'utf8');
    // Script SOURCES specifically: the page also names ./recap.js in a comment
    // explaining this very rewrite, so a bare text count reads 3 and the first
    // version of this assertion failed on the fix rather than on the bug.
    assert.equal((built.match(/src="\.\/recap\.js"/g) ?? []).length, 2,
      'only one of the two references was rewritten');
    assert.doesNotMatch(built, /\.\.\/spike/,
      'a dev-relative script path survived into the deployed page');
  });

  test('and any other escape out of dist/ fails the build loudly', () => {
    /*
     * The invariant is deliberately wider than the one path this build knows
     * how to rewrite: a new asset added with a parent-relative href must stop
     * the build rather than deploy a broken link.
     */
    fs.writeFileSync(SRC, original.replace('</head>', '<link rel="stylesheet" href="../spike/x.css">\n</head>'));
    const { code, out } = build();
    assert.equal(code, 1, `the build shipped a page pointing outside dist/:\n${out}`);
    assert.match(out, /still points outside dist\//);
  });
});

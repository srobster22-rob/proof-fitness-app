import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const DOMAIN = path.join(APP, 'src', 'domain');
const BUILD = path.join(APP, 'build-domain.cjs');
const HARNESS = path.join(APP, '..', 'harness', 'index.html');

/*
 * R507. The build verified itself against a list that was wrong in both
 * directions at once.
 *
 * `build-domain.cjs` loaded its own bundle and confirmed the exports were
 * present -- against a hand-written array of 28 names. The bundle publishes
 * 108, so it checked a quarter of them. And the harness, which is the only
 * consumer of this artifact that exists, calls exactly TWO of those names, so
 * it was not a contract either. A list that is neither complete nor accurate
 * still reports success, which is how R506's broken bundle passed this very
 * step while `Domain.sessionTitle` threw on the first call.
 *
 * Both questions are now asked of the sources rather than of a memory:
 *
 *   COMPLETENESS -- every name the bundler collected while parsing the modules
 *   must survive into the registry. That is what the string surgery can get
 *   wrong, and it now covers all 108 instead of a sample.
 *
 *   CONTRACT -- what the harness needs is read out of the harness. `Domain.foo`
 *   in harness/index.html IS the requirement, so adding a call there makes the
 *   next build check for it, with no list here to update or forget.
 *
 * The old list is not replaced by a longer list. That would be the same defect
 * with a later expiry date.
 */
describe('the build verifies itself from source, not from a list (R507)', () => {
  function sandbox(): { dir: string; src: string; out: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-verify-'));
    const src = path.join(dir, 'domain');
    fs.mkdirSync(src);
    for (const f of fs.readdirSync(DOMAIN)) fs.copyFileSync(path.join(DOMAIN, f), path.join(src, f));
    return { dir, src, out: path.join(dir, 'proof-domain.js') };
  }

  function build(src: string, out: string): { code: number; err: string } {
    const r = spawnSync(process.execPath, ['build-domain.cjs'], {
      cwd: APP, encoding: 'utf8',
      env: { ...process.env, PROOF_BUNDLE_SRC: src, PROOF_BUNDLE_OUT: out }
    });
    return { code: r.status ?? -1, err: (r.stdout ?? '') + (r.stderr ?? '') };
  }

  test('it checks every collected export, not a sample of them', () => {
    const { dir, src, out } = sandbox();
    try {
      const { code, err } = build(src, out);
      assert.equal(code, 0, err);
      const n = /verified all (\d+) collected exports/.exec(err);
      assert.ok(n, `the build no longer reports what it verified:\n${err}`);
      assert.ok(Number(n[1]) > 100,
        `only ${n[1]} exports verified — the check has narrowed back to a subset`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the number it verifies tracks the modules, with nothing to update', () => {
    /*
     * The property that makes it derived rather than merely bigger: add an
     * export to a module and the verified count goes up by one, with no edit
     * to build-domain.cjs. A hand-maintained list cannot do this.
     */
    const { dir, src, out } = sandbox();
    try {
      const before = /verified all (\d+)/.exec(build(src, out).err)![1];
      fs.appendFileSync(path.join(src, 'coldstart.ts'), '\nexport const R507_NEW = 1;\n');
      const after = /verified all (\d+)/.exec(build(src, out).err)![1];
      assert.equal(Number(after), Number(before) + 1,
        'a new export did not change what the build verifies, so the check is ' +
        'not derived from the modules at all');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a collected export that reaches the registry as undefined stops the build', () => {
    /*
     * The failure the completeness check exists for: a name the parser counts
     * as an export but which is worth nothing to a consumer. `export let X;`
     * is collected, assigned into the registry, and lands there as `undefined`
     * — the same thing a caller experiences in R506, arrived at from the other
     * side.
     *
     * The first version of this test planted `export const` inside an `if`
     * block, and it PASSED — on a SyntaxError from the type stripper, before
     * the completeness check ever ran. A non-zero exit proved nothing about
     * the thing being tested, so the assertion below now matches the check's
     * own message rather than merely the exit code.
     */
    const { dir, src, out } = sandbox();
    try {
      fs.appendFileSync(path.join(src, 'coldstart.ts'), '\nexport let R507_HIDDEN;\n');
      const { code, err } = build(src, out);
      assert.equal(code, 1, `a useless export was shipped anyway:\n${err}`);
      assert.match(err, /collected these exports but did not publish them: R507_HIDDEN/,
        'the build failed, but not on the completeness check — so that check is ' +
        'still unproven');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the harness contract is read out of the harness', () => {
    const src = fs.readFileSync(BUILD, 'utf8');
    assert.doesNotMatch(src, /const EXPORTS = \[/,
      'the hand-written export list is back; derive it from the consumer instead');
    assert.match(src, /const harnessDir = path\.join\(__dirname, '\.\.', 'harness'\)/,
      'the build no longer reads the harness, so its contract is a memory again');

    /*
     * The whole owned harness, not just its page. The test this replaced
     * scanned clip.js and encode.js too, and narrowing that silently would
     * have been a regression dressed as a refactor.
     */
    const owned = fs.readdirSync(path.dirname(HARNESS))
      .filter(f => /\.(html|js)$/.test(f) && f !== 'mp4-muxer.js');
    assert.ok(owned.length >= 3, `only ${owned.length} harness files found`);
    const calls = [...new Set(owned.flatMap(f =>
      [...fs.readFileSync(path.join(path.dirname(HARNESS), f), 'utf8')
        .matchAll(/Domain\.([A-Za-z_$][\w$]*)/g)].map(m => m[1])))].sort();
    assert.deepEqual(calls, ['buildRecap', 'findPRs'],
      'the harness changed what it calls — not a failure, but this test pins ' +
      'the fixture, so update it deliberately');

    /*
     * Sandboxed, like every other build in this file. The first version ran
     * the real `node build-domain.cjs`, which rewrites the shipped bundle
     * while ~120 other test processes read and mutate it -- it passed alone
     * and failed in the full suite, which is precisely the defect R501 spent a
     * round removing. A test for a build must not BE a build of the product.
     */
    const box = sandbox();
    try {
      const { code, err } = build(box.src, box.out);
      assert.equal(code, 0, err);
      for (const name of calls) {
        assert.match(err, new RegExp(name),
          `the build does not report checking ${name}, which the harness calls`);
      }
    } finally {
      fs.rmSync(box.dir, { recursive: true, force: true });
    }
  });
});

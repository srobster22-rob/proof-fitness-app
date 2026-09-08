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

/*
 * R505. The bundler collected exports with a regexp that understands exactly
 * one shape, and said nothing about the shapes it did not.
 *
 * `build-domain.cjs` publishes each module's exports into a shared registry by
 * matching `export const|let|function|class NAME` and taking ONE name. Every
 * export in the eight bundled modules is that shape today, so the bundler is
 * correct today. The failure when that stops being true is silent, which is
 * what makes it worth a gate rather than a comment:
 *
 *   export const A = 1, B = 2;
 *
 * strips to a perfectly valid `const A = 1, B = 2`, so the bundle builds, runs,
 * and passes its own "do the exports load" check -- because that check only
 * verifies the exports it managed to collect. B is simply never published, and
 * the harness gets `undefined` for it somewhere far away from the cause.
 * `export async function`, `export default` and `export *` fail the same way
 * from other directions.
 *
 * The build already refused a rewrite that matched NOTHING. That guard cannot
 * see this, and the pattern is the same one R504 found in link/build.cjs: a
 * check that only asks about the zero case. So the bundler now asks the
 * opposite question -- is there an export here I did not account for -- and
 * refuses to build.
 *
 * These tests build a COPY of the module tree in a temp directory and point
 * the build at it with PROOF_BUNDLE_SRC / PROOF_BUNDLE_OUT. Planting a bad
 * export into the real src/domain would mean mutating sources that ~120 other
 * test processes are reading, which is the exact defect R501 removed.
 */
describe('the bundler refuses an export it cannot account for (R505)', () => {
  /** A temp copy of the eight bundled modules, plus an out path beside it. */
  function sandbox(): { dir: string; src: string; out: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-bundle-'));
    const src = path.join(dir, 'domain');
    fs.mkdirSync(src);
    for (const f of fs.readdirSync(DOMAIN)) {
      fs.copyFileSync(path.join(DOMAIN, f), path.join(src, f));
    }
    return { dir, src, out: path.join(dir, 'proof-domain.js') };
  }

  function build(src: string, out: string): { code: number; err: string } {
    const r = spawnSync(process.execPath, ['build-domain.cjs'], {
      cwd: APP, encoding: 'utf8',
      env: { ...process.env, PROOF_BUNDLE_SRC: src, PROOF_BUNDLE_OUT: out }
    });
    return { code: r.status ?? -1, err: (r.stdout ?? '') + (r.stderr ?? '') };
  }

  test('an untouched copy of the real modules still builds', () => {
    /*
     * The control. Without it every assertion below could be passing because
     * the override is broken and the build is failing for some unrelated
     * reason, which would look exactly like success.
     */
    const { dir, src, out } = sandbox();
    try {
      const { code, err } = build(src, out);
      assert.equal(code, 0, err);
      assert.ok(fs.statSync(out).size > 1000, 'the sandboxed build produced nothing');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const [name, line, expected] of [
    ['several names in one declaration', 'export const R505_A = 1, R505_B = 2;', /several names in one declaration/],
    ['an async function', 'export async function r505f() { return 1; }', /does not understand/],
    ['a default export', 'export default 42;', /does not understand/]
  ] as [string, string, RegExp][]) {
    test(`${name} stops the build`, () => {
      const { dir, src, out } = sandbox();
      try {
        const target = path.join(src, 'coldstart.ts');
        fs.appendFileSync(target, '\n' + line + '\n');
        const { code, err } = build(src, out);
        assert.equal(code, 1, `the build shipped a bundle with a hole in it:\n${err}`);
        assert.match(err, expected);
        assert.match(err, /coldstart\.ts/, 'the error does not say which file to look in');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  test('a type-only export is still allowed through', () => {
    /*
     * The other half of the gate, and the one a careless version would get
     * wrong: `export type` and `export interface` are erased by the stripper,
     * so they must NOT be treated as exports the bundler failed to collect.
     * Without this, the gate would reject every module in the tree.
     */
    const { dir, src, out } = sandbox();
    try {
      fs.appendFileSync(path.join(src, 'coldstart.ts'),
        '\nexport type R505Only = { a: number };\nexport interface R505Face { b: string }\n');
      const { code, err } = build(src, out);
      assert.equal(code, 0, `a type-only export was mistaken for a missing value export:\n${err}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the real bundle is untouched by all of that', () => {
    // The overrides exist so these tests cannot reach what ships; this pins it.
    const r = spawnSync(process.execPath, ['build-domain.cjs', '--check'], {
      cwd: APP, encoding: 'utf8'
    });
    assert.equal(r.status, 0, (r.stdout ?? '') + (r.stderr ?? ''));
    assert.match(r.stdout ?? '', /is current/);
  });
});

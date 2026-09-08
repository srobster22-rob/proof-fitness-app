import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');

/*
 * R573. `npm test` chains `tsc --noEmit` as its LAST step, and this session
 * shipped two real type errors that sat unnoticed for rounds: `now-model.ts`
 * read `.equipment` off `Exercise`, a field it has never had, silently
 * evaluating to `undefined` on every call; `NowScreen.tsx` had the same JSX
 * attribute twice on one element. Both are exactly what `tsc --noEmit`
 * exists to catch, and it DID catch them, every single time `npm test` ran.
 *
 * What went wrong is upstream of the check: this session's own habit was to
 * pipe `npm test`'s output through a grep for the test runner's own
 * "tests/pass/fail" lines. `tsc`'s error output has a completely different
 * shape -- a file path, a line number, a TS code -- so it never matched that
 * pattern and never appeared in what got read, even though the overall
 * command's exit code was genuinely non-zero the whole time. A clean
 * "ℹ fail 0" from the grep was mistaken for "everything passed", when
 * "everything passed" was never what the grep could tell.
 *
 * This does not fix the habit -- there is no code fix for reading only part
 * of an output. It removes the NEED for the habit to be perfect: a `tsc`
 * failure now surfaces as an ordinary "✖ <test name>" line, which is exactly
 * the shape every grep pattern used all session already catches (verified:
 * every failing round in this log shows a "✖" line). The type error becomes
 * impossible to file-and-forget, because it fails the same way every other
 * defect in this suite does.
 */
describe('a type error fails loudly inside the suite, not silently after it (R573)', () => {
  test('tsc --noEmit passes', () => {
    /*
     * `node` plus the package's own JS entry point, not `npx tsc` and not
     * `node_modules/.bin/tsc`. `npx` is a shell shim `execFileSync` cannot
     * resolve without `shell: true`; the `.bin/tsc.cmd` wrapper on Windows is
     * itself a shell script and fails with EINVAL run directly. Neither
     * problem exists for `node <path-to-tsc.js>`, which is what those
     * wrappers both do underneath.
     */
    const bin = path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc');
    try {
      execFileSync(process.execPath, [bin, '--noEmit'], { cwd: APP, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      const out = (e as { stdout?: string }).stdout ?? String(e);
      assert.fail(`tsc --noEmit reported real type errors -- fix them, do not weaken this check:\n${out}`);
    }
  });
});

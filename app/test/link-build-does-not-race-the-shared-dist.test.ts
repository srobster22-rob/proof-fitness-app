import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

/*
 * R596. `node --test` runs test files concurrently by default, and three
 * separate files touch `link/dist/`: this project's own landing-page.test.ts
 * and share-card.test.ts read it as the shipped page, while
 * link-build-is-self-contained.test.ts used to rebuild the REAL dist/ three
 * times per run — including once deliberately leaving it in a broken state
 * to prove the build fails loudly. `build.cjs` deletes the whole directory
 * before writing it (`fs.rmSync(DIST, { recursive: true, force: true })`),
 * so the window where a concurrent reader finds dist/ outright missing, or
 * holding the deliberately-broken build, was real — reproduced once live in
 * this project's own suite before this round, not a theoretical race.
 *
 * The fix is `PROOF_LINK_DIST`: build.cjs writes to it instead of the real
 * dist/ when set. This test proves the override actually works and, just as
 * important, that the REAL dist/ is provably untouched when it is used —
 * the specific guarantee link-build-is-self-contained.test.ts now depends on
 * to stop racing the other two files.
 */
describe('link/build.cjs never touches the shared dist/ when redirected (R596)', () => {
  test('PROOF_LINK_DIST redirects the build output', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-link-dist-test-'));
    try {
      const r = spawnSync(process.execPath, ['link/build.cjs'], {
        cwd: ROOT, encoding: 'utf8', env: { ...process.env, PROOF_LINK_DIST: tmp }
      });
      assert.equal(r.status ?? -1, 0, (r.stdout ?? '') + (r.stderr ?? ''));
      assert.ok(fs.existsSync(path.join(tmp, 'index.html')),
        'PROOF_LINK_DIST was set but the build did not write there');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('the real dist/ is untouched while a redirected build runs', () => {
    const realDist = path.join(ROOT, 'link', 'dist');
    const before = fs.statSync(path.join(realDist, 'index.html')).mtimeMs;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-link-dist-test-'));
    try {
      spawnSync(process.execPath, ['link/build.cjs'], {
        cwd: ROOT, encoding: 'utf8', env: { ...process.env, PROOF_LINK_DIST: tmp }
      });
      const after = fs.statSync(path.join(realDist, 'index.html')).mtimeMs;
      assert.equal(after, before,
        'a redirected build modified the real, shared link/dist/ anyway');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

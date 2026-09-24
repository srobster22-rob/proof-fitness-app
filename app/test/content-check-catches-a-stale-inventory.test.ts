import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(APP, '..', 'CONTENT.md');

/*
 * `node tools/inventory.ts --check` (R695) is the check command's "CONTENT.md
 * current" gate: a round that changed what the app contains and never
 * regenerated the inventory fails there. It reports and never writes, so the
 * gate cannot quietly cure the thing it checks. Run against a copy.
 */
describe('the content check catches a stale inventory', () => {
  function check(file: string) {
    return spawnSync(process.execPath, ['tools/inventory.ts', '--check'], {
      cwd: APP, encoding: 'utf8', env: { ...process.env, PROOF_CONTENT_OUT: file, NODE_NO_WARNINGS: '1' }
    });
  }

  test('the committed inventory is current, and a changed count is stale, without a byte written', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-content-'));
    const copy = path.join(dir, 'CONTENT.md');
    try {
      fs.copyFileSync(CONTENT, copy);
      assert.equal(check(copy).status, 0, 'the committed CONTENT.md reads as stale');

      const stale = fs.readFileSync(copy, 'utf8').replace(/^\| Exercise library \| (\d+) \|/m, (_, n) => `| Exercise library | ${Number(n) + 1} |`);
      fs.writeFileSync(copy, stale);
      const r = check(copy);
      assert.equal(r.status, 1, 'a changed count passed the check');
      assert.match(r.stderr, /CONTENT\.md is stale/);
      assert.equal(fs.readFileSync(copy, 'utf8'), stale, 'the check rewrote the file it was checking');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a CRLF checkout of a current inventory is current, and regenerating it keeps it current', () => {
    // git's core.autocrlf checks CONTENT.md out with CRLF on Windows (R695 review).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-content-'));
    const copy = path.join(dir, 'CONTENT.md');
    try {
      fs.writeFileSync(copy, fs.readFileSync(CONTENT, 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
      assert.equal(check(copy).status, 0, 'a CRLF copy of the current CONTENT.md reads as stale');
      const regen = spawnSync(process.execPath, ['tools/inventory.ts'], {
        cwd: APP, encoding: 'utf8', env: { ...process.env, PROOF_CONTENT_OUT: copy, NODE_NO_WARNINGS: '1' }
      });
      assert.equal(regen.status, 0, regen.stderr);
      assert.ok(!fs.readFileSync(copy, 'utf8').includes('\r'), 'regenerating left CRLF lines behind');
      assert.equal(check(copy).status, 0, 'regenerated, and still stale');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const OUT = path.join(APP, 'dist', 'proof-domain.js');
const READS = 500;    // reads the child takes before reporting; one torn
                      // read is enough to prove the point, and this runs in the
                      // suite on every commit, so it is kept cheap

/*
 * R501. The bundle was rewritten in place, and it is read from other processes
 * while that happens.
 *
 * `npm test` runs the suite as ~120 separate processes. One of them,
 * `card-sheet-is-hard.test.ts`, `require`s dist/proof-domain.js at load time,
 * and `bundle-parity.test.ts` rewrites that same file twice as part of proving
 * `--check` reports staleness rather than curing it. `writeFileSync` truncates
 * before it writes, so for the length of that write the artifact on disk is
 * ZERO BYTES, and a require landing there loads a module with no exports.
 *
 * That is a sufficient mechanism for the single unreproducible suite failure
 * logged in R499 and written off as a phantom -- which is exactly why the loop
 * doc says to re-open your own "known flake" verdicts.
 *
 * The race below runs against a COPY in a temp directory, never the shipped
 * artifact. The first version of this file hammered dist/proof-domain.js
 * directly, including a control that wrote it non-atomically ON PURPOSE --
 * which would have caused the very failure it exists to explain, in every
 * other test process, on every run. The claim is about the technique, so the
 * technique is what gets raced; that the build actually uses it is checked
 * separately, at the end.
 */
describe('rewriting a file that other processes read (R501)', () => {
  /**
   * Rewrite `target` repeatedly with `write` while a child process reads it,
   * and report what the child saw.
   *
   * The READER is the child and the writer is this process. The other way
   * round needs a writer nested inside a reader's source string, and that
   * escaping is its own bug surface -- the first attempt failed there,
   * silently, because the child's stderr was being discarded.
   */
  async function race(
    target: string, bytes: Buffer, write: (t: string, b: Buffer) => void
  ): Promise<{ reads: number; short: number; writes: number }> {
    const full = bytes.length;
    /*
     * Counted, not timed. The parent writes flat out and starves this child,
     * so a wall-clock budget expired after a single batch and reported exactly
     * 200 reads -- caught by the instrument guard rather than by luck.
     */
    const reader = `
      const fs = require('fs');
      let reads = 0, short = 0;
      const t0 = Date.now();
      const tick = () => {
        for (let i = 0; i < 100; i++) {
          reads++;
          try { if (fs.readFileSync(${JSON.stringify(target)}).length !== ${full}) short++; }
          catch { short++; }
        }
        // Or 20s, whichever comes first: with a plain in-place write the
        // reader CONTENDS with the writer's handle on Windows and crawls, so
        // a pure count target let it run past the parent's deadline and get
        // killed before it ever printed.
        if (reads < ${READS} && Date.now() - t0 < 8000) return setImmediate(tick);
        console.log(JSON.stringify({ reads, short }));
      };
      tick();
    `;

    const child = spawn(process.execPath, ['-e', reader], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', done = false, writes = 0;
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('exit', () => { done = true; });

    const deadline = Date.now() + 30_000;
    while (!done && Date.now() < deadline) {
      write(target, bytes);
      writes++;
      // Yield every write so the reader is actually scheduled; a tight
      // synchronous loop here would starve the overlap being measured.
      await new Promise(r => setImmediate(r));
    }
    child.kill();

    assert.equal(err, '', `the reader child errored: ${err}`);
    // A rename costs more per write than a truncate, so this floor is set by
    // the slower path: enough writes to guarantee overlap, not a throughput bar.
    assert.ok(writes > 30, `only ${writes} writes — nothing to race against`);
    const seen = JSON.parse(out.trim()) as { reads: number; short: number };
    assert.ok(seen.reads >= 200, `only ${seen.reads} reads — the probe measured nothing`);
    return { ...seen, writes };
  }

  /** A scratch copy of the real bundle, so size and write cost stay realistic. */
  function scratch(): { dir: string; file: string; bytes: Buffer } {
    const bytes = fs.readFileSync(OUT);
    assert.ok(bytes.length > 1000, `the bundle is only ${bytes.length} bytes — build it first`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-race-'));
    const file = path.join(dir, 'proof-domain.js');
    fs.writeFileSync(file, bytes);
    return { dir, file, bytes };
  }

  test('a plain in-place write IS observable as a torn file', async () => {
    /*
     * The positive control, and the only reason the test below is worth
     * anything. This is what the build did until this round; if it ever stops
     * finding short reads, the probe has gone blind and the real assertion
     * underneath it is passing for free.
     */
    const { dir, file, bytes } = scratch();
    try {
      const { reads, short } = await race(file, bytes, (t, b) => fs.writeFileSync(t, b));
      assert.ok(short > 0,
        `${reads} reads and not one saw a torn file — the probe cannot detect ` +
        'the defect it exists to rule out, so the next test proves nothing');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('writing through a temp file and a rename is not', async () => {
    const { dir, file, bytes } = scratch();
    try {
      const { reads, short } = await race(file, bytes, (t, b) => {
        const tmp = t + '.tmp' + process.pid;
        fs.writeFileSync(tmp, b);
        /*
         * Windows refuses a rename ONTO a path another process currently has
         * open, with EPERM -- and a concurrent reader is precisely the case
         * this rename protects, so the two collide by construction. The build
         * carries the same retry; without a delay between attempts it still
         * threw, because instant retries all land inside one open handle.
         */
        for (let a = 0; ; a++) {
          try { fs.renameSync(tmp, t); break; }
          catch (e) {
            const code = (e as { code?: string }).code;
            if (a >= 200 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) throw e;
            const till = Date.now() + 2;
            while (Date.now() < till) { /* the handle closes in microseconds */ }
          }
        }
      });
      assert.equal(short, 0,
        `${short} of ${reads} reads saw a partial or missing file; the write is ` +
        'not atomic, so a concurrent require() can load a bundle with no exports');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('and the real build writes that way, leaving no temp file behind', () => {
    /*
     * Source-level on purpose: the race above proves the TECHNIQUE, this pins
     * that the shipped build uses it, and the leftover check proves the temp
     * file is consumed rather than shipped.
     */
    const src = fs.readFileSync(path.join(APP, 'build-domain.cjs'), 'utf8');
    assert.match(src, /fs\.renameSync\(tmp, OUT\)/,
      'build-domain.cjs writes the bundle straight over the top again');
    assert.doesNotMatch(src, /fs\.writeFileSync\(OUT,/,
      'build-domain.cjs still has a direct write to the shipped path');
    execFileSync(process.execPath, ['build-domain.cjs'], { cwd: APP, encoding: 'utf8' });
    const leftovers = fs.readdirSync(path.join(APP, 'dist')).filter(f => f.includes('.tmp'));
    assert.deepEqual(leftovers, [],
      'the atomic write left its scratch file in dist/, which ships');
  });
});

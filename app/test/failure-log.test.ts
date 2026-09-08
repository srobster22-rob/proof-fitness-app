import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const REPORTER = path.join(APP, 'tools', 'failure-log.mjs');
const LOG = path.join(APP, 'test-failures.log');

/*
 * R510. Twice a full-suite run reported one failure that was never identified
 * (R499, R509), and both times the cause was the same and was mine: the
 * command that ran the suite piped stdout through `grep` for the counts, so
 * the failing test's name and assertion were discarded. The second time there
 * was even a mechanism from R501 to check it against, and nothing left to
 * check it with.
 *
 * "Capture the output next time" is not a fix; it is the instruction that was
 * already being ignored. So the runner keeps the evidence itself, in a file,
 * where no pipe or filter downstream can reach it.
 *
 * These tests run a THROWAWAY suite in a temp directory. Running the real one
 * from inside itself is the mistake R507 made and R501 spent a round removing.
 */
describe('a failing test leaves evidence behind, whatever stdout does (R510)', () => {
  /** A temp dir holding `files`, plus a log path of its own. */
  function suite(files: Record<string, string>): { dir: string; log: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-flog-'));
    for (const [name, body] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), body);
    }
    return { dir, log: path.join(dir, 'test-failures.log') };
  }

  /**
   * Run node --test over `dir` with the reporter, discarding stdout entirely —
   * the harshest version of what the real commands were doing.
   */
  function run(dir: string, log: string): { code: number } {
    /*
     * Explicit file paths, not a glob: an absolute glob is not expanded here,
     * so the first version of this ran ZERO tests and the assertion that the
     * planted failure failed the run was what caught it.
     *
     * And its own log path, so a spawned run cannot stamp on the log of the
     * real run it is part of.
     */
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.ts'))
      .map(f => path.join(dir, f));
    assert.ok(files.length > 0, 'the throwaway suite has no test files in it');
    const r = spawnSync(process.execPath, [
      '--test', '--experimental-strip-types',
      '--test-reporter=./tools/failure-log.mjs', '--test-reporter-destination=stdout',
      ...files
    ], {
      // stdout is PIPED and then thrown away, which is what `| grep` does.
      // Closing it outright ('ignore') breaks the reporter's own destination,
      // and the run then fails for that reason instead of the planted one.
      cwd: APP, encoding: 'utf8',
      /*
       * NODE_TEST_CONTEXT is stripped deliberately. The runner sets it, a
       * spawned child inherits it, and node then treats that child as part of
       * the parent test protocol -- reporters do not run and the exit code
       * stops meaning what it means here. The same spawn works perfectly from
       * a plain script, which is exactly how long this took to find.
       */
      env: (() => {
        const e: Record<string, string | undefined> = { ...process.env, PROOF_FAILURE_LOG: log };
        delete e.NODE_TEST_CONTEXT;
        return e;
      })() as NodeJS.ProcessEnv
    });
    return { code: r.status ?? -1 };
  }

  test('the reporter names the test, the file and the assertion', () => {
    const { dir, log } = suite({
      'a.test.ts': "import { test } from 'node:test';\n" +
        "import assert from 'node:assert/strict';\n" +
        "test('the planted one', () => assert.equal(1, 2, 'deliberate r510'));\n"
    });
    try {
      const { code } = run(dir, log);
      assert.equal(code, 1, 'the planted failure did not fail the run');
      const text = fs.readFileSync(log, 'utf8');
      assert.match(text, /the planted one/, 'the log does not name the failing test');
      assert.match(text, /a\.test\.ts/, 'the log does not name the file');
    // The `error:` line specifically, not merely somewhere in the entry: the
    // stack trace repeats the message, so a looser match passed even with the
    // message field replaced by a constant. Caught by planting exactly that.
      assert.match(text, /^error: deliberate r510$/m,
        'the log does not carry the assertion message on its own line');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('one failing test is reported once, not once per enclosing suite', () => {
    /*
     * A suite reports a failure of its own as soon as a child fails, so
     * counting those turns one real failure into three in a nested file — and
     * a log that inflates is a log nobody believes.
     */
    const { dir, log } = suite({
      'b.test.ts': "import { test, describe } from 'node:test';\n" +
        "import assert from 'node:assert/strict';\n" +
        "describe('outer', () => { describe('inner', () => {\n" +
        "  test('deep', () => assert.ok(false, 'nested r510'));\n" +
        "}); });\n"
    });
    try {
      run(dir, log);
      const text = fs.readFileSync(log, 'utf8');
      assert.equal((text.match(/^--- \d+ ---$/gm) ?? []).length, 1,
        `one failing test produced ${(text.match(/^--- \d+ ---$/gm) ?? []).length} entries`);
      assert.match(text, /1 failure\(s\)/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a green run says so, rather than leaving the last run standing', () => {
    /*
     * The log is rewritten per run. If it were appended to, or left alone on
     * success, a stale entry would be read as a live failure — which is worse
     * than no log at all, because it is believed.
     */
    const { dir, log } = suite({
      'c.test.ts': "import { test } from 'node:test';\ntest('fine', () => {});\n"
    });
    try {
      fs.writeFileSync(log, 'STALE ENTRY FROM AN EARLIER RUN');
      const { code } = run(dir, log);
      assert.equal(code, 0);
      const text = fs.readFileSync(log, 'utf8');
      assert.doesNotMatch(text, /STALE ENTRY/, 'the previous run\'s failures are still on disk');
      assert.match(text, /\(no failures\)/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the suite command actually uses it', () => {
    // Otherwise the reporter is a file nobody runs, and the next lost failure
    // is lost exactly as before.
    const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')) as
      { scripts: Record<string, string> };
    assert.match(pkg.scripts.test, /--test-reporter=\.\/tools\/failure-log\.mjs/,
      'npm test does not load the failure reporter');
    assert.match(pkg.scripts.test, /--test-reporter=spec/,
      'the spec reporter is gone, so a person watching the run sees nothing');
    assert.ok(fs.existsSync(REPORTER), 'the reporter the test script names does not exist');
  });
});

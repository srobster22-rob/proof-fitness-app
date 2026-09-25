import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { firstTestFailure, firstTypeError, firstErrorLine, testCounts, formatSummary, testsVerdict } from '../tools/check-summary.mjs';
import { GATES, sameFile, runGates, run } from '../tools/check.mjs';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/*
 * `npm run check` (R695, AGENT_LOOP §3a) runs every SHIP gate and ends with a
 * summary that names each failing gate, its first failing assertion and the
 * file:line. These tests feed its parsers the output of REAL failing runs, made
 * in a temp folder, never the suite itself (running the real suite from inside
 * it is the mistake R507 made).
 */

/** A throwaway suite: `files` written under a temp dir, run with the spec reporter and the failure log, as the check runs it. */
function suite(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-check-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  const logFile = path.join(dir, 'failures.log');
  // Without NODE_TEST_CONTEXT, which would make the child part of this run's
  // own test protocol, where reporters do not run (failure-log.test.ts).
  const env: Record<string, string | undefined> = { ...process.env, PROOF_FAILURE_LOG: logFile, NODE_NO_WARNINGS: '1' };
  delete env.NODE_TEST_CONTEXT;
  const tests = Object.keys(files).filter(f => f.endsWith('.test.ts')).map(f => path.join(dir, f));
  const r = spawnSync(process.execPath, [
    '--test', '--test-reporter=spec', '--test-reporter-destination=stdout',
    `--test-reporter=${pathToFileURL(path.join(APP, 'tools', 'failure-log.mjs')).href}`, '--test-reporter-destination=stdout', ...tests
  ], { cwd: dir, encoding: 'utf8', env: env as NodeJS.ProcessEnv });
  const result = {
    dir, ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    log: fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : ''
  };
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

describe('the check command names what failed, and where', () => {
  test('it runs every gate the SHIP gate names', () => {
    assert.deepEqual(GATES.map(g => g.name), [
      'dependencies', 'domain bundle', 'tests', 'types', 'bundle matches source',
      'MARKET.md current', 'CONTENT.md current', 'link page current'
    ]);
  });

  test('a failing test: its name, the assertion\'s file:line, and what it said', () => {
    const s = suite({ 'planted.test.ts': [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "test('the planted one', () => {",
      "  assert.equal(1 + 1, 3, 'two is not three');",
      "});", ''
    ].join('\n') });
    const f = firstTestFailure(s.log, s.dir);
    assert.ok(f, 'no failure parsed out of the reporter\'s log');
    assert.equal(f.test, 'the planted one');
    assert.equal(f.at, 'planted.test.ts:4', 'not the line of the failing assertion');
    assert.match(f.error ?? '', /two is not three/);
    const v = testsVerdict({ ok: s.ok, output: s.output, log: s.log, appDir: s.dir });
    assert.equal(v.ok, false);
    assert.match(v.note, /^0\/1 passed, 1 failed$/);
    assert.match(v.first?.[0] ?? '', /"the planted one" at planted\.test\.ts:4/);
  });

  test('a test file that dies while loading: the error its child printed, and where', () => {
    // The shape a module split can leave: an import cycle, clean under tsc (R695 review).
    const s = suite({
      'src/a.ts': "import { B } from './b.ts';\nexport const A = 1;\nexport const AB = A + B;\n",
      'src/b.ts': "import { A } from './a.ts';\nexport const B = A + 1;\n",
      'k.test.ts': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { AB } from './src/a.ts';\ntest('sums', () => assert.equal(AB, 3));\n"
    });
    const v = testsVerdict({ ok: s.ok, output: s.output, log: s.log, appDir: s.dir });
    assert.equal(v.ok, false);
    assert.match(v.first?.[1] ?? '', /ReferenceError: Cannot access 'A' before initialization/);
    assert.match(v.first?.[0] ?? '', /at src\/b\.ts:2$/);
  });

  test('a suite that hung says it timed out, not which test passed last', () => {
    const v = testsVerdict({ ok: false, output: '✔ restore keeps every row\nError: timed out after 1800s\n', log: '', appDir: APP });
    assert.equal(v.ok, false);
    assert.equal(v.note, 'timed out');
    assert.equal(v.first?.[0], 'Error: timed out after 1800s');
    assert.equal(firstErrorLine('✔ passed\n✔ passed too\n'), '(no output)', 'a passing line was named as the error');
  });

  test('a source file node refuses to load: where it is, from the line node heads the error with', () => {
    // No stack frame points into src/ for this one, only the header (R695 review).
    const s = suite({
      'src/x.ts': 'export enum Kind { A, B }\n',
      'k.test.ts': "import { test } from 'node:test';\nimport { Kind } from './src/x.ts';\ntest('kind', () => { void Kind; });\n"
    });
    const v = testsVerdict({ ok: s.ok, output: s.output, log: s.log, appDir: s.dir });
    assert.equal(v.ok, false);
    assert.match(v.first?.[0] ?? '', /at src\/x\.ts:1$/, `the summary said: ${JSON.stringify(v.first)}`);
  });

  test('a run of zero tests fails, since a glob that matched nothing exits 0', () => {
    const v = testsVerdict({ ok: true, output: 'ℹ tests 0\nℹ suites 0\nℹ pass 0\nℹ fail 0\nℹ cancelled 0\n', log: '', appDir: APP });
    assert.equal(v.ok, false);
    assert.equal(v.note, 'no tests ran');
    assert.equal(testsVerdict({ ok: true, output: 'nothing at all', log: '', appDir: APP }).ok, false);
  });

  test('cancelled tests are counted, so a timeout never reads "0 failed"', () => {
    assert.deepEqual(testCounts('ℹ tests 3\nℹ pass 2\nℹ fail 0\nℹ cancelled 1\n'), { tests: 3, pass: 2, fail: 0, cancelled: 1 });
    const v = testsVerdict({ ok: false, output: 'ℹ tests 3\nℹ pass 2\nℹ fail 0\nℹ cancelled 1\n', log: '', appDir: APP });
    assert.equal(v.note, '2/3 passed, 1 cancelled');
  });

  test('the link page gate reads CRLF as LF, and still sees a real difference', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-same-'));
    const f = (name: string, body: string | Buffer) => { const p = path.join(dir, name); fs.writeFileSync(p, body); return p; };
    try {
      assert.equal(sameFile(f('a', 'one\ntwo\n'), f('b', 'one\r\ntwo\r\n')), true, 'a CRLF checkout read as stale');
      assert.equal(sameFile(f('c', 'one\ntwo\n'), f('d', 'one\ntwo!\n')), false, 'a changed file read as current');
      assert.equal(sameFile(f('e', Buffer.from([0, 1, 13, 10])), f('g', Buffer.from([0, 1, 10]))), false,
        'a binary file was compared as text');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a command that fails, or hangs, is a failed gate', () => {
    assert.equal(run('selftest-exit', ['-e', 'process.exit(3)'], { save: false }).ok, false);
    assert.equal(run('selftest-pass', ['-e', '0'], { save: false }).ok, true);
    const hung = run('selftest-hang', ['-e', 'setTimeout(() => {}, 20000)'], { timeout: 300, save: false });
    assert.equal(hung.ok, false);
    assert.match(hung.output, /timed out after/);
  });

  test('a command that dies without a word still says how it ended', () => {
    const silent = run('selftest-silent', ['-e', 'process.exit(3)'], { save: false });
    assert.equal(silent.ok, false);
    assert.equal(firstErrorLine(silent.output), 'exited with code 3 and printed nothing');
    // Anything the child did print stays the report.
    const loud = run('selftest-loud', ['-e', 'console.log("Error: the real reason"); process.exit(3)'], { save: false });
    assert.equal(firstErrorLine(loud.output), 'Error: the real reason');
  });

  test('one failing or crashing gate makes the exit code 1; all passing makes it 0', () => {
    const pass = { name: 'a', run: () => ({ ok: true, ms: 1 }) };
    const fail = { name: 'b', run: () => ({ ok: false, ms: 1, first: ['b broke'] }) };
    const crash = { name: 'c', run: () => { throw new Error('no such tool'); } };
    assert.equal(runGates([pass]).code, 0);
    assert.equal(runGates([pass, fail]).code, 1);
    const r = runGates([pass, crash]);
    assert.equal(r.code, 1);
    assert.match(r.results[1].first[0], /crashed: no such tool/);
  });

  test('a type error: tsc\'s first error, as file:line and code', () => {
    const e = firstTypeError([
      'src/ui/now-model.ts(1297,3): error TS2322: Type \'string\' is not assignable to type \'number\'.',
      'src/domain/coach.ts(10,1): error TS2304: Cannot find name \'x\'.'
    ].join('\n'));
    assert.deepEqual(e, { at: 'src/ui/now-model.ts:1297', code: 'TS2322', message: 'Type \'string\' is not assignable to type \'number\'.' });
    assert.equal(firstTypeError('nothing wrong here'), null);
  });

  test('any other gate: the first line that reads like an error, else its last line', () => {
    assert.equal(firstErrorLine('building\nMARKET.md is stale: regenerate it\nbye'), 'MARKET.md is stale: regenerate it');
    assert.equal(firstErrorLine('all fine\nlast words\n'), 'last words');
  });

  test('the summary names every failing gate with its first failure, and ends with a verdict', () => {
    const red = formatSummary([
      { name: 'tests', ok: false, ms: 30_000, note: '1 failed', first: ['first: "x" at test/a.test.ts:4'] },
      { name: 'types', ok: true, ms: 9_000 }
    ], ['snapshot abc'], 40_000);
    assert.match(red, /✖ tests .*\n\s+first: "x" at test\/a\.test\.ts:4/);
    assert.match(red, /✔ types/);
    assert.match(red, /· snapshot abc/);
    assert.match(red, /FAILED: tests$/);
    assert.match(formatSummary([{ name: 'types', ok: true, ms: 1 }], [], 1), /ALL GREEN$/);
  });
});

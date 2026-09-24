/**
 * The pure half of `npm run check`: turning each gate's raw output into the one
 * line a person needs, "what failed first, and where". Kept apart from
 * check.mjs, which spawns processes, so the parsing can be tested on fixtures.
 */
import path from 'node:path';

/**
 * The first failure in test-failures.log (tools/failure-log.mjs writes it):
 * the test's name, and the first stack frame inside `appDir` (never
 * node_modules), which is where the failing assertion sits. Without such a
 * frame, the line of the test itself.
 */
export function firstTestFailure(log, appDir) {
  const block = log.split(/\n--- \d+ ---\n/)[1];
  if (!block) return null;
  const field = name => (block.match(new RegExp(`^${name}: (.*)$`, 'm')) ?? [])[1] ?? null;
  const frames = [...block.matchAll(/(?:file:\/\/\/)?([A-Za-z]:[\\/][^():\n]+|\/[^():\n]+):(\d+):\d+/g)];
  const own = frames.find(f => inside(f[1], appDir) && !/node_modules/.test(f[1]));
  const where = own ? `${relative(own[1], appDir)}:${own[2]}` : field('file') && relative(field('file'), appDir);
  return { test: field('test'), error: field('error'), at: where };
}

function inside(p, dir) {
  if (!dir) return true;
  const rel = path.relative(dir, p.replace(/\//g, path.sep));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * A test FILE that dies while loading (an import cycle after a module split, a
 * syntax error) is reported in the log only as "test failed", with no stack.
 * Its child printed the real error to the run's output: the first `…Error: `
 * line, and the first frame under it inside `appDir`.
 */
export function loadError(output, appDir) {
  const lines = output.split(/\r?\n/);
  const i = lines.findIndex(l => /^(?:[A-Z]\w*)?Error(?: \[\w+\])?: /.test(l.trim()));
  if (i < 0) return null;
  // Node heads the error with the throwing line, `file:///…/x.ts:3`, above a
  // caret; a syntax error has no stack frame below, only that header.
  const own = m => m && inside(m[1], appDir) && !/node_modules/.test(m[1]);
  const header = lines.slice(Math.max(0, i - 6), i)
    .map(l => l.trim().match(/^(?:file:\/\/\/)?([A-Za-z]:[\\/][^():\s]+|\/[^():\s]+):(\d+)$/)).find(own);
  const frame = header ?? lines.slice(i + 1, i + 15)
    .map(l => l.match(/(?:file:\/\/\/)?([A-Za-z]:[\\/][^():\s]+|\/[^():\s]+):(\d+):\d+/)).find(own);
  return { error: lines[i].trim(), at: frame ? `${relative(frame[1], appDir)}:${frame[2]}` : null };
}

/** Whether a logged failure says nothing of its own: a file that failed to load, or a test cancelled by another. */
export function saysNothing(failure) {
  return !failure || /^(test failed|Promise resolution is still pending|.*cancelled.*)$/i.test(String(failure.error ?? '').trim());
}

/** The first `file(line,col): error TSnnnn: message` that tsc printed. */
export function firstTypeError(output) {
  const m = output.match(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/m);
  return m ? { at: `${m[1].replace(/\\/g, '/')}:${m[2]}`, code: m[4], message: m[5] } : null;
}

/**
 * For any other gate: a timeout if there was one, else the first line that
 * reads like an error, else the last line it printed. Never a passing test's
 * line: a suite that hung reads "timed out", not the last test that passed.
 */
export function firstErrorLine(output) {
  const lines = output.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('✔'));
  return lines.find(l => /^Error: timed out after/.test(l))
    ?? lines.find(l => /\b(error|failed|stale|missing|not current|mismatch)\b|✖/i.test(l))
    ?? lines[lines.length - 1] ?? '(no output)';
}

/** The spec reporter's closing counts: `ℹ tests 2370`, `ℹ pass 2370`, `ℹ fail 0`, `ℹ cancelled 0`. */
export function testCounts(specOutput) {
  const n = key => Number((specOutput.match(new RegExp(`^ℹ ${key} (\\d+)$`, 'm')) ?? [])[1] ?? NaN);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), cancelled: n('cancelled') };
}

/**
 * The tests gate's verdict from the run's exit, its output and the failure
 * log. A run of zero tests fails (a glob that matched nothing exits 0). A
 * failure whose log entry says nothing of its own (a file that died while
 * loading, a hook, a cancellation) is explained by the error its child
 * printed to the output.
 */
export function testsVerdict({ ok, output, log, appDir }) {
  const c = testCounts(output);
  // A hung suite is killed before it prints its counts: say it hung, not that no tests ran.
  const timeout = output.match(/^Error: timed out after .*$/m);
  if (timeout) return { ok: false, note: 'timed out', first: [timeout[0], 'full output: app/out/check-tests.txt'] };
  if (!(c.tests > 0)) return { ok: false, note: 'no tests ran', first: [firstErrorLine(output), 'full output: app/out/check-tests.txt'] };
  const note = `${c.pass}/${c.tests} passed` + (c.fail ? `, ${c.fail} failed` : '') + (c.cancelled ? `, ${c.cancelled} cancelled` : '');
  if (ok) return { ok: true, note, first: null };
  const f = firstTestFailure(log, appDir);
  const le = saysNothing(f) ? loadError(output, appDir) : null;
  const first = le
    ? [`first: ${f?.test ? `"${f.test}"` : 'a test file'} at ${le.at ?? f?.at ?? '?'}`, `says: ${le.error}`, 'full output: app/out/check-tests.txt']
    : f ? [`first: "${f.test}" at ${f.at}`, `says: ${f.error}`, 'all failures: app/test-failures.log']
    : [firstErrorLine(output), 'full output: app/out/check-tests.txt'];
  return { ok: false, note, first };
}

const seconds = ms => `${(ms / 1000).toFixed(1)}s`;

/**
 * The closing summary. `gates` are `{ name, ok, ms, note?, first? }` in the
 * order they ran; `reports` are informational lines (the snapshot, the sizes).
 */
export function formatSummary(gates, reports, totalMs) {
  const width = Math.max(...gates.map(g => g.name.length));
  const lines = [`check: ${gates.length} gates in ${seconds(totalMs)}`];
  for (const g of gates) {
    lines.push(`  ${g.ok ? '✔' : '✖'} ${g.name.padEnd(width)}  ${seconds(g.ms).padStart(6)}${g.note ? `  ${g.note}` : ''}`);
    if (!g.ok && g.first) for (const l of g.first) lines.push(`      ${l}`);
  }
  for (const r of reports) lines.push(`  · ${r}`);
  const failed = gates.filter(g => !g.ok).map(g => g.name);
  lines.push(failed.length ? `FAILED: ${failed.join(', ')}` : 'ALL GREEN');
  return lines.join('\n');
}

function relative(p, appDir) {
  const clean = p.replace(/^file:\/\/\//, '').replace(/\//g, path.sep);
  const rel = appDir ? path.relative(appDir, clean) : clean;
  return (rel.startsWith('..') ? clean : rel).split(path.sep).join('/');
}

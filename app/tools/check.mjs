/**
 * `npm run check`: every gate the SHIP gate needs, in one command.
 *
 * It runs the gates one after another, keeps each one's full output in out/,
 * and ends with a summary naming each failing gate, its first failing
 * assertion and the file:line it sits at. It exits non-zero if any gate fails.
 * Two lines after the gates are reports, not gates: the domain snapshot's hash
 * (identical before and after a change that moves code) and the size headline.
 *
 * `npm test` still runs the suite alone; this is the superset a round ships on.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstTypeError, firstErrorLine, formatSummary, testsVerdict } from './check-summary.mjs';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.join(APP, '..');
const OUT = path.join(APP, 'out');
const TSC = path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc');
const FAILURE_LOG = path.join(APP, 'test-failures.log');
const MINUTE = 60_000;

/** Run one node command in app/, keeping its output in out/check-<slug>.txt unless `save` is false. A gate that hangs fails at `timeout`. */
export function run(slug, args, { env = {}, timeout = 5 * MINUTE, save = true } = {}) {
  const started = Date.now();
  // NODE_TEST_CONTEXT would make a spawned `node --test` part of a parent test
  // run, where reporters do not run (test/failure-log.test.ts).
  const childEnv = { ...process.env, NODE_NO_WARNINGS: '1', ...env };
  delete childEnv.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, args, {
    cwd: APP, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: childEnv, timeout
  });
  const timedOut = r.error?.code === 'ETIMEDOUT';
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}` +
    (timedOut ? `\nError: timed out after ${Math.round(timeout / 1000)}s\n` : r.error ? `\n${String(r.error)}\n` : '');
  if (save) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `check-${slug}.txt`), output);
  }
  return { ok: r.status === 0 && !r.error, ms: Date.now() - started, output };
}

/** A gate whose output needs no parsing: pass, or its first error-looking line. */
const plain = (slug, args) => () => {
  const r = run(slug, args);
  return { ...r, first: r.ok ? null : [firstErrorLine(r.output)] };
};

/** Every file under `dir`, as relative paths with forward slashes. */
function tree(dir) {
  const out = [];
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else out.push(path.relative(dir, p).split(path.sep).join('/'));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort();
}

/** Whether two files hold the same bytes, reading text files with CRLF as LF (git may check them out either way). */
export function sameFile(a, b) {
  const x = fs.readFileSync(a), y = fs.readFileSync(b);
  if (x.equals(y)) return true;
  const text = buf => !buf.includes(0) && buf.toString('utf8').replace(/\r\n/g, '\n');
  return text(x) !== false && text(x) === text(y);
}

/**
 * The suite. A run can fail with nothing useful in the failure log: a test
 * file that died while loading, a hook, a cancellation. Then the error its
 * child printed is found in the output. And a run of zero tests is a failure,
 * because a glob that matched nothing exits 0.
 */
function tests() {
  try { fs.rmSync(FAILURE_LOG, { force: true }); } catch { /* the reporter rewrites it anyway */ }
  const r = run('tests', [
    '--test', '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=./tools/failure-log.mjs', '--test-reporter-destination=stdout', 'test/**/*.test.ts'
  ], { timeout: 30 * MINUTE });
  const log = fs.existsSync(FAILURE_LOG) ? fs.readFileSync(FAILURE_LOG, 'utf8') : '';
  return { ...r, ...testsVerdict({ ok: r.ok, output: r.output, log, appDir: APP }) };
}

function types() {
  const r = run('types', [TSC, '--noEmit'], { timeout: 10 * MINUTE });
  const e = r.ok ? null : firstTypeError(r.output);
  const count = (r.output.match(/: error TS\d+:/g) ?? []).length;
  return {
    ...r, note: r.ok ? 'tsc clean' : count ? `${count} errors` : undefined,
    first: r.ok ? null : e ? [`first: ${e.at} ${e.code}`, `says: ${e.message}`] : [firstErrorLine(r.output)]
  };
}

/**
 * Build the share-link page into a temp folder and compare it with the
 * committed link/dist, so a change to link/ or the share code that was never
 * rebuilt fails here instead of shipping stale.
 */
function linkPage() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-link-'));
  const r = run('link', [path.join(REPO, 'link', 'build.cjs')], { env: { PROOF_LINK_DIST: tmp } });
  const committed = path.join(REPO, 'link', 'dist');
  const a = tree(tmp), b = tree(committed);
  const differ = [...new Set([...a, ...b])]
    .filter(f => !a.includes(f) || !b.includes(f) || !sameFile(path.join(tmp, f), path.join(committed, f)));
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!r.ok) return { ...r, first: [firstErrorLine(r.output)] };
  return {
    ...r, ok: differ.length === 0, note: `${b.length} files`,
    first: differ.length ? [`stale: ${differ.slice(0, 3).join(', ')}${differ.length > 3 ? ` and ${differ.length - 3} more` : ''}`,
      'rebuild with `node link/build.cjs` from the repo root, then commit link/dist'] : null
  };
}

/**
 * The gates, in the order they run: this project's SHIP gate (AGENT_LOOP §6).
 * dist/ is not committed, so the check rebuilds it as `npm test` does, and
 * "bundle matches source" then asks the build's own --check whether what it
 * wrote is what the sources say: it fails on a build that is not reproducible
 * or a write that did not land.
 */
export const GATES = [
  { name: 'dependencies', run: plain('deps', ['check-deps.cjs']) },
  { name: 'domain bundle', run: plain('bundle', ['build-domain.cjs']) },
  { name: 'tests', run: tests },
  { name: 'types', run: types },
  { name: 'bundle matches source', run: plain('bundle-check', ['build-domain.cjs', '--check']) },
  { name: 'MARKET.md current', run: plain('market', ['tools/market.ts', '--check']) },
  { name: 'CONTENT.md current', run: plain('content', ['tools/inventory.ts', '--check']) },
  { name: 'link page current', run: linkPage },
];

/** Run `gates` in order. A gate that throws is a failed gate, never a crashed check. The code is 1 if any failed. */
export function runGates(gates) {
  const results = gates.map(g => {
    try {
      return { name: g.name, ...g.run() };
    } catch (e) {
      return { name: g.name, ok: false, ms: 0, first: [`the gate itself crashed: ${e?.message ?? e}`] };
    }
  });
  return { results, code: results.every(g => g.ok) ? 0 : 1 };
}

/** The two reports after the gates. The size report needs TypeScript's parser, so it is loaded here, not at the top. */
async function reports() {
  const snap = run('snapshot', ['tools/snapshot.ts', '--out', path.join(OUT, 'snapshot.json')]);
  const lines = [], extra = [];
  if (snap.ok) {
    lines.push(`${(snap.output.match(/^snapshot .*$/m) ?? ['snapshot (no hash printed)'])[0]}; sections in app/out/check-snapshot.txt`);
  } else {
    extra.push({ name: 'snapshot runs', ok: false, ms: snap.ms, first: [firstErrorLine(snap.output)] });
  }
  try {
    const { measure, headline } = await import('./sizes.mjs');
    lines.push(`sizes: ${headline(measure(APP))}`);
  } catch (e) {
    lines.push(`sizes: unavailable (${e?.message ?? e})`);
  }
  return { reports: lines, extra };
}

async function main() {
  const started = Date.now();
  const { results } = runGates(GATES);
  const rep = await reports();
  const all = [...results, ...rep.extra];
  const summary = formatSummary(all, rep.reports, Date.now() - started);
  fs.writeFileSync(path.join(OUT, 'check-summary.txt'), summary + '\n');
  console.log(summary);
  process.exit(all.every(g => g.ok) ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

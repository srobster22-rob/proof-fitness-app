import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

import { findPRs } from '../src/domain/pr.ts';
import { buildRecap, weekStreak } from '../src/domain/session.ts';
import { predictSession } from '../src/domain/predict.ts';
import { prefillFor, pickerFor } from '../src/domain/coldstart.ts';
import type { LoggedSet, Exercise, Session } from '../src/domain/types.ts';
/*
 * Namespace imports of every module the bundler bundles, so the parity check
 * below can be DERIVED from the source rather than from a list of names.
 */
import * as m_types from '../src/domain/types.ts';
import * as m_i18n from '../src/domain/i18n.ts';
import * as m_measure from '../src/domain/measure.ts';
import * as m_predict from '../src/domain/predict.ts';
import * as m_pr from '../src/domain/pr.ts';
import * as m_goals from '../src/domain/goals.ts';
import * as m_split from '../src/domain/split.ts';
import * as m_session from '../src/domain/session.ts';
import * as m_coldstart from '../src/domain/coldstart.ts';

/**
 * The browser bundle must behave IDENTICALLY to the source.
 *
 * The kill-test harness renders its artifacts with the bundle; the app will run
 * the TypeScript. If they diverge, the videos shown to ten real lifters are not
 * what the product would produce — and the test silently measures the wrong
 * thing. Cheap insurance against an expensive, invisible failure.
 */
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.join(HERE, '..', 'dist', 'proof-domain.js');

const sandbox: any = {};
const code = fs.readFileSync(BUNDLE, 'utf8');
new Function('globalThis', code).call(sandbox, sandbox);
const D = sandbox.Domain;

const DAY = 86_400_000, MIN = 60_000;
const NOW = Date.UTC(2026, 6, 29, 18);

const exercises = new Map<string, Exercise>([
  ['bench', { id: 'bench', name: 'Bench Press' }],
  ['ohp', { id: 'ohp', name: 'OHP' }],
  ['row', { id: 'row', name: 'Barbell Row' }]
]);

let uid = 0;
const mk = (exerciseId: string, weight: number, reps: number, at: number, sessionId: string): LoggedSet =>
  ({ id: `x${uid++}`, sessionId, exerciseId, weight, reps, at });

const history: LoggedSet[] = [];
for (let w = 8; w >= 1; w--) {
  const at = NOW - w * 7 * DAY;
  history.push(
    mk('bench', 200 + (8 - w) * 2.5, 5, at, `h${w}`),
    mk('ohp', 120, 6, at + 15 * MIN, `h${w}`),
    mk('row', 155, 8, at + 30 * MIN, `h${w}`)
  );
}
const today: LoggedSet[] = [
  mk('bench', 135, 8, NOW - 45 * MIN, 'now'),
  mk('bench', 230, 5, NOW - 30 * MIN, 'now'),
  mk('ohp', 125, 6, NOW - 18 * MIN, 'now'),
  mk('row', 160, 8, NOW - 6 * MIN, 'now')
];
const session: Session = { id: 'now', startedAt: NOW - 50 * MIN, endedAt: NOW, unit: 'lb', updatedAt: NOW };

describe('browser bundle parity', () => {
  /*
   * R508. This was seven hand-written names under the title "everything the
   * harness needs", and it was wrong twice over: the harness needs TWO of them,
   * and the bundle publishes 108. `sessionTitle` was not among the seven, which
   * is why this test sat green through R506 while that function threw
   * `sessionPlanDay is not a function` in the shipped bundle.
   *
   * The third such list in three rounds (R507 removed two more). Derived on
   * both sides now: every value each bundled module exports must reach the
   * bundle, with the same typeof and, for functions, the same arity. Adding an
   * export to a module extends this check by itself.
   *
   * Arity is included because it is free here, but its reach was measured
   * rather than assumed and it is narrower than it looks: `Function.length`
   * counts only the parameters BEFORE the first default, so it sees a change
   * to `findPRs(today, history, exercises)` and is blind to one in
   * `sessionTitle(sets, lang = 'en', plan = 'ppl')`, whose length is 1 either
   * way. Verified both ways by planting each mutation into the built bundle.
   * Required-parameter drift only, then -- worth having, not worth trusting
   * past what it covers.
   *
   * All 108 match on type and arity today, so this pins a true state rather
   * than hoping for one.
   */
  const MODULES: Record<string, Record<string, unknown>> = {
    'types.ts': m_types, 'i18n.ts': m_i18n, 'measure.ts': m_measure,
    'predict.ts': m_predict, 'pr.ts': m_pr, 'goals.ts': m_goals,
    'split.ts': m_split, 'session.ts': m_session, 'coldstart.ts': m_coldstart
  };

  test('every value the source modules export reaches the bundle', () => {
    const checked: string[] = [];
    const problems: string[] = [];
    for (const [mod, ns] of Object.entries(MODULES)) {
      for (const [name, value] of Object.entries(ns)) {
        checked.push(name);
        if (!(name in D)) { problems.push(`${mod}: ${name} is missing from the bundle`); continue; }
        if (typeof value !== typeof D[name]) {
          problems.push(`${mod}: ${name} is ${typeof value} in source, ${typeof D[name]} in the bundle`);
          continue;
        }
        if (typeof value === 'function' && value.length !== (D[name] as (...a: unknown[]) => unknown).length) {
          problems.push(`${mod}: ${name} takes ${value.length} args in source, ` +
            `${(D[name] as (...a: unknown[]) => unknown).length} in the bundle`);
        }
      }
    }
    // Guard on the instrument: an import that resolved to an empty namespace
    // would make every check above vacuous.
    assert.ok(checked.length > 100,
      `only ${checked.length} exported values found across the modules`);
    assert.deepEqual(problems, [], problems.join('; '));
  });

  test('and the two the harness actually calls are among them', () => {
    // Named separately because these are the contract, not merely present:
    // harness/index.html calls exactly these off the bundle.
    for (const name of ['findPRs', 'buildRecap']) {
      assert.equal(typeof D[name], 'function', `the harness calls ${name} and the bundle has no such function`);
    }
  });

  test('findPRs agrees', () => {
    assert.deepEqual(
      JSON.parse(JSON.stringify(D.findPRs(today, history, exercises))),
      JSON.parse(JSON.stringify(findPRs(today, history, exercises)))
    );
  });

  test('buildRecap agrees byte for byte — this is the one that matters', () => {
    const args = {
      session, sets: today, exercises, allSets: [...history, ...today],
      now: NOW, title: 'PUSH DAY'
    };
    const fromSource = buildRecap({ ...args, prs: findPRs(today, history, exercises) });
    const fromBundle = D.buildRecap({ ...args, prs: D.findPRs(today, history, exercises) });
    assert.equal(JSON.stringify(fromBundle), JSON.stringify(fromSource));
  });

  test('predictSession agrees', () => {
    const wd = new Date(NOW).getDay();
    assert.deepEqual(D.predictSession(history, NOW, wd), predictSession(history, NOW, wd));
  });

  test('prefillFor and pickerFor agree', () => {
    assert.deepEqual(D.prefillFor('bench', history, 'lb'), prefillFor('bench', history, 'lb'));
    assert.deepEqual(D.prefillFor('squat', [], 'kg'), prefillFor('squat', [], 'kg'));
    assert.deepEqual(D.pickerFor([], NOW), pickerFor([], NOW));
    assert.deepEqual(D.pickerFor(history, NOW), pickerFor(history, NOW));
  });

  test('weekStreak agrees', () => {
    assert.equal(D.weekStreak([...history, ...today], NOW), weekStreak([...history, ...today], NOW));
  });

  test('module-private names do not leak into the bundle scope', () => {
    // The reason each module gets its own IIFE: two modules both declare DAY_MS.
    assert.equal(typeof D.DAY_MS, 'undefined');
    assert.equal(typeof D.WEEK_MS, 'undefined');
    assert.equal(typeof D.FALLBACK, 'undefined');
  });
});

/*
 * Staleness gets its own answer, because parity cannot give one.
 *
 * `npm test` runs `build-domain.cjs` BEFORE this file, so by the time the
 * parity assertions above compare source against bundle the two have just been
 * made to agree. They catch a build that mangles semantics; they cannot catch
 * a bundle that is merely out of date — which is the failure §12 actually
 * names, since `harness/index.html` loads `dist/proof-domain.js` directly and
 * "a divergence would make the kill test silently measure the wrong artifact".
 *
 * Found by trying to prove the parity test bites: editing the source, running
 * the build, and watching it pass. It was right to pass. The probe was wrong,
 * and the gap it exposed was real.
 */
describe('the harness cannot be handed a stale bundle', () => {
  const APP = path.join(HERE, '..');
  const run = (args: string[], out?: string) => {
    try {
      const env = out ? { ...process.env, PROOF_BUNDLE_OUT: out } : process.env;
      return { out: execFileSync('node', args, { cwd: APP, encoding: 'utf8', env }), code: 0 };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; status?: number };
      return { out: (err.stdout ?? '') + (err.stderr ?? ''), code: err.status ?? -1 };
    }
  };

  test('--check passes when the bundle matches the source', () => {
    const { out, code } = run(['build-domain.cjs', '--check']);
    assert.equal(code, 0, out);
    assert.match(out, /is current/);
  });

  test('--check reports staleness rather than curing it', () => {
    // The whole point: a checker that rebuilds is a checker that always passes.
    /*
     * Against a COPY, through PROOF_BUNDLE_OUT (R662). This used to swap drift
     * into the REAL dist/proof-domain.js and back while other test processes
     * require that file at load -- and on Windows a reader opening it during a
     * rename can fail outright, which is what the atomic-write race test kept
     * catching. build-domain.cjs reads and writes only OUT, so a copy exercises
     * exactly the same --check.
     */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-parity-'));
    const copy = path.join(dir, 'proof-domain.js');
    try {
      fs.writeFileSync(copy, fs.readFileSync(BUNDLE, 'utf8') + '\n// drift\n');
      const { out, code } = run(['build-domain.cjs', '--check'], copy);
      assert.equal(code, 1);
      assert.match(out, /STALE/);
      // And it must not have repaired the file it was asked to inspect.
      assert.match(fs.readFileSync(copy, 'utf8'), /\/\/ drift/,
        '--check rewrote the bundle, so it can never report a problem');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a plain build still writes, so --check is opt-in', () => {
    // Into a temp path (R662), for the same reason: never rebuild the shipped
    // bundle while other test processes are loading it.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-parity-'));
    const out = path.join(dir, 'proof-domain.js');
    try {
      const { code } = run(['build-domain.cjs'], out);
      assert.equal(code, 0);
      assert.ok(fs.existsSync(out), 'the plain build did not write its output');
      assert.equal(run(['build-domain.cjs', '--check'], out).code, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/*
 * tools/snapshot.ts is how an ORGANIZE round proves a move changed nothing.
 * The first version ran a third of the Now model: R695's reviewer broke
 * removeSet, editSet, setPlan, skipDay and layoutFor and the hash never moved.
 * So the snapshot runs under V8 coverage here, and every function in the
 * modules it imports must run, callbacks included, except the named ones
 * listed below with the reason they cannot or must not.
 */
const ORPHAN = 'kept orphaned on purpose (tools/orphan-scan.cjs ACKNOWLEDGED); a tool calling it would count as its caller';
const NEVER_RUN_ON_PURPOSE: Record<string, string> = {
  'src/data/open-once.ts openOnce': ORPHAN,
  'src/data/repo.ts lastSetOf': ORPHAN,
  'src/domain/goals.ts goalE1rmGap': ORPHAN,
  'src/domain/i18n.ts missingKeys': ORPHAN,
  'src/domain/measure.ts kindOf': ORPHAN,
  'src/ui/now-layout.ts columnHeight': ORPHAN,
  'src/ui/recap-model.ts headline': ORPHAN,
  'src/ui/drag-scroll.ts useDragScroll': 'a React hook: it runs only inside a rendered component',
  'src/ui/guarded-push.ts useGuardedPush': 'a React hook: it runs only inside a rendered component',
  'src/ui/guarded-push.ts useGuardedLeave': 'a React hook: it runs only inside a rendered component',
  'src/ui/dates.ts shortDate': 'prints a year only when it is not the current one, so its output moves with the real date',
};
/** Whole files that import in node but run only in a browser. */
const BROWSER_ONLY: Record<string, string> = {
  'src/data/web-db.ts': 'needs localStorage and sql.js\'s wasm',
};
/** Modules node cannot import: they reach react-native or native expo modules. Everything else is in scope. */
const PLATFORM: string[] = [
  'src/data/db.ts', 'src/ui/backup.ts', 'src/ui/haptics.ts', 'src/ui/locale.ts', 'src/ui/now-kit.ts', 'src/ui/now-styles.ts', 'src/ui/press.ts'
];

describe('the snapshot runs every function in its scope', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-cov-'));
  const out = path.join(dir, 'snapshot.json');
  const r = spawnSync(process.execPath, ['tools/snapshot.ts', '--out', out], {
    cwd: APP, encoding: 'utf8', env: { ...process.env, NODE_V8_COVERAGE: dir, NODE_NO_WARNINGS: '1' }
  });
  const scope = r.status === 0 ? JSON.parse(fs.readFileSync(out, 'utf8')).exports as { modules: string[]; skipped: Record<string, string> } : null;
  type Fn = { functionName: string; ranges: Array<{ startOffset: number; endOffset: number; count: number }> };
  const neverRun: string[] = [];
  const loaded = new Set<string>();
  for (const f of fs.readdirSync(dir).filter(n => n.startsWith('coverage-'))) {
    for (const s of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).result as Array<{ url: string; functions: Fn[] }>) {
      const m = s.url.replace(/\\/g, '/').match(/\/app\/(src\/.*\.ts)$/);
      if (!m || !s.url.startsWith('file:')) continue;
      loaded.add(m[1]);
      if (m[1] in BROWSER_ONLY) continue;
      // Every function, named or not (a callback is where a converter or a sort
      // hides: R695 review), except the module's own top level at offset 0. Only
      // the outermost one that never ran: V8 may not even list a function inside it.
      const fns = s.functions.filter(fn => fn.functionName || fn.ranges[0].startOffset > 0);
      const zero = fns.filter(fn => fn.ranges[0].count === 0);
      const within = (o: Fn, fn: Fn) => o !== fn && o.ranges[0].startOffset <= fn.ranges[0].startOffset && o.ranges[0].endOffset >= fn.ranges[0].endOffset;
      const source = fs.readFileSync(path.join(APP, m[1]), 'utf8');
      for (const fn of zero.filter(fn => !zero.some(o => within(o, fn)))) {
        neverRun.push(fn.functionName
          ? `${m[1]} ${fn.functionName}`
          : `${m[1]}:${source.slice(0, fn.ranges[0].startOffset).split('\n').length} (an unnamed function: script the case that calls it)`);
      }
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });

  test('it runs', () => {
    assert.equal(r.status, 0, `tools/snapshot.ts failed:\n${r.stderr}`);
  });

  test('every module under src/ is in scope, except the platform ones', () => {
    assert.deepEqual(Object.keys(scope?.skipped ?? {}).sort(), PLATFORM,
      'a module stopped importing in node (did platform code leak into it?), or a platform module became pure');
    for (const rel of scope?.modules ?? []) assert.ok(loaded.has(rel), `${rel} is in scope but never loaded`);
  });

  test('every function in scope runs, named or not, except the named ones that cannot or must not', () => {
    assert.deepEqual([...new Set(neverRun)].sort(), Object.keys(NEVER_RUN_ON_PURPOSE).sort(),
      'script the new function in tools/snapshot.ts, or list it above with the reason it cannot run there');
  });
});

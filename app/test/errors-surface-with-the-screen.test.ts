import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { recordError, recentErrors, clearErrors, watchGlobalErrors, ERROR_RING } from '../src/ui/error-log.ts';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/*
 * R699, AGENT_LOOP §3a item 6: errors surface with context. A screen whose
 * render throws is replaced by its own error boundary, which records the error
 * against the screen's name; what no boundary sees is recorded as "app". The
 * playtest scripts fail on anything recorded.
 */
function quietly<T>(fn: () => T): { value: T; logged: unknown[][] } {
  const log = console.error, logged: unknown[][] = [];
  console.error = (...args: unknown[]) => { logged.push(args); };
  try { return { value: fn(), logged }; } finally { console.error = log; }
}

describe('an error is recorded with the screen it broke', () => {
  test('the screen, the message, the stack and the time, logged with the screen\'s name', () => {
    clearErrors();
    const { value, logged } = quietly(() => recordError('progress', new Error('rows went missing'), 123));
    assert.deepEqual([value.screen, value.message, value.at], ['progress', 'rows went missing', 123]);
    assert.match(value.stack ?? '', /rows went missing/);
    assert.deepEqual(logged, [['[PROOF progress] rows went missing']]);
    assert.deepEqual(recentErrors().map(e => e.screen), ['progress']);
    clearErrors();
    assert.equal(recentErrors().length, 0);
  });

  test('something thrown that is not an Error is still recorded', () => {
    clearErrors();
    quietly(() => recordError('goals', 'a string was thrown'));
    assert.equal(recentErrors()[0].message, 'a string was thrown');
    clearErrors();
  });

  test('the log keeps the last ERROR_RING', () => {
    clearErrors();
    quietly(() => { for (let i = 0; i < ERROR_RING + 3; i++) recordError('burst', `#${i}`); });
    const kept = recentErrors();
    assert.equal(kept.length, ERROR_RING);
    assert.equal(kept[0].message, '#3');
    clearErrors();
  });

  test('a throw no boundary sees, and a rejected promise, are recorded as the app, until the watch stops', () => {
    clearErrors();
    const target = new EventTarget();
    quietly(() => {
      const stop = watchGlobalErrors(target as never);
      target.dispatchEvent(Object.assign(new Event('error'), { error: new Error('a handler threw') }));
      target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('a promise was rejected') }));
      stop();
      target.dispatchEvent(Object.assign(new Event('error'), { error: new Error('after the undo') }));
    });
    assert.deepEqual(recentErrors().map(e => [e.screen, e.message]), [['app', 'a handler threw'], ['app', 'a promise was rejected']]);
    assert.doesNotThrow(() => watchGlobalErrors({} as never)(), 'a platform without listeners broke the app');
    clearErrors();
  });
});

describe('every route has its own boundary, named for its screen', () => {
  /** The screen name each route file's `ErrorBoundary` export is made for, read from its exports, not its text. */
  function boundaryNames(): Map<string, string | null> {
    const out = new Map<string, string | null>();
    for (const f of fs.readdirSync(path.join(APP, 'app')).filter(n => n.endsWith('.tsx'))) {
      const sf = ts.createSourceFile(f, fs.readFileSync(path.join(APP, 'app', f), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      let name: string | null = null;
      for (const st of sf.statements) {
        if (!ts.isVariableStatement(st) || !st.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
        for (const d of st.declarationList.declarations) {
          const init = d.initializer;
          if (ts.isIdentifier(d.name) && d.name.text === 'ErrorBoundary' && init && ts.isCallExpression(init) &&
              ts.isIdentifier(init.expression) && init.expression.text === 'errorBoundaryFor' &&
              init.arguments.length === 1 && ts.isStringLiteral(init.arguments[0])) name = init.arguments[0].text;
        }
      }
      out.set(f, name);
    }
    return out;
  }

  test('each route exports ErrorBoundary = errorBoundaryFor(its screen), and no two share a name', () => {
    const names = boundaryNames();
    assert.ok(names.size >= 8, `only ${names.size} route files found`);
    assert.deepEqual([...names].filter(([, n]) => !n).map(([f]) => f), [], 'routes without their own boundary');
    const all = [...names.values()];
    assert.equal(new Set(all).size, all.length, `two routes record under one name: ${all.join(', ')}`);
    assert.equal(names.get('_layout.tsx'), 'app');
    assert.equal(names.get('index.tsx'), 'now');
  });
});

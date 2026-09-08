import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const BUNDLE = path.join(APP, 'dist', 'proof-domain.js');

/*
 * R506. A function in the shipped bundle threw the moment it was called.
 *
 * `session.ts` imports `sessionPlanDay` from `split.ts`, and `split.ts` was not
 * in the bundler's MODULES list. Each module's imports are destructured out of
 * the shared registry when its IIFE runs -- `const { sessionPlanDay } = M;` --
 * so the name came out `undefined`, silently, and `Domain.sessionTitle` failed
 * with `sessionPlanDay is not a function` for anyone who called it.
 *
 * Nothing caught it, and the reason is worth keeping. The build DOES verify
 * itself after writing: it loads the bundle in a bare scope and checks that
 * every export is present. But it checks a hand-written list of 28 names, and
 * it asks only about EXPORTS. An import that resolves to nothing is invisible
 * to that question -- the module loads fine, the export is published fine, and
 * the hole only appears when the function is called.
 *
 * Found by loading the built artifact and CALLING things in it, rather than by
 * reading source or trusting "verified 28 exports load". The suite was green
 * throughout: `session.ts` is tested directly, where the real `split.ts` import
 * resolves normally. Only the bundle was broken, and only the bundle is what
 * the harness runs.
 *
 * These tests exercise the built file itself for that reason.
 */
describe('every name the built bundle imports actually resolves (R506)', () => {
  const source = fs.readFileSync(BUNDLE, 'utf8');
  const registry = (() => {
    const sandbox: Record<string, Record<string, unknown>> = {};
    new Function('globalThis', source).call(sandbox, sandbox);
    return sandbox.Domain;
  })();

  test('the bundle loads and publishes a registry', () => {
    // Guard on the instrument: if this is empty every check below is vacuous.
    assert.ok(registry, 'the bundle published no Domain namespace');
    assert.ok(Object.keys(registry).length > 50,
      `only ${Object.keys(registry).length} names in the registry`);
  });

  test('no module destructures a name the registry never provides', () => {
    /*
     * Derived from the built file rather than from a list: every module's
     * prologue is `const { a, b } = M;`, so the union of those names is
     * exactly what the bundle assumes it can rely on.
     */
    const imported = [...source.matchAll(/const \{ ([^}]*) \} = M;/g)]
      .flatMap(m => m[1].split(',').map(s => s.trim()))
      .filter(Boolean);
    assert.ok(imported.length > 10,
      `only found ${imported.length} imported names — the prologue shape changed ` +
      'and this test is no longer reading it');

    const unresolved = [...new Set(imported)].filter(n => registry[n] === undefined);
    assert.deepEqual(unresolved, [],
      'the bundle destructures names nothing publishes; every call through them ' +
      'throws at runtime while the build reports success');
  });

  test('sessionTitle works in the bundle, on every plan', () => {
    /*
     * The instance, pinned where it broke. It is exercised through the BUILT
     * artifact deliberately — the same call against src/ has always worked,
     * which is precisely why this went unnoticed.
     */
    const sets = [
      { id: 'a', sessionId: 's1', exerciseId: 'bench', weight: 100, reps: 5, at: Date.now() },
      { id: 'b', sessionId: 's1', exerciseId: 'row', weight: 60, reps: 5, at: Date.now() }
    ];
    const title = registry.sessionTitle as (s: unknown[], lang: string, plan: string) => string;
    for (const plan of ['ppl', 'upper-lower', 'full']) {
      const out = title(sets, 'en', plan);
      assert.ok(out && out.length > 0, `sessionTitle returned nothing for ${plan}`);
    }
    assert.equal(title(sets, 'en', 'upper-lower'), 'UPPER DAY',
      'bench + row is an upper day, and the bundle should say so');
  });

  test('the build refuses to produce a bundle with an unresolved import', () => {
    /*
     * Source-level, and deliberately so: the tests above prove the CURRENT
     * bundle is sound, and this pins that a future one cannot regress quietly.
     * Both failure shapes are one check — a module missing from MODULES, and a
     * module present but listed after the one that imports from it.
     */
    const build = fs.readFileSync(path.join(APP, 'build-domain.cjs'), 'utf8');
    assert.match(build, /which no earlier bundled module exports/,
      'nothing stops a module importing a name the bundle never publishes');
    assert.match(build, /const MODULES = \[[^\]]*'split\.ts',\s*'session\.ts'/,
      'split.ts must be bundled, and before session.ts, which imports from it');
  });
});

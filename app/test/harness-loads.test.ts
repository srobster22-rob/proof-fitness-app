import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const page = readFileSync(path.join(ROOT, 'harness', 'index.html'), 'utf8');

/** Every `<script src="...">` the harness page pulls in, in order. */
const SCRIPTS = [...page.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);

/*
 * The kill-test rig has to actually load.
 *
 * §12 says `harness/` is what real testers walk and that a divergence there
 * "would make the kill test silently measure the wrong artifact". It loads four
 * files this repo owns — the renderer, the wire format, the landing copy and
 * the built domain bundle — as plain `<script>` tags in one shared scope, with
 * no bundler and no module system to complain if one of them is missing or
 * throws on the way in.
 *
 * §12 also says those files "run identically in the browser and in Node", which
 * is what makes this checkable without a browser: load them the same way the
 * page does and see whether the globals it then calls exist.
 */
describe('the kill-test harness can still load what it depends on', () => {
  test('every script it asks for is on disk', () => {
    assert.ok(SCRIPTS.length >= 4, `only found ${SCRIPTS.length} scripts — did the page change shape?`);
    for (const src of SCRIPTS) {
      const abs = path.join(ROOT, 'harness', src);
      assert.ok(existsSync(abs), `harness/index.html loads ${src}, which does not exist`);
    }
  });

  test('the four this repo owns evaluate in one shared scope', () => {
    /*
     * Evaluated together, in page order, into one object — because that is how
     * a browser runs them, and a file that only works in isolation would pass a
     * per-file check and still break the page.
     */
    const OURS = SCRIPTS.filter(s => /recap\.js|share-url\.js|copy\.js|proof-domain\.js/.test(s));
    assert.equal(OURS.length, 4, `expected the four owned scripts, got ${OURS.join(', ')}`);
    const scope: Record<string, unknown> = {};
    for (const src of OURS) {
      const code = readFileSync(path.join(ROOT, 'harness', src), 'utf8');
      assert.doesNotThrow(() => new Function('globalThis', code).call(scope, scope),
        `${src} throws while loading, so the harness page never finishes`);
    }
    for (const g of ['RecapRender', 'ShareURL', 'Copy', 'Domain']) {
      assert.ok(scope[g], `${g} is missing after loading — the harness calls it`);
    }
  });

  test('and it provides everything the harness actually calls off them', () => {
    const used = new Set(
      [...page.matchAll(/Domain\.([A-Za-z0-9_]+)/g)].map(m => m[1])
    );
    for (const f of ['clip.js', 'encode.js']) {
      const src = readFileSync(path.join(ROOT, 'harness', f), 'utf8');
      for (const m of src.matchAll(/Domain\.([A-Za-z0-9_]+)/g)) used.add(m[1]);
    }
    assert.ok(used.size > 0, 'the harness calls nothing from the domain — has it been rewritten?');

    /*
     * R507. This used to grep build-domain.cjs for the name in its
     * hand-written EXPORTS array. That array is gone, and the guarantee it
     * stood for is now stronger: the build READS the harness, derives this
     * same set from it, and refuses to write a bundle that does not publish
     * every one of them. Matching a quoted name in a source file was always a
     * proxy; this asks the artifact.
     */
    const bundle = readFileSync(path.join(HERE, '..', 'dist', 'proof-domain.js'), 'utf8');
    const scope: Record<string, Record<string, unknown>> = {};
    new Function('globalThis', bundle).call(scope, scope);
    for (const name of used) {
      assert.notEqual(scope.Domain?.[name], undefined,
        `the harness calls Domain.${name}, which the built bundle does not publish`);
    }
  });

  test('the bundle it loads is the one the tests exercise', () => {
    // R229: `npm test` rebuilds before the parity tests, so parity can never
    // catch a STALE bundle — and the harness is the consumer that would run
    // one. `--check` is the answer; this pins that the harness really does
    // load the file that check is about.
    assert.ok(SCRIPTS.some(s => s.includes('proof-domain.js')),
      'the harness no longer loads the built domain bundle');
    assert.match(readFileSync(path.join(HERE, '..', 'build-domain.cjs'), 'utf8'),
      /--check/, 'the staleness check the harness depends on is gone');
  });
});

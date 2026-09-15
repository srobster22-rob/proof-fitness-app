import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/*
 * R672. expo-router's typed-routes watcher decides whether a changed file is
 * inside the app root with `startsWith('../')`, and on Windows `path.relative`
 * returns backslashes. So every test file created while the dev server ran was
 * written into .expo/types/router.d.ts as an app route -- and committed: R671's
 * commit carried "/../test/coach-names-weights-a-button-dials-in.test" in four
 * places, which the typed `href` then accepted as a real screen.
 *
 * The watcher is fed by Metro's file map, which drops events for anything the
 * resolver's blockList matches. So the fix lives in metro.config.js, and this
 * checks the pattern the dev server will actually be handed.
 */
describe('the dev server never sees test files (R672)', () => {
  const config = require(path.join(ROOT, 'metro.config.js')) as { resolver: { blockList: RegExp | RegExp[] } };
  const patterns = ([] as RegExp[]).concat(config.resolver.blockList);
  const blocked = (p: string) => patterns.some(re => re.test(p));
  const posix = (p: string) => p.split(path.sep).join('/');

  test('a file under test/ is blocked, whichever way the path is written', () => {
    const file = path.join(ROOT, 'test', 'some-new.test.ts');
    assert.ok(blocked(file), `${file} reaches the dev server's watcher`);
    assert.ok(blocked(posix(file)), `${posix(file)} reaches the dev server's watcher`);
  });

  test('nothing the app is built from is blocked', () => {
    for (const file of [
      path.join(ROOT, 'app', 'index.tsx'),
      path.join(ROOT, 'src', 'ui', 'now-model.ts'),
      path.join(ROOT, 'tools', 'seed-web.ts'),
      path.join(ROOT, 'node_modules', 'some-lib', 'test', 'index.js'),
      path.join(ROOT, 'src', 'testing.ts')
    ]) {
      assert.ok(!blocked(file), `${path.relative(ROOT, file)} would be hidden from the bundler`);
    }
  });

  test("expo's own blocks are kept, not replaced", () => {
    assert.ok(blocked(path.join(ROOT, '.expo', 'types', 'router.d.ts')),
      'the config replaced expo\'s default blockList instead of extending it');
  });

  test('the generated route types name only screens, never a path outside app/', () => {
    const types = readFileSync(path.join(ROOT, '.expo', 'types', 'router.d.ts'), 'utf8');
    const outside = [...new Set(types.match(/\/\.\.\/[^`'";\s$]*/g) ?? [])];
    assert.deepEqual(outside, [], `router.d.ts lists routes outside app/: ${outside.join(', ')}`);
  });
});

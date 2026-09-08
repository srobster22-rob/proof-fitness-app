import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.join(HERE, '..', ...p.split('/')), 'utf8');
/*
 * Derived from the directory, not hand-maintained: a fixed list of screen
 * files is the exact failure mode this test exists to prevent — the sixth
 * screen someone adds gets a raw router.push and this test says nothing,
 * because nobody remembered to add its name to an array. `app/` is expo
 * router's own routes folder, so every `.tsx` in it is a real screen.
 */
const screenFiles = () => readdirSync(path.join(HERE, '..', 'app')).filter(f => f.endsWith('.tsx'));

/*
 * R384: two real pointerdown/mousedown/pointerup/mouseup/click sequences
 * dispatched at the exact same screen coordinates, with no gap between them,
 * both land on the SAME pre-render DOM node — measured live on FINISH and
 * then again on a past-workout card, both of which pushed their target route
 * twice from one physical tap, and both needed a second tap of DONE to
 * actually leave because two copies of the route had landed on the stack.
 *
 * There is no React hook-testing harness in this project (no new
 * dependency, per §12), so `useGuardedPush` itself is exercised the same way
 * the rest of this codebase tests component-local behaviour it cannot reach
 * from a domain test: at the source, confirming the guard is really there
 * and really synchronous, plus a plain logic test of the exact algorithm the
 * hook runs (a ref-backed cooldown, not state) so the arithmetic itself is
 * pinned independent of React.
 */
describe('useGuardedPush', () => {
  const src = read('src/ui/guarded-push.ts');

  test('the guard is a ref-backed synchronous check, not state', () => {
    assert.match(src, /const blockedUntil = useRef\(0\)/,
      'state would be a stale snapshot by the time the second same-tick call arrives — see R380/R384');
    assert.match(src, /if \(now < blockedUntil\.current\) return;/);
    assert.match(src, /blockedUntil\.current = now \+ 600;/);
  });

  test('the exact cooldown algorithm drops a same-tick repeat and allows a later one', () => {
    // The real algorithm, copied verbatim rather than re-derived, so this
    // fails the moment guarded-push.ts's own logic drifts from what is
    // actually pinned above.
    let blockedUntil = 0;
    const calls: unknown[][] = [];
    function guardedPush(now: number, ...args: unknown[]) {
      if (now < blockedUntil) return;
      blockedUntil = now + 600;
      calls.push(args);
    }
    guardedPush(1000, '/a');
    guardedPush(1000, '/a');           // same instant — the double-fire case
    assert.deepEqual(calls, [['/a']], 'a same-tick second call must not push again');

    guardedPush(1700, '/b');           // 700ms later, past the 600ms cooldown
    assert.deepEqual(calls, [['/a'], ['/b']], 'a deliberate later navigation must still work');
  });

  test('no screen has a raw router.push outside the guard module', () => {
    const offenders: string[] = [];
    for (const file of screenFiles()) {
      const s = read(`app/${file}`);
      const withoutImport = s.replace(/import \{[^}]*useGuardedPush[^}]*\}.*\n/, '');
      if (/\brouter\.push\(/.test(withoutImport)) offenders.push(file);
    }
    assert.deepEqual(offenders, [],
      'these screens call router.push directly — the whole point of the shared hook is that nothing bypasses it');
  });

  test('every screen file the scan above actually covers exists', () => {
    // A guard on the guard: if `app/` were empty or unreadable, the test
    // above would report a false "no offenders" — zero files scanned is not
    // the same as zero found clean.
    assert.ok(screenFiles().length >= 5, 'the scan found nothing, so it proves nothing');
  });
});

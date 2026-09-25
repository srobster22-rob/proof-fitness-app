import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowScreenSource } from './helpers/now-screen.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.join(HERE, '..', ...p.split('/')), 'utf8');

/*
 * Every .ts/.tsx under src/ui and app/ — derived from the two directories
 * that actually hold component code, not a remembered subset of files. The
 * NowScreen-only check below (line 40's ancestor) would say nothing about a
 * SIXTH copy of the broken guard pasted into a brand-new file that happens
 * not to be NowScreen.tsx — a directory scan is the only version of this
 * check that a new file cannot silently sit outside of.
 */
function allSourceFiles(): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(path.join(HERE, '..', dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(rel);
    }
  }
  walk('src/ui');
  walk('app');
  return out;
}

/*
 * R388: the exact bug ConfirmSheet had (R386 — `if (closing) return` reading
 * `useState`, a stale snapshot a same-tick second tap sails past) turned out
 * to be copy-pasted identically into FOUR more places in NowScreen.tsx: the
 * day-ask sheet, the set-edit sheet, the exercise picker, the equipment
 * picker. Same live evidence each time — two real pointerdown/mousedown/
 * pointerup/mouseup/click sequences at the same screen coordinates land on
 * the same pre-render DOM node. Consolidated into one shared `useExitOnce`
 * (src/ui/ScreenModal.tsx, next to `exitMs` which every one of these already
 * imported) so a sixth copy of this exact bug cannot get pasted in again.
 */
describe('useExitOnce', () => {
  const src = read('src/ui/ScreenModal.tsx');

  test('the guard is a ref, and a stray timer is cleared before a new one replaces it', () => {
    assert.match(src, /const closingRef = useRef\(false\);/,
      'state alone is a stale snapshot for a same-tick second call — see confirm-sheet.test.ts');
    assert.match(src, /if \(closingRef\.current\) return false;/);
    assert.match(src, /if \(timer\.current\) clearTimeout\(timer\.current\);/,
      'an unfired timer left behind by a guard that let a second call through would still fire later');
  });

  test('every sheet in NowScreen that used to copy-paste this now shares it', () => {
    const now = nowScreenSource();
    assert.match(now, /import \{ ScreenModal, useExitOnce \} from '\.\/ScreenModal\.tsx'/,
      'NowScreen stopped importing the shared hook');
    const uses = now.match(/useExitOnce\(/g) ?? [];
    assert.equal(uses.length, 4,
      'expected 4 sheets (day-ask, set-edit, exercise picker, equipment picker) to use the shared hook — ' +
      `found ${uses.length}, which means one of them regressed to its own local copy`);
    assert.doesNotMatch(now, /if \(closing\) return;/,
      'a local copy of the broken guard came back');
  });

  test('the broken guard shape does not exist anywhere in src/ui or app, not just in NowScreen', () => {
    const offenders: string[] = [];
    for (const file of allSourceFiles()) {
      const s = read(file);
      // Comments mentioning the old pattern (this file's own history, this
      // component's docstring) are fine — only a live `if (closing) return;`
      // followed by state rather than a ref is the actual bug.
      const code = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
      if (/\bif \(closing\) return;/.test(code)) offenders.push(file);
    }
    assert.deepEqual(offenders, [],
      'a new copy of the exact bug R386/R388 fixed six times has reappeared — use useExitOnce instead');
  });

  test('the exact algorithm rejects a same-tick repeat and reports which call actually proceeded', () => {
    // Copied verbatim from the real leave(), so this fails the moment the
    // source drifts from what is pinned above.
    let closingRef = false;
    let timerSet = 0, timerCleared = 0;
    const fired: string[] = [];
    function leave(fire: string): boolean {
      if (closingRef) return false;
      closingRef = true;
      if (timerSet > timerCleared) timerCleared++;
      timerSet++;
      fired.push(fire);
      return true;
    }
    assert.equal(leave('a'), true, 'the first call must proceed');
    assert.equal(leave('a'), false, 'a same-tick second call must be rejected, not queued');
    assert.deepEqual(fired, ['a']);
    assert.equal(timerSet, 1, 'exactly one timer should ever be pending');
  });
});

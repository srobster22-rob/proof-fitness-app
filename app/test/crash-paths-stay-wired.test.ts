import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');

/*
 * R576. The app has TWO crash-recovery paths and neither had anything pinning
 * it in place: a route-level React error (caught by expo-router's own
 * ErrorBoundary, re-exported from `app/_layout.tsx`) and a storage-open
 * failure before any route renders (caught by `RepoGate`, which cannot rely
 * on the router boundary because it fires before the Stack exists).
 *
 * Both are correctly wired today, confirmed by reading expo-router's own
 * `.d.ts` (a real `Component` with `getDerivedStateFromError`, applied
 * automatically to every route via the `Try` wrapper) and by `RepoGate`'s
 * existing dedicated test file. What this file guards is that neither
 * silently stops being wired — a re-export deleted by an unrelated edit to
 * `_layout.tsx`, or `RepoGate` stopping rendering `StorageError` on failure,
 * would otherwise ship a genuine crash-to-blank-screen with nothing catching
 * it in any test run.
 *
 * Full behavioural confirmation -- does either one actually SHOW on a real
 * crash -- needs a production build: HANDOFF trap 18. A dev server routes an
 * uncaught render error to Metro's overlay instead, the same shape as trap 17.
 */
describe('both crash-recovery paths stay wired (R576)', () => {
  test('the root layout still has an error boundary', () => {
    // Its own since R699 (errorBoundaryFor, which also records the error as
    // "app"); every route has one too: errors-surface-with-the-screen.test.ts.
    const src = fs.readFileSync(path.join(APP, 'app', '_layout.tsx'), 'utf8');
    assert.match(src, /export const ErrorBoundary = errorBoundaryFor\('app'\);/,
      'app/_layout.tsx no longer exports an error boundary -- a layout ' +
      'that throws during render now shows a blank screen instead of a fallback');
  });

  test('RepoGate still renders StorageError on a failed open, not the children', () => {
    const src = fs.readFileSync(path.join(APP, 'src', 'ui', 'RepoGate.tsx'), 'utf8');
    assert.match(src, /return <StorageError/,
      'RepoGate no longer falls back to StorageError -- a database open failure, ' +
      'which happens before any route renders and so the router\'s own boundary ' +
      'never sees it, now has nothing catching it');
  });

  test('the two paths are documented as covering different failures, not the same one', () => {
    // If RepoGate's comment explaining WHY it needs its own handler (rather
    // than relying on the router boundary) disappears, the next edit has no
    // way to know the two are not redundant with each other.
    const src = fs.readFileSync(path.join(APP, 'src', 'ui', 'RepoGate.tsx'), 'utf8');
    assert.match(src, /openDatabaseSync.*or a migration throwing during render/s,
      'RepoGate lost the note explaining why it exists alongside the router boundary');
  });
});

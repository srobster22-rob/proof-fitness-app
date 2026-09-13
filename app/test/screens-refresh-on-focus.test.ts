import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const SCREENS = path.join(APP, 'app');

/*
 * R485. A screen that pushes another screen over itself stays MOUNTED, so
 * everything it read on the way in is frozen until something re-renders it.
 *
 * `NowScreen` has had a `useFocusEffect` for rounds, with a comment saying it
 * exists to "pick up a unit chosen in Settings". Progress — the only OTHER
 * route that can push Settings — never got one. Walked live: change the
 * language in Settings, tap DONE, and the whole Progress screen is still
 * English, and ERASE EVERYTHING then draws its Spanish template around an
 * English inventory:
 *
 *   "Se eliminaran 36 workouts, 288 sets, 1 goal and 1 setting"
 *
 * which is R480's half-translated destructive dialog arriving again by a
 * different mechanism — staleness rather than hardcoding. Progress → /measure →
 * back is the same gap: a bodyweight recorded there changes the erase
 * inventory and what a bodyweight lift can honestly report.
 *
 * The population is DERIVED (HANDOFF trap 13): whichever screens push another
 * route are the screens that can go stale, so a new one enters the checked set
 * by being written the same way rather than by somebody remembering this rule.
 */
describe('a screen that opens another one re-reads when it comes back', () => {
  function screens(): Array<[string, string]> {
    return readdirSync(SCREENS)
      .filter(f => f.endsWith('.tsx'))
      .map(f => [f, readFileSync(path.join(SCREENS, f), 'utf8')] as [string, string]);
  }

  test('every screen that pushes a route also refreshes on focus', () => {
    let pushers = 0;
    const offenders: string[] = [];
    for (const [name, src] of screens()) {
      // `push('/x')` is the navigation that leaves this screen mounted;
      // `leave()`/`replace` do not.
      if (!/push\(\s*['{]/.test(src)) continue;
      pushers++;
      /*
       * The effect may live in the COMPONENT the route renders rather than in
       * the route file: `index.tsx` pushes /goals, /progress and /settings and
       * has no effect of its own, because it renders `NowScreen`, which has
       * carried one for rounds. Checking only the route file reported it as an
       * offender — a false positive, and the kind that teaches people to skim.
       */
      const imported = [...src.matchAll(/from '\.\.\/src\/ui\/([\w-]+)\.tsx'/g)]
        .map(m => path.join(APP, 'src', 'ui', m[1] + '.tsx'))
        .map(p => readFileSync(p, 'utf8'));
      /*
       * A CALL, not a mention. This was `includes('useFocusEffect')`, which the
       * `import { useRouter, useFocusEffect } from 'expo-router'` line satisfies
       * on its own — so deleting the effect and leaving the import behind kept
       * the sweep green. Found by reverting the fix to check this test could
       * fail, which is the only reason it was ever noticed.
       */
      const calls = (s: string) => /useFocusEffect\s*\(/.test(s);
      const covered = [src, ...imported].some(calls);
      if (!covered) offenders.push(name);
    }
    assert.ok(pushers >= 1, `no pushing screens found — the scan went stale`);
    assert.deepEqual(offenders, [],
      'these screens push another route over themselves and never re-read when ' +
      'it closes, so anything changed there — the language, a preference, a ' +
      'bodyweight — leaves them showing what they read on the way in');
  });

  test('and Progress is one of them, since it opens Measure and past recaps over itself', () => {
    // Named explicitly as well as swept, because this is the instance that was
    // actually broken and a sweep with a subtly wrong predicate would pass.
    // R649: Settings no longer opens over Progress (goTab replaces, so Progress
    // remounts fresh), but Measure and a past session's recap still do.
    const src = readFileSync(path.join(SCREENS, 'progress.tsx'), 'utf8');
    assert.match(src, /push\('\/measure'\)/,
      'Progress no longer opens Measure over itself -- re-check whether this rule still applies');
    assert.match(src, /useFocusEffect\(useCallback\(\(\) => \{ setTick/,
      'Progress stopped refreshing on focus');
  });

  test('the erase inventory recomputes when the screen does', () => {
    // The focus effect alone was not enough: `counts` is memoised inside
    // `Backup`, and its deps were `[repo, note]` — `repo` is a stable singleton
    // and `note` only moves on export or restore, so the sentence the user
    // reads before destroying everything stayed frozen through a re-render.
    const src = readFileSync(path.join(SCREENS, 'progress.tsx'), 'utf8');
    const deps = region(src, 'const counts = useMemo', ');');
    assert.match(deps, /\[repo, note, revision\]/,
      'the erase inventory no longer depends on the screen revision');
    assert.match(src, /revision=\{tick\}/, 'Backup is not being handed the revision');
  });

  test('and the dead onChanged prop is gone, not merely unused', () => {
    // Declared, typed, documented and passed by both call sites while never
    // being invoked — its caller was the settings SHEET that R232 deleted. A
    // React prop is not an export, so orphan-scan could never have seen it.
    const src = readFileSync(path.join(SCREENS, 'progress.tsx'), 'utf8');
    // Matched as an identifier, not as a word: the first version banned the
    // string outright and failed on the comment above `revision` that explains
    // what onChanged was and why it went. A test that cannot survive its own
    // rationale being written down is the wrong test.
    assert.doesNotMatch(src, /onChanged\s*[:=(]/,
      'onChanged is back as a prop — if something needs it, it must be called');
  });
});

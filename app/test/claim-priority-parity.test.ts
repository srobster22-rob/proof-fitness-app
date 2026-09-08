import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { recapFor, headline, type Recap } from '../src/ui/recap-model.ts';
import type { LoggedSet } from '../src/domain/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const read = (p: string) => readFileSync(path.join(HERE, '..', ...p.split('/')), 'utf8');
const readRoot = (p: string) => readFileSync(path.join(ROOT, ...p.split('/')), 'utf8');
const DAY = 86_400_000, MIN = 60_000;
const T0 = Date.UTC(2026, 6, 29, 18);

let uid = 0;
const mk = (sid: string, ex: string, w: number, r: number, at: number): LoggedSet =>
  ({ id: `x${uid++}`, sessionId: sid, exerciseId: ex, weight: w, reps: r, at });

/*
 * R466, the peer's completing question: which remaining class fits the
 * derived-completeness template (HANDOFF.md #13) and has not had one built.
 * R463 fixed `headline` and flagged, in both orphan-scan.cjs and HANDOFF.md,
 * that nothing verifies it agrees with `recap.tsx` and `spike/recap.js` — the
 * two real reimplementations of the same claim-priority rule. This is that
 * gate.
 *
 * Scoped narrowly on purpose, matching one real distinction found while
 * building it: the SLAB choice (pr / firstSession / bestYet / neither) is
 * genuinely a single-winner priority across all three surfaces, but the GOAL
 * line is not — `recap.tsx` renders it in its own row ADDITIONALLY whenever
 * present ("they never both render — a goal wins" is about goal-vs-trend,
 * not goal-vs-slab; see the comment above `goalRow` in recap.tsx), while
 * `headline` and `recap.js` use it only as a FALLBACK when nothing else
 * claimed the slot. That is a deliberate, already-documented product
 * difference (§5: "goals exist to feed the output... on every session, not
 * just the ones where nothing else happened"), not a bug — so this gate
 * checks the slab, and does not force the goal case into a comparison that
 * would fail by design.
 *
 * Each surface's condition is quoted as a literal string assertion against
 * its own source first, so a rewritten guard fails this test loudly instead
 * of silently invalidating the mirrored logic below it — the same
 * "verified, not assumed" discipline R465 applied to this session's own
 * exemption reasons.
 */
describe('the claim slab picks the same case on every surface that draws one', () => {
  const tsxSrc = read('app/recap.tsx');
  const jsSrc = readRoot('spike/recap.js');

  test('the guards this test mirrors are still the guards the source has', () => {
    assert.match(tsxSrc, /\{payload\.pr && \(/);
    assert.match(tsxSrc, /\{payload\.firstSession && !payload\.pr && payload\.best && \(/);
    assert.match(tsxSrc, /\{payload\.bestYet && !payload\.firstSession && payload\.best && \(/);
    assert.match(jsSrc, /if \(pp > 0 && !D\.pr && D\.firstSession && D\.best\)/);
    assert.match(jsSrc, /\} else if \(pp > 0 && !D\.pr && D\.bestYet && D\.best\)/);
    assert.match(jsSrc, /\} else if \(pp > 0 && D\.pr\)/);
  });

  /** recap.tsx's own three guards, evaluated against a real payload. */
  function tsxSlab(payload: Recap['payload']): 'pr' | 'firstSession' | 'bestYet' | 'none' {
    if (payload.pr) return 'pr';
    if (payload.firstSession && !payload.pr && payload.best) return 'firstSession';
    if (payload.bestYet && !payload.firstSession && payload.best) return 'bestYet';
    return 'none';
  }

  /** spike/recap.js's own if/else-if chain, same order, same guards. */
  function jsSlab(payload: Recap['payload']): 'pr' | 'firstSession' | 'bestYet' | 'none' {
    if (!payload.pr && payload.firstSession && payload.best) return 'firstSession';
    if (!payload.pr && payload.bestYet && payload.best) return 'bestYet';
    if (payload.pr) return 'pr';
    return 'none';
  }

  /** headline()'s own order, restated for comparison rather than re-derived. */
  function headlineSlab(recap: Recap): 'pr' | 'firstSession' | 'bestYet' | 'none' {
    if (recap.prs.length) return 'pr';
    if (recap.payload.firstSession && recap.payload.best) return 'firstSession';
    if (recap.payload.bestYet && recap.payload.best) return 'bestYet';
    return 'none';
  }

  function agree(recap: Recap, expected: 'pr' | 'firstSession' | 'bestYet' | 'none') {
    assert.equal(tsxSlab(recap.payload), expected, 'recap.tsx would pick a different slab');
    assert.equal(jsSlab(recap.payload), expected, 'spike/recap.js would pick a different slab');
    assert.equal(headlineSlab(recap), expected, 'headline() would pick a different slab');
    // And headline's real output actually reflects that category.
    const h = headline(recap);
    if (expected === 'pr') assert.doesNotMatch(h, /session one|best yet/i);
    if (expected === 'firstSession') assert.match(h, /session one/i);
    if (expected === 'bestYet') assert.match(h, /best yet/i);
  }

  test('a PR wins the slab everywhere', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    for (let w = 4; w >= 1; w--) {
      repo.startSession(`h${w}`, 'lb');
      repo.logSet(mk(`h${w}`, 'squat', 215, 5, T0 - w * 7 * DAY));
      repo.endSession(`h${w}`, T0 - w * 7 * DAY + 40 * MIN);
    }
    repo.startSession('now', 'lb');
    repo.logSet(mk('now', 'squat', 225, 5, T0));
    repo.endSession('now', T0 + 2 * MIN);
    agree(recapFor(repo, 'now', T0)!, 'pr');
  });

  test('a first-ever session wins the slab everywhere', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    repo.startSession('now', 'lb');
    repo.logSet(mk('now', 'bench', 95, 8, T0));
    repo.endSession('now', T0 + 2 * MIN);
    agree(recapFor(repo, 'now', T0)!, 'firstSession');
  });

  test('an early best wins the slab everywhere', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    repo.startSession('h1', 'lb');
    repo.logSet(mk('h1', 'bench', 90, 8, T0 - 7 * DAY));
    repo.endSession('h1', T0 - 7 * DAY + 40 * MIN);
    repo.startSession('now', 'lb');
    repo.logSet(mk('now', 'bench', 135, 8, T0));
    repo.endSession('now', T0 + 2 * MIN);
    agree(recapFor(repo, 'now', T0)!, 'bestYet');
  });

  test('an ordinary session past the early window picks no slab anywhere', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    for (let w = 12; w >= 1; w--) {
      repo.startSession(`h${w}`, 'lb');
      repo.logSet(mk(`h${w}`, 'squat', 215, 5, T0 - w * 7 * DAY));
      repo.endSession(`h${w}`, T0 - w * 7 * DAY + 40 * MIN);
    }
    repo.startSession('now', 'lb');
    repo.logSet(mk('now', 'squat', 215, 5, T0));
    repo.endSession('now', T0 + 2 * MIN);
    const recap = recapFor(repo, 'now', T0)!;
    assert.equal(recap.prs.length, 0, 'fixture sanity: matching, not beating, is not a PR');
    agree(recap, 'none');
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findPRs } from '../src/domain/pr.ts';
import type { LoggedSet, Exercise } from '../src/domain/types.ts';

/**
 * PROMPT.md §16, test 5 — the cry-wolf test.
 *
 *   "Log four plausible weeks of training. Count the PRs awarded. If it is most
 *    sessions, §8 is not implemented correctly."
 *
 * The subtlety the spec does not state, and should: for a NOVICE on linear
 * progression, PRing almost every session is correct — they really are getting
 * stronger every session. The failure mode is an INTERMEDIATE, who trains hard
 * for a month and genuinely PRs a handful of times. Both are asserted below.
 *
 * SECOND finding, from running it: four weeks is TOO SHORT to test this at all.
 * On a weekly split each exercise is trained four times, and the cold-start
 * guard (no PRs in an exercise's first three sessions, §8) makes only the fourth
 * eligible. Novice and intermediate produced byte-identical results — the guard
 * dominated, and the rule under test never ran. Twelve weeks is the minimum that
 * exercises it. §16 has been corrected.
 */
const WEEKS = 12;

const PLAN: Record<string, string[]> = {
  push: ['bench', 'ohp', 'dip'],
  pull: ['row', 'curl', 'pulldown'],
  legs: ['squat', 'rdl', 'legpress']
};
const NAMES: Record<string, string> = {
  bench: 'Bench Press', ohp: 'OHP', dip: 'Dip', row: 'Barbell Row',
  curl: 'Curl', pulldown: 'Pulldown', squat: 'Squat', rdl: 'RDL', legpress: 'Leg Press'
};
const exercises = new Map<string, Exercise>(
  Object.entries(NAMES).map(([id, name]) => [id, { id, name }])
);
const START: Record<string, number> = {
  bench: 185, ohp: 115, dip: 45, row: 155, curl: 65,
  pulldown: 130, squat: 245, rdl: 205, legpress: 360
};

interface SimResult { sessions: number; sessionsWithPR: number; totalPRs: number; claims: string[]; }

/**
 * @param sessionsPerIncrease how many sessions of an exercise before its top
 *        set goes up. 1 = novice linear progression, 4 = intermediate.
 */
function simulate(weeks: number, sessionsPerIncrease: number): SimResult {
  let uid = 0;
  const history: LoggedSet[] = [];
  const trained: Record<string, number> = {};
  const load = { ...START };
  const days = Object.keys(PLAN);

  let sessions = 0, sessionsWithPR = 0, totalPRs = 0;
  const claims: string[] = [];

  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < days.length; d++) {
      const sessionId = `w${w}d${d}`;
      const sessionSets: LoggedSet[] = [];
      const at = Date.now() + (w * 7 + d * 2) * 86400_000;

      for (const ex of PLAN[days[d]]) {
        trained[ex] = (trained[ex] ?? 0) + 1;
        if (trained[ex] > 1 && trained[ex] % sessionsPerIncrease === 0) load[ex] += 5;
        const top = load[ex];

        // Warm-ups, then working sets, then a lighter high-rep back-off.
        // Warm-ups are the classic false-positive source: they are new
        // weight/rep combinations constantly.
        const push = (weight: number, reps: number) => sessionSets.push(
          { id: `x${uid++}`, sessionId, exerciseId: ex, weight, reps, at }
        );
        push(Math.round(top * 0.5), 8);
        push(Math.round(top * 0.75), 5);
        push(top, 5);
        push(top, 5);
        push(Math.round(top * 0.65), 12);
      }

      const prs = findPRs(sessionSets, history, exercises);
      sessions++;
      if (prs.length) { sessionsWithPR++; totalPRs += prs.length; }
      for (const p of prs) claims.push(p.claim);
      history.push(...sessionSets);
    }
  }
  return { sessions, sessionsWithPR, totalPRs, claims };
}

describe('cry-wolf (§16.5)', () => {
  test('an intermediate does NOT PR in most sessions', () => {
    const r = simulate(WEEKS, 4);
    const rate = r.sessionsWithPR / r.sessions;
    console.log(`      intermediate: ${r.sessionsWithPR}/${r.sessions} sessions had a PR ` +
                `(${(rate * 100).toFixed(0)}%), ${r.totalPRs} PRs total`);
    assert.ok(r.sessions >= 30, 'twelve weeks should be three dozen sessions');
    assert.ok(rate < 0.5, `PR'd in ${(rate * 100).toFixed(0)}% of sessions — that is crying wolf`);
    assert.ok(r.totalPRs > 0, 'a month of real progression should produce some PRs');
  });

  test('a novice on linear progression DOES PR often — that is correct, not a bug', () => {
    const r = simulate(WEEKS, 1);
    const rate = r.sessionsWithPR / r.sessions;
    console.log(`      novice:       ${r.sessionsWithPR}/${r.sessions} sessions had a PR ` +
                `(${(rate * 100).toFixed(0)}%), ${r.totalPRs} PRs total`);
    assert.ok(rate > 0.6, 'adding weight every session really is a PR every session');
  });

  test('warm-up and back-off sets never produce the PR', () => {
    const r = simulate(WEEKS, 4);
    // Every claim must name a rep count from a working set (5), never the
    // warm-up 8s or the back-off 12s.
    for (const c of r.claims) {
      assert.ok(!/8-rep|12-rep/.test(c), `warm-up or back-off produced a PR: "${c}"`);
    }
  });

  test('a light high-rep set does not PR against a heavy history', () => {
    const history: LoggedSet[] = Array.from({ length: 4 }, (_, i) => (
      { id: `h${i}`, sessionId: `p${i}`, exerciseId: 'bench', weight: 225, reps: 5, at: i }
    ));
    const junk: LoggedSet = { id: 'j', sessionId: 'now', exerciseId: 'bench', weight: 135, reps: 12, at: 9 };
    assert.equal(findPRs([junk], history, exercises).length, 0);
  });
});

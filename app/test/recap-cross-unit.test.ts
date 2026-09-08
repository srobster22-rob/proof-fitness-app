import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecap } from '../src/domain/session.ts';
import { findPRs } from '../src/domain/pr.ts';
import type { LoggedSet, Session, Exercise, Unit } from '../src/domain/types.ts';

const MIN = 60_000, DAY = 86_400_000;
const NOW = Date.UTC(2026, 1, 10, 18, 0, 0);

const exercises = new Map<string, Exercise>([
  ['bench', { id: 'bench', name: 'Bench Press' } as Exercise]
]);

const set = (
  sessionId: string, weight: number, reps: number, at: number, id: string
): LoggedSet => ({ id, sessionId, exerciseId: 'bench', weight, reps, at } as LoggedSet);

/*
 * R478. A `LoggedSet` carries no unit — the SESSION owns it — so any comparison
 * that reaches ACROSS sessions must convert each set out of its own session's
 * unit first. HANDOFF trap 9; five instances were found and fixed in R179-R181,
 * and `pr.ts`'s `loadOf` comment records the exact symptom: a 100 kg history
 * read as a bare 100, so a lighter later set won "Heaviest 5-rep bench press".
 *
 * `findPRs` was fixed then. `buildRecap` was not, and it runs TWO cross-session
 * comparisons of its own:
 *
 *   - `heaviest`, which gates the recap's loudest claim. `heaviestEver` takes
 *     `sessionUnits` as a defaulted 5th parameter and session.ts was the only
 *     call site in the whole app that omitted it — weekly.ts, progress-model.ts
 *     and recap-model.ts all passed it.
 *   - `bestYet`, whose `priorBest` reduces over `allSets` with a local `load`
 *     that fell back to the raw `x.weight`.
 *
 * The consequence is not a wrong number, it is a false CLAIM — §8's one rule is
 * never to cry wolf — and it reaches the share message and the in-app card.
 */
describe('a unit switch cannot buy a false "heaviest ever" (§8)', () => {
  /*
   * A real lifter's path: trained in kg, switched Settings to lb, trained on.
   * Three prior sessions, because MIN_SESSIONS_BEFORE_PR is 3.
   *
   * 100 kg is 220.5 lb. Today's 200 lb x 8 is a genuine 8-rep record (it beats
   * the converted 176.5 lb) but it is NOT the heaviest thing this lifter has
   * ever moved — that is still the 100 kg single-session best, 20.5 lb heavier.
   */
  const history: LoggedSet[] = [
    set('k1', 100, 3, NOW - 30 * DAY, 'a'),
    set('k2', 80, 8, NOW - 20 * DAY, 'b'),
    set('k3', 80, 8, NOW - 10 * DAY, 'c')
  ];
  const today = [set('now', 200, 8, NOW - 40 * MIN, 'd')];
  const session: Session = {
    id: 'now', startedAt: NOW - 55 * MIN, endedAt: NOW - 18 * MIN,
    unit: 'lb', updatedAt: NOW - 55 * MIN
  };
  const sessionUnits = new Map<string, Unit>([
    ['k1', 'kg'], ['k2', 'kg'], ['k3', 'kg'], ['now', 'lb']
  ]);
  const allSets = [...history, ...today];

  test('the PR itself is still awarded — this is not about suppressing records', () => {
    const prs = findPRs(today, history, exercises, 'lb', [], sessionUnits);
    assert.equal(prs.length, 1, 'a genuine 8-rep record was lost');
    assert.equal(prs[0].weight, 200);
  });

  test('but it is not announced as the heaviest ever, because it is not', () => {
    const prs = findPRs(today, history, exercises, 'lb', [], sessionUnits);
    const payload = buildRecap({
      session, sets: today, exercises, prs, allSets, now: NOW, sessionUnits
    });
    assert.ok(payload.pr, 'no PR on the payload');
    assert.equal(payload.pr!.heaviest, false,
      'the recap claims "heaviest ever" for a 200 lb set while the lifter has ' +
      '100 kg (220.5 lb) in their own history — 20.5 lb HEAVIER. Reverting the ' +
      'sessionUnits argument at session.ts\'s heaviestEver call reproduces this.');
  });

  /*
   * The same defect one field over, and the reason this round swept rather than
   * patching a line: `bestYet` reduces `allSets` too.
   */
  test('and bestYet does not manufacture a baseline out of an unconverted history', () => {
    // No PR this time (today's set is genuinely lighter than the kg history),
    // so the bestYet branch is the one that runs.
    const lighter = [set('now', 150, 8, NOW - 40 * MIN, 'e')];
    const payload = buildRecap({
      session, sets: lighter, exercises, prs: [], allSets: [...history, ...lighter],
      now: NOW, sessionUnits
    });
    assert.equal(payload.bestYet, undefined,
      '150 lb was called a "best yet" against a history whose real best is ' +
      '220.5 lb — the raw kg numbers (100/80/80) only look smaller than 150');
  });

  test('and none of this changes anything for a lifter who never switched', () => {
    // The regression guard. With one unit throughout, the map is a no-op and
    // every claim must read exactly as it did before R478.
    const lbUnits = new Map<string, Unit>([
      ['k1', 'lb'], ['k2', 'lb'], ['k3', 'lb'], ['now', 'lb']
    ]);
    const prs = findPRs(today, history, exercises, 'lb', [], lbUnits);
    const payload = buildRecap({
      session, sets: today, exercises, prs, allSets, now: NOW, sessionUnits: lbUnits
    });
    assert.ok(payload.pr, 'the all-lb lifter lost their PR');
    assert.equal(payload.pr!.heaviest, true,
      '200 lb really is the heaviest in a 100/80/80 lb history');
  });
});

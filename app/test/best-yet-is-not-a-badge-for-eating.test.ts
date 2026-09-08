import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { buildRecap } from '../src/domain/session.ts';
import { findPRs } from '../src/domain/pr.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SESSION = fs.readFileSync(path.join(HERE, '..', 'src', 'domain', 'session.ts'), 'utf8');
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 9, 12);

/**
 * Three sessions of `exerciseId` at 25 x 5, then the same 25 x 5 today.
 * `gained` decides whether the lifter is heavier than they used to be.
 */
function history(exerciseId: string, gained: boolean, reps = 5): Repo {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  let n = 0;
  for (const d of [21, 14, 7]) {
    const id = `h${d}`;
    repo.startSession(id, 'lb');
    repo.logSet({ id: `s${n++}`, sessionId: id, exerciseId, weight: 25, reps, at: T0 - d * DAY });
    repo.endSession(id, T0 - d * DAY + 3600_000);
  }
  repo.startSession('today', 'lb');
  repo.logSet({ id: 'st', sessionId: 'today', exerciseId, weight: 25, reps, at: T0 });
  repo.saveMeasurement({ id: 'b0', kind: 'bodyweight', value: 180, unit: 'lb', at: T0 - 60 * DAY });
  repo.saveMeasurement({ id: 'b1', kind: 'bodyweight', value: gained ? 192 : 180, unit: 'lb', at: T0 - DAY });
  return repo;
}

function card(repo: Repo) {
  const sets = repo.setsInSession('today');
  const prs = findPRs(sets, repo.historyBefore('today'), repo.exercises(),
    'lb', repo.measurements(), repo.sessionUnits());
  const recap = buildRecap({
    session: repo.session('today')!, sets, exercises: repo.exercises(), prs,
    allSets: repo.allSets(), now: T0,
    measurements: repo.measurements(), sessionUnits: repo.sessionUnits()
  });
  return { prs, recap };
}

/*
 * R540. `bestYet`'s own comment claimed it made "the same comparison `findPRs`
 * makes, so the two can never disagree about whether something was beaten".
 * They disagreed on the first case anyone would check.
 *
 * `findPRs` holds a bodyweight movement to TWO scales — more total load AND
 * more added weight than ever before — because the one way real load can rise
 * on a pull-up without the lifter doing anything is the lifter getting heavier.
 * `pr.ts` names that failure exactly: "the purest cry-wolf in the app: a badge
 * for eating". `bestYet` compared load and nothing else.
 *
 * Measured: 25 x 5 pull-ups three times at 180 lb bodyweight, then the same
 * 25 x 5 at 192. `findPRs` correctly awards nothing, and the recap card said
 * BEST YET, prev 205 — on the surface people SHARE. The `headline` suppression
 * could not save it either: there was no record, which is the whole point.
 *
 * The claim in the comment is what made this hard to see. It was not a comment
 * describing the code; it was a comment standing in for a test.
 */
describe('BEST YET is not awarded for gaining weight (R540)', () => {
  test('the same pull-up at a heavier bodyweight is not a best', () => {
    const { prs, recap } = card(history('pullup', true));
    assert.equal(prs.length, 0, 'the fixture broke: findPRs should award nothing here');
    assert.equal(recap.bestYet, undefined,
      'the card claims BEST YET for a set identical to three before it — the only ' +
      'thing that changed is the scale, and findPRs already refused to call it a record');
  });

  test('and the guard costs a real lifter nothing', () => {
    /*
     * The other half, and the reason the guard is safe: at an unchanged
     * bodyweight the two scales agree exactly, so adding weight to the belt
     * still reads as a best.
     *
     * Getting to a case `bestYet` can actually reach took three attempts, and
     * the wrong ones all failed against CORRECT code — which would have read
     * as the new guard being too strict.
     *
     * A PR suppresses `bestYet` by design, and `MIN_INCREMENT.lb` is 1, so on
     * a lift with matching-rep history ANY extra pound is already a record and
     * `bestYet` never gets a turn. Its territory is sets `findPRs` declines to
     * judge — here, above `MAX_PR_REPS`, where a set is conditioning rather
     * than a strength record. Fifteen reps, and the improvement counts.
     */
    const repo = history('pullup', false, 15);
    repo.logSet({ id: 'st2', sessionId: 'today', exerciseId: 'pullup', weight: 28, reps: 15, at: T0 + 60_000 });
    const { recap } = card(repo);
    assert.ok(recap.bestYet, 'three more pounds on the belt at the same bodyweight is not being counted');
  });

  test('an ordinary lift is untouched by the guard', () => {
    // The rule is scoped to the four movements that carry the lifter. A bench
    // press does not get heavier when you do.
    const repo = history('bench', true, 15);
    repo.logSet({ id: 'st2', sessionId: 'today', exerciseId: 'bench', weight: 28, reps: 15, at: T0 + 60_000 });
    const { recap } = card(repo);
    assert.ok(recap.bestYet, 'a heavier bench is no longer a best');
  });

  test('the comment no longer claims the two can never disagree', () => {
    /*
     * The claim is the defect's cause, not its decoration: it is what a reader
     * checks INSTEAD of checking the code, and it survived every round that
     * touched this file.
     */
    assert.doesNotMatch(SESSION, /the two can never\s*\n?\s*\*?\s*disagree about whether something was beaten/,
      'session.ts still claims bestYet and findPRs cannot disagree');
    assert.match(SESSION, /R540 measured them\s*\n?\s*\*?\s*disagreeing/,
      'the correction that replaced the claim is gone');
  });
});

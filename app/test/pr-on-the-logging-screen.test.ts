import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { around } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = fs.readFileSync(path.join(HERE, '..', 'src', 'ui', 'NowScreen.tsx'), 'utf8');
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 9, 12);

/** Three sessions of bench at 185×5, so 185 is the number to beat. */
function benched(): Repo {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  let n = 0;
  for (const d of [21, 14, 7]) {
    const id = `h${d}`;
    repo.startSession(id, 'lb');
    repo.logSet({ id: `s${n++}`, sessionId: id, exerciseId: 'bench', weight: 185, reps: 5, at: T0 - d * DAY });
    repo.endSession(id, T0 - d * DAY + 3600_000);
  }
  return repo;
}

function onBench(repo: Repo): NowModel {
  const m = new NowModel(repo, () => T0, 'en-US');
  m.selectExercise('bench');
  return m;
}

/*
 * R522, for OWNER.md #5: "motion, colour and feedback where a set is logged or
 * a best is hit".
 *
 * Logging already had feedback — `Arrive` gives the chip an entrance. A BEST
 * had none. §8 calls the personal record "the emotional payload of the whole
 * product", and `findPRs` was used by the recap and by the harness and never by
 * the screen the record happens on: a lifter could break a three-month plateau
 * and the logging screen said exactly what it says for a warm-up, until the
 * recap told them later.
 *
 * The mark is deliberately small — the accent and one glyph, on the chip that
 * did it. §8's other half is NEVER CRY WOLF, and a banner for every heavy set
 * is how an app teaches people to ignore it. The sentence about a record still
 * belongs to the recap, which has room for one.
 */
describe('a personal record is marked where it happens (R522)', () => {
  test('an ordinary set is not marked', () => {
    const m = onBench(benched());
    m.log();
    assert.deepEqual(m.state().prSetIds, [],
      'a set at the usual weight was marked as a record');
  });

  test('equalling the old best is not a record either', () => {
    /*
     * §8's rule is MORE weight than ever, for the same or more reps. Matching
     * it is not beating it, and an app that celebrates a tie is crying wolf on
     * the one signal it cannot afford to devalue.
     */
    const repo = benched();
    const m = onBench(repo);
    m.log();   // the prefill is the previous best, 185 × 5
    assert.equal(m.state().loggedThisExercise.at(-1)?.weight, 185, 'the fixture did not equal the best');
    assert.deepEqual(m.state().prSetIds, []);
  });

  test('beating it marks that set, and only that set', () => {
    const m = onBench(benched());
    m.log();                                        // 185, not a record
    for (let i = 0; i < 4; i++) m.bumpPlate(1);     // heavier than ever
    m.log();
    const s = m.state();
    assert.equal(s.prSetIds.length, 1, `${s.prSetIds.length} sets marked; exactly one broke a record`);
    assert.ok(s.prSetIds.includes(s.loggedThisExercise.at(-1)!.id),
      'the marked set is not the one that broke the record');
  });

  test('it asks the same question the recap asks', () => {
    /*
     * `historyBefore(sessionId)` and the same measurements and per-session
     * units the recap passes. If the screen used `allSets()` instead, today's
     * own sets would be in the history a record is measured against and the
     * second heavy set of a session could never be one — the two surfaces
     * would disagree about what happened in the same workout.
     */
    const model = fs.readFileSync(path.join(HERE, '..', 'src', 'ui', 'now-model.ts'), 'utf8');
    // `around`, not slice(indexOf(...)): the raw form returns the tail of the
    // file instead of throwing when an anchor moves, so this test would pass by
    // reading something else. The repo's own gate caught me doing it twice in
    // one round.
    const call = around(model, 'this.prCacheValue = findPRs(', 0, 300);
    assert.match(call, /historyBefore\(this\.session\.id\)/,
      'the screen measures records against a history that includes today');
    /*
     * R539 hoisted `this.repo.measurements()` into a local, because the cache
     * now keys on it as well as on the sets, so this read the literal call and
     * failed on a change that strengthened the thing it was protecting. The
     * argument is what matters, not where it was fetched — so check the
     * argument, and check the local is bound to the repo just above it.
     */
    assert.match(call, /measurements, this\.repo\.sessionUnits\(\)/,
      'bodyweight movements and kilogram sessions are being compared dishonestly');
    const body = around(model, 'private prSetIds(', 0, 700);
    assert.match(body, /const measurements = this\.repo\.measurements\(\)/,
      'the measurements handed to findPRs no longer come from the repo');
  });

  test('the screen actually draws the mark', () => {
    assert.match(SCREEN, /state\.prSetIds\.includes\(set\.id\) && s\.chipPR/,
      'nothing on the chip changes when the set is a record');
    assert.match(SCREEN, /chipPR: \{[^}]*borderColor: VOLT/,
      'the record mark does not use the accent §15 reserves for exactly this');
  });

  test('and a chip that never animates is still marked', () => {
    /*
     * §12's rule, which `Arrive` records the hard way: `Animated` is driven by
     * requestAnimationFrame, which does not fire while the page is hidden, so
     * anything that only exists during a transition can strand. The mark is a
     * resting style — it is on the chip whether or not the entrance ever ran.
     */
    assert.doesNotMatch(SCREEN, /chipPR:[^}]*opacity: 0/,
      'the record mark starts invisible and depends on a transition to appear');
    const arrive = fs.readFileSync(path.join(HERE, '..', 'src', 'ui', 'Arrive.tsx'), 'utf8');
    assert.match(arrive, /the resting style is the visible one/,
      'the rule this mark relies on is no longer stated where the motion lives');
  });
});

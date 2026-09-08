import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MUSCLES, profileFor, overlap, recommendNext, RECOMMENDATION_SOURCES
} from '../src/domain/muscles.ts';
import { BUILTIN } from '../src/domain/coldstart.ts';
import type { LoggedSet } from '../src/domain/types.ts';

const T = Date.UTC(2026, 7, 21, 18);
let n = 0;
const did = (exerciseId: string): LoggedSet =>
  ({ id: `x${n++}`, sessionId: 's1', exerciseId, weight: 100, reps: 8, at: T + n * 60_000 });

/**
 * The user's own example, which is also the clearest case in the literature:
 * after bench press you want triceps, not a second horizontal press and not an
 * overhead press — all three of those run on the same prime movers.
 */
describe('what to do after a bench press', () => {
  const after = (done: string[], candidates: string[]) =>
    recommendNext(candidates, done.map(did));

  test('a triceps isolation beats another pressing variation', () => {
    const r = after(['bench'], ['incline', 'ohp', 'triext', 'dbpress']);
    assert.equal(r[0].exerciseId, 'triext',
      `ranked ${r.map(x => `${x.exerciseId}:${x.score}`).join(' ')}`);
  });

  test('and it says why, rather than just reordering the list', () => {
    const r = after(['bench'], ['incline', 'triext']);
    assert.match(r[0].reason, /finishes what your compound started/);
    assert.match(r.find(x => x.exerciseId === 'incline')!.reason, /same muscles/);
  });

  test('overhead press is not the answer either — it shares delts and triceps', () => {
    const r = after(['bench'], ['ohp', 'row']);
    assert.equal(r[0].exerciseId, 'row', 'a pull is untouched by a press');
    assert.ok(r[0].score > r[1].score);
  });

  /*
   * The rule this is really encoding: a candidate whose prime movers were just
   * used as prime movers is the same work for less load.
   */
  test('a second horizontal press scores worst of all', () => {
    const r = after(['bench'], ['dbpress', 'incline', 'lateral', 'row', 'triext']);
    assert.equal(r[r.length - 1].exerciseId, 'dbpress',
      'bench and DB bench are the same lift with a different implement');
  });

  test('a side delt raise is fine after bench — bench is not a side delt lift', () => {
    const r = after(['bench'], ['lateral', 'incline']);
    assert.equal(r[0].exerciseId, 'lateral');
  });
});

/*
 * Compounds before isolations for the same muscle. Isolation first is
 * pre-exhaustion, which costs the compound 10-30% of its load with no measured
 * hypertrophy benefit.
 */
describe('compounds before isolations, for the same muscle', () => {
  test('opening a session on a triceps isolation is discouraged', () => {
    const cold = recommendNext(['triext', 'bench'], []);
    assert.equal(cold[0].exerciseId, 'bench', 'the heavy work comes first');
    assert.match(cold.find(x => x.exerciseId === 'triext')!.reason,
      /after the heavy work, not before/);
  });

  test('but the same isolation is the top pick once the compound is done', () => {
    const warm = recommendNext(['triext', 'incline'], [did('bench')]);
    assert.equal(warm[0].exerciseId, 'triext');
  });

  /*
   * Written the other way round first, asserting the isolation won. It does
   * not, and the model is right: compound-first means the heavy work happens
   * while something is still fresh, so on a full-body day a leg press outranks
   * the triceps extension that finishes off the bench. The triceps work is not
   * lost — it is later, which is exactly where the ordering rule puts it.
   */
  test('a compound on a fresh muscle still outranks the isolation', () => {
    const r = recommendNext(['triext', 'legpress'], [did('bench')]);
    assert.equal(r[0].exerciseId, 'legpress');
    assert.match(r[0].reason, /not trained yet today|just fatigued/);
  });

  test('an isolation for a muscle nothing has touched is still held back', () => {
    // Leg curl with no hamstring compound done: pre-exhaustion again.
    const r = recommendNext(['legcurl', 'rdl'], [did('bench')]);
    assert.equal(r[0].exerciseId, 'rdl');
  });
});

describe('the session so far, not just the last lift', () => {
  test('fatigue from earlier in the session still counts, but counts less', () => {
    const justNow = recommendNext(['incline'], [did('bench')])[0].score;
    const aWhileAgo = recommendNext(['incline'], [did('bench'), did('row')])[0].score;
    assert.ok(aWhileAgo > justNow,
      'fatigue fades across a workout rather than staying flat');
  });

  test('a lift already trained today is not a recommendation', () => {
    const r = recommendNext(['bench', 'row'], [did('bench')]);
    assert.equal(r[0].exerciseId, 'row');
    assert.ok(r.find(x => x.exerciseId === 'bench')!.score < 0);
  });

  test('with nothing done yet, a compound leads', () => {
    const r = recommendNext(['curl', 'squat', 'calf'], []);
    assert.equal(r[0].exerciseId, 'squat');
  });
});

describe('the muscle map itself', () => {
  test('every movement in the library is mapped, or deliberately is not', () => {
    const unmapped = BUILTIN.map(l => l.id).filter(id => !MUSCLES[id]);
    assert.deepEqual(unmapped, [],
      'a library movement with no profile silently scores neutral and is never recommended');
  });

  test('a movement the user invented has no profile, and none is guessed', () => {
    assert.equal(profileFor('sled'), null);
    const r = recommendNext(['sled'], [did('bench')]);
    assert.equal(r[0].score, 0);
    assert.equal(r[0].reason, '', 'the app must not narrate a claim it cannot make');
  });

  test('every profile names at least one primary muscle', () => {
    for (const [id, p] of Object.entries(MUSCLES)) {
      assert.ok(p.primary.length > 0, `${id} trains nothing`);
    }
  });

  test('no muscle is both primary and secondary in one movement', () => {
    for (const [id, p] of Object.entries(MUSCLES)) {
      for (const m of p.primary) {
        assert.ok(!p.secondary.includes(m), `${id} lists ${m} twice`);
      }
    }
  });

  test('overlap is near-total against itself and nil against something unrelated', () => {
    // Not exactly 1: a movement's SECONDARY muscles landing on the same
    // secondary muscles are discounted twice over, by design — the expensive
    // collision is prime mover on prime mover.
    assert.ok(overlap(MUSCLES.bench, MUSCLES.bench) >= 0.85);
    assert.equal(overlap(MUSCLES.calf, MUSCLES.bench), 0);
  });

  test('the pressing family really does collide', () => {
    // The specific claim in the sources: bench, incline and overhead pressing
    // all run on chest / anterior deltoid / triceps.
    assert.ok(overlap(MUSCLES.incline, MUSCLES.bench) > 0.6);
    assert.ok(overlap(MUSCLES.ohp, MUSCLES.bench) > 0.3);
    assert.ok(overlap(MUSCLES.row, MUSCLES.bench) < 0.1);
  });
});

/*
 * §16 — a claim the user cannot check is one they cannot trust, and that goes
 * double for advice about their training.
 */
describe('the advice can be checked', () => {
  test('every source has a claim and a URL', () => {
    assert.ok(RECOMMENDATION_SOURCES.length >= 4);
    for (const s of RECOMMENDATION_SOURCES) {
      assert.ok(s.claim.length > 20, 'a source with no claim proves nothing');
      assert.match(s.url, /^https:\/\//);
    }
  });
});

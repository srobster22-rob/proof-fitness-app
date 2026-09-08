import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { buildRecap } from '../src/domain/session.ts';

const MIN = 60_000, DAY = 86_400_000;
const T0 = Date.UTC(2026, 6, 29, 18);

function payloadFor(rows: Array<[string, string, number, number, number]>, sid: string, now = T0) {
  const repo = new Repo(new DatabaseSync(':memory:') as any, () => now);
  let i = 0;
  for (const [sessionId, exerciseId, weight, reps, at] of rows) {
    if (!repo.session(sessionId)) { repo.startSession(sessionId, 'lb', undefined, at); repo.endSession(sessionId, at + 40 * MIN); }
    repo.logSet({ id: `s${i++}`, sessionId, exerciseId, weight, reps, at });
  }
  const all = repo.allSets();
  return buildRecap({
    session: repo.session(sid)!,
    sets: all.filter(x => x.sessionId === sid),
    exercises: repo.exercises(),
    prs: [],
    allSets: all,
    now
  });
}

/**
 * `firstSession` is a fact about the DEVICE, not about the session — it is what
 * lets the recap say the one true thing available to a workout that broke no
 * record. Getting it from the session's own emptiness would mark every later
 * workout as a first one the moment it opened.
 */
describe('firstSession (§8)', () => {
  test('the very first workout is one', () => {
    const p = payloadFor([['a', 'bench', 45, 8, T0]], 'a');
    assert.equal(p.firstSession, true);
  });

  test('the second is not, even on a fresh session id', () => {
    const p = payloadFor([
      ['a', 'bench', 45, 8, T0 - 7 * DAY],
      ['b', 'bench', 95, 5, T0]
    ], 'b');
    assert.equal(p.firstSession, false);
  });

  test('sets logged inside this session do not make it look later than it is', () => {
    const p = payloadFor([
      ['a', 'bench', 45, 8, T0],
      ['a', 'row', 60, 8, T0 + 10 * MIN]
    ], 'a');
    assert.equal(p.firstSession, true, 'its own earlier sets are not "before" it');
  });
});

/*
 * The slab that fills a first recap has to carry something the card is not
 * already showing. Built first as the volume, which the hero above it already
 * is — 1,800 LB printed twice on one card reads as a rendering fault.
 */
describe('the first-session slab is not the volume again (§16)', () => {
  test('it is the heaviest set of the workout', () => {
    const p = payloadFor([
      ['a', 'bench', 45, 8, T0],
      ['a', 'squat', 135, 5, T0 + 10 * MIN],
      ['a', 'row', 60, 10, T0 + 20 * MIN]
    ], 'a');
    // `exerciseId` rides along so a consumer can tell WHICH movement it was —
    // the bodyweight-multiple line has to recognise a pull-up and refuse to
    // claim it as a multiple of the lifter's own weight.
    assert.deepEqual(p.best, { lift: 'Squat', weight: 135, reps: 5, exerciseId: 'squat' });
  });

  test('reps only break a tie on weight', () => {
    const p = payloadFor([
      ['a', 'bench', 100, 3, T0],
      ['a', 'squat', 100, 9, T0 + 10 * MIN]
    ], 'a');
    assert.equal(p.best!.reps, 9, 'equal weight goes to the harder set');
  });

  test('it is the top set of THIS workout, not of all time', () => {
    const p = payloadFor([
      ['a', 'bench', 225, 5, T0 - 7 * DAY],
      ['b', 'bench', 95, 5, T0]
    ], 'b');
    assert.equal(p.best!.weight, 95);
    assert.equal(p.firstSession, false, 'and this one does not get the slab anyway');
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { recapFor, shareText } from '../src/ui/recap-model.ts';
import { coachSuggestion, type TrainingGoal } from '../src/domain/coach.ts';
import { PREF_GOAL } from '../src/ui/training-goal.ts';
import type { LoggedSet } from '../src/domain/types.ts';
import { t } from '../src/domain/i18n.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 23, 18);

/*
 * R687, THE CALL, slices 2 and 3. The coach needed two sessions of a lift in
 * two weeks, and a first week of push, pull and legs trains no lift twice, so a
 * first-timer saw no coach line at all (H3 = 0 since PT0). Now one session is
 * enough when its own sets are the pattern, and the recap names the call.
 */

/** One session of `lift`, `reps` per set at `weight`, `days` before T0. */
const session = (lift: string, weight: number, reps: number[], days = 3, id = 's1'): LoggedSet[] =>
  reps.map((r, i) => ({ id: `${id}-${i}`, sessionId: id, exerciseId: lift, weight, reps: r, at: T0 - days * DAY + i * 120_000 }));
const call = (sets: LoggedSet[], goal: TrainingGoal = 'size') =>
  coachSuggestion(sets, sets[0].exerciseId, T0, { unit: 'lb', goal, grid: 5 });

describe('one session is enough when its own sets say so (R687)', () => {
  test('every set at the top weight at the goal\'s reps: one step up', () => {
    const c = call(session('fly', 30, [8, 9, 8]))!;
    assert.equal(c.key, 'coachAllSets');
    assert.deepEqual([c.kind, c.weight, c.reps], ['increase', 35, 8]);
    assert.deepEqual(c.params, { weight: 30, reps: 8, n: 3, suggest: 35 }, 'the line must name the fewest reps done, not the most');
    assert.equal(call(session('bench', 135, [5, 5, 5]), 'strength')?.weight, 140, 'strength asks for 5, and got it');
  });

  test('anything short of that says nothing: no guess, and no "first time" claim', () => {
    assert.equal(call(session('fly', 30, [8, 8, 7])), null, 'one short set');
    assert.equal(call(session('fly', 30, [8])), null, 'one set is not a pattern');
    // Three at 45 and one at 50: the top weight was done once.
    assert.equal(call([...session('bench', 45, [8, 8, 8]), ...session('bench', 50, [8], 3, 's1').map(s => ({ ...s, id: 'top', at: s.at + 600_000 }))]), null);
    // PT1's returning lifter: 185×5 for 3 after a break is short of size's 8.
    assert.equal(call(session('squat', 185, [5, 5, 5], 10)), null);
    assert.equal(call(session('fly', 30, [8, 8, 8]), 'consistency'), null, 'the consistency goal added weight');
  });

  test('bodyweight with nothing added gets no call: a push-up set going well is not a plate', () => {
    assert.equal(call(session('pushup', 0, [12, 12, 12])), null);
    assert.equal(call([...session('pullup', 0, [8, 8, 8], 8, 'a'), ...session('pullup', 0, [8, 8, 8], 4, 'b')]), null,
      'two sessions of bodyweight still asked for 5 lb');
  });

  test('taking the call earns the next one, not "repeat it"', () => {
    // 30 for 3 sets, "try 35", then 35 for 3 sets: 5 lb is too big a step on
    // 30 to count as climbing, and this used to fall to "First time at 35×8".
    const sets = [...session('fly', 30, [8, 8, 8], 8, 'a'), ...session('fly', 35, [8, 8, 8], 4, 'b')];
    assert.equal(call(sets)?.key, 'coachAllSets');
    assert.equal(call(sets)?.weight, 40);
  });

  test('only this lift\'s sets count, even at a weight another lift shared', () => {
    const one = [...session('bench', 45, [8]), ...session('ohp', 45, [8, 8]).map(s => ({ ...s, id: `o${s.id}` }))];
    assert.equal(call(one), null, 'overhead press sets made bench\'s pattern');
  });
});

/** A repo with one finished workout, `days` before T0, and a NowModel at T0. */
function trained(sets: LoggedSet[], days = 3) {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  repo.startSession('s1', 'lb', undefined, T0 - days * DAY);
  for (const s of sets) repo.logSet(s);
  repo.endSession('s1', T0 - days * DAY + 3_600_000);
  return repo;
}

describe('the lifter sees it', () => {
  test('the second time a lift comes round, the call is up before the first set', () => {
    const repo = trained(session('fly', 30, [8, 8, 8]));
    const m = new NowModel(repo, () => T0, 'en-US');
    m.selectExercise('fly');
    assert.equal(m.state().lastTime.head, '30×8 for 3 sets — try 35');
  });

  test('the recap names the next call, the first increase in the order trained', () => {
    const repo = trained([...session('bench', 45, [8, 8, 7]), ...session('fly', 30, [8, 8, 8]).map(s => ({ ...s, id: `f${s.id}` })),
      ...session('triext', 10, [12, 12, 12]).map(s => ({ ...s, id: `t${s.id}` }))]);
    const recap = recapFor(repo, 's1', T0)!;
    assert.deepEqual(recap.next, [
      { id: 'fly', lift: 'Chest Fly', line: '30×8 for 3 sets — try 35' },
      { id: 'triext', lift: 'Tricep Extension', line: '10×12 for 3 sets — try 15' }
    ], 'bench fell short, so the calls belong to the lifts that earned one, in the order trained');
  });

  test('a number to beat outranks advice to back off, whichever lift came first', () => {
    // Bench grinding down at 205 over three sessions earns a deload; the fly
    // after it earns an increase. The recap leads with the number to beat.
    const repo = trained([...session('bench', 205, [4]), ...session('fly', 30, [8, 8, 8]).map(s => ({ ...s, id: `f${s.id}` }))]);
    for (const [id, days, reps] of [['p1', 11, 8], ['p2', 7, 6]] as const) {
      repo.startSession(id, 'lb', undefined, T0 - days * DAY);
      repo.logSet({ id: `${id}b`, sessionId: id, exerciseId: 'bench', weight: 205, reps, at: T0 - days * DAY });
      repo.endSession(id, T0 - days * DAY + 3_600_000);
    }
    assert.equal(coachSuggestion(repo.allSets(), 'bench', T0, { unit: 'lb', grid: 5 })?.kind, 'deload', 'the fixture no longer deloads bench');
    assert.deepEqual(recapFor(repo, 's1', T0)!.next.map(c => c.lift), ['Chest Fly']);
    // And the other way round: the fly first, the bench after.
    const flyFirst = trained([...session('fly', 30, [8, 8, 8]).map(s => ({ ...s, id: `f${s.id}` })), ...session('bench', 205, [4]).map(s => ({ ...s, at: s.at + 900_000 }))]);
    for (const [id, days, reps] of [['p1', 11, 8], ['p2', 7, 6]] as const) {
      flyFirst.startSession(id, 'lb', undefined, T0 - days * DAY);
      flyFirst.logSet({ id: `${id}b`, sessionId: id, exerciseId: 'bench', weight: 205, reps, at: T0 - days * DAY });
      flyFirst.endSession(id, T0 - days * DAY + 3_600_000);
    }
    assert.deepEqual(recapFor(flyFirst, 's1', T0)!.next.map(c => c.lift), ['Chest Fly']);
  });

  test('at most three calls, the first three earned in the order trained (R691)', () => {
    const lifts = ['fly', 'triext', 'curl', 'lateral'];
    const repo = trained(lifts.flatMap((lift, k) => session(lift, 20 + k * 5, [12, 12, 12]).map(s => ({ ...s, id: `${lift}${s.id}`, at: s.at + k * 900_000 }))));
    const next = recapFor(repo, 's1', T0)!.next;
    assert.deepEqual(next.map(c => c.lift), ['Chest Fly', 'Tricep Extension', 'Bicep Curl']);
  });

  test('a workout with nothing to call says nothing, and the call never goes on the card', () => {
    const repo = trained(session('bench', 45, [8, 6]));
    assert.deepEqual(recapFor(repo, 's1', T0)!.next, []);
    const made = trained(session('fly', 30, [8, 8, 8]));
    const recap = recapFor(made, 's1', T0)!;
    assert.equal(recap.next.length, 1);
    assert.doesNotMatch(JSON.stringify(recap.payload), /try 35/, 'the call reached the share card');
    assert.doesNotMatch(shareText(recap), /try 35/, 'the call reached the share message');
  });

  test('the goal decides the call on the recap as it does on Now', () => {
    const repo = trained(session('fly', 30, [8, 8, 8]));
    repo.setPref(PREF_GOAL, 'consistency');
    assert.deepEqual(recapFor(repo, 's1', T0)!.next, [], 'a consistency lifter was told to add weight');
  });

  test('reopened days later, a recap still shows what it called then', () => {
    const repo = trained(session('fly', 30, [8, 8, 8], 20), 20);
    assert.equal(recapFor(repo, 's1', T0)!.next[0]?.line, '30×8 for 3 sets — try 35',
      'the two weeks were counted back from today instead of from the workout');
  });

  test('the recap screen shows it under NEXT TIME, in both languages', () => {
    const HERE = path.dirname(fileURLToPath(import.meta.url));
    const screen = readFileSync(path.join(HERE, '..', 'app', 'recap.tsx'), 'utf8');
    assert.match(screen, /const \{ payload, thin, next[^}]*\} = recap;/);
    assert.match(screen, /\{next\.length > 0 && \([\s\S]{0,200}T\('nextTime'\)[\s\S]{0,200}next\.map\(call =>[\s\S]{0,200}\{call\.lift\}[\s\S]{0,40}\{call\.line\}/,
      'the recap no longer draws the call');
    assert.equal(t('es', 'nextTime'), 'LA PRÓXIMA VEZ');
    assert.equal(t('es', 'coachAllSets'), '{weight}×{reps} en {n} series — prueba {suggest}');
  });
});

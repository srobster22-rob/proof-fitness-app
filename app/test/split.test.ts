import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayOf, sessionDay, groupBySplit, companionFor, SPLIT_DAYS, SPLIT_LABEL
} from '../src/domain/split.ts';
import { STARTING_TWELVE } from '../src/domain/coldstart.ts';

const LIB = STARTING_TWELVE.map(({ id, name }) => ({ id, name }));

describe('splits — what goes with what (§6, §7)', () => {
  test('every starting movement has a day', () => {
    for (const e of STARTING_TWELVE) {
      assert.ok(dayOf(e.id), `${e.id} belongs to no day — it would vanish from the grouped picker`);
    }
  });

  test('and belongs to exactly one', () => {
    const seen = new Map<string, number>();
    for (const day of SPLIT_DAYS) {
      for (const e of STARTING_TWELVE) {
        if (dayOf(e.id) === day) seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
      }
    }
    for (const [id, n] of seen) assert.equal(n, 1, `${id} is on ${n} days`);
  });

  test('a movement the user invented has no day, rather than a guessed one', () => {
    assert.equal(dayOf('hack_squat'), null);
  });

  test('the assignments are the conventional ones', () => {
    assert.equal(dayOf('bench'), 'push');
    assert.equal(dayOf('row'), 'pull');
    assert.equal(dayOf('squat'), 'legs');
    assert.equal(dayOf('deadlift'), 'pull', 'deadlift trains with the back, not next to squats');
    assert.equal(dayOf('curl'), 'pull');
    assert.equal(dayOf('triext'), 'push');
  });
});

describe('which day the workout is', () => {
  test('unknowable until something recognisable is logged', () => {
    assert.equal(sessionDay([]), null);
    assert.equal(sessionDay(['hack_squat']), null, 'a custom lift must not name the day');
  });

  test('one lift is enough', () => {
    assert.equal(sessionDay(['bench']), 'push');
  });

  test('the majority wins', () => {
    assert.equal(sessionDay(['bench', 'ohp', 'curl']), 'push');
    assert.equal(sessionDay(['row', 'pulldown', 'bench']), 'pull');
  });

  test('a tie goes to the lift they are ON', () => {
    // One set of bench then one of squats is 1-1, and breaking it toward what
    // they opened with labelled the screen PUSH DAY, and led the picker with
    // push movements, while the user sat looking at SQUAT.
    assert.equal(sessionDay(['bench', 'squat'], 'legs'), 'legs');
    assert.equal(sessionDay(['bench', 'squat'], 'push'), 'push');
  });

  test('with no lift to prefer, a tie goes to what they opened with', () => {
    assert.equal(sessionDay(['bench', 'curl']), 'push');
    assert.equal(sessionDay(['curl', 'bench']), 'pull');
  });

  test('but a majority still beats the lift they are on', () => {
    // Browsing to a curl mid-push-day must not rename the workout.
    assert.equal(sessionDay(['bench', 'ohp', 'curl'], 'pull'), 'push');
  });

  test('a preference for a day not being trained is ignored', () => {
    assert.equal(sessionDay(['bench', 'ohp'], 'legs'), 'push');
  });

  test('custom lifts are ignored rather than breaking the count', () => {
    assert.equal(sessionDay(['bench', 'hack_squat', 'ohp']), 'push');
  });
});

describe('the grouped picker', () => {
  test('the day being trained leads', () => {
    const groups = groupBySplit(LIB, 'legs');
    assert.equal(groups[0].day, 'legs');
    assert.equal(groups[0].label, SPLIT_LABEL.legs);
  });

  test('but the other days stay visible — this is grouping, not a filter', () => {
    const groups = groupBySplit(LIB, 'legs');
    assert.deepEqual(groups.map(g => g.day), ['legs', 'push', 'pull']);
    const listed = groups.flatMap(g => g.exercises.map(e => e.id));
    assert.equal(listed.length, LIB.length, 'a filter would lose movements');
  });

  test('with no day known the order is the standard one', () => {
    assert.deepEqual(groupBySplit(LIB, null).map(g => g.day), SPLIT_DAYS);
  });

  test('nothing is lost and nothing is duplicated', () => {
    for (const lead of [...SPLIT_DAYS, null]) {
      const ids = groupBySplit(LIB, lead).flatMap(g => g.exercises.map(e => e.id));
      assert.equal(new Set(ids).size, ids.length, `duplicate under lead=${lead}`);
      assert.deepEqual([...ids].sort(), LIB.map(e => e.id).sort());
    }
  });

  test('movements the user made get their own group, at the end', () => {
    const groups = groupBySplit([...LIB, { id: 'hack_squat', name: 'Hack Squat' }], 'push');
    const last = groups[groups.length - 1];
    assert.equal(last.day, null);
    assert.equal(last.label, 'YOURS');
    assert.deepEqual(last.exercises.map(e => e.id), ['hack_squat']);
  });

  test('an empty day is not given a heading', () => {
    const groups = groupBySplit(LIB.filter(e => dayOf(e.id) !== 'legs'), null);
    assert.ok(!groups.some(g => g.day === 'legs'), 'a heading over nothing');
  });
});

describe('what to train next when there is no history at all', () => {
  test('it names a movement from the same day', () => {
    const next = companionFor('push', ['bench'], LIB);
    assert.ok(next);
    assert.equal(dayOf(next!), 'push');
    assert.notEqual(next, 'bench');
  });

  test('the big compound before the isolation', () => {
    assert.equal(companionFor('push', ['bench'], LIB), 'ohp',
      'overhead press, not lateral raises');
  });

  test('it never repeats what is already done', () => {
    const done = LIB.filter(e => dayOf(e.id) === 'push').map(e => e.id);
    assert.equal(companionFor('push', done, LIB), null, 'the day is finished; say nothing');
  });

  test('and says nothing when the day is unknown', () => {
    assert.equal(companionFor(null, [], LIB), null);
  });
});

// The group you are IN has to lead, and a movement the user invented has no
// day — so it lands in YOURS, at the bottom. Opening the picker while training
// "Hack Squat" put the selected row at y 1098 on an 812px screen: below the
// fold, with nothing visible marked as current.
describe('leading with YOURS', () => {
  const MINE = { id: 'hack_squat', name: 'Hack Squat' };
  const WITH_MINE = [...LIB, MINE];

  test('the custom group comes first when that is where you are', () => {
    const groups = groupBySplit(WITH_MINE, 'yours');
    assert.equal(groups[0].label, 'YOURS');
    assert.deepEqual(groups[0].exercises.map(e => e.id), ['hack_squat']);
  });

  test('and last when you are on a movement with a day', () => {
    const groups = groupBySplit(WITH_MINE, 'push');
    assert.equal(groups[0].day, 'push');
    assert.equal(groups[groups.length - 1].label, 'YOURS');
  });

  test('asking for YOURS when there are none changes nothing', () => {
    assert.deepEqual(
      groupBySplit(LIB, 'yours').map(g => g.day),
      groupBySplit(LIB, null).map(g => g.day)
    );
  });

  test('nothing is lost or duplicated whichever group leads', () => {
    for (const lead of [...SPLIT_DAYS, 'yours', null] as const) {
      const ids = groupBySplit(WITH_MINE, lead).flatMap(g => g.exercises.map(e => e.id));
      assert.equal(new Set(ids).size, ids.length, `duplicate under lead=${lead}`);
      assert.deepEqual([...ids].sort(), WITH_MINE.map(e => e.id).sort());
    }
  });
});

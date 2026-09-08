import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  coachSuggestion, WINDOW_DAYS, MIN_SESSIONS, PLATEAU_SESSIONS, type TrainingGoal
} from '../src/domain/coach.ts';
import { t, fill } from '../src/domain/i18n.ts';
import type { LoggedSet } from '../src/domain/types.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 9, 18);

let uid = 0;
/** One session `daysAgo`, with the given (weight, reps) sets in order. */
function session(daysAgo: number, sets: Array<[number, number]>): LoggedSet[] {
  const sessionId = `s${uid++}`;
  const at = NOW - daysAgo * DAY;
  return sets.map(([weight, reps], i) => ({
    id: `x${uid++}`, sessionId, exerciseId: 'bench', weight, reps, at: at + i * 60_000
  } as unknown as LoggedSet));
}

const lb = { unit: 'lb' as const };

/*
 * OWNER.md #2, the rule-engine half: "use the last two weeks of history to say
 * what to lift today and why".
 *
 * The tests are grouped by the thing that could go wrong rather than by
 * function, because the ways a coach can be bad are specific: it can talk when
 * it does not know, it can push a tired lifter harder, it can only ever say
 * "go up", and it can be right in English and wrong in Spanish.
 */
describe('the coach only speaks when it has something to say (§8)', () => {
  test('nothing at all from a single session', () => {
    /*
     * "You did 185 once, try 190" is a guess wearing the clothes of evidence.
     * The line's whole value is that it can point at what you actually did, and
     * one session is not a pattern.
     */
    assert.equal(coachSuggestion(session(2, [[185, 5]]), 'bench', NOW, lb), null);
  });

  test('nothing from a lift you have not trained in this window', () => {
    const old = session(WINDOW_DAYS + 3, [[185, 5]]).concat(session(WINDOW_DAYS + 6, [[185, 5]]));
    assert.equal(coachSuggestion(old, 'bench', NOW, lb), null,
      'a lift last touched three weeks ago is not evidence about today');
  });

  test('nothing about a lift you have never done, however much else you have', () => {
    const history = [...session(2, [[185, 5]]), ...session(5, [[185, 5]])];
    assert.equal(coachSuggestion(history, 'squat', NOW, lb), null);
  });

  test('and MIN_SESSIONS is the actual boundary, not a number in a comment', () => {
    const build = (n: number) => Array.from({ length: n }, (_, i) => session(i * 3 + 1, [[185, 8]])).flat();
    assert.equal(coachSuggestion(build(MIN_SESSIONS - 1), 'bench', NOW, lb), null);
    assert.notEqual(coachSuggestion(build(MIN_SESSIONS), 'bench', NOW, lb), null);
  });
});

describe('what it says is what the history says', () => {
  test('two sessions at a weight, reps hit: go up', () => {
    const history = [...session(2, [[185, 8]]), ...session(5, [[185, 8]])];
    const s = coachSuggestion(history, 'bench', NOW, lb)!;
    assert.equal(s.kind, 'increase');
    assert.equal(s.recentWeight, 185, 'it must cite the weight actually lifted');
    assert.ok(s.weight > 185);
  });

  test('mid-climb, reps not yet there: stay', () => {
    // The most common honest answer, and the one a coach that only ever says
    // "go up" would never give.
    const history = [...session(2, [[185, 5]]), ...session(5, [[185, 4]])];
    const s = coachSuggestion(history, 'bench', NOW, lb)!;
    assert.equal(s.kind, 'hold');
    assert.equal(s.weight, 185, 'holding means the same number, not a smaller one');
  });

  test('reps falling at the same weight: back off, do not push', () => {
    /*
     * The branch that protects the lifter, and the reason it is checked FIRST.
     * A lifter grinding out a bad week must never be told to add weight on top
     * of it — that is the one suggestion here that could hurt somebody.
     */
    const history = [
      ...session(1, [[185, 4]]),
      ...session(4, [[185, 6]]),
      ...session(7, [[185, 8]])
    ];
    const s = coachSuggestion(history, 'bench', NOW, lb)!;
    assert.equal(s.kind, 'deload');
    assert.ok(s.weight < 185, `deload suggested ${s.weight}, which is not lighter than 185`);
  });

  test('stuck three sessions with reps flat: nudge the load', () => {
    const history = [
      ...session(1, [[185, 5]]), ...session(4, [[185, 5]]), ...session(7, [[185, 5]])
    ];
    const s = coachSuggestion(history, 'bench', NOW, lb)!;
    assert.equal(s.kind, 'increase');
    assert.equal(s.sessions, PLATEAU_SESSIONS);
    assert.equal(s.key, 'coachPlateau', 'a plateau should say so, not read as ordinary progress');
  });

  test('the top set is the evidence, not the warm-ups', () => {
    /*
     * Including warm-ups would drag every suggestion down toward the warm-up —
     * the coach would tell a 185 bencher to try 100.
     */
    const history = [
      ...session(2, [[95, 8], [135, 5], [185, 8], [135, 12]]),
      ...session(5, [[95, 8], [135, 5], [185, 8], [135, 12]])
    ];
    const s = coachSuggestion(history, 'bench', NOW, lb)!;
    assert.equal(s.recentWeight, 185);
  });
});

describe('it is tuned to what the lifter is training for', () => {
  const climbing = [...session(2, [[100, 8]]), ...session(5, [[100, 8]])];

  test('strength steps further than size', () => {
    const strength = coachSuggestion(climbing, 'bench', NOW, { ...lb, goal: 'strength' })!;
    const size = coachSuggestion(climbing, 'bench', NOW, { ...lb, goal: 'size' })!;
    assert.ok(strength.weight > size.weight,
      `strength suggested ${strength.weight} and size ${size.weight}; the goals are not tuning anything`);
  });

  test('consistency never moves the number', () => {
    // A lifter told to add weight every single time they come in eventually
    // stops coming in.
    const s = coachSuggestion(climbing, 'bench', NOW, { ...lb, goal: 'consistency' })!;
    assert.equal(s.kind, 'hold');
    assert.equal(s.weight, 100);
  });

  test('the step is a real step in either unit', () => {
    /*
     * Expressed in MIN_INCREMENT rather than a hard 5: hard-coding would mean
     * "5 kg" on a metric phone, which is double the intended jump and the kind
     * of thing only a metric lifter would ever find.
     */
    const kg = [...session(2, [[60, 8]]), ...session(5, [[60, 8]])];
    const inKg = coachSuggestion(kg, 'bench', NOW, { unit: 'kg', goal: 'strength' })!;
    const inLb = coachSuggestion(climbing, 'bench', NOW, { ...lb, goal: 'strength' })!;
    assert.equal(inKg.weight - 60, 2.5, 'a kg jump should be 2.5, not 5');
    assert.equal(inLb.weight - 100, 5);
  });
});

describe('the line can be said in both languages', () => {
  const cases: Array<[string, LoggedSet[], TrainingGoal]> = [
    ['increase', [...session(2, [[185, 8]]), ...session(5, [[185, 8]])], 'size'],
    ['hold', [...session(2, [[185, 5]]), ...session(5, [[185, 4]])], 'size'],
    ['plateau', [...session(1, [[185, 5]]), ...session(4, [[185, 5]]), ...session(7, [[185, 5]])], 'size'],
    ['deload', [...session(1, [[185, 4]]), ...session(4, [[185, 6]]), ...session(7, [[185, 8]])], 'size']
  ];

  for (const [name, history, goal] of cases) {
    test(`${name} renders in en and es with every value filled`, () => {
      /*
       * §16: the two languages must say the same thing. The engine returns a
       * KEY and values precisely so this is checkable — a sentence built in
       * coach.ts would be English on a Spanish phone and no test would notice.
       */
      const s = coachSuggestion(history, 'bench', NOW, { ...lb, goal })!;
      for (const lang of ['en', 'es'] as const) {
        const line = fill(t(lang, s.key as never), s.params);
        assert.ok(line.length > 0, `${lang} produced nothing for ${s.key}`);
        assert.doesNotMatch(line, /\{[a-z]+\}/i,
          `${lang} left a placeholder unfilled: "${line}"`);
        assert.notEqual(line, s.key, `${lang} has no translation for ${s.key}`);
      }
    });
  }

  test('the engine never returns a sentence of its own', () => {
    // The guard that keeps the above true. A `reason: string` field would be
    // English by construction and would bypass i18n entirely.
    const s = coachSuggestion(
      [...session(2, [[185, 8]]), ...session(5, [[185, 8]])], 'bench', NOW, lb)!;
    assert.match(s.key, /^coach[A-Z]/, 'the key is not a key');
    assert.equal(typeof (s as unknown as { reason?: string }).reason, 'undefined',
      'the engine grew a prose field, which cannot be translated');
  });
});

describe('a lifter who moves up every session (the real common case)', () => {
  /*
   * Every fixture above holds the weight constant across sessions, so
   * `atSameWeight` was always >= 2 and this case never arose. Running the
   * engine against the app's OWN seeded history — a lifter on linear
   * progression — showed it is the common case, and that the engine got it
   * wrong: it said '235 last 1 — stay here and add a rep'. A count of one read
   * as a streak, and 'stay here' was said to somebody who had added weight
   * every session for three months.
   */
  const climbing = [
    ...session(2, [[205, 5]]),
    ...session(5, [[200, 5]]),
    ...session(8, [[195, 5]])
  ];

  test('is told to repeat the new weight, not to "stay" at it', () => {
    const s = coachSuggestion(climbing, 'bench', NOW, lb)!;
    assert.equal(s.key, 'coachSettle',
      'a weight hit once is being reported as though it were a streak');
    assert.equal(s.weight, 205, 'the advice must be about the weight they just hit');
  });

  test('and no line ever counts a streak of one', () => {
    /*
     * The property, rather than the one string. Any line that cites a number
     * of sessions is claiming a pattern, and one session is not one — this is
     * the §8 rule applied to the copy rather than to the decision.
     */
    const histories = [climbing,
      [...session(2, [[185, 8]]), ...session(5, [[185, 8]])],
      [...session(1, [[185, 5]]), ...session(4, [[185, 5]]), ...session(7, [[185, 5]])],
      [...session(1, [[185, 4]]), ...session(4, [[185, 6]]), ...session(7, [[185, 8]])]];
    for (const h of histories) {
      const s = coachSuggestion(h, 'bench', NOW, lb);
      if (!s) continue;
      if ('n' in s.params) {
        assert.ok(Number(s.params.n) >= MIN_SESSIONS,
          `a line claims ${s.params.n} sessions, which is not a pattern`);
      }
      for (const lang of ['en', 'es'] as const) {
        assert.doesNotMatch(fill(t(lang, s.key as never), s.params), /\b1\b(?=[^0-9]*$)/,
          `"${fill(t(lang, s.key as never), s.params)}" ends by counting to one`);
      }
    }
  });

  test('the new-weight line says it in both languages', () => {
    const s = coachSuggestion(climbing, 'bench', NOW, lb)!;
    for (const lang of ['en', 'es'] as const) {
      const line = fill(t(lang, s.key as never), s.params);
      assert.doesNotMatch(line, /\{[a-z]+\}/i, `${lang} left a placeholder: "${line}"`);
      assert.notEqual(line, s.key, `${lang} has no translation for ${s.key}`);
    }
  });
});

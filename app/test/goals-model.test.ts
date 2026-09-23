import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import {
  createGoal, editGoal, listGoals, removeGoals, restoreGoals,
  canAddGoal, suggestTarget, targetBase, HORIZONS,
  REP_CHOICES, customReps, horizonDays, HORIZON_UNITS, DAYS_PER, goalLifts,
  type GoalDraft
} from '../src/ui/goals-model.ts';
import { MAX_GOALS } from '../src/domain/goals.ts';

/** Real built-in ids — goals carry a foreign key to the exercise table. */
/**
 * MAX_GOALS distinct exercises, invented as needed.
 *
 * The cap is a hundred and the seeded library is twenty-eight, so filling it
 * takes more movements than the app ships with. That is not a contrivance:
 * one goal per exercise is enforced, so the only way a real user reaches the
 * cap is by inventing lifts, and this is what that looks like.
 */
function capSlate(repo: Repo): string[] {
  const ids: string[] = [];
  for (let n = 0; n < MAX_GOALS; n++) {
    const id = `lift${n}`;
    repo.addExercise(id, `Lift ${n}`);
    ids.push(id);
  }
  return ids;
}

const DAY = 86_400_000, MIN = 60_000;
const T0 = Date.UTC(2026, 6, 29, 18);
const fresh = () => new Repo(new DatabaseSync(':memory:') as any, () => T0);

let uid = 0;
function train(repo: Repo, ex: string, weight: number, reps: number, daysAgo: number) {
  const sid = `s${uid++}`;
  repo.startSession(sid, 'lb');
  repo.logSet({ id: `x${uid++}`, sessionId: sid, exerciseId: ex, weight, reps, at: T0 - daysAgo * DAY });
  repo.endSession(sid, T0 - daysAgo * DAY + 30 * MIN);
}

const draft = (over: Partial<GoalDraft> = {}): GoalDraft => ({
  exerciseId: 'squat', targetWeight: 315, targetReps: 5, inDays: 90, unit: 'lb', ...over
});

describe('goal creation', () => {
  test('creates, persists, and reads back', () => {
    const repo = fresh();
    train(repo, 'squat', 275, 5, 7);
    const r = createGoal(repo, draft(), T0);
    assert.equal(r.ok, true);
    assert.equal(repo.goals().length, 1);
    assert.equal(listGoals(repo, T0)[0].goal.targetWeight, 315);
  });

  test('the horizon becomes a real date', () => {
    const repo = fresh();
    train(repo, 'squat', 275, 5, 7);
    const r = createGoal(repo, draft({ inDays: 42 }), T0);
    assert.equal(r.goal!.targetDate, T0 + 42 * DAY);
  });

  test('rejections come back as something a person can read', () => {
    const repo = fresh();
    train(repo, 'squat', 320, 5, 7);
    const r = createGoal(repo, draft({ targetWeight: 315 }), T0);
    assert.equal(r.ok, false);
    assert.match(r.error!, /already beaten/i);
    assert.equal(repo.goals().length, 0, 'and nothing was written');
  });

  test('the cap is refused politely, then honoured', () => {
    const repo = fresh();
    // Filled from MAX_GOALS rather than a hardcoded three, so the test still
    // tests the cap after the cap moves — and it has moved twice now.
    for (const ex of capSlate(repo)) {
      assert.equal(createGoal(repo, draft({ exerciseId: ex }), T0).ok, true);
    }
    assert.equal(canAddGoal(repo), false);
    const r = createGoal(repo, draft({ exerciseId: 'row' }), T0);
    assert.equal(r.ok, false);
    assert.match(r.error!, /finish or drop one/i);
    assert.equal(repo.goals().length, MAX_GOALS);
  });

  test('deleting frees a slot', () => {
    const repo = fresh();
    const r = createGoal(repo, draft(), T0);
    assert.equal(canAddGoal(repo), true);
    removeGoals(repo, [r.goal!.id]);
    assert.equal(listGoals(repo, T0).length, 0);
  });

  test('one goal per lift', () => {
    const repo = fresh();
    createGoal(repo, draft(), T0);
    assert.match(createGoal(repo, draft(), T0).error!, /already have a goal/i);
  });

  test('the same error speaks Spanish for a Spanish lifter', () => {
    // `measure-goal.ts`'s twin validation error path has always gone through
    // `t()`; this one printed raw English into a Spanish screen until now —
    // `goalErrorMessage` reads `languageOf(repo)` rather than defaulting.
    const repo = fresh();
    repo.setPref('pref.language', 'es');
    createGoal(repo, draft(), T0);
    const r = createGoal(repo, draft(), T0);
    assert.match(r.error!, /ya tienes una meta/i);
    assert.doesNotMatch(r.error!, /already have a goal/i,
      'the Spanish screen must not show the English fallback');
  });
});

describe('goal target suggestion (§4 — no blank fields)', () => {
  test('suggests just above their current best', () => {
    const repo = fresh();
    train(repo, 'squat', 275, 5, 7);
    const t = suggestTarget(repo, 'squat', 5, 'lb');
    assert.ok(t > 275, `suggested ${t}, must be an actual target`);
    assert.equal(t % 10, 0, 'rounds to something a lifter would say out loud');
  });

  test('an untrained lift still gets a number, never a blank', () => {
    const repo = fresh();
    assert.ok(suggestTarget(repo, 'squat', 5, 'lb') > 0);
    assert.ok(suggestTarget(repo, 'squat', 5, 'kg') > 0);
  });

  test('a suggested target is always accepted by validation', () => {
    const repo = fresh();
    train(repo, 'squat', 275, 5, 7);
    const target = suggestTarget(repo, 'squat', 5, 'lb');
    assert.equal(createGoal(repo, draft({ targetWeight: target }), T0).ok, true,
      'the default the UI offers must never be one the rules reject');
  });

  test('ignores sets at fewer reps than the goal', () => {
    const repo = fresh();
    train(repo, 'squat', 400, 1, 7);
    train(repo, 'squat', 275, 5, 6);
    const t = suggestTarget(repo, 'squat', 5, 'lb');
    assert.ok(t < 400, `a 400 single must not set a 5-rep target; got ${t}`);
  });

  /*
   * Checked directly and found missing, the same gap `pr.ts` and `goals.ts`
   * both had this round: a raw max across mixed-unit history could suggest a
   * target far too easy for a lifter who trains in both units — a real
   * ~220 lb (100 kg) squat read as a raw "100" suggests starting at 110.
   */
  test('a kg PR is converted before it becomes an lb suggestion', () => {
    const repo = fresh();
    const sid = 'kgsession';
    repo.startSession(sid, 'kg', undefined, T0 - 7 * DAY);
    repo.logSet({ id: 'kgpr', sessionId: sid, exerciseId: 'squat', weight: 100, reps: 5, at: T0 - 7 * DAY });
    repo.endSession(sid, T0 - 7 * DAY + 30 * MIN);
    const t = suggestTarget(repo, 'squat', 5, 'lb');
    assert.ok(t > 200, `100 kg is ~220.5 lb; suggested ${t} looks like it read the raw "100"`);
  });

  test('every horizon preset is in the future', () => {
    for (const h of HORIZONS) assert.ok(h.days > 0, `${h.label} is not a future date`);
  });
});

describe('goal reps and horizon — presets plus a custom one', () => {
  test('every rep chip is one the app will actually accept', () => {
    // A chip the form then rejects would be the sheet arguing with itself.
    for (const r of REP_CHOICES) {
      assert.ok(r >= 1 && r <= 12, `${r} reps would fail validateNewGoal`);
    }
    assert.ok(REP_CHOICES.length >= 8, 'the row was five chips and looked half empty');
    assert.equal(new Set(REP_CHOICES).size, REP_CHOICES.length, 'no duplicate chips');
    assert.deepEqual([...REP_CHOICES].sort((a, b) => a - b), REP_CHOICES, 'ascending');
  });

  test('the horizons stay ordered and reach a year', () => {
    const days = HORIZONS.map(h => h.days);
    assert.deepEqual([...days].sort((a, b) => a - b), days);
    assert.ok(days.includes(365), 'a year is a normal thing to plan for');
  });

  test('a typed rep count is accepted inside the range', () => {
    assert.equal(customReps('7'), 7);
    assert.equal(customReps(' 11 '), 11);
    assert.equal(customReps('1'), 1);
    assert.equal(customReps('12'), 12);
  });

  /*
   * The field holds TEXT, so every half-typed and junk state has to be a clean
   * "not yet" rather than a number. Committing on the way to 12 would snap the
   * form to a 1-rep goal.
   */
  test('and refuses everything the app could not honour', () => {
    for (const bad of ['', ' ', '0', '13', '99', '-3', '2.5', 'abc', '5x', 'NaN', 'Infinity']) {
      assert.equal(customReps(bad), null, `"${bad}" should not become a goal`);
    }
  });

  test('a horizon is a number in whichever unit was chosen', () => {
    assert.equal(horizonDays('90', 'days'), 90);
    assert.equal(horizonDays('8', 'weeks'), 56);
    assert.equal(horizonDays('3', 'months'), 90, 'the old 3 MONTHS preset, to the day');
    assert.equal(horizonDays('1', 'years'), 365, 'and the old 1 YEAR');
  });

  test('every unit a person actually says a deadline in is offered', () => {
    assert.deepEqual(HORIZON_UNITS, ['days', 'weeks', 'months', 'years']);
    for (const u of HORIZON_UNITS) assert.ok(DAYS_PER[u] >= 1, `${u} has no length`);
  });

  test('and it refuses a horizon that is not a plan', () => {
    for (const bad of ['', '0', '-1', '4.5', 'soon', 'NaN']) {
      assert.equal(horizonDays(bad, 'weeks'), null, `"${bad}" should not become a date`);
    }
  });

  // Two years is the cap, whichever unit you say it in.
  test('the ceiling holds in every unit', () => {
    assert.equal(horizonDays('730', 'days'), 730);
    assert.equal(horizonDays('731', 'days'), null);
    assert.equal(horizonDays('104', 'weeks'), 728);
    assert.equal(horizonDays('105', 'weeks'), null);
    assert.equal(horizonDays('24', 'months'), 720);
    assert.equal(horizonDays('25', 'months'), null);
    assert.equal(horizonDays('2', 'years'), 730);
    assert.equal(horizonDays('3', 'years'), null);
  });

  // A custom value has to survive the same gate the presets do.
  test('a custom goal passes validation end to end', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'a', sessionId: 's1', exerciseId: 'squat', weight: 200, reps: 7, at: T0 - 1000 });
    const reps = customReps('7')!;
    const inDays = horizonDays('8', 'weeks')!;
    const r = createGoal(repo, { exerciseId: 'squat', targetWeight: 245, targetReps: reps, inDays, unit: 'lb' }, T0);
    assert.equal(r.ok, true, r.error ?? '');
    const saved = repo.goals()[0];
    assert.equal(saved.targetReps, 7);
    assert.equal(Math.round((saved.targetDate - T0) / 86_400_000), 56);
  });
});

/*
 * One goal per exercise is enforced at the write, so a lift that already has
 * one is not an option — it is a refusal waiting to happen. With 36 goals set,
 * most chips in the sheet ended at "You already have a goal for this lift",
 * discovered only after choosing a target, a rep count and a deadline, on the
 * tap that was meant to commit. §4: never ask a question it could answer.
 */
describe('the goal sheet does not offer what it would refuse', () => {
  const withGoalOn = (ids: string[]) => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'a', sessionId: 's1', exerciseId: 'squat', weight: 225, reps: 5, at: T0 });
    ids.forEach((ex, n) => repo.saveGoal({
      id: `g${n}`, exerciseId: ex, targetWeight: 315, targetReps: 5,
      targetDate: T0 + 90 * DAY, unit: 'lb', createdAt: T0
    }));
    return repo;
  };

  test('a lift that already has a goal is not offered again', () => {
    const repo = withGoalOn(['squat', 'deadlift']);
    const { trained, rest } = goalLifts(repo, T0 + 1000);
    assert.equal(trained.some(e => e.id === 'squat'), false,
      'squat is trained AND taken — being trained must not smuggle it back in');
    assert.equal(rest.some(e => e.id === 'deadlift'), false);
    assert.ok(rest.some(e => e.id === 'bench'), 'and everything still open is still there');
  });

  test('removing the goal puts the lift back', () => {
    const repo = withGoalOn(['bench']);
    assert.equal(goalLifts(repo, T0 + 1000).rest.some(e => e.id === 'bench'), false);
    repo.deleteGoal('g0');
    assert.ok(goalLifts(repo, T0 + 1000).rest.some(e => e.id === 'bench'),
      'a freed slot has to be offerable again, or the list only ever shrinks');
  });

  /*
   * The end state, which the screen has to say something about rather than
   * showing a form whose only outcome is a refusal.
   */
  /*
   * The half that R39 fixed at the validator and this exclusion nearly undid at
   * the picker. Hitting a 225 squat and wanting 275 is the single most likely
   * next thing a user does; a lift that simply vanishes from the sheet is
   * quieter than the old "you already have a goal for this lift" and no more
   * helpful. A trophy is not a commitment.
   */
  test('a goal already hit does not take the lift out of the sheet', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'a', sessionId: 's1', exerciseId: 'squat', weight: 315, reps: 5, at: T0 });
    repo.saveGoal({
      id: 'g0', exerciseId: 'squat', targetWeight: 225, targetReps: 5,
      targetDate: T0 + 90 * DAY, unit: 'lb', createdAt: T0 - 30 * DAY
    });
    const { trained } = goalLifts(repo, T0 + 1000);
    assert.ok(trained.some(e => e.id === 'squat'),
      'the 225 is done — aiming at 275 must not require deleting the trophy first');
  });

  test('with a goal on everything there is nothing to offer', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    const every = [...repo.exercises().keys()];
    assert.ok(every.length > 20, 'the library has to be seeded for this to mean anything');
    every.forEach((ex, n) => repo.saveGoal({
      id: `g${n}`, exerciseId: ex, targetWeight: 315, targetReps: 5,
      targetDate: T0 + 90 * DAY, unit: 'lb', createdAt: T0
    }));
    const { trained, rest } = goalLifts(repo, T0 + 1000);
    assert.deepEqual([...trained, ...rest], [],
      'the sheet must be able to tell that it has nothing to show');
  });

  test('and inventing a movement gives the sheet something again', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    [...repo.exercises().keys()].forEach((ex, n) => repo.saveGoal({
      id: `g${n}`, exerciseId: ex, targetWeight: 315, targetReps: 5,
      targetDate: T0 + 90 * DAY, unit: 'lb', createdAt: T0
    }));
    repo.addExercise('sled', 'Sled Push');
    const { rest } = goalLifts(repo, T0 + 1000);
    assert.deepEqual(rest.map(e => e.id), ['sled'],
      'the way out of the dead end is a new movement, so it has to appear');
  });
});

describe('the goal sheet offers your lifts before the library', () => {
  test('a new user has no "your lifts" row to show', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    const { trained, rest } = goalLifts(repo, T0);
    assert.deepEqual(trained, [], 'the sheet drops the heading rather than showing it empty');
    assert.ok(rest.length >= 12, 'and the library is still all there');
  });

  test('lifts they actually train lead, and are not repeated below', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'a', sessionId: 's1', exerciseId: 'squat', weight: 225, reps: 5, at: T0 });
    repo.logSet({ id: 'b', sessionId: 's1', exerciseId: 'bench', weight: 185, reps: 5, at: T0 + 1000 });

    const { trained, rest } = goalLifts(repo, T0 + 2000);
    assert.deepEqual(trained.map(e => e.id).sort(), ['bench', 'squat']);
    assert.equal(rest.some(e => e.id === 'squat'), false, 'no lift is in both categories');
    assert.ok(rest.length > 0, 'the alternative is still offered');
  });

  test('together they are the whole library, with nothing lost or duplicated', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'a', sessionId: 's1', exerciseId: 'squat', weight: 225, reps: 5, at: T0 });
    const { trained, rest } = goalLifts(repo, T0 + 1000);
    const all = [...trained, ...rest].map(e => e.id);
    assert.equal(new Set(all).size, all.length, 'duplicate offered');
    assert.equal(all.length, repo.exercises().size);
  });

  test('a movement they invented counts as theirs once trained', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    repo.addExercise('sissy_squat', 'Sissy Squat');
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'a', sessionId: 's1', exerciseId: 'sissy_squat', weight: 200, reps: 8, at: T0 });
    const { trained } = goalLifts(repo, T0 + 1000);
    assert.deepEqual(trained.map(e => e.name), ['Sissy Squat']);
  });
});

/*
 * Until this existed the only way to change a target or push a deadline out was
 * to remove the goal and set a new one — and that quietly threw away the thing
 * the progress bar is measured from.
 */
describe('amending a goal keeps what it has already earned', () => {
  function withProgress() {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    repo.startSession('s0', 'lb');
    // 40 lb into a 60 lb climb: 225 when the goal was set, 265 now, aiming 285.
    repo.logSet({ id: 'a', sessionId: 's0', exerciseId: 'squat', weight: 225, reps: 5, at: T0 - 90 * DAY });
    repo.logSet({ id: 'b', sessionId: 's0', exerciseId: 'squat', weight: 265, reps: 5, at: T0 - DAY });
    repo.saveGoal({
      id: 'g1', exerciseId: 'squat', targetWeight: 285, targetReps: 5,
      targetDate: T0 + 30 * DAY, unit: 'lb', createdAt: T0 - 60 * DAY
    });
    return repo;
  }

  const draft = (over: Partial<GoalDraft> = {}): GoalDraft =>
    ({ exerciseId: 'squat', targetWeight: 285, targetReps: 5, inDays: 120, unit: 'lb', ...over });

  test('pushing the deadline out does not reset the progress bar', () => {
    const repo = withProgress();
    const was = listGoals(repo, T0)[0];
    assert.ok(was.fraction > 0.5, `the fixture is wrong: ${was.fraction}`);

    assert.equal(editGoal(repo, 'g1', draft(), T0).ok, true);
    const now = listGoals(repo, T0)[0];
    assert.equal(now.fraction, was.fraction,
      'recreating the goal would measure from today and read as zero progress');
    assert.equal(now.goal.createdAt, T0 - 60 * DAY, 'the start date is the baseline');
    assert.equal(now.goal.targetDate, T0 + 120 * DAY, 'and the deadline did move');
  });

  test('and the goal keeps its id, so nothing else has to be told', () => {
    const repo = withProgress();
    editGoal(repo, 'g1', draft({ targetWeight: 315 }), T0);
    assert.deepEqual(repo.goals().map(g => g.id), ['g1']);
    assert.equal(repo.goals()[0].targetWeight, 315);
  });

  /*
   * Every edit is a duplicate of itself and, at the cap, one goal too many.
   * Both checks have to skip the goal being amended.
   */
  test('an edit is not refused as a duplicate of itself', () => {
    const repo = withProgress();
    const r = editGoal(repo, 'g1', draft({ targetWeight: 315 }), T0);
    assert.equal(r.ok, true, `the edit was refused: ${r.error}`);
  });

  test('nor as one goal too many when the list is full', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    for (const ex of capSlate(repo)) {
      assert.equal(createGoal(repo, { exerciseId: ex, targetWeight: 300, targetReps: 5,
        inDays: 90, unit: 'lb' }, T0).ok, true);
    }
    assert.equal(canAddGoal(repo), false);
    const first = repo.goals()[0];
    const r = editGoal(repo, first.id, { exerciseId: first.exerciseId, targetWeight: 400,
      targetReps: 5, inDays: 90, unit: 'lb' }, T0);
    assert.equal(r.ok, true, `at the cap an edit was refused: ${r.error}`);
    assert.equal(repo.goals().length, MAX_GOALS, 'and it did not add one');
  });

  test('the rules that make a goal sane still apply', () => {
    const repo = withProgress();
    assert.match(editGoal(repo, 'g1', draft({ targetWeight: 200 }), T0).error!, /already beaten/i,
      '265 is already on the board — 200 is not a target');
    assert.match(editGoal(repo, 'g1', draft({ targetReps: 20 }), T0).error!, /1 and 12/);
    assert.match(editGoal(repo, 'g1', draft({ inDays: -5 }), T0).error!, /future/i);
    assert.equal(repo.goals()[0].targetWeight, 285, 'and nothing was written on the way');
  });

  /*
   * The lift is not editable: a goal is a target ON a lift, so moving it would
   * take the progress baseline to another movement's history.
   */
  test('the lift cannot be changed out from under the goal', () => {
    const repo = withProgress();
    editGoal(repo, 'g1', draft({ exerciseId: 'bench' }), T0);
    assert.equal(repo.goals()[0].exerciseId, 'squat');
  });

  /*
   * Found by editing a real goal in the app: the sheet opened on the 222 that
   * was set, one tap of "+45" saved 185, and nothing on screen said which
   * number the plus button was adding to.
   */
  test('the stepper counts from the target that is set, not from a fresh suggestion', () => {
    const existing = { id: 'g1', exerciseId: 'squat', targetWeight: 222, targetReps: 3,
      targetDate: T0 + 60 * DAY, unit: 'lb' as const, createdAt: T0 - 60 * DAY };
    assert.equal(targetBase(existing, 140), 222,
      'one tap of +45 would have been a 37 lb reduction');
    assert.equal(targetBase(null, 140), 140, 'a new goal still opens on the suggestion');
    assert.equal(targetBase(undefined, 140), 140);
  });

  test('editing a goal that is no longer there says so rather than creating one', () => {
    const repo = withProgress();
    removeGoals(repo, ['g1']);
    const r = editGoal(repo, 'g1', draft(), T0);
    assert.equal(r.ok, false);
    assert.deepEqual(repo.goals(), [], 'a failed edit must not resurrect it');
  });
});

/*
 * Wiping goals, and taking it back.
 *
 * Deletion here is soft, but nothing outside the repo knows that, so a screen
 * offering UNDO would have to reach into the schema to find out what it had
 * just destroyed. `removeGoals` hands back what it took, which makes the
 * reversal identical for one goal and for a hundred.
 */
describe('wiping goals is reversible', () => {
  const goalOn = (ex: string, n: number) => ({
    id: `g_${ex}`, exerciseId: ex, targetWeight: 300 + n, targetReps: 5,
    targetDate: T0 + 90 * DAY, unit: 'lb' as const, createdAt: T0 - (60 + n) * DAY
  });

  function seeded(n: number) {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    capSlate(repo).slice(0, n).forEach((ex, i) => repo.saveGoal(goalOn(ex, i)));
    return repo;
  }

  test('one goal goes, and comes back exactly as it was', () => {
    const repo = seeded(3);
    const before = repo.goals().find(g => g.id === 'g_lift1')!;
    const taken = removeGoals(repo, ['g_lift1']);
    assert.equal(repo.goals().length, 2);
    assert.deepEqual(taken, [before], 'the undo has to carry the whole goal, not just its id');

    assert.equal(restoreGoals(repo, taken), 1);
    assert.deepEqual(repo.goals().find(g => g.id === 'g_lift1'), before);
  });

  /*
   * `createdAt` is the baseline the progress bar measures from, so an undo that
   * RECREATED the goal would hand it back looking untouched — which is not what
   * undo means.
   */
  test('undo keeps the start date, so the bar is where it was', () => {
    const repo = seeded(2);
    const before = repo.goals().find(g => g.id === 'g_lift0')!;
    restoreGoals(repo, removeGoals(repo, ['g_lift0']));
    assert.equal(repo.goals().find(g => g.id === 'g_lift0')!.createdAt, before.createdAt);
  });

  test('all of them go together, and all of them come back', () => {
    const repo = seeded(12);
    const ids = repo.goals().map(g => g.id);
    const taken = removeGoals(repo, ids);
    assert.equal(taken.length, 12);
    assert.deepEqual(repo.goals(), [], 'wipe all has to mean all');
    assert.equal(restoreGoals(repo, taken), 12);
    assert.equal(repo.goals().length, 12);
  });

  test('an id that is already gone is skipped, not an error', () => {
    const repo = seeded(2);
    removeGoals(repo, ['g_lift0']);
    assert.deepEqual(removeGoals(repo, ['g_lift0']), [],
      'a double tap on WIPE must not throw');
    assert.equal(repo.goals().length, 1);
  });

  test('wiping does not touch the sets behind the goals', () => {
    const repo = seeded(2);
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'x1', sessionId: 's1', exerciseId: 'lift0', weight: 225, reps: 5, at: T0 });
    removeGoals(repo, repo.goals().map(g => g.id));
    assert.equal(repo.allSets().length, 1, 'the targets go; the training does not');
  });

  /*
   * The cap is enforced at the write. An undo attempted after the freed slots
   * have been refilled restores what fits and REPORTS the shortfall, rather
   * than throwing on the user's behalf or silently dropping goals.
   */
  test('an undo that no longer fits says how much came back', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    const slate = capSlate(repo);
    slate.forEach((ex, i) => repo.saveGoal(goalOn(ex, i)));
    assert.equal(repo.goals().length, MAX_GOALS);

    const taken = removeGoals(repo, ['g_lift0', 'g_lift1']);
    // Both freed slots taken by something else before the undo is tapped.
    repo.addExercise('newA', 'New A');
    repo.addExercise('newB', 'New B');
    repo.saveGoal(goalOn('newA', 900));
    repo.saveGoal(goalOn('newB', 901));

    assert.equal(restoreGoals(repo, taken), 0, 'there is no room, and that is not a crash');
    assert.equal(repo.goals().length, MAX_GOALS, 'and the cap still holds');
  });

  test('restoring an empty list is a no-op', () => {
    const repo = seeded(2);
    assert.equal(restoreGoals(repo, []), 0);
    assert.equal(repo.goals().length, 2);
  });

  /*
   * R581. `restoreGoals` is an upsert with no memory of WHY the goal it is
   * given no longer exists — it cannot tell "wiped a second ago, undo makes
   * sense" from "the device was erased on purpose a minute ago, undo must
   * not." Pinned here as a fact about this function, not a bug in it: the
   * function is a correct, general primitive, and the guarantee that a
   * post-erase undo can never reach it lives in the SCREEN (`app/goals.tsx`'s
   * `useFocusEffect`, which clears `undo` the moment the screen is not the
   * one that has been on screen the whole time), not here.
   *
   * If this test ever starts failing an expectation of "erase wins," that is
   * the signal to push the guard down into `restoreGoals` itself rather than
   * rely on the screen alone.
   *
   * A BUILTIN exercise on purpose, not `seeded()`'s cap-testing fixture:
   * those use `addExercise`, real custom exercises `eraseAll` genuinely
   * deletes, so `saveGoal` inside `restoreGoals`'s try/catch throws for a
   * different reason (the exercise is gone) and the real point -- that the
   * GOAL ROW ITSELF comes back with no memory of the erase -- never gets
   * isolated. `bench` survives erase (`seedBuiltins` puts it straight back).
   */
  test('an upsert cannot tell an erase from an ordinary gap (documented, not fixed here)', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
    repo.saveGoal({ id: 'g1', exerciseId: 'bench', targetWeight: 225, targetReps: 5,
      createdAt: T0, targetDate: T0 + 90 * DAY, unit: 'lb' });
    const taken = removeGoals(repo, ['g1']);
    repo.eraseAll();
    assert.equal(repo.goals().length, 0, "erase said 'cannot be undone'");
    const back = restoreGoals(repo, taken);
    assert.equal(back, 1,
      'restoreGoals stopped being a plain upsert -- if it now refuses this on ' +
      'purpose, delete this test and the useFocusEffect guard becomes redundant belt-and-braces');
  });
});

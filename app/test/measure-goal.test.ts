import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { SCHEMA_VERSION } from '../src/data/schema.ts';
import type { Measurement } from '../src/domain/measure.ts';
import {
  measureGoalProgress, validateMeasureGoal, measureGoalLine, directionOf,
  type MeasureGoal
} from '../src/domain/measure-goal.ts';

const DAY = 86_400_000;
const T = Date.UTC(2026, 7, 22, 8);

const weighed = (value: number, daysAgo: number, unit: 'lb' | 'kg' = 'lb'): Measurement =>
  ({ id: `w${daysAgo}_${value}`, kind: 'bodyweight', value, unit, at: T - daysAgo * DAY });

const goal = (over: Partial<MeasureGoal> = {}): MeasureGoal => ({
  id: 'g1', kind: 'bodyweight', target: 175, unit: 'lb',
  targetDate: T + 90 * DAY, createdAt: T - 60 * DAY, ...over
});

/*
 * Everything in `goals.ts` assumes a target you climb toward. Half the
 * bodyweight targets anyone would set point the other way, and the old maths
 * did not merely get them wrong — `Math.max(0, target - start)` makes the span
 * zero, so a losing goal read as either 0% or 100% for ever.
 */
describe('a goal can point downward', () => {
  const losing = [weighed(200, 70), weighed(190, 30), weighed(185, 1)];

  test('the direction comes from where they were when they set it', () => {
    assert.equal(directionOf(goal(), losing), 'down');
    assert.equal(directionOf(goal({ target: 215 }), losing), 'up');
  });

  test('progress counts the distance actually covered', () => {
    const p = measureGoalProgress(goal(), losing, T);
    assert.equal(p.start, 200, 'what they weighed when they set it');
    assert.equal(p.current, 185);
    assert.equal(p.remaining, 10, '185 down to 175');
    assert.equal(p.fraction, 0.6, '15 of the 25 lb');
  });

  test('and a gaining goal counts the same way in the other direction', () => {
    const gaining = [weighed(150, 70), weighed(160, 1)];
    const p = measureGoalProgress(goal({ target: 175 }), gaining, T);
    assert.equal(p.direction, 'up');
    assert.equal(p.remaining, 15);
    assert.equal(p.fraction, 0.4);
  });

  /*
   * Direction is fixed at creation on purpose. Somebody who set out to lose
   * weight and gained four pounds has not changed their mind, and a goal that
   * re-read its direction would show them as making progress in the direction
   * they are trying to leave.
   */
  test('going the wrong way does not flip the goal round', () => {
    const wrongWay = [weighed(200, 70), weighed(206, 1)];
    const p = measureGoalProgress(goal(), wrongWay, T);
    assert.equal(p.direction, 'down');
    assert.equal(p.fraction, 0, 'clamped at zero, not reported as negative progress');
    assert.equal(p.remaining, 31);
  });

  test('progress never runs past the end', () => {
    const overshot = [weighed(200, 70), weighed(160, 1)];
    const p = measureGoalProgress(goal(), overshot, T);
    assert.equal(p.fraction, 1);
    assert.equal(p.remaining, 0, 'past the target is not negative distance');
  });
});

/*
 * The distinction this feature exists to get right.
 *
 * A 315 squat is yours the moment you stand it up; being 175 lb in June does
 * not make you 175 lb in August. Measuring a bodyweight goal the way an
 * exercise goal is measured — on the best reading ever — would let the app
 * congratulate somebody on a state they are no longer in.
 */
describe('a lift is what you did, a bodyweight is what you are', () => {
  const there_and_back = [weighed(200, 70), weighed(174, 30), weighed(182, 1)];

  test('achieved reads the latest reading, not the best one', () => {
    const p = measureGoalProgress(goal(), there_and_back, T);
    assert.equal(p.current, 182);
    assert.equal(p.achieved, false, 'they are not there now');
  });

  test('but getting there is still remembered', () => {
    const p = measureGoalProgress(goal(), there_and_back, T);
    assert.equal(p.reachedAt, T - 30 * DAY, 'the day they first hit it');
  });

  test('and both are true at once when they are still there', () => {
    const p = measureGoalProgress(goal(), [weighed(200, 70), weighed(174, 2)], T);
    assert.equal(p.achieved, true);
    assert.equal(p.reachedAt, T - 2 * DAY);
  });

  test('a reading from before the goal existed cannot claim it', () => {
    // They were 174 once, months before deciding to get there from 200.
    const before = [weighed(174, 90), weighed(200, 61), weighed(190, 1)];
    const p = measureGoalProgress(goal({ createdAt: T - 60 * DAY }), before, T);
    assert.equal(p.start, 200, 'the baseline is the reading the goal was set against');
    assert.equal(p.reachedAt, null, 'the goal is about what happens after you set it');
  });
});

/*
 * §16 — a number the user cannot check is one they cannot trust, and the scale
 * itself cannot resolve past a tenth.
 */
describe('close enough is close enough', () => {
  test('inside the noise floor counts as there', () => {
    const p = measureGoalProgress(goal(), [weighed(200, 70), weighed(175.4, 1)], T);
    assert.equal(p.achieved, true, 'arguing about 0.4 lb is arguing with the scale');
  });

  test('a pound out is a pound out', () => {
    const p = measureGoalProgress(goal(), [weighed(200, 70), weighed(177, 1)], T);
    assert.equal(p.achieved, false);
    assert.equal(p.remaining, 2);
  });
});

describe('two units, one target', () => {
  test('a kilo scale against a pound target', () => {
    const kg = [weighed(91, 70, 'kg'), weighed(84, 1, 'kg')];
    const p = measureGoalProgress(goal({ target: 175, unit: 'lb' }), kg, T);
    assert.equal(p.start, 200.6, '91 kg in pounds');
    assert.equal(p.current, 185.2);
    assert.equal(p.direction, 'down');
  });
});

/*
 * The guard rails, and the one they do NOT have.
 */
describe('what the app will and will not accept', () => {
  const now = T;
  const history = [weighed(200, 10)];
  const created = { createdAt: T - 5 * DAY };

  test('a target you are already at is not a goal', () => {
    assert.equal(
      validateMeasureGoal(goal({ target: 200, ...created }), history, [], now), 'already-there');
  });

  test('with nothing on record there is nothing to measure from', () => {
    assert.equal(validateMeasureGoal(goal(created), [], [], now), 'no-reading');
  });

  test('one per kind', () => {
    const existing = [goal({ id: 'other', ...created })];
    assert.equal(
      validateMeasureGoal(goal({ id: 'new', ...created }), history, existing, now), 'duplicate');
    assert.equal(
      validateMeasureGoal(goal({ id: 'other', ...created }), history, existing, now), null,
      'editing the one you have is not a duplicate of itself');
  });

  test('a date in the past', () => {
    assert.equal(
      validateMeasureGoal(goal({ targetDate: T - DAY, ...created }), history, [], now),
      'past-date');
  });

  /*
   * The same trap R138 found in `plausible`: bounds that are not unit-aware are
   * decorative. 400 is an ordinary target in pounds and 881 lb in kilos, and a
   * check that compared the raw number would wave both through.
   */
  test('a typo in the unit box is caught, in the unit it was typed in', () => {
    assert.equal(
      validateMeasureGoal(goal({ target: 400, unit: 'kg', ...created }), history, [], now),
      'implausible', '400 kg is 881 lb');
    assert.equal(
      validateMeasureGoal(goal({ target: 400, unit: 'lb', ...created }), history, [], now),
      null, 'the same number in pounds is an ordinary target');
  });

  /*
   * Deliberate: the bounds are `plausible()`'s bounds and nothing more. They
   * exist to catch a target typed into the wrong unit box, not to approve or
   * reject anybody's plan. An app with no knowledge of the person is not
   * qualified to have an opinion about their target.
   */
  test('and an ordinary target is simply accepted', () => {
    assert.equal(validateMeasureGoal(goal(created), history, [], now), null);
  });
});

/*
 * §5 — a goal earns its place by feeding the output. That obligation does not
 * lapse because the goal is about the lifter.
 */
describe('the sentence', () => {
  const line = (all: Measurement[], g = goal()) =>
    measureGoalLine(measureGoalProgress(g, all, T));

  test('the distance, with a direction', () => {
    assert.equal(line([weighed(200, 70), weighed(185, 1)]), '10 lb to 175 lb');
  });

  test('arriving says so', () => {
    assert.match(line([weighed(200, 70), weighed(174, 1)])!, /you are there/);
  });

  test('reached it, then left it, names the date rather than re-baselining them', () => {
    // Down to 174 (under the 175 target) 20 days ago, back up to 180 since.
    // `achieved` is false today, but pretending they have never been there
    // discards a true fact the app already has.
    const l = line([weighed(200, 70), weighed(174, 20), weighed(180, 1)]);
    assert.match(l!, /Hit 175 lb on/, 'names the target and that it was reached');
    assert.match(l!, /5 lb back to it/, 'and the distance back, not a fresh "to go"');
    assert.doesNotMatch(l!, /^5 lb to 175 lb$/, 'must not read as a first-time approach');
  });

  test('nothing to say with nothing on record', () => {
    assert.equal(line([]), null);
  });

  /*
   * There is no pace judgement here and that is the decision, not an omission.
   * "Behind pace" is the right sentence for a lift and the wrong one for a
   * bodyweight: it would be an app with no knowledge of the person urging them
   * to lose faster.
   */
  test('and never a grade', () => {
    const slow = line([weighed(200, 70), weighed(199, 1)])!;
    assert.doesNotMatch(slow, /behind|pace|ahead|on track|should/i);
  });
});

/*
 * Persistence, including the part of a schema change that can actually hurt.
 */
describe('targets survive the app closing', () => {
  const fresh = () => new Repo(new DatabaseSync(':memory:') as any, () => T);

  test('the schema knows about them', () => {
    assert.ok(SCHEMA_VERSION >= 6, 'measurement goals arrived in v6');
    const repo = fresh();
    repo.saveMeasureGoal(goal());
    assert.deepEqual(repo.measureGoals(), [goal()]);
  });

  test('editing keeps the created date, so progress keeps its baseline', () => {
    const repo = fresh();
    repo.saveMeasureGoal(goal());
    repo.saveMeasureGoal(goal({ target: 170 }));
    assert.equal(repo.measureGoals().length, 1);
    assert.equal(repo.measureGoals()[0].target, 170);
    assert.equal(repo.measureGoals()[0].createdAt, T - 60 * DAY,
      'losing this would re-baseline the goal to today and empty the bar');
  });

  test('a second target for the same kind is refused at the write', () => {
    const repo = fresh();
    repo.saveMeasureGoal(goal());
    assert.throws(() => repo.saveMeasureGoal(goal({ id: 'g2', target: 160 })));
  });

  test('but a different kind is fine', () => {
    const repo = fresh();
    repo.saveMeasureGoal(goal());
    repo.saveMeasureGoal(goal({ id: 'h', kind: 'height', target: 72, unit: 'in' }));
    assert.equal(repo.measureGoals().length, 2);
  });

  test('deleting frees the kind again', () => {
    const repo = fresh();
    repo.saveMeasureGoal(goal());
    repo.deleteMeasureGoal('g1');
    assert.deepEqual(repo.measureGoals(), []);
    repo.saveMeasureGoal(goal({ id: 'g2', target: 165 }));
    assert.equal(repo.measureGoals().length, 1);
  });

  test('the read cannot go stale', () => {
    const repo = fresh();
    assert.deepEqual(repo.measureGoals(), []);
    repo.saveMeasureGoal(goal());
    assert.equal(repo.measureGoals().length, 1, 'the empty read was cached and never dropped');
  });

  test('erasing everything erases these too', () => {
    const repo = fresh();
    repo.saveMeasureGoal(goal());
    repo.measureGoals();
    repo.eraseAll();
    assert.deepEqual(repo.measureGoals(), []);
  });

  /*
   * The upgrade. A fresh install runs every migration and cannot tell you
   * whether the new one composes with existing data.
   */
  test('a v5 database gains the table and keeps everything it held', () => {
    const db = new DatabaseSync(':memory:') as any;
    const before = new Repo(db, () => T);
    before.startSession('s1', 'lb');
    before.logSet({
      id: 'x1', sessionId: 's1', exerciseId: 'bench', weight: 145, reps: 8, at: T });
    before.saveMeasurement({ id: 'm', kind: 'bodyweight', value: 200, unit: 'lb', at: T });
    db.prepare('UPDATE meta SET value = ? WHERE key = ?').run('5', 'schema_version');
    db.exec('DROP TABLE IF EXISTS measure_goals');

    const after = new Repo(db, () => T);
    assert.equal(after.allSets().length, 1, 'the sets survived');
    assert.equal(after.measurements().length, 1, 'the readings survived');
    assert.deepEqual(after.measureGoals(), [], 'and the new table is there, empty');
    after.saveMeasureGoal(goal());
    assert.equal(after.measureGoals().length, 1, 'and usable');
  });
});

/*
 * The screen wiring: `measureRows` is what the YOU screen renders from, so the
 * target has to arrive ON the row or the feature exists only in the store.
 */
describe('the row carries its own target', () => {
  const fresh = () => new Repo(new DatabaseSync(':memory:') as any, () => T);

  test('a bodyweight target shows up as progress and a sentence', async () => {
    const { measureRows, TARGETABLE } = await import('../src/ui/measure-model.ts');
    const repo = fresh();
    repo.saveMeasurement({ id: 'w0', kind: 'bodyweight', value: 200, unit: 'lb', at: T - 70 * DAY });
    repo.saveMeasurement({ id: 'w1', kind: 'bodyweight', value: 185, unit: 'lb', at: T - DAY });
    repo.saveMeasureGoal(goal());
    const row = measureRows(repo, T).find(r => r.kind === 'bodyweight')!;
    assert.equal(row.goal!.fraction, 0.6);
    assert.equal(row.goalLine, '10 lb to 175 lb');
    assert.ok(TARGETABLE.has('bodyweight'));
  });

  test('no target means a null, not a placeholder', async () => {
    const { measureRows } = await import('../src/ui/measure-model.ts');
    const repo = fresh();
    repo.saveMeasurement({ id: 'w', kind: 'bodyweight', value: 185, unit: 'lb', at: T - DAY });
    const row = measureRows(repo, T).find(r => r.kind === 'bodyweight')!;
    assert.equal(row.goal, null);
    assert.equal(row.goalLine, null);
  });

  /*
   * Height is tracked and deliberately NOT targetable: a target is a thing you
   * work toward, and effort does not move an adult's height. The one person
   * whose height moves does not need a deadline on puberty.
   */
  test('height cannot be targeted from the screen', async () => {
    const { TARGETABLE } = await import('../src/ui/measure-model.ts');
    assert.ok(!TARGETABLE.has('height'));
  });

  test('the sheet round-trip: suggest, save, line appears, clear', async () => {
    const { saveMeasureGoal, clearMeasureGoal, suggestTarget, measureRows } =
      await import('../src/ui/measure-model.ts');
    const repo = fresh();
    repo.saveMeasurement({ id: 'w', kind: 'bodyweight', value: 187, unit: 'lb', at: T - DAY });

    assert.equal(suggestTarget(repo, 'bodyweight', 'lb', T), '180',
      'a round number a short step away, in the direction most people head');

    const r = saveMeasureGoal(repo, 'bodyweight', '175', 'lb', T + 90 * DAY, T);
    assert.equal(r.ok, true);
    assert.equal(measureRows(repo, T).find(x => x.kind === 'bodyweight')!.goalLine,
      '12 lb to 175 lb');

    // Editing keeps the baseline: the id and createdAt survive a change.
    const before = repo.measureGoals()[0];
    saveMeasureGoal(repo, 'bodyweight', '170', 'lb', T + 120 * DAY, T + 10 * DAY);
    const after = repo.measureGoals()[0];
    assert.equal(after.id, before.id);
    assert.equal(after.createdAt, before.createdAt, 'a tweak must not re-baseline the bar');
    assert.equal(after.target, 170);

    clearMeasureGoal(repo, 'bodyweight');
    assert.deepEqual(repo.measureGoals(), []);
  });

  test('a rejected target comes back as a sentence, not a throw', async () => {
    const { saveMeasureGoal } = await import('../src/ui/measure-model.ts');
    const repo = fresh();
    const r = saveMeasureGoal(repo, 'bodyweight', '175', 'lb', T + 90 * DAY, T);
    assert.equal(r.ok, false);
    assert.match(r.error!, /Record where you are first/);
  });
});

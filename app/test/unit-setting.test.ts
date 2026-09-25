import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { PREF_UNIT } from '../src/ui/display-unit.ts';
import { unitForNewSession } from '../src/domain/coldstart.ts';

const T = Date.UTC(2026, 7, 24, 9);
const fresh = () => new Repo(new DatabaseSync(':memory:') as any, () => T);

/*
 * The UNITS control in Settings wrote `pref.unit` and **nothing in the app ever
 * read it**. The chips lit, the conversion example redrew, and every session
 * afterwards started in the old unit for ever — `lastUsedUnit` is sticky and
 * there was no other way in. Two taps that changed nothing but their own
 * highlight, on a setting that governs every number in the product.
 */
describe('choosing a unit changes what the app uses', () => {
  test('an explicit choice outranks what they last trained in', () => {
    assert.equal(unitForNewSession('lb', 'en-US', 'kg'), 'kg');
    assert.equal(unitForNewSession('kg', 'de-DE', 'lb'), 'lb');
  });

  test('with no choice made, nothing about the old behaviour moves', () => {
    assert.equal(unitForNewSession('kg', 'en-US'), 'kg', 'their history still wins the locale');
    assert.equal(unitForNewSession(null, 'en-US'), 'lb');
    assert.equal(unitForNewSession(null, 'de-DE'), 'kg');
    assert.equal(unitForNewSession(null, 'en-US', null), 'lb', 'an unset choice is not a choice');
  });

  test('a new session opens in the chosen unit', () => {
    const repo = fresh();
    repo.setPref(PREF_UNIT, 'kg');
    assert.equal(new NowModel(repo, () => T, 'en-US').state().session.unit, 'kg',
      'a US locale must not override the answer they typed in');
  });

  test('and it beats a long history in the other unit', () => {
    const repo = fresh();
    repo.startSession('old', 'lb');
    repo.logSet({ id: 'x', sessionId: 'old', exerciseId: 'bench', weight: 225, reps: 5, at: T - 1000 });
    repo.endSession('old', T - 900);
    repo.setPref(PREF_UNIT, 'kg');
    assert.equal(new NowModel(repo, () => T, 'en-US').state().session.unit, 'kg');
  });
});

/*
 * The second half, and the one that would have made the fix look broken again:
 * opening the app starts a session immediately, so going to Settings, choosing
 * kg and coming back lands on the SAME lb session. The setting appears to do
 * nothing a second time, and the whole workout gets logged in the unit they
 * just rejected.
 */
describe('an untouched workout takes up the new unit', () => {
  test('a session with nothing in it is restarted', () => {
    const repo = fresh();
    const m = new NowModel(repo, () => T, 'en-US');
    assert.equal(m.state().session.unit, 'lb');
    repo.setPref(PREF_UNIT, 'kg');
    assert.equal(m.adoptChosenUnit(), true);
    assert.equal(m.state().session.unit, 'kg');
  });

  /*
   * The line this must not cross. 100 logged in pounds is not 100 kilos, and
   * this app never rewrites a weight it was given — so a workout that has
   * started keeps the unit it was born with.
   */
  test('a session with a set in it keeps the unit that set was logged in', () => {
    const repo = fresh();
    const m = new NowModel(repo, () => T, 'en-US');
    m.selectExercise('bench');
    m.setWeight(225);
    m.setReps(5);
    m.log();
    repo.setPref(PREF_UNIT, 'kg');
    assert.equal(m.adoptChosenUnit(), false);
    assert.equal(m.state().session.unit, 'lb', 'the 225 they logged is still 225 lb');
  });

  test('the set survives the refusal', () => {
    const repo = fresh();
    const m = new NowModel(repo, () => T, 'en-US');
    m.selectExercise('bench');
    m.setWeight(225);
    m.setReps(5);
    m.log();
    repo.setPref(PREF_UNIT, 'kg');
    m.adoptChosenUnit();
    assert.equal(repo.allSets().length, 1);
    assert.equal(repo.allSets()[0].weight, 225);
  });

  test('choosing the unit it is already in does nothing at all', () => {
    const repo = fresh();
    const m = new NowModel(repo, () => T, 'en-US');
    const before = m.state().session.id;
    repo.setPref(PREF_UNIT, 'lb');
    assert.equal(m.adoptChosenUnit(), false);
    assert.equal(m.state().session.id, before, 'no churn for a no-op');
  });

  /*
   * The empty shell is ended rather than abandoned: two live sessions is a
   * state `liveSession()` cannot describe, and an open empty one would still
   * own "the most recent unit".
   */
  test('the abandoned session does not stay open', () => {
    const repo = fresh();
    const m = new NowModel(repo, () => T, 'en-US');
    const old = m.state().session.id;
    repo.setPref(PREF_UNIT, 'kg');
    m.adoptChosenUnit();
    assert.notEqual(m.state().session.id, old);
    assert.notEqual(repo.session(old)!.endedAt, null, 'the shell was left live');
  });

  test('calling it with no preference set is a no-op', () => {
    const repo = fresh();
    const m = new NowModel(repo, () => T, 'en-US');
    assert.equal(m.adoptChosenUnit(), false);
  });
});

/*
 * The bug the fix above exposed, found by switching units on the running app.
 *
 * A `LoggedSet` carries no unit — the session owns it — so any function reading
 * `set.weight` against a different session's unit is out by a factor of 2.2.
 * Nothing hit that while the unit could never change. The moment the Settings
 * control started working, the first screen after it offered a lifter with
 * 195 lb squats a prefill of **195 kg**: 430 lb, presented as "same as last
 * time", which is §4's whole promise pointed at a number nobody could lift.
 */
describe('history read in another unit is converted, not relabelled', () => {
  function withLbHistory() {
    const repo = fresh();
    repo.startSession('old', 'lb');
    repo.logSet({ id: 'x', sessionId: 'old', exerciseId: 'squat', weight: 195, reps: 5, at: T - 5000 });
    repo.endSession('old', T - 4000);
    return repo;
  }

  test('an lb set prefills a kg session as kilos', () => {
    const repo = withLbHistory();
    repo.setPref(PREF_UNIT, 'kg');
    const m = new NowModel(repo, () => T, 'en-US');
    m.selectExercise('squat');
    const st = m.state();
    assert.equal(st.session.unit, 'kg');
    assert.equal(st.weight, 88.5, '195 lb is 88.5 kg, not "195 kg"');
    assert.equal(st.reps, 5, 'the reps are a count and never convert');
  });

  test('and the stored set is untouched', () => {
    const repo = withLbHistory();
    repo.setPref(PREF_UNIT, 'kg');
    new NowModel(repo, () => T, 'en-US').selectExercise('squat');
    assert.equal(repo.allSets()[0].weight, 195,
      'converting for display must never write back — 195 lb stays 195 lb');
  });

  test('the other direction too', () => {
    const repo = fresh();
    repo.startSession('old', 'kg');
    repo.logSet({ id: 'x', sessionId: 'old', exerciseId: 'squat', weight: 100, reps: 5, at: T - 5000 });
    repo.endSession('old', T - 4000);
    repo.setPref(PREF_UNIT, 'lb');
    const m = new NowModel(repo, () => T, 'en-US');
    m.selectExercise('squat');
    assert.equal(m.state().weight, 220.5, '100 kg is 220.5 lb');
  });

  test('a single-unit history is handed through untouched', () => {
    const repo = withLbHistory();
    const m = new NowModel(repo, () => T, 'en-US');
    m.selectExercise('squat');
    assert.equal(m.state().weight, 195, 'no conversion, no rounding, no drift');
  });

  test('sessionUnits maps every session, live ones included', () => {
    const repo = withLbHistory();
    repo.setPref(PREF_UNIT, 'kg');
    const m = new NowModel(repo, () => T, 'en-US');
    const units = repo.sessionUnits();
    assert.equal(units.get('old'), 'lb');
    assert.equal(units.get(m.state().session.id), 'kg',
      'a session started after the map was last read must still be in it');
  });
});

/*
 * Everything on the logging screen has to agree with the hero above it. These
 * are the two lines that did not: the "last time" subtitle describes the SAME
 * set the hero prefills from, and the goal hint sits beside both.
 */
describe('one screen, one unit', () => {
  function kgOverLb() {
    const repo = fresh();
    repo.startSession('old', 'lb');
    repo.logSet({ id: 'x', sessionId: 'old', exerciseId: 'squat', weight: 195, reps: 5, at: T - 5000 });
    repo.endSession('old', T - 4000);
    repo.saveGoal({
      id: 'g', exerciseId: 'squat', targetWeight: 225, targetReps: 5,
      targetDate: T + 90 * 86_400_000, unit: 'lb', createdAt: T - 6000
    });
    repo.setPref(PREF_UNIT, 'kg');
    const m = new NowModel(repo, () => T, 'en-US');
    m.selectExercise('squat');
    return m;
  }

  test('the subtitle names the same number as the hero', () => {
    const st = kgOverLb().state();
    assert.equal(st.weight, 88.5);
    assert.match(st.lastTime.head, /88\.5/,
      'the hero and the line under it describe one set and must not disagree');
    assert.doesNotMatch(st.lastTime.head, /195/);
  });

  test('the goal is shown in the unit being lifted in', () => {
    const st = kgOverLb().state();
    assert.equal(st.lastTime.tail.includes('225'), false,
      'an lb target printed under a kg hero is a number nobody can compare');
    // 225 lb is 102 kg; 195 lb is 88.5 kg, so 13.5 kg to go.
    assert.match(st.lastTime.tail, /102/);
  });

  test('and a matching-unit goal is left exactly alone', () => {
    const repo = fresh();
    repo.startSession('old', 'lb');
    repo.logSet({ id: 'x', sessionId: 'old', exerciseId: 'squat', weight: 195, reps: 5, at: T - 5000 });
    repo.endSession('old', T - 4000);
    repo.saveGoal({
      id: 'g', exerciseId: 'squat', targetWeight: 225, targetReps: 5,
      targetDate: T + 90 * 86_400_000, unit: 'lb', createdAt: T - 6000
    });
    const m = new NowModel(repo, () => T, 'en-US');
    m.selectExercise('squat');
    const st = m.state();
    assert.match(st.lastTime.head, /195/);
    assert.match(st.lastTime.tail, /225/, 'no conversion means no rounding and no drift');
  });
});

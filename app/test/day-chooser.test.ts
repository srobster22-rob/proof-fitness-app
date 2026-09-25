import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { IDLE_END_MS } from '../src/domain/session.ts';
import { region } from './helpers/source.ts';
import { nowScreenSource } from './helpers/now-screen.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T = Date.UTC(2026, 7, 24, 9);
const fresh = () => new Repo(new DatabaseSync(':memory:') as any, () => T);

/**
 * "TODAY IS" opened for the first workout after a cold launch and for no other,
 * ever.
 *
 * `dayOpen` was a lazy `useState` initializer, this screen is the stack's entry
 * route and is never unmounted (recap and progress are pushed ON TOP of it),
 * and the only other calls were `setDayOpen(false)`. So: finish a workout, tap
 * DONE, and the fresh session `startNextIfFinished` creates was never asked.
 * Every workout but the first ran day-less — the picker lost its grouping and
 * the rail fell back to inference, precisely what asking first was built to
 * prevent. The comment above the state claimed "once per workout, not once per
 * launch"; the code did the opposite.
 *
 * The condition the screen renders on is `!dayAsked && !justFinished &&
 * loggedThisSession === 0`, all of which come from the model, so it is the
 * model that has to be right across a finish — and then the screen has to keep
 * deriving rather than remembering. `justFinished` (R679) holds the question
 * back for the minutes right after DONE; finishing-leaves-the-tabs-reachable
 * .test.ts is about that half.
 */
describe('the day question follows the workout, not the app launch', () => {
  const asks = (m: NowModel) => {
    const st = m.state();
    return !st.dayAsked && !st.justFinished && st.loggedThisSession.length === 0;
  };

  test('a fresh session is asked', () => {
    assert.equal(asks(new NowModel(fresh(), () => T, 'en-US')), true);
  });

  test('answering closes it for that session', () => {
    const m = new NowModel(fresh(), () => T, 'en-US');
    m.setDay('push');
    assert.equal(asks(m), false);
  });

  test('skipping closes it too, and stays closed', () => {
    const m = new NowModel(fresh(), () => T, 'en-US');
    m.skipDay();
    assert.equal(asks(m), false);
  });

  /*
   * The bug, stated as the invariant it broke.
   */
  test('the NEXT workout is asked again', () => {
    const clock = { now: T };
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => clock.now);
    const m = new NowModel(repo, () => clock.now, 'en-US');
    m.setDay('push');
    m.selectExercise('bench');
    m.log();
    assert.equal(asks(m), false, 'answered and training — nothing to ask');

    m.finish();
    assert.equal(m.startNextIfFinished(), true, 'DONE on the recap starts the next workout');
    // Not in the minutes after DONE (R679), but when they come back to train.
    clock.now += IDLE_END_MS + 60_000;
    assert.equal(asks(m), true,
      'a new workout is a new day, and the answer is stored per session on purpose');
  });

  test('and the new session did not inherit the old answer', () => {
    const repo = fresh();
    const m = new NowModel(repo, () => T, 'en-US');
    m.setDay('legs');
    m.selectExercise('squat');
    m.log();
    m.finish();
    m.startNextIfFinished();
    assert.equal(m.chosenDay(), null,
      '"today is legs day" is a fact about one workout, not about the week');
  });

  test('a session with a set but no answer is left alone', () => {
    // Mid-workout is the wrong moment to interrupt: they are already lifting,
    // and the rail can infer the day from what they have done.
    const m = new NowModel(fresh(), () => T, 'en-US');
    m.selectExercise('bench');
    m.log();
    assert.equal(asks(m), false);
  });
});

/*
 * The screen half. The condition above is only right if the component keeps
 * deriving it — a second copy in `useState` is what caused this.
 */
describe('the screen derives the question rather than remembering it', () => {
  const src = nowScreenSource();
  // The comment explaining the fix quotes the thing the fix removed, so it has
  // to come out before matching — the same trap `contrast.test.ts` hit when its
  // guard failed on the note explaining why a colour was deleted.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

  test('dayOpen is computed every render', () => {
    assert.match(code, /const dayOpen = !state\.dayAsked && !state\.justFinished && state\.loggedThisSession\.length === 0;/,
      'a stored copy cannot be re-evaluated when the session changes underneath it');
  });

  test('nothing can set it, because there is nothing to set', () => {
    assert.doesNotMatch(code, /setDayOpen/,
      'a setter means a second source of truth, and the model already owns this');
  });

  test('both dismissals still tell the model, which is what persists', () => {
    const sheet = region(code, '{dayOpen && (', '/>');
    assert.match(sheet, /model\.setDay\(d\)/);
    assert.match(sheet, /model\.skipDay\(\)/);
  });
});

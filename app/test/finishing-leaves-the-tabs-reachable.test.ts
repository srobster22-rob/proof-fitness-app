import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { IDLE_END_MS } from '../src/domain/session.ts';

const T0 = Date.UTC(2026, 8, 22, 18);

/*
 * R679, from PT0. DONE on the recap begins the next session at once, and a
 * session nobody had been asked about opened the "TODAY IS" sheet over the tab
 * bar. Someone who had just finished and wanted to look at Progress had to
 * answer, or skip, a question about a workout they had not started. Tapping
 * PROGRESS did nothing.
 *
 * The next workout is still asked, as day-chooser.test.ts requires. It is asked
 * when the lifter comes back to train, not in the minutes after finishing.
 */

/** What the Now screen renders the day sheet on (`dayOpen` in NowScreen.tsx). */
const sheetOpen = (m: NowModel) => {
  const st = m.state();
  return !st.dayAsked && !st.justFinished && st.loggedThisSession.length === 0;
};

/** A lifter who trains push day at T0, finishes, and taps DONE on the recap. */
function finishedAt(clock: { now: number }) {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => clock.now);
  const m = new NowModel(repo, () => clock.now, 'en-US');
  m.setPlan('ppl');
  m.setDay('push');
  m.selectExercise('bench');
  m.log();
  clock.now += 20 * 60_000;           // the rest of the workout
  m.log();
  m.finish();
  m.startNextIfFinished();            // what DONE does when Now comes back into focus
  return { repo, m };
}

describe('finishing a workout leaves the tabs reachable (R679)', () => {
  test('right after DONE the next workout is not asked about', () => {
    const clock = { now: T0 };
    const { m } = finishedAt(clock);
    assert.equal(m.state().justFinished, true);
    assert.equal(sheetOpen(m), false,
      'the day sheet for a workout they have not started covers the tab bar straight after DONE');
  });

  test('nor when they reopen the app to look at what they just did', () => {
    const clock = { now: T0 };
    const { repo } = finishedAt(clock);
    clock.now += 30 * 60_000;
    assert.equal(sheetOpen(new NowModel(repo, () => clock.now, 'en-US')), false);
  });

  test('it is asked when they come back to train', () => {
    const clock = { now: T0 };
    const { repo } = finishedAt(clock);
    clock.now += IDLE_END_MS + 60_000;
    const later = new NowModel(repo, () => clock.now, 'en-US');
    assert.equal(later.state().justFinished, false);
    assert.equal(sheetOpen(later), true, 'the next workout was never asked what day it is');
  });

  test('a first-ever workout is asked straight away', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
    const m = new NowModel(repo, () => T0, 'en-US');
    assert.equal(m.state().justFinished, false, 'nothing has been finished yet');
    assert.equal(sheetOpen(m), true);
  });

  test('mid-workout it changes nothing', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
    const m = new NowModel(repo, () => T0, 'en-US');
    m.selectExercise('bench');
    m.log();
    assert.equal(m.state().justFinished, false, 'a lifter in the middle of a workout has not finished one');
  });
});

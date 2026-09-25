import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { IDLE_END_MS } from '../src/domain/session.ts';
import { around } from './helpers/source.ts';
import { nowScreenSource } from './helpers/now-screen.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T0 = Date.UTC(2026, 7, 27, 12);

/** A model with one set logged, and a clock the test can move. */
function training() {
  let now = T0;
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => now);
  const m = new NowModel(repo, () => now, 'en-US');
  m.log();
  return { m, repo, advance: (ms: number) => { now += ms; } };
}

/*
 * §8's idle rule has to fire on the path it actually happens.
 *
 * A workout ends after ninety minutes of nothing, and the model did that in its
 * CONSTRUCTOR — so it only ever ran on a cold launch. A phone wakes far more
 * often than it relaunches: lock the screen mid-workout, leave the gym, open
 * the app again two hours later, and iOS restores the process with the same
 * model holding the same live session. The next set then joins a workout that
 * started before lunch and the recap reports its duration as two hours — the
 * "phone left on a bench" case the rule exists to prevent, arriving by the
 * route nobody had checked.
 */
describe('a workout abandoned while the app slept is ended (§8)', () => {
  test('nothing happens while the session is still fresh', () => {
    const { m, advance } = training();
    advance(IDLE_END_MS - 60_000);
    assert.equal(m.closeIfStale(), false, 'a session inside the window was closed');
    assert.equal(m.state().totalSets, 1, 'the live session lost its sets');
  });

  test('past the idle window it is closed and a fresh one begins', () => {
    const { m, repo, advance } = training();
    const first = repo.liveSession()!.id;
    advance(IDLE_END_MS + 60_000);
    assert.equal(m.closeIfStale(), true);
    assert.equal(m.state().totalSets, 0, 'the new session is not carrying the old sets');
    const reopened = repo.liveSession();
    assert.ok(reopened, 'no live session to log into');
    assert.notEqual(reopened!.id, first, 'still the same session');
  });

  test('the abandoned workout keeps the duration it actually had', () => {
    /*
     * Backdated to the last set, exactly as the constructor does. Ending it at
     * `now` instead would record the hours the phone spent in a bag as training
     * time — and that number reaches the recap and the shared card.
     */
    const { m, repo, advance } = training();
    const id = repo.liveSession()!.id;
    advance(IDLE_END_MS + 3 * 3600_000);
    m.closeIfStale();
    const ended = repo.session(id)!;
    assert.ok(ended.endedAt, 'the old session was left open');
    assert.equal(ended.endedAt! - ended.startedAt < 60_000, true,
      `the abandoned workout recorded ${(ended.endedAt! - ended.startedAt) / 60000} minutes`);
  });

  test('it is idempotent, because focus fires more than once', () => {
    const { m, advance } = training();
    advance(IDLE_END_MS + 60_000);
    assert.equal(m.closeIfStale(), true);
    assert.equal(m.closeIfStale(), false, 'a second focus started yet another session');
    assert.equal(m.closeIfStale(), false);
  });

  test('and the screen calls it when it comes back into focus', () => {
    // The whole point: the constructor path was already right, and unreachable
    // in the case that matters.
    const src = nowScreenSource();
    const focus = around(src, 'model.startNextIfFinished();', 700, 100);
    assert.match(focus, /model\.closeIfStale\(\);/,
      'focus no longer re-checks whether the session went stale while away');
    // Before `startNextIfFinished`, or it would decide what to show for a
    // session that is about to be replaced.
    assert.ok(focus.indexOf('model.closeIfStale();') < focus.indexOf('model.startNextIfFinished();'),
      'the staleness check must run first');
  });

  /*
   * R492. Every word above is right and the wiring underneath it was wrong.
   *
   * `useFocusEffect` subscribes to navigation's `focus` and `blur` events and
   * to NOTHING else — read `@react-navigation/core/lib/module/useFocusEffect`,
   * it calls `navigation.addListener` exactly twice. Navigation focus does not
   * move when a phone sleeps. Lock the screen mid-workout with Now on top and
   * Now is still the focused screen two hours later, so the effect never
   * re-runs and `closeIfStale` never fires. The one route that check was
   * written for — "a phone does not relaunch the app, it wakes it", in its own
   * comment — is the single route the hook it was wired to cannot observe.
   *
   * Source-level, because the wake is a platform event: the model half is
   * already covered by the tests above, so what is unproven is only that the
   * app is listening for it at all.
   */
  describe('the app waking is also a way back (§8)', () => {
    const src = nowScreenSource();

    test('a wake is listened for', () => {
      assert.match(src, /AppState\.addEventListener\('change'/,
        'nothing watches for the app coming back, so locking the phone ' +
        'mid-workout leaves the session live forever');
      assert.match(src, /AppState/,
        'AppState is not imported, so the listener above cannot be real');
    });

    test('and only a wake, not a backgrounding', () => {
      assert.match(src, /if \(s === 'active'\) resume\(\);/,
        "running on every AppState change would fire on 'background' too, " +
        'and re-read the screen the user just left');
    });

    test('it runs the same work as arriving on the screen', () => {
      /*
       * Not a second copy of it. Two hand-maintained resume paths drift, and
       * the one that drifts is always the one nobody can see running.
       */
      assert.match(src, /useFocusEffect\(resume\);/,
        'focus and wake have separate bodies, which will diverge');
      assert.equal(src.split('model.closeIfStale();').length - 1, 1,
        'the idle check is written out more than once');
    });

    test('the listener is removed', () => {
      assert.match(src, /return \(\) => sub\.remove\(\);/,
        'an AppState listener that outlives the screen holds the model alive');
    });
  });
});

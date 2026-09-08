import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { trainingGoal, TRAINING_GOALS, PREF_GOAL } from '../src/ui/training-goal.ts';
import { t } from '../src/domain/i18n.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS = fs.readFileSync(path.join(HERE, '..', 'app', 'settings.tsx'), 'utf8');
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 9, 12);

/** A repo with a lifter climbing 5 lb a session, which every goal has an opinion about. */
function climbing(): Repo {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  let n = 0;
  for (const [daysAgo, weight] of [[8, 195], [5, 200], [2, 205]] as [number, number][]) {
    const sessionId = `h${daysAgo}`;
    repo.startSession(sessionId, 'lb');
    repo.logSet({ id: `s${n++}`, sessionId, exerciseId: 'bench', weight, reps: 5, at: T0 - daysAgo * DAY });
    repo.endSession(sessionId, T0 - daysAgo * DAY + 3600_000);
  }
  return repo;
}

/*
 * R519, finishing OWNER.md #2: "tuned to the person's stated goal (strength /
 * size / consistency)".
 *
 * R517 built the engine taking a goal and R518 wired the line to the screen,
 * and in between nothing ever passed one — so every lifter got the `size`
 * default and that clause of the owner's request was not yet true. The engine
 * was already right; what was missing was somebody to ask.
 */
describe('the stated training goal is real, stored and acted on (R519)', () => {
  test('a lifter who has never opened Settings still gets advice', () => {
    // No "unset" state for the screen to render. The default has to be a real
    // answer, because the coach line exists to be useful before anybody
    // configures anything.
    const repo = climbing();
    assert.equal(trainingGoal(repo), 'size');
    assert.ok(new NowModel(repo, () => T0, 'en-US').state().lastTime.head.length > 0);
  });

  test('a stored choice is honoured, and rubbish is not', () => {
    const repo = climbing();
    for (const g of TRAINING_GOALS) {
      repo.setPref(PREF_GOAL, g);
      assert.equal(trainingGoal(repo), g);
    }
    repo.setPref(PREF_GOAL, 'powerlifting-but-fun');
    assert.equal(trainingGoal(repo), 'size',
      'an unrecognised stored value must fall back, not reach the engine');
  });

  test('the choice changes what the Now screen says', () => {
    /*
     * The point of the whole round, and the thing that was untrue until now:
     * OWNER.md #3 asks that preferences "visibly shape what the app shows, not
     * just what it stores". So this asserts the LINE differs, not that the
     * preference round-trips.
     */
    const repo = climbing();
    const lineFor = (goal: string) => {
      repo.setPref(PREF_GOAL, goal);
      return new NowModel(repo, () => T0, 'en-US').state().lastTime.head;
    };
    assert.notEqual(lineFor('consistency'), lineFor('size'),
      'consistency and size produce the same line, so the setting shows nothing');

    /*
     * STRENGTH and SIZE deliberately agree for a lifter who is CLIMBING, and
     * this is the interesting case rather than a gap.
     *
     * When somebody has added weight every session and made every one, the
     * engine suggests THEIR increment, not the goal table's — 5 lb for this
     * fixture, 2.5 for the row in the seeded history. Overriding a plan that is
     * demonstrably working because of a preference is the same mistake R517 and
     * R518 each fixed once already, pointed at a setting instead of at a
     * default. Their own evidence outranks the table.
     *
     * So the goal decides where there IS no working increment to read: a lifter
     * sitting at one weight, below is where the table applies.
     */
    const settled = climbing();
    settled.startSession('flat', 'lb');
    settled.logSet({ id: 'f1', sessionId: 'flat', exerciseId: 'bench', weight: 205, reps: 8, at: T0 - DAY });
    settled.endSession('flat', T0 - DAY + 3600_000);
    const flatLine = (goal: string) => {
      settled.setPref(PREF_GOAL, goal);
      return new NowModel(settled, () => T0, 'en-US').state().lastTime.head;
    };
    assert.notEqual(flatLine('size'), flatLine('strength'),
      'with no increment of their own to read, the goal must decide the step');
  });

  test('consistency really does leave the weight alone', () => {
    // The one goal whose whole promise is that the number does not move. A
    // lifter told to add weight every time they come in eventually stops
    // coming in.
    const repo = climbing();
    repo.setPref(PREF_GOAL, 'consistency');
    const line = new NowModel(repo, () => T0, 'en-US').state().lastTime.head;
    assert.match(line, /205/, 'the line should be about the weight they are on');
    assert.doesNotMatch(line, /210|try/i, `consistency suggested a change: "${line}"`);
  });

  test('Settings offers exactly the goals the engine understands', () => {
    /*
     * Derived rather than listed: a chip the engine does not know would fall
     * back to `size` and the screen would show a selected choice that does
     * nothing — the worst kind of setting, because it looks like it worked.
     */
    const offered = [...SETTINGS.matchAll(/GOAL_KEY: Record<TrainingGoal, ([^>]*)>/g)];
    assert.equal(offered.length, 1, 'the label map is gone; chips and labels can now drift');
    for (const g of TRAINING_GOALS) {
      assert.match(SETTINGS, new RegExp(`${g}: 'goal`), `Settings has no label for ${g}`);
    }
    assert.match(SETTINGS, /TRAINING_GOALS\.map/,
      'Settings hard-codes its chips instead of deriving them from the engine\'s list');
  });

  test('every goal has a word in both languages', () => {
    for (const key of ['trainingGoal', 'goalStrength', 'goalSize', 'goalConsistency', 'trainingGoalHelp']) {
      for (const lang of ['en', 'es'] as const) {
        const word = t(lang, key as never);
        assert.ok(word && word !== key, `${key} has no ${lang} translation`);
      }
    }
  });
});

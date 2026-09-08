import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { progressRows } from '../src/ui/progress-model.ts';
import { buildRecap } from '../src/domain/session.ts';
import { findPRs } from '../src/domain/pr.ts';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 9, 12);

/** Three pound sessions, then 86 kg — which is 189.5 lb, and not on any rack. */
function switchedUnits(): Repo {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  let n = 0;
  for (const [d, w] of [[11, 175], [8, 180], [5, 185]] as [number, number][]) {
    const id = `lb${d}`;
    repo.startSession(id, 'lb');
    repo.logSet({ id: `s${n++}`, sessionId: id, exerciseId: 'bench', weight: w, reps: 5, at: T0 - d * DAY });
    repo.endSession(id, T0 - d * DAY + 3600_000);
  }
  repo.startSession('kg2', 'kg');
  repo.logSet({ id: 'sk', sessionId: 'kg2', exerciseId: 'bench', weight: 86, reps: 5, at: T0 - 2 * DAY });
  repo.endSession('kg2', T0 - 2 * DAY + 3600_000);
  return repo;
}

/*
 * R551. Five rounds of putting weights ON the grid (R548 suggestions, R549 the
 * climb, R550 the plate buttons) create a specific new risk: rounding a weight
 * the lifter actually LIFTED.
 *
 * §16 draws the line and nothing enforced it. A weight the app SUGGESTS has to
 * exist on a rack, because the lifter is being asked to load it. A weight the
 * app REPORTS has to match what happened, because the lifter is being asked to
 * recognise it — and 86 kg is 189.5 lb, so "190 and climbing" is a number they
 * cannot check against anything they did.
 *
 * Every surface is correct today; this is the gate, not a fix. It exists
 * because "put it on the grid" is now the obvious move in this repo, and the
 * next person to make it will be right four times and wrong here.
 */
describe('a weight the lifter lifted is reported exactly (R551)', () => {
  test('the Now header quotes the real weight and suggests a loadable one', () => {
    const m = new NowModel(switchedUnits(), () => T0, 'en-US');
    m.selectExercise('bench');
    const line = m.state().lastTime.head;
    assert.match(line, /189\.5 and climbing/,
      `the reported weight was rounded, so it matches no session: "${line}"`);
    assert.match(line, /try 195/, `the suggestion left the grid: "${line}"`);
  });

  test('the weight field opens on what they last lifted, not a tidied version', () => {
    /*
     * §4 wants the field prefilled with "same as last time", and last time was
     * 86 kg. Rounding it to 190 would silently log a set they did not do.
     */
    const m = new NowModel(switchedUnits(), () => T0, 'en-US');
    m.selectExercise('bench');
    assert.equal(m.state().weight, 189.5, 'the prefill was rounded onto the grid');
  });

  test('Progress reports the best and the trend exactly', () => {
    const row = progressRows(switchedUnits(), T0)[0];
    assert.equal(row.best, 189.5, 'the best set was rounded');
    assert.equal(row.trend, 14.5,
      'the trend was rounded — progress-model already learned this once, when ' +
      'Math.round turned a 12.5 lb gain into "+13"');
  });

  test('the recap card shows the number they typed, in the unit they typed it', () => {
    const repo = switchedUnits();
    const sets = repo.setsInSession('kg2');
    const prs = findPRs(sets, repo.historyBefore('kg2'), repo.exercises(),
      'kg', repo.measurements(), repo.sessionUnits());
    const recap = buildRecap({
      session: repo.session('kg2')!, sets, exercises: repo.exercises(), prs,
      allSets: repo.allSets(), now: T0,
      measurements: repo.measurements(), sessionUnits: repo.sessionUnits()
    });
    assert.equal(recap.best?.weight, 86, 'the card rounded the weight that was logged');
    assert.equal(recap.unit, 'kg', 'the card left the session unit');
  });

  test('MAX_CLIMB_FRACTION is documented as a test, not a suggestion', () => {
    /*
     * The last bare fraction in coach.ts, and therefore the obvious next thing
     * to put on the grid. It never reaches a screen — it asks whether a jump
     * the lifter already made is believable — so the note is what stops a
     * well-aimed change landing on the one constant that must not move.
     */
    const src = fs.readFileSync(path.join(HERE, '..', 'src', 'domain', 'coach.ts'), 'utf8');
    assert.match(src, /NOT A SUGGESTION, AND SO NOT ON THE GRID/,
      'coach.ts no longer says why MAX_CLIMB_FRACTION is exempt from the grid work');
  });
});

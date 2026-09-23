import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { coachSuggestion } from '../src/domain/coach.ts';
import { around } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 9, 12);

/** Benched in POUNDS for three sessions, then logged one in KILOS. */
function switchedUnits(): Repo {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  let n = 0;
  for (const [d, w] of [[11, 175], [8, 180], [5, 185]] as [number, number][]) {
    const id = `lb${d}`;
    repo.startSession(id, 'lb');
    repo.logSet({ id: `s${n++}`, sessionId: id, exerciseId: 'bench', weight: w, reps: 5, at: T0 - d * DAY });
    repo.endSession(id, T0 - d * DAY + 3600_000);
  }
  // 86 kg is about 189.5 lb — an ordinary next step, not a jump.
  repo.startSession('kg2', 'kg');
  repo.logSet({ id: `s${n++}`, sessionId: 'kg2', exerciseId: 'bench', weight: 86, reps: 5, at: T0 - 2 * DAY });
  repo.endSession('kg2', T0 - 2 * DAY + 3600_000);
  return repo;
}

/*
 * R537, for HANDOFF trap 9: "a cross-unit weight bug does not look like a bug".
 *
 * A LoggedSet carries no unit — the SESSION does — so anything comparing
 * weights across sessions has to convert first. The coach (R517) compares
 * across sessions by construction: it reads the last two weeks of top sets and
 * decides whether they are climbing. It is protected because `now-model` hands
 * it `historyInSessionUnit()`, and nothing tested that.
 *
 * Measured what the unprotected path would say, so the risk is a number rather
 * than a worry: given three pound sessions and one 86 kg session, the app says
 * "189.5 and climbing, 4 sessions — try 194" (correct — 86 kg IS 189.5 lb, and
 * 4.5 is the lifter's own step), while the same call on raw `allSets()` reports
 * `recentWeight = 86` and advises settling at 86. Not an error, not a crash: a
 * plausible sentence about a weight nobody lifted, which is precisely what
 * trap 9 warns is invisible.
 */
describe('the coach reads a history in one unit (R537, trap 9)', () => {
  test('a lifter who switched units still gets advice about real weights', () => {
    const m = new NowModel(switchedUnits(), () => T0, 'en-US');
    m.selectExercise('bench');
    const line = m.state().lastTime.head;
    assert.match(line, /189\.5/,
      `the coach should talk about 189.5 lb, the converted weight. It said: "${line}"`);
    assert.doesNotMatch(line, /\b86\b/,
      `the coach quoted 86 — a kilogram figure shown beside a pound hero: "${line}"`);
  });

  test('and it reads the climb as a climb, not as a jump', () => {
    /*
     * The subtler half. Unconverted, 185 to 86 is a 54% DROP, so the run stops
     * being a climb and the lifter on a working linear progression is told to
     * settle. The advice is wrong in kind, not just in number.
     */
    const m = new NowModel(switchedUnits(), () => T0, 'en-US');
    m.selectExercise('bench');
    assert.match(m.state().lastTime.head, /climbing/,
      'four sessions of steady progress were not recognised as progress');
  });

  test('the raw history genuinely would be wrong — this is not a hypothetical', () => {
    /*
     * Pinning the failure mode itself. If this ever stops being wrong, the
     * conversion has moved inside the engine and the guard below is obsolete
     * rather than merely passing.
     */
    const repo = switchedUnits();
    const raw = coachSuggestion(repo.allSets(), 'bench', T0, { unit: 'kg' })!;
    assert.equal(raw.recentWeight, 86,
      'raw history no longer mixes units; re-check whether this whole guard is still needed');
  });

  test('now-model hands the coach converted history, not allSets()', () => {
    // The one line that protects it. `allSets()` here would be faster, would
    // look equivalent, and would silently reintroduce the case above.
    const model = fs.readFileSync(path.join(HERE, '..', 'src', 'ui', 'now-model.ts'), 'utf8');
    // Since R692 the call is made in one place, `coachCall()`, for the line and the dial.
    assert.match(model, /coach: this\.coachCall\(\)/, 'the line no longer reads the one call');
    const call = around(model, 'private coachCall(): Suggestion | null {', 0, 200);
    assert.match(call, /this\.historyInSessionUnit\(\)/,
      'the coach is being handed a history that mixes units');
    assert.doesNotMatch(call, /this\.repo\.allSets\(\)/,
      'the coach is being handed raw allSets(), which carries kilos and pounds together');
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel, WEIGHT_STEP, PLATE } from '../src/ui/now-model.ts';
import type { Unit } from '../src/domain/types.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 9, 12);

/**
 * A lifter who logged one session in kilos, so the weight field opens off-grid.
 * 86 kg is 189.5 lb — reported honestly, and not a number any rack makes.
 */
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
  repo.logSet({ id: `s${n++}`, sessionId: 'kg2', exerciseId: 'bench', weight: 86, reps: 5, at: T0 - 2 * DAY });
  repo.endSession('kg2', T0 - 2 * DAY + 3600_000);
  return repo;
}

function onBench(repo: Repo): NowModel {
  const m = new NowModel(repo, () => T0, 'en-US');
  m.selectExercise('bench');
  return m;
}

/*
 * R550, closing the loop R548 and R549 opened.
 *
 * Those rounds put every SUGGESTED weight on plates. The field the lifter
 * actually types into was never looked at, and it turned out the two controls
 * on that row disagreed: `bumpWeight` snapped to `WEIGHT_STEP`, `bumpPlate` did
 * not.
 *
 * Measured from 189.5 lb: `+45` gave 234.5, `-45` gave 144.5, and every further
 * press kept the half, so the big plate buttons could never get back to a
 * weight that exists — while the small buttons beside them fixed it in one tap.
 * The lifter's only escape was to type a number.
 */
describe('the plate buttons land on weights that exist (R550)', () => {
  test('adding a plate from an off-grid weight lands on the grid', () => {
    const m = onBench(switchedUnits());
    // Last time's converted weight, off the grid. Since R692 the dial opens on
    // the coach's call, so the off-grid start is set, as a typed weight would be.
    m.setWeight(189.5);
    assert.equal(m.state().weight, 189.5, 'the fixture is not off-grid, so this proves nothing');
    m.bumpPlate(1);
    assert.equal(m.state().weight, 235, `+45 from 189.5 gave ${m.state().weight}`);
    m.bumpPlate(1);
    assert.equal(m.state().weight % WEIGHT_STEP.lb, 0, 'a second plate went back off-grid');
  });

  test('and so does stripping one', () => {
    const m = onBench(switchedUnits());
    m.setWeight(189.5);
    m.bumpPlate(-1);
    assert.equal(m.state().weight, 145, `-45 from 189.5 gave ${m.state().weight}`);
  });

  test('the two buttons on that row now agree', () => {
    /*
     * The actual defect: not that a number was wrong, but that two adjacent
     * controls had different ideas about what a weight can be. Whichever the
     * lifter presses, they end up somewhere loadable.
     */
    for (const unit of ['lb', 'kg'] as Unit[]) {
      const repo = switchedUnits();
      const m = onBench(repo);
      m.setWeight(unit === 'lb' ? 189.5 : 86.3);
      const viaStep = (() => { m.bumpWeight(1); return m.state().weight; })();
      m.setWeight(unit === 'lb' ? 189.5 : 86.3);
      const viaPlate = (() => { m.bumpPlate(1); return m.state().weight; })();
      for (const [what, w] of [['stepper', viaStep], ['plate', viaPlate]] as [string, number][]) {
        assert.equal(Math.round(w / WEIGHT_STEP.lb) * WEIGHT_STEP.lb, w,
          `the ${what} button left ${w}, which is not on the grid`);
      }
    }
  });

  test('a lifter with micro-plates keeps them', () => {
    /*
     * The half that stops this becoming a different bug. Somebody who sets a
     * 2.5 lb plate jump owns 1.25 lb plates and is telling the app what they
     * can load; snapping that onto the 5 lb default would erase the setting.
     * So the grid is the FINER of the two — their evidence outranks the
     * default, which is the rule R518 and R549 both reached from other sides.
     */
    const repo = switchedUnits();
    repo.setPref('jump.lb', '2.5');
    const m = onBench(repo);
    m.setWeight(190);
    m.bumpPlate(1);
    assert.equal(m.state().weight, 192.5,
      'a custom 2.5 lb jump was rounded away by the 5 lb default');
  });

  test('an on-grid weight is not moved by the fix', () => {
    // The common case by far, and it must be untouched: 135 plus a 45 is 180,
    // not 180-rounded-to-something-else.
    const m = onBench(switchedUnits());
    m.setWeight(135);
    m.bumpPlate(1);
    assert.equal(m.state().weight, 135 + PLATE.lb);
    m.bumpPlate(-1);
    assert.equal(m.state().weight, 135);
  });

  test('stripping plates still floors at zero rather than going negative', () => {
    // The behaviour bumpPlate already had, which the snap must not lose.
    const m = onBench(switchedUnits());
    m.setWeight(20);
    m.bumpPlate(-1);
    assert.equal(m.state().weight, 0, 'stripping a plate off 20 lb went below zero');
  });
});

/*
 * R670. R550 made both buttons on the weight row LAND on the grid, and never
 * asked WHICH grid weight. The stepper rounded (weight +/- 5), so from an
 * off-grid weight + could skip the nearest weight up: 187.5 lb -- 85 kg,
 * converted -- went to 195, under a coach line that said "try 190".
 *
 * Found by sweeping all 608 coach suggestions (units x jumps x goals x
 * branches x converted history) against what each button reaches when pressed
 * repeatedly: 40 of the 163 that no single button could dial in were this.
 */
describe('from an off-grid weight the stepper goes to the next weight, not past it (R670)', () => {
  test('+ and - land on the nearest grid weight in that direction', () => {
    for (const [unit, from, up, down] of [
      ['lb', 187.5, 190, 185], ['lb', 189.5, 190, 185], ['lb', 132.5, 135, 130],
      ['kg', 81.5, 82.5, 80], ['kg', 84, 85, 82.5]
    ] as Array<[Unit, number, number, number]>) {
      const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
      repo.setPref('pref.unit', unit);
      const m = onBench(repo);
      m.setWeight(from);
      m.bumpWeight(1);
      assert.equal(m.state().weight, up, `+ from ${from} ${unit} went to ${m.state().weight}`);
      m.setWeight(from);
      m.bumpWeight(-1);
      assert.equal(m.state().weight, down, `- from ${from} ${unit} went to ${m.state().weight}`);
    }
  });

  test('the number the coach names is one press away', () => {
    // Three sessions of 85 kg, opened in pounds: 187.5, and a plateau says 190.
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
    for (const d of [10, 7, 4]) {
      const id = `kg${d}`;
      repo.startSession(id, 'kg', undefined, T0 - d * DAY);
      repo.logSet({ id: `k${d}`, sessionId: id, exerciseId: 'bench', weight: 85, reps: 8, at: T0 - d * DAY });
      repo.endSession(id, T0 - d * DAY + 3600_000);
    }
    repo.setPref('pref.unit', 'lb');
    const m = onBench(repo);
    const line = m.state().lastTime.head;
    assert.match(line, /try 190(?![\d.])/, `fixture stopped being a plateau at 187.5: "${line}"`);
    // Since R692 the dial opens on it; from last time's 187.5 it is still one press.
    assert.equal(m.state().weight, 190, 'the dial did not open on the call');
    m.setWeight(187.5);
    m.bumpWeight(1);
    assert.equal(m.state().weight, 190, `the coach said "${line}" and + went to ${m.state().weight}`);
  });

  test('an on-grid weight still moves exactly one step per press', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
    repo.setPref('pref.unit', 'lb');
    const m = onBench(repo);
    m.setWeight(185);
    m.bumpWeight(1);
    assert.equal(m.state().weight, 190);
    m.bumpWeight(1);
    assert.equal(m.state().weight, 195);
    m.bumpWeight(-3);
    assert.equal(m.state().weight, 180);
  });
});

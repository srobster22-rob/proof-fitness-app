import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withinBudget } from './helpers/perf.ts';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import { NowModel, splitPickerGroups } from '../src/ui/now-model.ts';
import {
  WEIGHT_STEP,
  PLATE,
  REP_JUMP,
  typedWeight,
  MAX_TYPED_WEIGHT,
  customJump,
  customRepJump
} from '../src/ui/now-steppers.ts';
import { layoutFor, columnHeight, heroWidth, HIT, revealOffset } from '../src/ui/now-layout.ts';
import { lastTimeLine, goalTail, lastTimeParts } from '../src/ui/now-line.ts';
import { STARTING_TWELVE } from '../src/domain/coldstart.ts';
import { dayOf, inPlanDay, sessionPlanDay } from '../src/domain/split.ts';
import { nextCandidates } from '../src/domain/predict.ts';
import type { LoggedSet } from '../src/domain/types.ts';
import { nowScreenSource } from './helpers/now-screen.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (p: string) => readFileSync(path.join(HERE, '..', ...p.split('/')), 'utf8');

const MIN = 60_000, DAY = 86_400_000;

/**
 * The line under the lift name, composed.
 *
 * The state carries it split — `head` plus `tail` — because the screen colours
 * the tail volt when a set has just hit a goal, and a nested `Text` is the only
 * way to colour half a line. Everything that only cares about the words joins
 * it back together here.
 */
const lineOf = (m: NowModel) => { const s = m.state(); return s.lastTime.head + s.lastTime.tail; };
const T0 = Date.UTC(2026, 6, 29, 18);

function repoWith(history: Array<[string, string, number, number, number]> = [], now = T0) {
  const repo = new Repo(new DatabaseSync(':memory:') as any, () => now);
  let i = 0;
  for (const [sessionId, exerciseId, weight, reps, at] of history) {
    if (!repo.session(sessionId)) {
      repo.startSession(sessionId, 'lb');
      repo.endSession(sessionId, at + 45 * MIN);
    }
    repo.logSet({ id: `h${i++}`, sessionId, exerciseId, weight, reps, at });
  }
  return repo;
}

/** Four weekly sessions of squat + row, most recent 7 days ago. */
function trained(now = T0): Repo {
  const rows: Array<[string, string, number, number, number]> = [];
  for (let w = 4; w >= 1; w--) {
    const at = now - w * 7 * DAY;
    rows.push([`h${w}`, 'squat', 200 + (4 - w) * 5, 5, at]);
    rows.push([`h${w}`, 'row', 150, 8, at + 20 * MIN]);
  }
  return repoWith(rows, now);
}

describe('Now screen — launch (§4)', () => {
  test('a first-ever launch opens on a real lift with real numbers', () => {
    const m = new NowModel(repoWith(), () => T0);
    const s = m.state();
    assert.ok(s.exercise.id, 'must open on something');
    // No locale, so §8 gives kg — where an empty barbell is 20, not 45.
    assert.equal(s.session.unit, 'kg');
    assert.equal(s.weight, 20, 'an empty barbell, in the unit this session is actually in');
    assert.ok(s.reps > 0, 'an empty reps field is a bug');
    assert.equal(s.prefillSource, 'seed');
    assert.equal(s.picker.length, STARTING_TWELVE.length,
      'cold start shows the SHORT list §6 promises, not the whole library');
  });

  test('with history it opens on the predicted first lift, prefilled from last time', () => {
    const m = new NowModel(trained(), () => T0);
    const s = m.state();
    assert.equal(s.exercise.id, 'squat', 'the lift they actually start with');
    // Their own history, not a seed: since R692 the coach's call from it,
    // 215 and climbing, so 220.
    assert.equal(s.weight, 220, 'the call from their last squats, not a seed');
    assert.equal(s.prefillSource, 'history');
  });

  test('relaunching mid-workout resumes, it does not restart', () => {
    const repo = trained();
    const a = new NowModel(repo, () => T0);
    a.log();
    const sessionId = a.state().session.id;

    const b = new NowModel(repo, () => T0 + 3 * MIN);
    assert.equal(b.state().session.id, sessionId, 'same session');
    assert.equal(b.state().loggedThisSession.length, 1, 'the set is still there');
    assert.equal(b.state().exercise.id, 'squat', 'back where they were');
  });

  test('a session abandoned days ago is closed and a new one begins', () => {
    const repo = trained();
    const a = new NowModel(repo, () => T0);
    a.log();
    const stale = a.state().session.id;

    const b = new NowModel(repo, () => T0 + 3 * DAY);
    assert.notEqual(b.state().session.id, stale, 'must not resume Tuesday\'s workout');
    assert.equal(repo.session(stale)!.endedAt !== null, true, 'and the old one is closed');
    assert.equal(b.state().loggedThisSession.length, 0);
  });
});

describe('Now screen — the tap budget (§4)', () => {
  test('repeating the last set is exactly one action', () => {
    const m = new NowModel(trained(), () => T0);
    const before = m.state();
    m.log();                                    // <- one tap
    const after = m.state();
    assert.equal(after.loggedThisExercise.length, 1);
    assert.equal(after.loggedThisExercise[0].weight, before.weight);
    assert.equal(after.loggedThisExercise[0].reps, before.reps);
  });

  test('the steppers do not reset after logging — the next set is usually the same', () => {
    const m = new NowModel(trained(), () => T0);
    const w = m.state().weight, r = m.state().reps;
    m.log();
    assert.equal(m.state().weight, w);
    assert.equal(m.state().reps, r);
    m.log();
    assert.equal(m.state().loggedThisExercise.length, 2, 'two identical sets, two taps');
  });

  test('changing weight then logging is three actions, no keyboard', () => {
    const m = new NowModel(trained(), () => T0);
    const start = m.state().weight;
    m.bumpWeight(1); m.bumpWeight(1); m.log();  // <- three
    assert.equal(m.state().loggedThisExercise[0].weight, start + 2 * WEIGHT_STEP.lb);
  });

  test('weight steps snap to plate maths and never go negative', () => {
    const m = new NowModel(trained(), () => T0);
    m.setWeight(203);
    m.bumpWeight(1);
    assert.equal(m.state().weight % WEIGHT_STEP.lb, 0, 'must land on a loadable weight');
    m.bumpWeight(-999);
    assert.equal(m.state().weight, 0);
  });

  test('reps never drop below one', () => {
    const m = new NowModel(trained(), () => T0);
    m.bumpReps(-50);
    assert.equal(m.state().reps, 1);
  });

  test('a mis-tap costs one action to undo', () => {
    const m = new NowModel(trained(), () => T0);
    m.log(); m.log();
    assert.equal(m.state().loggedThisExercise.length, 2);
    assert.equal(m.undo(), true);
    assert.equal(m.state().loggedThisExercise.length, 1);
    assert.equal(m.undo(), true);
    assert.equal(m.undo(), false, 'nothing left to undo');
  });
});

describe('Now screen — moving between lifts (§7)', () => {
  test('the rail never tags the lift you just walked away from', () => {
    /*
     * Move between two untrained lifts and neither is `done`, so a suggestion
     * that skips only the CURRENT lift turns round and points back at the one
     * you came from. On screen that is NEXT sitting on a chip the user has just
     * left; as a swipe it is an infinite bench -> fly -> bench.
     *
     * Not hypothetical: this is what the rail did until the swipe was wired to
     * it and the loop showed up.
     */
    const m = new NowModel(trained(), () => T0);
    const first = m.state().exercise.id;
    assert.equal(m.next(), true);
    const second = m.state().exercise.id;

    const tag = m.state().dayRail.find(l => l.suggested);
    assert.notEqual(tag?.id, first,
      `the rail is pointing back at ${first}, the lift just left`);
    assert.notEqual(tag?.id, second, 'the rail is tagging the lift on screen');
  });

  test('swipe lands on the lift the rail is pointing at, and re-prefills', () => {
    /*
     * The two answers differ, and this fixture is the case that proves it: on
     * this leg day `upNext` says **row**, which is not on the rail at all —
     * the rail reads `*calf hipthrust legcurl legext legpress lunge rdl squat`
     * and tags calf. `next()` used to take `upNext`, so a swipe left the screen
     * showing NEXT beside one chip and arrived at a movement that was not on it.
     *
     * Asserted against the tag rather than against a hardcoded id, because the
     * invariant is the agreement, not which lift wins today.
     */
    const m = new NowModel(trained(), () => T0);
    assert.equal(m.state().exercise.id, 'squat');

    const tagged = m.state().dayRail.find(l => l.suggested)!;
    assert.ok(tagged, 'the rail has nothing tagged — the fixture stopped exercising this');
    assert.notEqual(tagged.id, m.state().upNext?.id,
      'upNext and the rail agree here, so this fixture no longer pins the divergence');

    assert.equal(m.next(), true);
    assert.equal(m.state().exercise.id, tagged.id);
    assert.ok(m.state().dayRail.find(l => l.id === tagged.id)!.current,
      'landed somewhere the rail does not show as current');
  });

  test('arriving at a lift re-prefills from its own history', () => {
    // Split from the assertion above: the landing target is now chosen by the
    // rail, and pinning a weight to it would re-couple this to today's ranking.
    const m = new NowModel(trained(), () => T0);
    m.selectExercise('row');
    assert.equal(m.state().weight, 155, 'the call from their own rows (150×8 twice), not the squat');
    assert.equal(m.state().prefillSource, 'history');
  });

  /*
   * This used to assert `upNext === null` after two lifts, which was only true
   * while the library WAS two lifts — `pickerFor` now offers untrained
   * movements too, so a companion exists for longer. The behaviour that
   * matters is unchanged and is what is asserted: it terminates rather than
   * cycling, which is R50's fix.
   */
  test('upNext eventually stops rather than cycling forever', () => {
    const m = new NowModel(trained(), () => T0);
    const seen = [m.state().exercise.id];
    let guard = 0;
    while (m.next() && guard < 60) { seen.push(m.state().exercise.id); guard++; }
    assert.ok(guard < 60, 'next() never returned false — that is an infinite loop');
    assert.equal(new Set(seen).size, seen.length, `revisited a lift: ${seen.join(' -> ')}`);
    assert.equal(m.state().dayRail.find(l => l.suggested), undefined,
      'and it ends with the rail having nothing left to tag');
  });

  test('picking from the list re-prefills, including for an untrained lift', () => {
    const m = new NowModel(trained(), () => T0);
    m.selectExercise('bench');
    const s = m.state();
    assert.equal(s.exercise.name, 'Bench Press');
    assert.equal(s.prefillSource, 'seed', 'never trained it — so there is nothing to carry over');
    assert.ok(s.weight >= 45, 'scaled from what they DO lift, never below an empty bar');
  });

  test('"last time" reads the previous session, never the current one', () => {
    const m = new NowModel(trained(), () => T0);
    assert.equal(m.lastTime()!.weight, 215);
    m.bumpWeight(1); m.log();
    assert.equal(m.lastTime()!.weight, 215, 'today\'s set must not become "last time"');
  });
});

describe('Now screen — finishing', () => {
  test('finish backdates to the last set, not to when they remembered', () => {
    const repo = trained();
    let clock = T0;
    const m = new NowModel(repo, () => clock);
    m.log();
    const lastAt = m.state().loggedThisSession[0].at;

    clock = T0 + 2 * 60 * MIN;
    const ended = m.finish();
    assert.equal(ended.endedAt, lastAt);
    assert.equal(repo.liveSession(), null);
  });

  test('a whole session flows through in the tap budget it claims', () => {
    const repo = trained();
    const m = new NowModel(repo, () => T0);
    let taps = 0;
    m.log(); taps++;                       // squat, the coach's call (R692)
    m.bumpWeight(1); taps++;
    m.log(); taps++;                       // squat, +5
    m.next(); taps++;                      // swipe to row
    m.log(); taps++;
    m.log(); taps++;
    const s = m.state();
    assert.equal(s.loggedThisSession.length, 4);
    assert.equal(taps, 6, 'four sets across two lifts in six actions');
    assert.equal(s.loggedThisSession[1].weight, 225);
  });
});

describe('Now screen — picker invariants', () => {
  test('the picker always contains the lift currently selected', () => {
    const repo = trained();
    const m = new NowModel(repo, () => T0);
    // Their history is squat + row, so the ranked picker is those two.
    m.selectExercise('bench');
    const s = m.state();
    assert.ok(
      s.picker.some(e => e.id === s.exercise.id),
      `picker [${s.picker.map(e => e.id)}] does not contain the current lift "${s.exercise.id}" — ` +
      'the sheet would open with nothing marked as selected'
    );
  });
});

describe('Now screen — adding a custom exercise (§7)', () => {
  test('creates it, registers it, and switches to it', () => {
    const repo = trained();
    const m = new NowModel(repo, () => T0);
    const id = m.addCustomExercise('Sissy Squat');
    assert.equal(id, 'sissy_squat');
    assert.equal(repo.exercises().get('sissy_squat')!.name, 'Sissy Squat');
    assert.equal(m.state().exercise.name, 'Sissy Squat');
  });

  test('the new exercise can immediately be logged against', () => {
    // sets carries a FK to exercises; addExercise must land first or this throws.
    const repo = trained();
    const m = new NowModel(repo, () => T0);
    m.addCustomExercise('Pendlay Row');
    m.log();
    assert.equal(m.state().loggedThisExercise.length, 1);
    assert.equal(m.state().loggedThisExercise[0].exerciseId, 'pendlay_row');
  });

  test('an existing name is reused, not duplicated', () => {
    const repo = trained();
    const m = new NowModel(repo, () => T0);
    const before = repo.exercises().size;
    assert.equal(m.addCustomExercise('bench press'), 'bench', 'matches case-insensitively');
    assert.equal(repo.exercises().size, before, 'no second Bench Press');
  });

  test('a lossy slug collision does not rename the original', () => {
    const repo = trained();
    const m = new NowModel(repo, () => T0);
    // Two different names, one slug: `slugify` drops the "é" that
    // `normalizeName` reads as an "e", so R683's search keeps them apart.
    m.addCustomExercise('Caf Row');
    const second = m.addCustomExercise('Café Row');
    assert.notEqual(second, 'caf_row', 'must not reuse the taken slug');
    assert.equal(repo.exercises().get('caf_row')!.name, 'Caf Row',
      'the original keeps its name — two movements must never merge history');
    assert.equal(repo.exercises().get(second!)!.name, 'Café Row');
    // One movement typed two ways is not a collision at all: since R683 the
    // second spelling picks the first, and nothing is renamed or duplicated.
    const sissy = m.addCustomExercise('Sissy Squat');
    assert.equal(m.addCustomExercise('Sissy-Squat'), sissy);
    assert.equal(repo.exercises().get(sissy!)!.name, 'Sissy Squat');
  });

  test('removing it undoes the mistake, but never the lift currently open', () => {
    const repo = trained();
    const m = new NowModel(repo, () => T0);
    const id = m.addCustomExercise('Sissy Squat')!;

    // Still the open lift — refused, so the screen never has to decide what
    // to show in its place.
    assert.equal(m.removeCustomExercise(id), false);
    assert.ok(repo.exercises().has(id));

    m.selectExercise('bench');
    assert.equal(m.removeCustomExercise(id), true, 'no longer open, never logged — should go');
    assert.ok(!repo.exercises().has(id));
  });

  test('blank and whitespace-only names are refused', () => {
    const m = new NowModel(trained(), () => T0);
    assert.equal(m.addCustomExercise('   '), null);
    assert.equal(m.addCustomExercise(''), null);
  });

  test('names that slugify to nothing still get a usable id', () => {
    const repo = trained();
    const m = new NowModel(repo, () => T0);
    const id = m.addCustomExercise('???')!;
    assert.ok(id && id.length > 0);
    assert.equal(repo.exercises().get(id)!.name, '???');
  });

  test('a custom exercise appears in its own picker', () => {
    const m = new NowModel(trained(), () => T0);
    m.addCustomExercise('Zercher Squat');
    const s = m.state();
    assert.ok(s.picker.some(e => e.id === s.exercise.id));
  });
});

// §6: "First launch shows a short list of the most common movements. Tap one and
// you are logging." Walking the app as a beginner found it silently choosing
// Bench Press instead, with no visible sign the name could be tapped.
describe('Now screen — first launch shows the choice (§6)', () => {
  test('a fresh install reports firstEver', () => {
    assert.equal(new NowModel(repoWith(), () => T0).state().firstEver, true);
  });

  test('and offers the full starting twelve to choose from', () => {
    const s = new NowModel(repoWith(), () => T0).state();
    assert.equal(s.picker.length, STARTING_TWELVE.length);
  });

  test('one logged set is enough to stop asking', () => {
    const repo = repoWith();
    const m = new NowModel(repo, () => T0);
    m.log();
    assert.equal(m.state().firstEver, false);
    assert.equal(new NowModel(repo, () => T0 + 60_000).state().firstEver, false,
      'the choice is offered once, not every launch');
  });

  test('a returning user is never asked', () => {
    assert.equal(new NowModel(trained(), () => T0).state().firstEver, false);
  });
});

// Typed weight entry (§4). Steppers are right when the next set is the last set
// and wrong for a jump — 45 to 225 is 36 taps — so the hero number opens a
// field. It committed on blur first, which meant typing a number and then
// tapping LOG SET logged the OLD weight: the handlers raced and nothing on
// screen said which had won. Every test below is about that stuck state.
describe('Now screen — typed weight (§4)', () => {
  /** Type a string one character at a time, as the field really receives it. */
  function type(m: NowModel, input: string): string {
    let text = '';
    for (const ch of input) {
      const step = typedWeight(text + ch);
      text = step.text;
      if (step.weight !== null) m.setWeight(step.weight);
    }
    return text;
  }

  test('what is on screen is what gets logged', () => {
    const m = new NowModel(trained(), () => T0);
    const shown = type(m, '225');
    m.log();                                   // no blur, no confirm, no commit step
    const logged = m.state().loggedThisExercise.at(-1)!;
    assert.equal(logged.weight, 225);
    assert.equal(String(logged.weight), shown, 'the number logged is the number displayed');
  });

  test('every keystroke commits, so logging mid-number is still honest', () => {
    const m = new NowModel(trained(), () => T0);
    type(m, '22');                             // stopped early — 22, not 225
    m.log();
    assert.equal(m.state().loggedThisExercise.at(-1)!.weight, 22);
  });

  test('a typed weight need not land on a plate step', () => {
    const m = new NowModel(trained(), () => T0);
    type(m, '227.5');
    m.log();
    assert.equal(m.state().loggedThisExercise.at(-1)!.weight, 227.5);
  });

  test('clearing the field leaves the working weight alone', () => {
    const m = new NowModel(trained(), () => T0);
    const working = m.state().weight;
    for (const raw of ['', '.', '0', '00']) {
      assert.equal(typedWeight(raw).weight, null, `"${raw}" must not commit`);
    }
    type(m, '');
    m.log();
    assert.equal(m.state().loggedThisExercise.at(-1)!.weight, working,
      'a blank field must never zero someone mid-set');
  });

  test('the displayed text and the committed number can never disagree', () => {
    for (const raw of ['225', '2a2b5', '22..5', '1.2.3', '  135  ', '-90', '12345678']) {
      const { text, weight } = typedWeight(raw);
      assert.ok(text.length <= 6, `"${raw}" -> "${text}" is longer than the field`);
      if (weight !== null) {
        assert.equal(weight, parseFloat(text), `"${raw}" shows "${text}" but would log ${weight}`);
      }
    }
    assert.equal(typedWeight('2a2b5').text, '225', 'letters are dropped, digits kept');
    assert.equal(typedWeight('22..5').text, '22.5', 'a second decimal point is dropped');
    assert.equal(typedWeight('-90').weight, 90, 'a minus sign cannot make a negative weight');
  });

  test('a stepper after typing steps from the typed number', () => {
    const m = new NowModel(trained(), () => T0);
    type(m, '225');
    m.bumpWeight(1);
    assert.equal(m.state().weight, 230, 'the step must apply to what was typed, not what preceded it');
  });

  /*
   * Journey G — mis-tap, wrong weight. Every keystroke commits with no
   * confirm step (see the "what is on screen is what gets logged" test
   * above), which is exactly what makes a fat-fingered extra digit
   * dangerous: "999999" typed just as fast as "225" and became the working
   * weight before LOG SET was ever tapped. `plausible()` already runs this
   * exact check for a bodyweight reading (40-700 lb, "a typo guard, not a
   * judgement"); typed set weight had no equivalent at all.
   */
  test('typedWeight rejects anything past the ceiling outright', () => {
    for (const raw of ['4500', '999999', '1501']) {
      assert.equal(typedWeight(raw).weight, null, `"${raw}" should not be a real barbell load`);
    }
  });

  test('typing past the ceiling cannot log the implausible number', () => {
    // Every keystroke commits (see above), so typing "4500" one character at
    // a time commits 4, 45, 450 — each plausible on its own — and only balks
    // at the fourth digit; the working weight ends on the last VALID prefix,
    // not on 4500. What matters is that the number that actually gets logged
    // is never the implausible one.
    const m = new NowModel(trained(), () => T0);
    type(m, '4500');
    m.log();
    const logged = m.state().loggedThisExercise.at(-1)!.weight;
    assert.notEqual(logged, 4500, 'the fat-fingered number must never reach the log');
    assert.ok(logged <= 1500, `${logged} is still past the ceiling`);
  });

  test('a real heavy single is still accepted right up to the ceiling', () => {
    assert.equal(typedWeight('1500').weight, 1500, 'the ceiling itself must still commit');
    const m = new NowModel(trained(), () => T0);
    type(m, '1500');
    m.log();
    assert.equal(m.state().loggedThisExercise.at(-1)!.weight, 1500);
  });

  /*
   * The edit-set sheet (correcting a logged set, or adding one from a lift's
   * own block) parses its weight field with a raw regex rather than
   * `typedWeight` — a second, independent path with no ceiling of its own
   * until this round, despite existing specifically to CORRECT a mistake.
   * `ok` disables SAVE the same way it already does for a blank rep count;
   * there is no separate error message, matching that existing pattern.
   */
  /*
   * The fifth surface to carry the volume claim, and the only LIVE one — it
   * prints under the logged sets while the lifter is still in the gym. Found
   * by grepping `sessionStats(` after fixing the recap card, the shared card,
   * Progress's history list and the share message, rather than by tripping
   * over it a round later. See BUILD_LOOP step 4.
   */
  test('the running total does not report a volume it cannot compute', () => {
    const repo = repoWith();
    const m = new NowModel(repo, () => T0);
    m.selectExercise('pushup');
    m.setReps(12);
    m.setWeight(0);
    m.log();
    const st = m.state();
    assert.equal(st.totalSets, 1, 'fixture sanity: a set was logged');
    assert.equal(st.totalVolume, 0, 'the floor is still 0 — nothing was added to the lifter');
    assert.equal(st.totalVolumeKnown, false, 'but the screen must not print it as a total');
  });

  test('an ordinary lift still reports its running total', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.log();
    const st = m.state();
    assert.equal(st.totalVolumeKnown, true);
    assert.ok(st.totalVolume > 0);
  });

  /*
   * `state()` is THE hot read in the app — it runs on every tap, and
   * `allSets()` is called several times inside it. It scaled with total
   * history until the Repo memoised that read: 45.6ms per tap at five years
   * of training, which is four dropped frames on a control whose entire
   * promise is one-tap logging (§4). Nothing guarded it afterwards.
   *
   * Measured against the real stress database (14,000 sets / 700 sessions) at
   * 5.77ms. A guard, not a benchmark — generous enough not to flake on a
   * loaded machine, tight enough that losing the memoisation cannot pass.
   */
  test('the logging screen still recomputes in a frame at five years of history', () => {
    const repo = repoWith();
    for (let i = 0; i < 6000; i++) {
      const sid = `bulk${Math.floor(i / 20)}`;
      if (!repo.session(sid)) repo.startSession(sid, 'lb', undefined, T0 - (6000 - i) * 3600_000);
      repo.logSet({
        id: `b${i}`, sessionId: sid, exerciseId: STARTING_TWELVE[i % 12].id,
        weight: 100 + (i % 90), reps: 5 + (i % 4), at: T0 - (6000 - i) * 3600_000
      });
    }
    const m = new NowModel(repo, () => T0);
    withinBudget(7, 16, 'state() is scanning the whole history again', () => { m.state(); });
  });

  /*
   * Journey G's abandon-mid-workout corner, driven through the REAL entry
   * point. `repo.test.ts` already covers this, but by re-running the
   * constructor's logic by hand — `isStale`, then `autoEnd`, then
   * `endSession` — so deleting that block from `NowModel`'s constructor would
   * leave it green while §4's "a cold launch goes to the active workout,
   * never a workout you finished on Tuesday" quietly broke.
   *
   * Both directions matter and they are in tension: a workout abandoned for
   * ten minutes must RESUME (walked live — one set survived a full reload
   * with its rest timer still running), and one abandoned since Tuesday must
   * NOT.
   */
  describe('a cold launch resumes today\'s workout and not Tuesday\'s', () => {
    /** A live, unfinished session whose last set landed `agoMs` ago. */
    const abandoned = (agoMs: number) => {
      // The clock moves to when the session actually started, so its own
      // `started_at`/`updated_at` land there too — a fixed `() => T0` clock
      // would stamp both from "now" regardless of `agoMs`, making the
      // session read as touched today no matter how old its one set is,
      // which is the exact inconsistent fixture shape R333's idle-rule fix
      // (`lastTouch`) exists to see through.
      let clock = T0 - agoMs;
      const repo = new Repo(new DatabaseSync(':memory:') as any, () => clock);
      repo.startSession('live', 'lb');
      repo.logSet({ id: 'a1', sessionId: 'live', exerciseId: 'bench', weight: 225, reps: 5, at: T0 - agoMs });
      clock = T0;
      return repo;
    };

    test('a workout left ten minutes ago is picked back up', () => {
      const repo = abandoned(10 * MIN);
      const st = new NowModel(repo, () => T0).state();
      assert.equal(st.session.id, 'live', 'it started a new session over a live one');
      assert.equal(st.totalSets, 1, 'the set logged before the interruption is gone');
    });

    test('a workout left since Tuesday is closed, not resumed', () => {
      const repo = abandoned(5 * DAY);
      const st = new NowModel(repo, () => T0).state();
      assert.notEqual(st.session.id, 'live', 'resumed a workout finished five days ago');
      assert.equal(st.totalSets, 0, 'the new session inherited the old one\'s sets');
    });

    test('and the closed one is backdated to its last set, not to now', () => {
      const repo = abandoned(5 * DAY);
      new NowModel(repo, () => T0);
      assert.equal(repo.session('live')!.endedAt, T0 - 5 * DAY,
        'ending it at `now` would claim a five-day workout');
    });
  });

  test('the edit-set sheet reuses the same ceiling, not a second copy of it', () => {
    const src = nowScreenSource();
    assert.match(src, /w <= MAX_TYPED_WEIGHT/,
      'EditSetSheet must reuse the shared ceiling rather than trusting the 6-character text cap alone');
  });
});

// Journey B — a returning user's second session. §4 rests on "pre-filled with
// last time's numbers", and after one workout the app opened on Bench Press at
// a seeded 95 lb for someone who had only ever squatted, with UP NEXT pointing
// at Squat at the same time. Last time's numbers were a tap away instead of
// being on the screen.
describe('Now screen — the second session (§4, §7)', () => {
  /** One finished workout, yesterday: squat then row. */
  function oneSessionIn(now = T0): Repo {
    return repoWith([
      ['s1', 'squat', 225, 5, now - DAY],
      ['s1', 'row', 150, 8, now - DAY + 20 * MIN]
    ], now);
  }

  test('opens on a lift they actually train, not the head of the twelve', () => {
    const s = new NowModel(oneSessionIn(), () => T0).state();
    assert.equal(s.exercise.id, 'squat');
  });

  test('with last time\'s numbers already loaded', () => {
    const s = new NowModel(oneSessionIn(), () => T0).state();
    assert.equal(s.weight, 225);
    assert.equal(s.reps, 5);
    assert.equal(s.prefillSource, 'history', 'a returning user must never be told "somewhere to start"');
  });

  test('and the "last time" line can be shown, because there is a last time', () => {
    const m = new NowModel(oneSessionIn(), () => T0);
    const last = m.lastTime();
    assert.ok(last, 'the line §5 requires without interaction must have something to say');
    assert.equal(last!.weight, 225);
  });

  test('UP NEXT points at the rest of the workout, not back at the opener', () => {
    const s = new NowModel(oneSessionIn(), () => T0).state();
    assert.ok(s.upNext, 'a second lift is known and should be offered');
    assert.notEqual(s.upNext!.id, s.exercise.id);
  });

  test('it opens where the workout STARTED, not on the last accessory', () => {
    const repo = repoWith([
      ['s1', 'squat', 225, 5, T0 - DAY],
      ['s1', 'legpress', 200, 10, T0 - DAY + 20 * MIN],
      ['s1', 'curl', 30, 12, T0 - DAY + 40 * MIN]
    ], T0);
    assert.equal(new NowModel(repo, () => T0).state().exercise.id, 'squat');
  });

  test('a genuine cold start is untouched — still the starting twelve', () => {
    const s = new NowModel(repoWith(), () => T0).state();
    assert.equal(s.exercise.id, STARTING_TWELVE[0].id);
    assert.equal(s.firstEver, true);
  });
});

// The Now column does not scroll — §4 keeps LOG SET reachable without one, and
// a logging path you have to scroll to is not a one-tap logging path. The cost
// is that the column has to FIT, and it did not: it spent ~660px of fixed
// height whatever the viewport, so on anything shorter than a phone the footer
// rendered below the fold with no way to reach it. Reported as "when i preview
// it doesnt show it all".
describe('Now screen — the column has to fit (§4)', () => {
  /*
   * Every viewport height the app can plausibly be handed.
   *
   * This list started at 500 and passed — against arithmetic that was wrong.
   * `fixedHeight` budgeted 12px for the ±45 / ±5 jump row, which measures 40px
   * on the running app, so the whole function was promising 28px it did not
   * have and every assertion here was checking that promise against itself.
   * With the real number in, the column's fixed parts come to 512px, so 500 is
   * not a height this screen fits — and saying so is better than shrinking a
   * touch target until the number goes green. 520 is below every shipping
   * device; the shortest iPhone in circulation is the SE at 568. It moved
   * from 520 to 560 when the rail's heading stopped being droppable — the
   * fixed parts now come to 526.
   */
  const HEIGHTS = [560, 568, 600, 667, 700, 736, 780, 812, 844, 932, 1000];

  /*
   * The claim changed when the constants stopped lying.
   *
   * `columnHeight` is a CONSERVATIVE estimate now: HEADER_TEXT was 58 against a
   * measured 79 and STEP_HINT was 12 against a measured 40, so it used to report
   * a comfortable fit for columns that overflowed. It also budgets the day rail
   * unconditionally, and the rail does not exist until a set is logged.
   *
   * So "it fits everywhere" is no longer the honest invariant, and asserting it
   * is what produced the fiction. What has to hold is that the screen either
   * fits or degrades on purpose: TODAY is squeezed to nothing first, and the
   * column then top-aligns so overflow goes down rather than into the nav. Both
   * halves were verified on the running app - an iPhone SE at 375x568 keeps LOG
   * SET fully visible at y364-390 with the rail up.
   */
  test('every height either fits or degrades on purpose', () => {
    for (const h of HEIGHTS) {
      const l = layoutFor(375, h);
      const fits = columnHeight(l) <= h;
      assert.ok(fits || l.todayMin === 0,
        `at ${h}px the column needs ${columnHeight(l)}px and TODAY still claims ` +
        `${l.todayMin}px — it must give that up before anything overflows`);
    }
  });

  test('the tap targets never shrink, whatever the height', () => {
    for (const h of HEIGHTS) {
      const l = layoutFor(375, h);
      assert.ok(l.logHeight >= HIT, `LOG SET shrank below a thumb at ${h}px`);
      // The rail is dropped whole below the shortest shipping phone rather than
      // squeezed — a half-height rail is a clipped rail.
      assert.ok(l.railHeight === 0 || l.railHeight >= 58,
        `the rail was squeezed rather than dropped at ${h}px`);
    }
  });

  test('and at every width, including a desktop pane', () => {
    // Same claim as the height sweep: `columnHeight` is a conservative estimate,
    // so what must hold is that the screen either fits or gives up TODAY first
    // — never that the estimate itself comes in under the viewport.
    for (const w of [320, 375, 390, 430, 768, 1280]) {
      const l = layoutFor(w, 600);
      assert.ok(columnHeight(l) <= 600 || l.todayMin === 0,
        `${w}x600 needs ${columnHeight(l)}px with TODAY still claiming ${l.todayMin}px`);
    }
  });

  test('LOG SET never shrinks below a thumb', () => {
    for (const h of HEIGHTS) {
      assert.ok(layoutFor(375, h).logHeight >= HIT,
        `a shorter screen does not make the thumb smaller (${h}px)`);
    }
  });

  /*
   * The floor is a fact about the screen, so it is stated rather than implied.
   * If someone adds another row to the logging path, this is the test that says
   * what it cost.
   */
  test('the shortest shipping device still reaches LOG SET', () => {
    /*
     * An iPhone SE is 568. The model reports the fixed parts at 592 there, and
     * the app is fine in practice: measured on the running app at exactly that
     * size, with a set logged and the rail up, LOG SET sits at y364-390 and
     * FINISH at y549-566 — both inside the screen. `columnHeight` is a
     * conservative estimate and over-budgets 568 by roughly 46px, so the number
     * to guard is not "does the estimate fit" but "has the estimate stopped
     * being roughly right", which a large drift would break.
     */
    const l = layoutFor(375, 568);
    assert.equal(l.todayMin, 0, 'TODAY should already have given up its space here');
    const fixed = columnHeight(l) - l.todayMin;
    assert.ok(fixed <= 568 + 48,
      `the unshrinkable parts came to ${fixed}px against a 568px screen — that is ` +
      'further past the measured conservatism than a rounding change explains');
  });

  test('a phone-sized screen is left exactly as it was drawn', () => {
    // The scaling is a rescue for short viewports, not a redesign. Every real
    // iPhone is 780px or taller in this layout, and must be untouched.
    // 780 is now the boundary rather than comfortably inside it — the honest
    // constants cost 21px — so the lock is on the sizes that are genuinely
    // untouched. Every shipping iPhone since the X is 812 or taller.
      /*
       * 90 on 844 and up, 80 on an 812.
       *
       * TODAY is the part that gives — that is this layout's stated rule, and
       * adding the "THIS WORKOUT" heading over the logged-set list is the first
       * time an 812px phone has had to exercise it. The heading is 18px of
       * budget in `fixedHeight`, so the scrolling list keeps 80 of its designed
       * 90 on the shortest phone above the scaling floor and its full 90 on
       * everything taller.
       *
       * Locked per height rather than relaxed to a range, because the value of
       * this test is that a change to any constant in `fixedHeight` shows up
       * here as a number rather than as a shrug.
       */
    for (const h of [812, 844, 932]) {
      const l = layoutFor(375, h);
      assert.equal(l.logHeight, 72);
      assert.equal(l.headerGap, 28);
      assert.equal(l.todayMin, h >= 844 ? 90 : 80);
      assert.equal(l.footerGap, 26);
      // The hero is capped by the row it has to fit in as well as by the
      // viewport — see "the hero fits the number it is showing" below.
      assert.ok(Math.abs(l.hero - 113) <= 4, `hero drifted to ${l.hero}`);
    }
  });

  test('the hero is capped by height as well as width', () => {
    // Sizing the number off the width alone is what ate the vertical space.
    assert.ok(layoutFor(1280, 560).hero < layoutFor(1280, 900).hero,
      'a wide but short pane must not get a 120px number');
    assert.equal(layoutFor(1280, 1000).hero, 120, 'and it is still capped at 120');
  });

  test('TODAY collapses fastest, because it is the part that scrolls', () => {
    const short = layoutFor(375, 560), tall = layoutFor(375, 812);
    assert.ok(short.todayMin / tall.todayMin < short.logHeight / tall.logHeight,
      'the scrollable region should give up room before the controls do');
  });
});

// §5 is iOS-first. Past a phone's width the layout does not improve, it just
// stretches — on a 1280px preview pane the two weight steppers sat 1200px apart
// with the number marooned between them.
describe('Now screen — the column is phone-shaped (§5)', () => {
  test('a wide viewport letterboxes instead of stretching', () => {
    assert.equal(layoutFor(1280, 800).column, 430);
    assert.equal(layoutFor(768, 800).column, 430);
  });

  test('a phone uses every pixel it has', () => {
    for (const w of [320, 375, 390, 428]) {
      assert.equal(layoutFor(w, 812).column, w, 'no letterboxing on a real device');
    }
  });

  test('the hero is sized off the column, not the window', () => {
    // Sizing it off the raw width gave a 384px number on a desktop pane.
    assert.equal(layoutFor(1280, 900).hero, layoutFor(430, 900).hero);
  });
});

// FINISH -> DONE returns to a screen that was never unmounted, so the model
// came back still holding the session it had just ended. The user was left
// inside a finished workout, and logging from there wrote into a closed
// session whose endedAt was earlier than the sets inside it.
describe('Now screen — after finishing (§4)', () => {
  test('logging again starts a NEW workout, never appends to the closed one', () => {
    const repo = repoWith();
    const m = new NowModel(repo, () => T0);
    m.log();
    const finished = m.finish();

    const later = new NowModel(repo, () => T0);            // same model instance below
    void later;
    m.log();                                                // the tap that used to corrupt

    const stale = repo.setsInSession(finished.id);
    assert.equal(stale.length, 1, 'the finished workout must stay as it was celebrated');
    assert.notEqual(m.state().session.id, finished.id, 'a new session, not the old one');
    assert.equal(m.state().loggedThisSession.length, 1, 'and the new one holds only the new set');
  });

  test('a finished session never ends up with sets logged after it ended', () => {
    const repo = repoWith();
    const m = new NowModel(repo, () => T0);
    m.log();
    const finished = m.finish();
    m.log();
    const sets = repo.setsInSession(finished.id);
    for (const s of sets) {
      assert.ok(s.at <= finished.endedAt!, 'a set inside a workout that had already ended');
    }
  });

  test('returning to the screen clears it before anything is tapped', () => {
    const repo = repoWith();
    const m = new NowModel(repo, () => T0);
    m.log(); m.log();
    assert.equal(m.state().totalSets, 2);

    m.finish();
    assert.equal(m.startNextIfFinished(), true, 'the screen asks this on focus');
    const s = m.state();
    assert.equal(s.totalSets, 0, 'TODAY still listed the workout the user had just been congratulated on');
    assert.equal(s.rest.label, null, 'and a rest clock was still running for it');
    assert.equal(s.session.endedAt, null);
  });

  test('it is a no-op mid-workout, so a stray focus cannot split a session', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.log();
    const id = m.state().session.id;
    assert.equal(m.startNextIfFinished(), false);
    assert.equal(m.startNextIfFinished(), false);
    assert.equal(m.state().session.id, id);
    assert.equal(m.state().totalSets, 1);
  });

  test('the new workout opens on what they just trained', () => {
    // It is the same rung as journey B, one session later: whatever you did
    // last is the best guess for what you are about to do.
    const repo = repoWith();
    const m = new NowModel(repo, () => T0);
    m.selectExercise('deadlift');
    m.log();
    m.finish();
    m.startNextIfFinished();
    assert.equal(m.state().exercise.id, 'deadlift');
  });
});

// The split (§6, §7). §7's predictor says nothing until three sessions exist,
// so on a first-ever workout UP NEXT was BLANK — rank the history, remove what
// is already done, and for a beginner that is the empty set. The person with no
// idea what to do next was the one person the app told nothing.
describe('Now screen — the split fills in what history cannot (§7)', () => {
  test('UP NEXT is no longer empty on a first-ever workout', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.selectExercise('bench');
    m.log();
    const s = m.state();
    assert.ok(s.upNext, 'a beginner three sets in was shown nothing');
    assert.notEqual(s.upNext!.id, 'bench');
  });

  test('and it suggests something from the same day', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.selectExercise('bench');
    m.log();
    assert.equal(m.state().upNext!.id, 'ohp', 'push follows push');
  });

  test('the workout knows which day it is once anything is logged', () => {
    const m = new NowModel(repoWith(), () => T0);
    assert.equal(m.state().day, 'push', 'it opens on bench, so the day is knowable at once');
    m.selectExercise('squat');
    m.log();
    assert.equal(m.state().day, 'legs');
  });

  test('the picker leads with the day being trained', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.selectExercise('squat');
    m.log();
    const groups = m.state().pickerGroups;
    assert.equal(groups[0].day, 'legs');
    assert.ok(groups.length > 1, 'the other days stay reachable');
  });

  test('the picker still offers everything, grouped', () => {
    const m = new NowModel(repoWith(), () => T0);
    const s = m.state();
    const grouped = s.pickerGroups.flatMap(g => g.exercises.map(e => e.id));
    assert.deepEqual([...grouped].sort(), [...s.picker.map(e => e.id)].sort(),
      'grouping must not drop or invent a movement');
  });

  test('a movement they invented is offered, and does not name the day', () => {
    const repo = repoWith();
    const m = new NowModel(repo, () => T0);
    m.addCustomExercise('Sissy Squat');
    m.log();
    const s = m.state();
    assert.equal(s.day, null, 'the app cannot know which day a lift it has never heard of is');
    const yours = s.pickerGroups.find(g => g.day === null);
    assert.ok(yours, 'it still has to be selectable');
    assert.ok(yours!.exercises.some(e => e.name === 'Sissy Squat'));
  });

  test('real history beats the convention', () => {
    // Someone who squats on push day is not wrong, and the app must not correct
    // them once it has evidence of what they actually do.
    const rows: Array<[string, string, number, number, number]> = [];
    for (let w = 4; w >= 1; w--) {
      rows.push([`h${w}`, 'bench', 135, 5, T0 - w * 7 * DAY]);
      rows.push([`h${w}`, 'squat', 225, 5, T0 - w * 7 * DAY + 20 * MIN]);
    }
    const m = new NowModel(repoWith(rows, T0), () => T0);
    m.selectExercise('bench');
    m.log();
    assert.equal(m.state().upNext!.id, 'squat', 'their own pattern, not the push-day convention');
  });
});

// FINISH was offered from the moment the app opened. Tapping it with nothing
// logged pushed a recap reading "Nothing logged yet" with a BACK button, and
// ended a session with no sets in it — a phantom row for every launch someone
// opened and did not train.
describe('Now screen — you cannot finish what you did not start (§5)', () => {
  test('FINISH is not offered until something is logged', () => {
    const m = new NowModel(repoWith(), () => T0);
    assert.equal(m.state().canFinish, false);
    m.log();
    assert.equal(m.state().canFinish, true);
  });

  test('and finishing an empty workout leaves no phantom session', () => {
    const repo = repoWith();
    const m = new NowModel(repo, () => T0);
    const before = m.state().session.id;
    m.finish();
    assert.equal(m.state().session.endedAt, null, 'nothing was ended');
    assert.equal(m.state().session.id, before, 'and no new session was started');
    assert.ok(repo.liveSession(), 'the open session is reused on the next launch');
  });

  test('undoing back to empty withdraws the offer again', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.log();
    m.undo();
    assert.equal(m.state().canFinish, false);
  });

  test('a real workout still finishes normally', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.log();
    const done = m.finish();
    assert.ok(done.endedAt, 'a workout with sets in it must still end');
    assert.equal(m.state().canFinish, true, 'and the recap is still reachable from it');
  });
});

describe('Now screen — the picker opens on where you are', () => {
  test('training a movement you invented leads with YOURS', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.log();                                       // a push set first, so the day is push
    m.addCustomExercise('Sissy Squat');
    const groups = m.state().pickerGroups;
    assert.equal(groups[0].label, 'YOURS', 'the lift you are on was below the fold and unmarked');
    assert.ok(groups[0].exercises.some(e => e.name === 'Sissy Squat'));
  });

  test('and the workout is still named by what was actually trained', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.log();
    m.addCustomExercise('Sissy Squat');
    assert.equal(m.state().day, 'push', 'a custom lift must not rename the day');
  });

  test('going back to a normal lift restores the day order', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.log();
    m.addCustomExercise('Sissy Squat');
    m.selectExercise('squat');
    assert.equal(m.state().pickerGroups[0].day, 'legs');
  });
});

// With twelve weeks of a real push/pull/legs routine the app suggested SQUAT
// immediately after Bench Press. `predictSession` orders by typical position
// within a session, and on a PPL routine every day's opener has position 0 —
// so the ranking has no idea the days exist and sent the user to another day's
// lift mid-workout. Only visible with history spread over months.
describe('Now screen — UP NEXT stays on the day being trained (§7)', () => {
  /** Twelve weeks of push / pull / legs, three sessions a week. */
  function ppl(): Repo {
    const rows: Array<[string, string, number, number, number]> = [];
    const split: Array<[string, string[]]> = [
      ['push', ['bench', 'ohp', 'triext']],
      ['pull', ['deadlift', 'row', 'curl']],
      ['legs', ['squat', 'legpress']]
    ];
    for (let w = 12; w >= 1; w--) {
      split.forEach(([day, lifts], i) => {
        const at = T0 - w * 7 * DAY + i * 2 * DAY;
        lifts.forEach((ex, j) => rows.push([`w${w}_${day}`, ex, 100 + j * 5, 5, at + j * 20 * MIN]));
      });
    }
    return repoWith(rows, T0);
  }

  test('after a push lift it suggests another push lift', () => {
    const m = new NowModel(ppl(), () => T0);
    m.selectExercise('bench');
    m.log();
    const next = m.state().upNext!;
    assert.ok(next, 'there is more push work to suggest');
    assert.equal(dayOf(next.id), 'push', `suggested ${next.id}, which is not a push movement`);
  });

  test('after a leg lift it suggests another leg lift', () => {
    const m = new NowModel(ppl(), () => T0);
    m.selectExercise('squat');
    m.log();
    assert.equal(dayOf(m.state().upNext!.id), 'legs');
  });

  test('their own ranking still decides the order within the day', () => {
    // The split only rules OUT the wrong day. It must not start choosing.
    const m = new NowModel(ppl(), () => T0);
    m.selectExercise('bench');
    m.log();
    const next = m.state().upNext!.id;
    const ranked = nextCandidates(ppl().allSets(), ['bench'], T0, new Date(T0).getDay());
    assert.equal(next, ranked.find(id => dayOf(id) === 'push'),
      'it must be their highest-ranked push lift, not the seed list order');
  });

  test('when the day is exhausted it still suggests something', () => {
    const m = new NowModel(ppl(), () => T0);
    for (const id of ['bench', 'ohp', 'triext']) { m.selectExercise(id); m.log(); }
    const next = m.state().upNext;
    assert.ok(next, 'a finished day must not leave the swipe target empty');
    assert.notEqual(dayOf(next!.id), 'push', 'there is no push work left to do');
  });
});

// Journey G. A set logged wrong and then moved on from was stranded: visible in
// TODAY, with the only way to remove it three taps away behind realising you
// had to switch back to that lift first. The mistake was on screen and the fix
// was not.
describe('Now screen — a mistake can be fixed from where it is shown (§4)', () => {
  test('any lift in the session can be undone, not just the current one', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.selectExercise('bench');
    m.log();
    m.selectExercise('squat');
    m.log();

    assert.equal(m.undo('bench'), true, 'the wrong set was unreachable from here');
    const today = m.state().today;
    assert.equal(today.find(l => l.exerciseId === 'bench'), undefined, 'the bad set is gone');
    assert.equal(today.find(l => l.exerciseId === 'squat')!.sets.length, 1,
      'and the lift they are actually on is untouched');
  });

  test('undo still defaults to the lift being trained', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.log(); m.log();
    m.undo();
    assert.equal(m.state().loggedThisExercise.length, 1);
  });

  test('undoing a lift with nothing logged changes nothing', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.selectExercise('bench');
    m.log();
    assert.equal(m.undo('deadlift'), false);
    assert.equal(m.state().totalSets, 1, 'a no-op must not eat somebody else\'s set');
  });

  test('undo takes the LAST set of that lift, not the last set overall', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.selectExercise('bench');
    m.setWeight(135); m.log();
    m.setWeight(185); m.log();
    m.selectExercise('squat');
    m.setWeight(225); m.log();

    m.undo('bench');
    const bench = m.state().today.find(l => l.exerciseId === 'bench')!;
    assert.deepEqual(bench.sets.map(s => s.weight), [135], 'it removed the wrong one');
    assert.equal(m.state().today.find(l => l.exerciseId === 'squat')!.sets.length, 1);
  });

  test('undoing everything withdraws FINISH again', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.selectExercise('bench');
    m.log();
    m.selectExercise('squat');
    m.log();
    m.undo('bench');
    m.undo('squat');
    assert.equal(m.state().canFinish, false);
  });
});

// Journey H. `typedWeight` allows six characters, and at six the hero row was
// 135px wider than a 320px phone: `scrollWidth` 455 against a `clientWidth` of
// 320, the page scrolling sideways and the + stepper off the screen entirely.
// Sizing the hero from the viewport alone cannot see that.
describe('Now screen — the hero fits the number it is showing (§4)', () => {
  /** What the row costs beside the number: padding, two steppers, the unit. */
  const CHROME = 40 + 2 * HIT + 36;
  const width = (chars: number, l: ReturnType<typeof layoutFor>) => heroWidth(l.hero, chars) + CHROME;

  test('six characters still fit on the smallest phone', () => {
    const l = layoutFor(320, 568, 6);
    assert.ok(width(6, l) <= l.column, `needs ${Math.round(width(6, l))}px of ${l.column}`);
  });

  test('and at every width and length the app allows', () => {
    for (const w of [320, 375, 390, 430, 1280]) {
      for (const chars of [1, 2, 3, 4, 5, 6]) {
        const l = layoutFor(w, 812, chars);
        assert.ok(width(chars, l) <= l.column + 1,
          `${w}px wide, ${chars} chars: needs ${Math.round(width(chars, l))}px of ${l.column}`);
      }
    }
  });

  test('a normal weight on a normal phone barely moves', () => {
    // The cap has to bite a little even here — a three-digit weight at the old
    // 113px was 7px wider than a 375px screen, which nothing had measured. The
    // cost of fixing it is 2px of hero on the commonest phone.
    for (const [w, h, was] of [[375, 812, 113], [390, 844, 117], [430, 932, 120]] as const) {
      const now = layoutFor(w, h, 3).hero;
      assert.ok(Math.abs(now - was) <= 4, `${w}x${h}: hero moved ${was} -> ${now}`);
    }
  });

  test('the everyday case no longer overflows the screen', () => {
    // This is the one that had been wrong all along, not just at six digits.
    const l = layoutFor(375, 812, 3);
    assert.ok(width(3, l) <= 375, `a 3-digit weight needs ${Math.round(width(3, l))}px of 375`);
  });

  test('a longer number gets a smaller hero, never a wider row', () => {
    const three = layoutFor(320, 568, 3), six = layoutFor(320, 568, 6);
    assert.ok(six.hero < three.hero, 'six characters must not be drawn at three-character size');
    assert.equal(six.column, three.column, 'the column itself never grows to accommodate');
  });

  test('it never shrinks to something unreadable', () => {
    for (const chars of [1, 2, 3, 4, 5, 6]) {
      assert.ok(layoutFor(320, 568, chars).hero >= 24, 'the hero is still the hero');
    }
  });

  test('every hero size either fits or degrades on purpose', () => {
    for (const chars of [1, 3, 6]) {
      for (const h of [560, 600, 812]) {
        const l = layoutFor(375, h, chars);
        assert.ok(columnHeight(l) <= h || l.todayMin === 0,
          `${chars} chars at ${h}px needs ${columnHeight(l)}px with TODAY at ${l.todayMin}`);
      }
    }
  });
});

describe('Now screen — the line under the lift name is never blank (§4)', () => {
  const setOf = (weight: number, reps: number, id = 'x'): any =>
    ({ id, sessionId: 's', exerciseId: 'bench', weight, reps, at: T0 });

  test('an earlier session outranks everything — that is what §4 asks for', () => {
    assert.equal(
      lastTimeLine({ previous: setOf(225, 5), thisSession: [setOf(95, 8)] }),
      'Last time  225 × 5'
    );
  });

  test('with no earlier session, the set just logged fills the line', () => {
    assert.equal(lastTimeLine({ previous: null, thisSession: [setOf(95, 8)] }), 'Just did  95 × 8');
  });

  test('the most recent set of this session wins, not the first', () => {
    assert.equal(
      lastTimeLine({ previous: null, thisSession: [setOf(95, 8), setOf(115, 5)] }),
      'Just did  115 × 5'
    );
  });

  test('with nothing at all, the app admits the number is its own suggestion', () => {
    assert.equal(lastTimeLine({ previous: null, thisSession: [] }), 'First time');
  });

  /*
   * The defect journey A found. "Somewhere to start" is on screen, the user
   * taps LOG SET for the first time in their life, and the line becomes a
   * single space — 20px of empty gap under the app's own title. Their first
   * tap deleted the only encouraging thing on the screen.
   */
  test('logging the FIRST EVER set does not blank the line', () => {
    const m = new NowModel(repoWith(), () => T0);
    assert.equal(lineOf(m), `First time — ${m.state().weight} is a starting point`);
    m.log();
    const after = lineOf(m);
    assert.notEqual(after.trim(), '', 'this is the bug: a blank line where copy used to be');
    assert.equal(after, `Just did  ${m.state().weight} × ${m.state().reps}`);
  });

  test('nothing on this screen renders as whitespace', () => {
    const m = new NowModel(repoWith(), () => T0);
    for (let i = 0; i < 3; i++) {
      assert.ok(lineOf(m).trim().length > 0, `blank after ${i} sets`);
      m.log();
    }
    assert.ok(lineOf(m).trim().length > 0, 'blank after 3 sets');
  });

  /*
   * The same hole, reached from the other side and worse: a movement the user
   * invented has no seed, so `prefillSource` was 'fallback' rather than 'seed'
   * and the line was blank from the very first frame — they never saw copy
   * there at all.
   */
  test('a lift the user invented gets a line too, before anything is logged', () => {
    const m = new NowModel(repoWith(), () => T0);
    assert.ok(m.addCustomExercise('Sissy Squat'), 'the custom lift must be created');
    const s = m.state();
    assert.equal(s.prefillSource, 'fallback', 'no seed exists for an invented movement');
    assert.equal(s.lastTime.head + s.lastTime.tail, `First time — ${s.weight} is a starting point`);
  });

  test('a second session speaks about the previous one, never about this one', () => {
    /*
     * R518: this asserted the literal "Last time  215 × 5". The coach line
     * (OWNER.md #2) now owns this slot when it has something to say, and this
     * fixture is four weekly squats at 200/205/210/215 — a lifter on linear
     * progression — so it says so and names the next rung.
     *
     * The invariant the test was written for is untouched and is what is
     * asserted now: the line is about the PREVIOUS session's number, and
     * logging a set today must not displace it with "just did". Both the old
     * line and the coach line cite 215; only the coach line also says what to
     * do with it.
     */
    const m = new NowModel(trained(), () => T0);
    assert.match(lineOf(m), /215/, 'the line must name the weight that decides what to load');
    assert.doesNotMatch(lineOf(m), /^Just did/);
    m.log();
    assert.doesNotMatch(
      lineOf(m), /^Just did/,
      'the previous session is the number that decides what to load — it must not be displaced'
    );
  });

  /*
   * R641, the owner's call on the R555 filing: on day one the hero shows a
   * confident number the lifter never lifted. The app knows it chose it
   * (prefill source seed/fallback), so the line says so -- and ONLY then.
   */
  test('an app-chosen starting weight is named as a starting point', () => {
    assert.equal(lastTimeLine({ previous: null, thisSession: [], start: 45 }),
      'First time — 45 is a starting point');
    assert.equal(lastTimeParts({ previous: null, thisSession: [], start: 20 }, 'es').head,
      'Primera vez — 20 es un punto de partida');
  });

  test('the label never claims a number the lifter chose themselves', () => {
    // A real previous session, or a set logged today, always outranks it.
    assert.equal(lastTimeLine({ previous: setOf(135, 5), thisSession: [], start: 45 }),
      'Last time  135 × 5');
    assert.equal(lastTimeLine({ previous: null, thisSession: [setOf(95, 8)], start: 45 }),
      'Just did  95 × 8');
    // And a lift with history hands the model no start at all.
    const m = new NowModel(trained(), () => T0);
    assert.doesNotMatch(lineOf(m), /starting point/);
  });

  test('the label names the number the app chose, not one the lifter tapped to', () => {
    const m = new NowModel(repoWith(), () => T0);
    const chosen = m.state().weight;
    m.bumpWeight(1);
    assert.notEqual(m.state().weight, chosen);
    assert.equal(lineOf(m), `First time — ${chosen} is a starting point`);
  });

  test('switching to an untrained lift mid-session still says something', () => {
    const m = new NowModel(trained(), () => T0);
    m.log();
    m.selectExercise('bench');
    assert.equal(lineOf(m), `First time — ${m.state().weight} is a starting point`,
      'never trained, nothing logged today');
    m.log();
    assert.match(lineOf(m), /^Just did  /, 'trained today, never before');
  });
});

describe('Now screen — TODAY follows the lift you are on (§4)', () => {
  // The seeded push day, measured off the running app: a 218px viewport,
  // 357px of content, three blocks.
  const PUSH = [{ y: 0, h: 119 }, { y: 119, h: 119 }, { y: 238, h: 119 }];
  const VIEW = 218, CONTENT = 357;

  const reveal = (current: number, scrollTop = 0, blocks = PUSH) =>
    revealOffset({ blocks, current, viewport: VIEW, content: CONTENT, scrollTop });

  /*
   * The defect journey B found. Three lifts into the seeded routine, the block
   * for the lift being trained — its volt dot, its sets, and R38's per-lift
   * UNDO — was 0px visible: y 765 against a scroller ending at 745, with
   * scrollTop still 0 and no scroll indicator to suggest there was more.
   */
  test('the third lift is brought into view instead of sitting below the fold', () => {
    const to = reveal(2);
    assert.notEqual(to, null, 'this is the bug: the list never scrolled itself');
    assert.equal(to, 238 + 119 - VIEW, 'its bottom lands on the viewport bottom');
    assert.ok(to! + VIEW >= 238 + 119, 'the whole block is now on screen');
  });

  // The common case is set after set on one lift. A list that jumps every tap
  // is worse than one that sits still.
  test('a block already fully in view does not move', () => {
    assert.equal(reveal(0), null, 'y 0..119 sits inside a 218px viewport at scrollTop 0');
    const two = [{ y: 0, h: 100 }, { y: 100, h: 100 }];
    assert.equal(
      revealOffset({ blocks: two, current: 1, viewport: VIEW, content: 300, scrollTop: 0 }),
      null, 'y 100..200 also fits'
    );
  });

  // Measured live: with three blocks the SECOND is cut off by 20px too, which
  // is where its UNDO is. The fix is not only about the last block.
  test('a block clipped by a few pixels is still brought fully into view', () => {
    assert.equal(reveal(1), 238 - VIEW, 'y 119..238 overhangs a 218px viewport by 20');
  });

  test('scrolling to a block that is already exactly in place returns null', () => {
    assert.equal(reveal(2, 139), null, '139 is where reveal would put it');
  });

  /*
   * `buildToday` orders blocks by when each lift first appeared and only
   * appends the current one if it has no sets — so switching BACK to a lift
   * trained earlier makes the block you need the first one. `scrollToEnd()`
   * would scroll confidently away from it.
   */
  test('switching back to an earlier lift scrolls UP to it', () => {
    const to = reveal(0, 139);
    assert.equal(to, 0, 'the current lift is the first block, not the last');
  });

  test('a block above the fold aligns to its top, not its bottom', () => {
    const to = reveal(1, 200);
    assert.equal(to, 119, 'showing the name is the point');
  });

  /*
   * PT1 (R684). At 375x812 the list is a 52px window, shorter than one lift's
   * name and its row of sets, and showing the head left the latest set's +
   * half under CLEAR / FINISH, where a thumb could not press it. The name is
   * the screen's title already; the tail is where the next tap goes.
   */
  test('a block taller than the viewport shows its tail: the latest set, its UNDO and +', () => {
    const tall = [{ y: 0, h: 100 }, { y: 100, h: 400 }];
    const to = revealOffset({ blocks: tall, current: 1, viewport: VIEW, content: 500, scrollTop: 0 });
    assert.equal(to, 100 + 400 - VIEW, 'the latest set is at the bottom of the block');
    // Scrolled past it, too: the tail, not the name.
    assert.equal(revealOffset({ blocks: tall, current: 1, viewport: VIEW, content: 900, scrollTop: 600 }), 100 + 400 - VIEW);
  });

  test('the offset never exceeds what there is to scroll', () => {
    for (let i = 0; i < PUSH.length; i++) {
      for (const at of [0, 50, 139]) {
        const to = reveal(i, at);
        if (to === null) continue;
        assert.ok(to >= 0, `negative offset for block ${i}`);
        assert.ok(to <= CONTENT - VIEW, `offset ${to} scrolls past the end for block ${i}`);
      }
    }
  });

  test('content that fits needs no scrolling at all', () => {
    const two = [{ y: 0, h: 100 }, { y: 100, h: 100 }];
    assert.equal(revealOffset({ blocks: two, current: 1, viewport: VIEW, content: 200, scrollTop: 0 }), null);
  });

  // onLayout has not run on the first render. Scrolling on a guess would move
  // the list to an offset computed from zeros.
  test('nothing is measured yet, so nothing moves', () => {
    assert.equal(revealOffset({ blocks: PUSH, current: 2, viewport: 0, content: 0, scrollTop: 0 }), null);
  });

  test('no current lift, or an empty list, is not a scroll', () => {
    assert.equal(reveal(-1), null, 'findIndex returned -1');
    assert.equal(revealOffset({ blocks: [], current: 0, viewport: VIEW, content: 0, scrollTop: 0 }), null);
  });

  /*
   * End to end against the real model rather than hand-made offsets: three
   * lifts of the seeded push day, and the block that must be reachable is the
   * one the model marks current.
   */
  test('the block the model marks current is the one revealed', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.log();
    m.selectExercise('ohp'); m.log();
    m.selectExercise('triext'); m.log();
    const today = m.state().today;
    assert.equal(today.length, 3, 'three lifts in the session');
    const current = today.findIndex(l => l.current);
    assert.equal(current, 2, 'the lift being trained is the third block');
    const to = revealOffset({
      blocks: today.map((_, i) => ({ y: i * 119, h: 119 })),
      current, viewport: VIEW, content: CONTENT, scrollTop: 0
    });
    assert.equal(to, 139, 'and it gets scrolled into view');
  });
});

/*
 * Journey G, second walk. Its question is "can it be undone without thinking",
 * and R38 answered it for the mistake you notice after moving on. This is the
 * one it did not reach: a set logged wrong in the MIDDLE.
 */
describe('Now screen — a bad set in the middle can be removed (§4)', () => {
  const setsOf = (m: NowModel, ex = 'triext') =>
    m.state().today.find(l => l.exerciseId === ex)?.sets ?? [];

  /** 55, 55, 255 (the fat-finger), 55 — the shape measured on the running app. */
  function withBadMiddleSet() {
    const m = new NowModel(repoWith(), () => T0);
    m.selectExercise('triext');
    m.setWeight(55); m.setReps(12);
    m.log(); m.log();
    m.setWeight(255); m.log();
    m.setWeight(55); m.log();
    return m;
  }

  test('the trap: UNDO can only take the tail, so the good set goes first', () => {
    const m = withBadMiddleSet();
    assert.deepEqual(setsOf(m).map(s => s.weight), [55, 55, 255, 55]);
    m.undo('triext');
    assert.deepEqual(setsOf(m).map(s => s.weight), [55, 55, 255],
      'UNDO removed the GOOD set — the mistake is still there');
  });

  test('the set that was wrong is the set that goes', () => {
    const m = withBadMiddleSet();
    const bad = setsOf(m).find(s => s.weight === 255)!;
    assert.equal(m.removeSet(bad.id), true);
    assert.deepEqual(setsOf(m).map(s => s.weight), [55, 55, 55],
      'and every good set survives');
  });

  /*
   * Why this matters beyond tidiness: the bad set is awarded as a personal
   * record, inflates the volume, and goes out in the share message as
   * "heaviest ever". Measured live before the fix:
   *   NEW PERSONAL RECORD · 255 × 12 · TRICEP EXTENSION +200 LB
   */
  test('removing it takes the fake PR and the inflated volume with it', () => {
    const m = withBadMiddleSet();
    const before = m.state().totalVolume;
    const bad = setsOf(m).find(s => s.weight === 255)!;
    m.removeSet(bad.id);
    const after = m.state().totalVolume;
    assert.equal(before - after, 255 * 12, 'the volume must lose exactly the bad set');
    assert.equal(setsOf(m).every(s => s.weight === 55), true, 'no 255 left to award');
  });

  test('a set from another session is refused, not silently deleted', () => {
    const m = new NowModel(repoWith([['old', 'bench', 135, 5, T0 - 7 * DAY]]), () => T0);
    assert.equal(m.removeSet('h0'), false,
      'this screen shows today; reaching into history is how you delete what you cannot see');
    assert.equal(m.removeSet('nope'), false);
  });

  test('removing the last set of a lift leaves the session consistent', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.log();
    const only = m.state().today[0].sets[0];
    assert.equal(m.removeSet(only.id), true);
    assert.equal(m.state().canFinish, false, 'you cannot finish a workout with nothing in it');
  });
});

/*
 * §4's actual mechanism for "can it be undone without thinking" — a set
 * logged wrong in the MIDDLE can be removed without destroying the good set
 * after it. This used to be `armSet`, a tap-to-arm-then-tap-to-remove chip;
 * it was replaced by routing removal through `EditSetSheet`'s own explicit
 * REMOVE button instead (see that component's comment: "Removal still
 * exists, inside the editor, where it is a choice rather than the only
 * door"), and `armSet` — along with the `armed` state that called it — sat
 * unused for a stretch afterward, tested and dead at the same time. Removed
 * both; the guarantee itself is what `EditSetSheet`'s own tests cover now.
 */

describe('Now screen — UP NEXT advances instead of ping-ponging (§7)', () => {
  /*
   * With nothing logged, `trained` is just the current lift, so the suggestion
   * was whatever pairs with it — and taking it made the lift you just left the
   * pair again. Measured: bench, press, bench, press, forever. Two of twelve
   * movements reachable through the control whose job is moving you on.
   */
  test('pressing UP NEXT repeatedly walks the session, it does not oscillate', () => {
    const m = new NowModel(repoWith(), () => T0);
    const seen = [m.state().exercise.id];
    for (let i = 0; i < 8 && m.next(); i++) seen.push(m.state().exercise.id);
    assert.equal(new Set(seen).size, seen.length, `revisited a lift: ${seen.join(' -> ')}`);
    assert.ok(seen.length >= 4, `only reached ${seen.length} lifts: ${seen.join(' -> ')}`);
  });

  test('it stops rather than looping once the day is used up', () => {
    const m = new NowModel(repoWith(), () => T0);
    let guard = 0;
    while (m.next() && guard < 50) guard++;
    assert.ok(guard < 50, 'next() never returned false — that is the infinite loop');
  });

  /*
   * `visited` is deliberately not part of `trained`: merely LOOKING at a leg
   * movement must not turn a push day into leg day.
   */
  test('visiting a lift does not change what day the session is', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.selectExercise('bench');
    m.log();
    const dayBefore = m.state().day;
    m.selectExercise('squat');      // wander to legs without logging
    m.selectExercise('bench');
    assert.equal(m.state().day, dayBefore, 'the day is decided by what was TRAINED');
  });

  test('a new workout starts its suggestions over', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.log(); m.next(); m.log();
    m.finish();
    assert.equal(m.startNextIfFinished(), true);
    assert.ok(m.state().upNext, 'the next workout has somewhere to go again');
  });
});

describe('Now screen — the big-jump buttons (§4)', () => {
  test('a plate is a plate in the unit the user actually loads', () => {
    assert.equal(PLATE.lb, 45, 'the big plate on an imperial bar');
    assert.equal(PLATE.kg, 20, 'and on a metric one — 20.41 is not a plate anyone owns');
  });

  test('+45 adds a plate to an lb session', () => {
    // Explicit US locale: with none, §8 falls back to kg as the world majority,
    // so a test that assumed pounds would be asserting the fixture, not the fix.
    const m = new NowModel(repoWith(), () => T0, 'en-US');
    assert.equal(m.state().session.unit, 'lb');
    const before = m.state().weight;
    m.bumpPlate(1);
    assert.equal(m.state().weight, before + 45);
  });

  // §8's whole point: a metric user is never shown imperial numbers.
  test('a kg session gets 20, not 45 and not a converted 20.41', () => {
    const m = new NowModel(repoWith(), () => T0, 'de-DE');
    assert.equal(m.state().session.unit, 'kg');
    const before = m.state().weight;
    m.bumpPlate(1);
    assert.equal(m.state().weight, before + 20);
  });

  test('it stacks, and never goes negative through the shared floor', () => {
    const m = new NowModel(repoWith(), () => T0, 'en-US');
    m.setWeight(0);
    m.bumpPlate(1); m.bumpPlate(1);
    assert.equal(m.state().weight, 90);
  });

  test('+5 reps jumps by five and stays a whole number', () => {
    const m = new NowModel(repoWith(), () => T0);
    const before = m.state().reps;
    m.jumpReps(1);
    assert.equal(m.state().reps, before + REP_JUMP);
    m.jumpReps(1);
    assert.equal(m.state().reps, before + 2 * REP_JUMP);
  });

  test('the jumps are the same numbers the buttons print', () => {
    // The labels are `+${PLATE[unit]}` and `+${REP_JUMP}` — if these drift the
    // button lies about what it does.
    assert.equal(REP_JUMP, 5);
    assert.ok(PLATE.lb > WEIGHT_STEP.lb, 'a jump that is not bigger than the stepper is pointless');
    assert.ok(PLATE.kg > WEIGHT_STEP.kg);
  });
});

describe('Now screen — the jumps go both ways (§4)', () => {
  test('a plate comes off as easily as it goes on', () => {
    const m = new NowModel(repoWith(), () => T0, 'en-US');
    m.setWeight(225);
    m.bumpPlate(-1);
    assert.equal(m.state().weight, 180);
    m.bumpPlate(1);
    assert.equal(m.state().weight, 225, 'and it is a clean round trip');
  });

  /*
   * The reason the minus exists: before it, undoing an over-tap of +45 cost
   * NINE presses of the −5 stepper.
   */
  test('one tap undoes one tap', () => {
    const m = new NowModel(repoWith(), () => T0, 'en-US');
    const start = m.state().weight;
    m.bumpPlate(1);
    m.bumpPlate(-1);
    assert.equal(m.state().weight, start);
  });

  test('stripping plates stops at the bar, never below zero', () => {
    const m = new NowModel(repoWith(), () => T0, 'en-US');
    m.setWeight(20);
    m.bumpPlate(-1);
    assert.equal(m.state().weight, 0, 'the shared floor in setWeight catches it');
    m.bumpPlate(-1);
    assert.equal(m.state().weight, 0);
  });

  test('reps drop by five and stop at one', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.setReps(12);
    m.jumpReps(-1);
    assert.equal(m.state().reps, 7);
    m.setReps(3);
    m.jumpReps(-1);
    assert.equal(m.state().reps, 1, 'a set of zero reps is not a set');
  });

  /*
   * Five, not ten. Rep schemes live in 1..MAX_PR_REPS (12), so a ten-rep jump
   * would leave the usable range from almost anywhere in it — from 3 it lands
   * on 13, which §8 treats as conditioning rather than a strength set. Five
   * moves between the two schemes people actually alternate, 5s and 10s, in one
   * tap, and it is a clean multiple of the ±1 stepper beside it.
   */
  test('the rep jump stays inside the range the app will score', () => {
    assert.equal(REP_JUMP, 5);
    assert.ok(REP_JUMP * 2 <= 12, 'two jumps from 2 must still be a scoreable set');
    const m = new NowModel(repoWith(), () => T0);
    m.setReps(5); m.jumpReps(1);
    assert.equal(m.state().reps, 10, 'the other common scheme, one tap away');
  });
});

describe('Now screen — the bottom block leads with what is next', () => {
  /*
   * The head used to read "TODAY · 3 sets · 2,625 lb" — a receipt. Mid-workout
   * the question is not what you have done, it is what you are walking back to
   * the bar for. `loggedThisExercise` is what the set number counts, so it has
   * to track the CURRENT lift rather than the session.
   */
  test('the next set number counts the lift you are on, not the session', () => {
    const m = new NowModel(repoWith(), () => T0);
    assert.equal(m.state().loggedThisExercise.length + 1, 1, 'first set of the day');
    m.log(); m.log();
    assert.equal(m.state().loggedThisExercise.length + 1, 3);

    m.selectExercise('ohp');
    assert.equal(m.state().loggedThisExercise.length + 1, 1,
      'a new lift starts at set 1 — the session total is a different number');
    assert.equal(m.state().totalSets, 2, 'while the session still knows about the other two');
  });

  test('switching back to a lift resumes its own count', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.log(); m.log();
    m.selectExercise('ohp'); m.log();
    m.selectExercise('bench');
    assert.equal(m.state().loggedThisExercise.length + 1, 3, 'back to bench, set 3');
  });

  // Removing a set has to walk the number back, or it counts sets that are gone.
  test('removing a set moves the next one back down', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.log(); m.log();
    const sets = m.state().loggedThisExercise;
    assert.equal(sets.length + 1, 3);
    m.removeSet(sets[0].id);
    assert.equal(m.state().loggedThisExercise.length + 1, 2);
  });
});

describe('Now screen — clearing the workout (§11)', () => {
  test('it removes today, and only today', () => {
    const m = new NowModel(trained(), () => T0);
    const historyBefore = m.state().today;
    m.log(); m.log();
    m.selectExercise('row'); m.log();
    assert.equal(m.state().totalSets, 3);

    const gone = m.clearWorkout();
    assert.equal(gone, 3, 'it reports what it removed');
    assert.equal(m.state().totalSets, 0);
    assert.equal(m.state().canFinish, false, 'nothing left to finish');
    void historyBefore;
  });

  /*
   * The whole difference between this and ERASE EVERYTHING: yesterday survives.
   * `trained()` is four weekly sessions of squat and row.
   */
  test('history, the streak and the prefill all survive it', () => {
    const repo = trained();
    const m = new NowModel(repo, () => T0);
    m.log();
    const before = repo.allSets().length;
    m.clearWorkout();
    assert.equal(repo.allSets().length, before - 1, 'exactly the one set logged today');
    assert.ok(repo.allSets().length > 0, 'the previous sessions are untouched');
    assert.equal(m.state().weight, 220, 'and the call from last time still prefills (R692)');
  });

  /*
   * `clearWorkoutBody` names three things as untouched — history, streak AND
   * goals — but only history and the prefill (a proxy for the streak reading)
   * had a test. A goal is a separate table `clearWorkout` never reaches, but
   * nothing had ever pinned that in code the way R458's WIPE ALL sweep pinned
   * the equivalent claim on the Goals screen.
   */
  test('a live goal survives it too, exactly as the sentence promises', () => {
    const repo = trained();
    repo.saveGoal({ id: 'g', exerciseId: 'squat', targetWeight: 300, targetReps: 5,
      targetDate: T0 + 90 * 86_400_000, unit: 'lb', createdAt: T0 });
    const before = repo.goals().length;
    const m = new NowModel(repo, () => T0);
    m.log();
    m.clearWorkout();
    assert.equal(repo.goals().length, before, 'clearing the live workout must not touch goals');
  });

  test('the session stays open, so it is a restart rather than an abandon', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.log();
    const id = m.state().session.id;
    m.clearWorkout();
    assert.equal(m.state().session.id, id, 'same workout, emptied');
    assert.equal(m.state().session.endedAt, null, 'ending it would push an empty recap');
  });

  test('clearing an empty workout is a no-op, not an error', () => {
    const m = new NowModel(repoWith(), () => T0);
    assert.equal(m.clearWorkout(), 0);
    assert.equal(m.state().totalSets, 0);
  });
});

describe('Now screen — the picker opens on the day you are training (§7)', () => {
  const groups = (...spec: Array<[string | null, string, string[]]>) =>
    spec.map(([day, label, ex]) => ({
      day: day as never, label,
      exercises: ex.map(id => ({ id, name: id }))
    }));

  const PPL = groups(
    ['push', 'PUSH', ['bench', 'ohp', 'triext']],
    ['pull', 'PULL', ['deadlift', 'row']],
    ['legs', 'LEGS', ['squat', 'legpress']]
  );

  /*
   * The ask, and §7's own logic: on push day a leg movement is not a near-miss,
   * it is rows to scroll past to reach the ones that could plausibly be next.
   */
  test('only the day being trained is shown', () => {
    const { thisDay, others } = splitPickerGroups(PPL, 'push');
    assert.deepEqual(thisDay.map(g => g.label), ['PUSH']);
    assert.deepEqual(others.map(g => g.label), ['PULL', 'LEGS']);
  });

  test('the other days are reachable, not gone', () => {
    const { others } = splitPickerGroups(PPL, 'push');
    assert.equal(others.reduce((n, g) => n + g.exercises.length, 0), 4,
      'the count the OTHER DAYS row prints');
  });

  /*
   * R32's trap: telling someone their movement exists and then never showing
   * it again. A lift the user invented has no day, so it cannot be filed under
   * one — and burying it would punish exactly the effort of adding it.
   */
  test('movements the user invented are never hidden', () => {
    const withMine = [...PPL, ...groups([null, 'YOURS', ['sissy_squat']])];
    const { thisDay, others } = splitPickerGroups(withMine, 'push');
    assert.deepEqual(thisDay.map(g => g.label), ['PUSH', 'YOURS']);
    assert.equal(others.some(g => g.label === 'YOURS'), false);
  });

  // Narrowing to an arbitrary third of the library is worse than not narrowing.
  test('when the day is not knowable, nothing is hidden', () => {
    const { thisDay, others } = splitPickerGroups(PPL, null);
    assert.equal(thisDay.length, 3, 'all of it');
    assert.deepEqual(others, []);
  });

  test('a user with only custom movements still sees them', () => {
    const onlyMine = groups([null, 'YOURS', ['sissy_squat', 'sled']]);
    const { thisDay, others } = splitPickerGroups(onlyMine, null);
    assert.deepEqual(thisDay.map(g => g.label), ['YOURS']);
    assert.deepEqual(others, []);
  });

  test('every group is accounted for — nothing is dropped on the floor', () => {
    for (const day of ['push', 'pull', 'legs', null] as const) {
      const { thisDay, others } = splitPickerGroups(PPL, day);
      assert.equal(thisDay.length + others.length, PPL.length, `lost a group on ${day}`);
    }
  });

  test('it narrows against the real model, not just hand-made groups', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.selectExercise('bench');
    const st = m.state();
    const { thisDay } = splitPickerGroups(st.pickerGroups, st.day);
    const shown = thisDay.flatMap(g => g.exercises.map(e => e.id));
    assert.ok(shown.includes('bench'), 'the lift being trained is always on screen');
    assert.equal(shown.includes('squat'), false, 'a leg movement is not offered on push day');
  });
});

describe('Now screen — the jump amounts are the user\'s (§9)', () => {
  test('they default to a plate and five reps', () => {
    const m = new NowModel(repoWith(), () => T0, 'en-US');
    assert.equal(m.state().plateJump, 45);
    assert.equal(m.state().repJump, 5);
  });

  test('a chosen amount is what the buttons then add', () => {
    // Written the way Settings writes it — through the pref — since R238
    // deleted the model setters that were a second way to do the same thing.
    const repo = repoWith();
    repo.setPref('jump.lb', '25');
    const m = new NowModel(repo, () => T0, 'en-US');
    assert.equal(m.state().plateJump, 25, 'and the button relabels itself from state');
    const before = m.state().weight;
    m.bumpPlate(1);
    assert.equal(m.state().weight, before + 25);
  });

  test('it survives a relaunch', () => {
    const repo = repoWith();
    repo.setPref('jump.lb', '2.5');
    const fresh = new NowModel(repo, () => T0, 'en-US');
    assert.equal(fresh.state().plateJump, 2.5, 'microplates are a real way to train');
  });

  // Weights are never converted, so the preference is stored per unit.
  test('lb and kg keep their own amount', () => {
    const repo = repoWith();
    repo.setPref('jump.lb', '35');
    const kg = new NowModel(repoWith(), () => T0, 'de-DE');
    assert.equal(kg.state().plateJump, 20, 'a kg user is unaffected by an lb choice');
  });

  test('a rep jump can be set and stored', () => {
    const repo = repoWith();
    repo.setPref('jump.reps', '3');
    const m = new NowModel(repo, () => T0);
    assert.equal(m.state().repJump, 3);
    m.setReps(5); m.jumpReps(1);
    assert.equal(m.state().reps, 8);
  });

  /*
   * The field holds TEXT while it is typed, so junk must be a clean "not yet"
   * rather than a number — committing "1" on the way to "10" would silently
   * reset someone's plate to a pound.
   */
  test('junk is refused and the old amount stands', () => {
    // Straight at `customJump`, which is the validation Settings actually
    // calls — R238 deleted the model setter that used to wrap it and that
    // nothing but this test had ever invoked.
    const repo = repoWith();
    repo.setPref('jump.lb', '25');
    for (const bad of ['', ' ', '0', '-5', 'abc', 'NaN', '99999']) {
      assert.equal(customJump(bad, 'lb'), null, `"${bad}" was accepted`);
    }
    // And a refusal leaves what was stored alone, which is the point.
    assert.equal(new NowModel(repo, () => T0, 'en-US').state().plateJump, 25);
  });

  test('rep jumps stay inside the range the app will score', () => {
    for (const bad of ['0', '13', '2.5', '', 'x']) {
      assert.equal(customRepJump(bad), null, `"${bad}" was accepted`);
    }
    assert.equal(customRepJump('12'), 12, 'the ceiling itself is fine');
  });

  test('a corrupt stored value falls back rather than breaking the screen', () => {
    const repo = repoWith();
    repo.setPref('jump.lb', 'not-a-number');
    repo.setPref('jump.reps', '999');
    const m = new NowModel(repo, () => T0, 'en-US');
    assert.equal(m.state().plateJump, 45);
    assert.equal(m.state().repJump, 5);
  });

  test('erasing everything takes the preferences with it', () => {
    const repo = repoWith();
    repo.setPref('jump.lb', '25');
    repo.eraseAll();
    assert.equal(new NowModel(repo, () => T0, 'en-US').state().plateJump, 45);
  });
});

describe('Now screen — what the set was done on', () => {
  test('nothing is assumed: unanswered is unanswered, not a barbell', () => {
    const m = new NowModel(repoWith(), () => T0);
    assert.equal(m.state().equipment, null, 'a default here puts a fact nobody chose into the record');
    m.log();
    assert.equal(m.state().today[0].sets[0].equipment, undefined);
  });

  test('the choice lands on the set', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.setEquipment('dumbbell');
    m.log();
    assert.equal(m.state().today[0].sets[0].equipment, 'dumbbell');
  });

  test('a machine carries its name', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.setEquipment('machine', 'Arsenal');
    m.log();
    const set = m.state().today[0].sets[0];
    assert.equal(set.equipment, 'machine');
    assert.equal(set.machine, 'Arsenal');
  });

  // "Arsenal" against a barbell set is a fact about nothing.
  test('the machine name is dropped when it is not a machine', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.setEquipment('machine', 'Arsenal');
    m.setEquipment('barbell');
    assert.equal(m.state().machine, null);
    m.log();
    assert.equal(m.state().today[0].sets[0].machine, undefined);
  });

  /*
   * §4 — the app never asks a question it could answer. Equipment changes maybe
   * once a month, so it carries over exactly like weight and reps do.
   */
  test('it carries over to the next session on that lift', () => {
    const repo = repoWith();
    const first = new NowModel(repo, () => T0);
    first.setEquipment('machine', 'Arsenal');
    first.log();
    first.finish();

    const later = new NowModel(repo, () => T0 + 3 * DAY);
    later.selectExercise('bench');
    assert.equal(later.state().equipment, 'machine');
    assert.equal(later.state().machine, 'Arsenal');
  });

  test('but it is per lift — a different movement is not assumed', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.selectExercise('bench');
    m.setEquipment('machine', 'Arsenal');
    m.log();
    m.selectExercise('squat');
    assert.equal(m.state().equipment, null, 'the squat has never been answered for');
  });

  /*
   * "Save the machine for easy access" needs no table — the machines someone
   * knows about are the ones they have logged.
   */
  test('machines already used come back as options, most recent first', () => {
    const repo = repoWith();
    // A moving clock: with a fixed one both sets share a timestamp and "most
    // recent" has nothing to sort on.
    let clock = T0;
    const m = new NowModel(repo, () => clock);
    m.selectExercise('lateral');
    m.setEquipment('machine', 'Hammer Strength'); m.log();
    clock = T0 + 5 * MIN;
    m.setEquipment('machine', 'Arsenal'); m.log();
    assert.deepEqual(m.state().knownMachines, ['Arsenal', 'Hammer Strength']);
  });

  test('the list is scoped to the lift you are standing at', () => {
    const repo = repoWith();
    const m = new NowModel(repo, () => T0);
    m.selectExercise('lateral');
    m.setEquipment('machine', 'Arsenal'); m.log();
    m.selectExercise('legpress');
    assert.deepEqual(m.state().knownMachines, [],
      'the machines that matter are the ones for THIS movement');
  });

  test('a machine is remembered once, however many sets used it', () => {
    const repo = repoWith();
    const m = new NowModel(repo, () => T0);
    m.setEquipment('machine', 'Arsenal');
    m.log(); m.log(); m.log();
    assert.deepEqual(m.state().knownMachines, ['Arsenal']);
  });

  test('clearing it takes the answer off future sets', () => {
    const m = new NowModel(repoWith(), () => T0);
    m.setEquipment('dumbbell');
    m.log();
    m.setEquipment(null);
    m.log();
    const sets = m.state().today[0].sets;
    assert.equal(sets[0].equipment, 'dumbbell');
    assert.equal(sets[1].equipment, undefined);
  });
});

describe('Now screen — it does not own the data, so it re-reads it', () => {
  /*
   * Found by walking: saving a jump amount in Settings left the buttons on
   * this screen still labelled with the old one, because the screen only
   * re-read after a finished session rolled over. The same staleness covers a
   * restore or an erase performed on Progress.
   */
  test('a jump amount changed elsewhere is picked up on the next read', () => {
    const repo = repoWith();
    const m = new NowModel(repo, () => T0, 'en-US');
    assert.equal(m.state().plateJump, 45);

    // Something else — Settings, on another screen — writes the preference.
    repo.setPref('jump.lb', '25');

    assert.equal(m.state().plateJump, 25,
      'state() must read through to the repo, not cache the old answer');
  });

  test('sets removed elsewhere are gone from the next read', () => {
    const repo = repoWith();
    const m = new NowModel(repo, () => T0);
    m.log(); m.log();
    assert.equal(m.state().totalSets, 2);
    for (const s of repo.setsInSession(m.state().session.id)) repo.deleteSet(s.id);
    assert.equal(m.state().totalSets, 0, 'the screen cannot assume its data survived');
  });

  /*
   * `eraseAll` deletes the session row this model is holding. It used to keep
   * pointing at it — showing the weight from a set that no longer existed, and
   * the next log would have failed the foreign key against a deleted session.
   */
  test('an erase performed elsewhere does not leave phantom numbers', () => {
    const repo = trained();
    const m = new NowModel(repo, () => T0);
    m.log();
    repo.eraseAll();

    assert.equal(m.startNextIfFinished(), true, 'the session it held is gone');
    const after = m.state();
    assert.equal(after.totalSets, 0);
    assert.equal(after.canFinish, false);
    assert.equal(after.weight, 20, 'an empty bar in kg — nothing left to scale from');

    m.log();   // must not throw: the new session actually exists
    assert.equal(m.state().totalSets, 1);
  });
});

/*
 * The goal, on the screen where the lift is actually being trained.
 *
 * Goals lived on their own screen and on the recap, so while you were under the
 * bar the app said nothing about the target you had set for that exact lift —
 * the one moment the number can change what you do next. It rides the
 * "last time" line rather than taking a row of its own, because §4's logging
 * path must not scroll and a new row would have cost the day rail on a short
 * phone.
 */
describe('the last-time line carries the goal on this lift', () => {
  const set = (weight: number, reps: number): LoggedSet =>
    ({ id: 'x', sessionId: 's', exerciseId: 'bench', weight, reps, at: 1 });

  test('the gap and the target, at the goal\'s own rep count', () => {
    const line = lastTimeLine({
      previous: set(165, 5), thisSession: [],
      goal: { remaining: 20, targetWeight: 185, targetReps: 5 }
    });
    assert.match(line, /Last time\s+165 × 5/, 'the last-time numbers still lead');
    assert.match(line, /20 to 185 × 5/,
      'a gap to "185" means nothing without the reps — 20 lb at five is not 20 at ten');
  });

  test('no goal, and the line is exactly what it was', () => {
    assert.equal(
      lastTimeLine({ previous: set(165, 5), thisSession: [] }),
      lastTimeLine({ previous: set(165, 5), thisSession: [], goal: null }));
  });

  /*
   * It would otherwise sit on the line for every future session of that lift,
   * and the trophy already has a home on the Goals screen.
   */
  test('a goal already met says nothing here', () => {
    assert.equal(goalTail({ remaining: 0, targetWeight: 185, targetReps: 5 }), '');
    assert.equal(goalTail(null), '');
    assert.equal(goalTail(undefined), '');
  });

  test('it attaches to every branch of the line, not just the usual one', () => {
    const goal = { remaining: 20, targetWeight: 185, targetReps: 5 };
    assert.match(lastTimeLine({ previous: null, thisSession: [set(160, 5)], goal }),
      /Just did\s+160 × 5.*20 to 185/, 'the second set of a first-ever session');
    assert.match(lastTimeLine({ previous: null, thisSession: [], goal }),
      /First time.*20 to 185/, 'and the very first one, where the target is all there is');
  });

  test('a fractional gap is not printed to four decimal places', () => {
    assert.match(goalTail({ remaining: 12.5001, targetWeight: 185, targetReps: 5 }), /13 to 185/);
  });
});

/*
 * Hitting a target you chose months ago is the most postable thing that happens
 * in this app, and on the logging screen it passed in complete silence — the
 * line simply stopped saying anything, next session.
 */
describe('the set that hits the goal says so', () => {
  const T = Date.UTC(2026, 7, 21, 18);
  const fresh = () => new Repo(new DatabaseSync(':memory:') as any, () => T);

  function withGoal(target: number, reps: number, priorBest: number | null) {
    const repo = fresh();
    if (priorBest !== null) {
      repo.startSession('old', 'lb');
      repo.logSet({ id: 'p1', sessionId: 'old', exerciseId: 'bench',
        weight: priorBest, reps, at: T - 7 * DAY });
      repo.endSession('old', T - 7 * DAY + MIN);
    }
    repo.saveGoal({ id: 'g1', exerciseId: 'bench', targetWeight: target, targetReps: reps,
      targetDate: T + 90 * DAY, unit: 'lb', createdAt: T - 60 * DAY });
    return repo;
  }

  function nowOn(repo: Repo) {
    const m = new NowModel(repo, () => T);
    m.selectExercise('bench');
    return m;
  }

  test('logging the set that meets it changes the line', () => {
    const m = nowOn(withGoal(185, 5, 180));
    assert.match(lineOf(m), /5 to 185 × 5/, 'the gap, before the set');
    m.setWeight(185);
    m.setReps(5);
    m.log();
    assert.match(lineOf(m), /goal hit: 185 × 5/,
      'the one moment worth saying something, and it said nothing');
  });

  /*
   * A goal hit last month is not news, and a line that says "goal hit" every
   * time you touch the lift for the rest of the year is exactly the crying
   * wolf §8 forbids of the PR badge.
   */
  test('a goal met before today stays quiet', () => {
    const m = nowOn(withGoal(185, 5, 200));
    assert.doesNotMatch(lineOf(m), /goal hit/,
      'it was hit last week — today it is just a lift');
    assert.doesNotMatch(lineOf(m), /to 185/, 'and there is no gap left to report');
  });

  test('overshooting still counts as hitting it', () => {
    const m = nowOn(withGoal(185, 5, 180));
    m.setWeight(205);
    m.setReps(5);
    m.log();
    assert.match(lineOf(m), /goal hit: 185 × 5/);
  });

  test('more reps than the goal asked for counts, fewer does not', () => {
    const under = nowOn(withGoal(185, 5, 180));
    under.setWeight(185);
    under.setReps(3);
    under.log();
    assert.doesNotMatch(lineOf(under), /goal hit/,
      '185 for three is not 185 for five');

    const over = nowOn(withGoal(185, 5, 180));
    over.setWeight(185);
    over.setReps(8);
    over.log();
    assert.match(lineOf(over), /goal hit/, 'and 185 for eight is more than enough');
  });

  test('a lift with no goal is untouched by any of this', () => {
    const repo = fresh();
    const m = new NowModel(repo, () => T);
    m.selectExercise('squat');
    assert.doesNotMatch(lineOf(m), /goal|to \d/);
  });
});

/*
 * Fixing a set instead of destroying it, and repeating one without leaving the
 * lift you are on.
 */
describe('a logged set can be amended and repeated', () => {
  const T = Date.UTC(2026, 7, 21, 18);

  function session() {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    const m = new NowModel(repo, () => T);
    m.selectExercise('bench');
    m.setWeight(145); m.setReps(8); m.log();
    m.setWeight(155); m.setReps(5); m.log();
    return { repo, m };
  }

  /*
   * The reason this exists. Removing and re-logging gave the set a new id and a
   * new `at`, so correcting a mistyped MIDDLE set moved it to the end of the
   * workout — and the recap's per-exercise top set then read a session that had
   * not happened in that order.
   */
  test('editing keeps the set in its place', () => {
    const { repo, m } = session();
    const first = repo.setsInSession(m.state().session.id)[0];
    assert.equal(m.editSet(first.id, { weight: 135 }), true);

    const after = repo.setsInSession(m.state().session.id);
    assert.equal(after.length, 2, 'editing must not add or drop a set');
    assert.equal(after[0].id, first.id, 'and it is still the first one');
    assert.equal(after[0].at, first.at, 'with the time it was actually done');
    assert.equal(after[0].weight, 135);
    assert.equal(after[0].reps, 8, 'what was not edited is not touched');
  });

  test('a note rides along with the set', () => {
    const { repo, m } = session();
    const id = repo.setsInSession(m.state().session.id)[1].id;
    m.editSet(id, { note: '  RIR 2, tempo 3-1-1  ' });
    assert.equal(repo.allSets().find(x => x.id === id)!.note, 'RIR 2, tempo 3-1-1',
      'stored trimmed, so a stray space is not a note');
  });

  test('editing the weight alone does not wipe the note', () => {
    const { repo, m } = session();
    const id = repo.setsInSession(m.state().session.id)[0].id;
    m.editSet(id, { note: 'machine 4' });
    m.editSet(id, { weight: 150 });
    const set = repo.allSets().find(x => x.id === id)!;
    assert.equal(set.note, 'machine 4', 'a caller fixing a number must not erase what was written');
    assert.equal(set.weight, 150);
  });

  test('and clearing it is possible on purpose', () => {
    const { repo, m } = session();
    const id = repo.setsInSession(m.state().session.id)[0].id;
    m.editSet(id, { note: 'gone in a moment' });
    m.editSet(id, { note: '' });
    assert.equal(repo.allSets().find(x => x.id === id)!.note, undefined);
  });

  test('editing a set that is not there fails rather than inventing one', () => {
    const { repo, m } = session();
    assert.equal(m.editSet('nope', { weight: 100 }), false);
    assert.equal(repo.allSets().length, 2);
  });

  /*
   * The "+" beside UNDO. It copies THAT lift's last set, not whatever the
   * steppers happen to be showing, so it repeats what happened.
   */
  test('adding a set repeats that lift, not the hero', () => {
    const { repo, m } = session();
    m.selectExercise('squat');
    m.setWeight(315); m.setReps(3); m.log();

    const added = m.addSetTo('bench');
    assert.ok(added, 'bench has sets to repeat');
    assert.equal(added!.weight, 155, 'the last BENCH set, while the hero shows a squat');
    assert.equal(added!.reps, 5);
    assert.equal(added!.exerciseId, 'bench');
    assert.equal(repo.allSets().filter(x => x.exerciseId === 'bench').length, 3);
  });

  test('it copies the note and the kit with it', () => {
    const { repo, m } = session();
    const id = repo.setsInSession(m.state().session.id)[1].id;
    m.editSet(id, { note: 'machine 4' });
    const added = m.addSetTo('bench');
    assert.equal(added!.note, 'machine 4',
      'the same set again means the same set, including what was true about it');
  });

  test('a lift with nothing logged has nothing to repeat', () => {
    const { m } = session();
    assert.equal(m.addSetTo('deadlift'), null, 'and it must not guess a weight');
  });

  test('the new set gets its own id, so undo pops one', () => {
    const { repo, m } = session();
    const added = m.addSetTo('bench')!;
    assert.equal(new Set(repo.allSets().map(x => x.id)).size, 3);
    m.undo('bench');
    assert.equal(repo.allSets().some(x => x.id === added.id), false);
    assert.equal(repo.allSets().length, 2, 'and only the repeat went');
  });

  /*
   * R579. `NowScreen`'s `addingTo` holds a bare exercise id — the "+" sheet
   * for repeating a lift's last set — and nothing clears it on `resume()`.
   * Now is the root route and is never unmounted, so the id can outlive an
   * ERASE EVERYTHING done from Progress while it is conceptually still open:
   * navigate away, erase, come back, and a stale tap would call `addSetTo`
   * with an id from a session and a set of exercises that no longer exist.
   *
   * `editingSet` (R578) is guarded by `updateSet`'s own `WHERE deleted = 0`
   * re-check. `addSetTo` has no equivalent guard written for it — it derives
   * safety only from the fact that `mine.length` is empty once the session's
   * sets are gone, which is true but was never pinned, unlike R578's case.
   */
  test('a stale add-set tap after ERASE EVERYTHING adds nothing (R579)', () => {
    const { repo, m } = session();
    assert.ok(repo.allSets().length > 0, 'the fixture starts with nothing to lose');
    repo.eraseAll();
    assert.equal(repo.session(m.state().session.id), null,
      'the fixture no longer models a session that has actually vanished');
    assert.equal(m.addSetTo('bench'), null,
      'addSetTo invented a set for a session and exercise that no longer exist');
    assert.equal(repo.allSets().length, 0, 'a stale add-set tap resurrected data after an erase');
  });
});

/*
 * R496. The same filter, asked at the wrong level for two thirds of the splits
 * the app offers.
 *
 * `dayOf` files bench under push and row under pull. For push/pull/legs that
 * is exactly right. For UPPER/LOWER — offered in the app's own split picker —
 * bench and row are the SAME day, and filtering the candidates by push meant
 * skipping straight past the lift their history actually says comes next.
 *
 * Measured on fourteen weeks of an upper/lower routine before the fix: the
 * lifter benches, `nextCandidates` returns row first off their own evidence,
 * and UP NEXT showed OHP. `sessionPlanDay` already carries the argument for
 * why the push/pull/legs level is the wrong one to count at; this was the one
 * place still comparing there.
 */
describe('Now screen — UP NEXT respects the split the lifter chose (§7)', () => {
  /** Fourteen weeks of upper/lower, two sessions a week. */
  function upperLower(): Repo {
    const rows: Array<[string, string, number, number, number]> = [];
    const upper = ['bench', 'row', 'ohp', 'pulldown'];
    const lower = ['squat', 'legpress'];
    let n = 0;
    for (let w = 14; w >= 1; w--) {
      for (const d of [0, 3]) {
        const lifts = n % 2 === 0 ? upper : lower;
        const at = T0 - (w * 7 - d) * DAY;
        lifts.forEach((ex, j) => rows.push([`ul${n}`, ex, 100 + j * 5, 5, at + j * 20 * MIN]));
        n++;
      }
    }
    return repoWith(rows, T0);
  }

  test('on an upper day, a pull lift is not skipped for being pull', () => {
    const m = new NowModel(upperLower(), () => T0);
    m.setPlan('upper-lower');
    m.selectExercise('bench');
    m.log();

    const next = m.state().upNext!;
    assert.ok(next, 'a lifter mid-upper-day was offered nothing');
    const ranked = nextCandidates(upperLower().allSets(), ['bench'], T0, new Date(T0).getDay());
    assert.equal(next.id, ranked[0],
      `their own history says ${ranked[0]} comes next and UP NEXT said ${next.id} — ` +
      'the push/pull table overruled the evidence');
    assert.equal(inPlanDay(next.id, 'upper'), true,
      'and whatever it picked is not even on an upper day');
  });

  test('it still refuses to send them to the other day', () => {
    // The filter must keep doing its job — this is not "remove the filter".
    const m = new NowModel(upperLower(), () => T0);
    m.setPlan('upper-lower');
    m.selectExercise('bench');
    m.log();
    assert.notEqual(dayOf(m.state().upNext!.id), 'legs',
      'mid-upper-day it offered a leg lift');
  });

  test('and a push/pull/legs lifter is unaffected', () => {
    /*
     * For PPL the plan day and the split day are the same value, so this whole
     * change is a no-op there. Stated as a test because that equivalence is
     * the reason the §7 suite above did not have to move.
     */
    const m = new NowModel(upperLower(), () => T0);
    m.setPlan('ppl');
    m.selectExercise('bench');
    m.log();
    assert.equal(dayOf(m.state().upNext!.id), 'push',
      'on PPL the filter must still be the narrow one');
  });
});

/*
 * R498. One session, two screens, two names for the day.
 *
 * `planDay` on this screen was `planDayFor(sessionDay(...), plan)`: tally in
 * push/pull/legs, then translate. `sessionTitle` on the recap has always
 * called `sessionPlanDay`, which tallies in the lifter's own vocabulary. Those
 * are not the same function of the same input, and `sessionPlanDay`'s own
 * comment says exactly why: an upper/lower lifter's upper day is push AND
 * pull, so bench + row + squat splits two upper votes across two buckets and
 * reads as a 1-1-1 tie — at which point the tie-break sends the answer to
 * whatever lift they happen to be standing on. Counted where the lifter
 * actually lives it is 2 upper against 1 lower, and not a tie at all.
 *
 * Measured before the fix, on that session with the user on Squat: the Now
 * screen said LOWER and the recap said UPPER, a minute apart.
 */
describe('the day this screen names is the day the recap will name', () => {
  function ul(): Repo {
    const rows: Array<[string, string, number, number, number]> = [];
    for (let w = 6; w >= 1; w--) {
      rows.push([`u${w}`, 'bench', 100, 5, T0 - w * 7 * DAY]);
      rows.push([`u${w}`, 'row', 100, 5, T0 - w * 7 * DAY + 20 * MIN]);
    }
    return repoWith(rows, T0);
  }

  /** bench + row + squat, standing on the squat: the disagreeing case. */
  function mixed(m: NowModel) {
    for (const id of ['bench', 'row', 'squat']) { m.selectExercise(id); m.log(); }
  }

  test('an upper/lower lifter mid-session gets one answer, not two', () => {
    const m = new NowModel(ul(), () => T0);
    m.setPlan('upper-lower');
    mixed(m);

    const st = m.state();
    const fromRecap = sessionPlanDay(st.loggedThisSession.map(s => s.exerciseId), 'upper-lower',
      dayOf(st.exercise.id));
    assert.equal(st.planDay, fromRecap,
      `the logging screen calls this a ${st.planDay} day and the recap calls it a ${fromRecap} day`);
  });

  test('and the answer is the one the majority of the session supports', () => {
    const m = new NowModel(ul(), () => T0);
    m.setPlan('upper-lower');
    mixed(m);
    assert.equal(m.state().planDay, 'upper',
      'two upper lifts and one lower read as a lower day, because the count was ' +
      'taken at a level where the two upper lifts are different days');
  });

  test('a chosen day still wins over anything inferred', () => {
    // §4: the app does not argue with an answer it asked for. Unchanged.
    const m = new NowModel(ul(), () => T0);
    m.setPlan('upper-lower');
    m.setDay('lower');
    mixed(m);
    assert.equal(m.state().planDay, 'lower', 'the day they told us was overruled by inference');
  });

  test('and push/pull/legs is unaffected', () => {
    /*
     * For PPL the plan day and the split day are the same value, so tallying
     * at either level gives the same answer. Stated because that equivalence
     * is why no existing test moved.
     */
    const m = new NowModel(ul(), () => T0);
    m.setPlan('ppl');
    for (const id of ['bench', 'ohp']) { m.selectExercise(id); m.log(); }
    assert.equal(m.state().planDay, 'push');
  });
});

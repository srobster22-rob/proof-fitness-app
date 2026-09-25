import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { PLATE, REP_JUMP, WEIGHT_STEP } from '../src/ui/now-steppers.ts';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T0 = Date.UTC(2026, 7, 27, 12);
const fresh = () => new NowModel(new Repo(new DatabaseSync(':memory:') as never, () => T0), () => T0);

/*
 * §4's tap budgets, which it calls acceptance criteria rather than aspirations.
 *
 * Measured on the running app from a cleared database:
 *
 *   install → first set logged      1 tap   (target ≤ 3)
 *   log a set mid-workout           1 tap   (target 1)
 *   change weight or reps, then log 3 taps  (target ≤ 3, no keyboard)
 *
 * The third was `+45`, `+5`, `LOG SET`, with zero visible inputs and focus
 * never leaving `<body>` — so no keyboard, which is the half of that target
 * that is easy to lose. Totals reconciled at every step: 45 × 8 = 360, then
 * 720, then 1,890.
 *
 * R521 took those counts again on the running app, with dispatched pointer
 * sequences rather than a finger, and added the half §4 never budgeted — what
 * it costs to FINISH:
 *
 *   finish -> recap                 1 tap
 *   recap  -> back to logging       1 tap
 *
 * So the owner's whole flow, open -> log a set -> done, is TWO taps. Totals
 * reconciled against the recap: 45x8, 45x8, 90x13 = 1,890 lb, which is the
 * same arithmetic as the note above, taken independently.
 *
 * These pin what MAKES those numbers possible, since the counts themselves can
 * only be taken with a finger.
 */
describe('the logging path stays inside §4 (tap budgets)', () => {
  test('a brand-new install can log without answering anything first', () => {
    /*
     * This is the whole first-tap budget. The app opens on the logging screen
     * with the split chooser OVER it — and the chooser is an offer, not a gate:
     * LOG SET works underneath it, which is why install → first set is one tap
     * and not three. Making that question blocking would still "look fine".
     */
    const m = fresh();
    assert.equal(m.state().totalSets, 0);
    const set = m.log();
    assert.ok(set, 'a fresh install could not log a set at all');
    assert.equal(m.state().totalSets, 1);
  });

  test('and it needs no typing to do it — every field is pre-filled (§4)', () => {
    // "An empty number field is a bug", stated in §4 immediately under the
    // table. A zero here would mean the first tap logs nothing.
    const s = fresh().state();
    assert.ok(s.weight > 0, `weight pre-filled to ${s.weight}`);
    assert.ok(s.reps > 0, `reps pre-filled to ${s.reps}`);
  });

  test('repeating the last set is one operation, not a form', () => {
    const m = fresh();
    const first = m.log();
    const before = m.state();
    const second = m.log();
    assert.equal(m.state().totalSets, 2);
    // Same weight and reps carried over: that is what makes it ONE tap.
    assert.equal(second.weight, first.weight);
    assert.equal(second.reps, first.reps);
    assert.equal(before.weight, second.weight);
  });

  test('changing weight and reps is two taps, so logging makes three', () => {
    /*
     * The big-jump buttons are what keep this inside the budget: one tap moves
     * a whole plate and one moves a whole rep block. Without them a 45 lb
     * change would be nine taps of the stepper.
     */
    const m = fresh();
    const start = m.state();
    // One plate and one rep block, one tap each — `bumpPlate`/`bumpReps` take
    // STEPS, which is what makes them a single tap rather than nine of the
    // stepper.
    m.bumpPlate(1);
    m.bumpReps(REP_JUMP);
    const after = m.state();
    /*
     * One plate, in whichever unit this install inferred — an in-memory repo
     * with no locale comes up in kilograms, and hardcoding 45 here asserts the
     * tester's locale rather than the rule. What matters is that ONE tap moves
     * a whole plate rather than one stepper notch.
     */
    const jump = after.weight - start.weight;
    assert.ok([PLATE.lb, PLATE.kg].includes(jump),
      `one tap moved ${jump}, which is not a plate in either unit`);
    assert.ok(jump > Math.max(WEIGHT_STEP.lb, WEIGHT_STEP.kg),
      'the big jump is no bigger than the stepper, so this is not one tap any more');
    assert.equal(after.reps, start.reps + REP_JUMP);
    m.log();
    assert.equal(m.state().totalSets, 1);
  });

  test('nothing on the logging path waits on a spinner', () => {
    // §4: "Loading spinners on the logging path — zero. All local, sync is
    // background." A local SQLite write has nothing to wait for, and an
    // `await` here would be how one appears.
    const src = readFileSync(path.join(HERE, '..', 'src', 'ui', 'NowScreen.tsx'), 'utf8');
    const at = src.indexOf('model.log()');
    assert.notEqual(at, -1, 'the log handler moved');
    const around = src.slice(Math.max(0, at - 200), at + 200);
    assert.doesNotMatch(around, /await |ActivityIndicator/,
      'logging a set now waits on something');
  });
});

/*
 * §4: "Loading spinners on the logging path — zero. All local, sync is
 * background."
 *
 * Stated as an acceptance criterion and never checked mechanically. The app has
 * exactly one spinner and it is the boot gate, which wraps the root before any
 * screen mounts — so nothing a user does after launch waits on anything. The
 * rule is easy to break by accident: an `await` in a handler and a spinner to
 * cover it is the ordinary way to write a save button.
 */
describe('nothing on the logging path spins (§4)', () => {
  const UI = [
    ...readdirSync(path.join(HERE, '..', 'app')).map(f => ['app', f] as const),
    ...readdirSync(path.join(HERE, '..', 'src', 'ui')).map(f => ['src/ui', f] as const)
  ].filter(([, f]) => /\.tsx$/.test(f));

  test('there are screens to check', () => {
    assert.ok(UI.length >= 8, `only found ${UI.length} .tsx files`);
  });

  test('exactly one spinner exists, and it is the boot gate', () => {
    const withSpinner = UI.filter(([d, f]) =>
      /ActivityIndicator/.test(readFileSync(path.join(HERE, '..', ...d.split('/'), f), 'utf8')));
    assert.deepEqual(withSpinner.map(([, f]) => f), ['RepoGate.tsx'],
      'a spinner appeared outside the boot gate — §4 allows none on the logging path');
  });

  test('and the gate is above the screens, not inside one', () => {
    // If it moved into a screen it would be waiting on something mid-session.
    const layout = readFileSync(path.join(HERE, '..', 'app', '_layout.tsx'), 'utf8');
    assert.match(layout, /RepoGate/,
      'the boot gate is no longer wrapping the app at the root');
  });
});

/*
 * R521, for OWNER.md #4: "every core flow (open, log a set, done) measured in
 * taps and seconds; cut anything that isn't earning its place".
 *
 * Measuring it found nothing to cut — the flow is two taps — so what follows
 * pins the things that would quietly make it three. §4 budgets the logging
 * half and says nothing about FINISHING, which is half of the owner's flow and
 * was the half nobody had counted.
 */
describe('finishing a workout is one tap, and stays one (R521)', () => {
  test('FINISH ends the session outright, with nothing to confirm', () => {
    /*
     * The cheapest way to lose this budget is a confirmation step, and a
     * confirmation is exactly what a cautious change would add: FINISH is
     * irreversible-looking. It is not — the recap's own EDIT THIS WORKOUT goes
     * back — so an 'are you sure' would be a tap spent on a question the app
     * can already answer by undoing.
     */
    const src = readFileSync(path.join(HERE, '..', 'src', 'ui', 'NowScreen.tsx'), 'utf8');
    // `region`, not slice(indexOf(...)): a moved anchor makes the raw form
    // return the tail of the file rather than throw, and this test would then
    // pass by reading something else entirely. The repo's own gate caught me
    // doing it, which is the gate working.
    const handler = region(src, "accessibilityLabel={T('finishA11y')}",
                           '<Text style={s.finishText}>');
    assert.match(handler, /model\.finish\(\); sync\(\); onFinish\?\.\(\);/,
      'FINISH no longer finishes and navigates in one press');
    assert.doesNotMatch(handler, /Alert|confirm|setConfirm|window\.confirm/,
      'a confirmation step was added to FINISH, which costs the flow a tap');
  });

  test('and one press cannot land two recaps on the stack', () => {
    /*
     * The guard that makes the count honest rather than lucky. Two real
     * pointer sequences at the same coordinates both hit the same pre-render
     * node, so a check against render state cannot see the second coming —
     * measured on the running app, and it put DONE at two taps with a third
     * session rolled over underneath. The ref is the fix and it has to be a
     * ref, checked and set synchronously outside any render.
     */
    const src = readFileSync(path.join(HERE, '..', 'src', 'ui', 'NowScreen.tsx'), 'utf8');
    assert.match(src, /if \(finishedRef\.current\) return;\s*finishedRef\.current = true;/,
      'the double-press guard is gone, so one press can push two recaps');
    // THIS ref, not any ref: the file has three `useRef(false)` and matching
    // the bare call passed happily with the guard replaced by a plain object
    // — caught by planting exactly that.
    assert.match(src, /const finishedRef = useRef\(false\)/,
      'the guard is no longer a ref, so it cannot be set synchronously');
  });

  test('the model really does end the session when asked once', () => {
    /*
     * The behaviour under the source checks above: one call, session over.
     *
     * Asserted against the REPO, not against `state()`. I first wrote
     * `totalSets === 0` and it failed — `state()` still describes the workout
     * that just ended, which is correct and necessary, because the recap is
     * what renders next and it has to have something to show. The checkable
     * fact is that nothing is live any more.
     */
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
    const m = new NowModel(repo, () => T0);
    m.log();
    assert.ok(repo.liveSession(), 'nothing was live to finish');
    assert.equal(m.state().canFinish, true, 'a logged set should be finishable');
    m.finish();
    // Falsy, not a specific empty value: this returns null, and my probe
    // printed `liveSession()?.id` which reads as undefined either way.
    assert.ok(!repo.liveSession(),
      'FINISH left the session live, so the next set would join the old workout');
  });
});

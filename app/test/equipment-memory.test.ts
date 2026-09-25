import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { region } from './helpers/source.ts';
import { t } from '../src/domain/i18n.ts';
import { nowScreenSource } from './helpers/now-screen.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = nowScreenSource();
const T0 = Date.UTC(2026, 6, 29, 18);

function model() {
  const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
  return { repo, m: new NowModel(repo, () => T0, 'en-US') };
}

/**
 * "once you click on what equipment you are using it should automatically go
 * down aka there shouldnt be a save button" — and "it should save it for later
 * as in the program to remember what the user lasted."
 */
describe('equipment commits on tap (§4)', () => {
  test('there is no save button on the equipment sheet', () => {
    const sheet = region(SOURCE, 'function EquipmentSheet', 'function Jump');
    assert.doesNotMatch(sheet, />SAVE</,
      'a confirm step after an unambiguous single choice is a tap spent agreeing with yourself');
  });

  test('barbell and dumbbell close the sheet; machine stays up for its name', () => {
    const sheet = region(SOURCE, 'function EquipmentSheet', 'function Jump');
    assert.match(sheet, /if \(e !== 'machine'\) return pick\(e\);/,
      'the other two are complete answers and should close');
    assert.match(sheet, /onApply\(e, machine\);/,
      'machine must record the kit but keep the sheet up to ask which one');
  });

  /*
   * Unless the user has said not to be asked. Someone who trains at one gym
   * answers "which machine" with the same word every time, and the second step
   * becomes a tap paid on every machine set for information the app has.
   */
  test('and machine closes like the others once the question is switched off', () => {
    const sheet = region(SOURCE, 'function EquipmentSheet', 'function Jump');
    assert.match(sheet, /if \(skipMachine\) return pick\(e, machine\);/,
      'with the question off, MACHINE has to behave exactly like BARBELL');
    assert.match(sheet, /\{kit === 'machine' && !skipMachine && \(/,
      'and the "which one" step must not render at all');
  });

  /*
   * The control that silenced the step is the only place somebody would think
   * to look for turning it back on.
   */
  test('tapping MACHINE again puts the question back', () => {
    const sheet = region(SOURCE, 'function EquipmentSheet', 'function Jump');
    assert.match(sheet, /if \(already && skipMachine\) \{ onSkipMachine\(false\); return; \}/,
      'a second tap on the chosen kit is the undo');
  });

  test('a known machine is a finished answer', () => {
    const sheet = region(SOURCE, 'function EquipmentSheet', 'function Jump');
    // `pick` wraps `onPick` in the exit animation — same commit, deferred by
    // exitMs so the sheet gets to fade out rather than teleport away.
    assert.match(sheet, /onPress=\{\(\) => \{ setMachine\(m\); pick\('machine', m\); \}\}/);
  });

  test('typing a new machine can still be committed without a button', () => {
    const sheet = region(SOURCE, 'function EquipmentSheet', 'function Jump');
    assert.match(sheet, /onSubmitEditing=\{\(\) => pick\('machine', machine\)\}/,
      'with SAVE gone, return has to be the commit');
  });

  test('CLEAR stays — no chip can say "none"', () => {
    const sheet = region(SOURCE, 'function EquipmentSheet', 'function Jump');
    assert.match(sheet, /CLEAR/);
  });
});

/*
 * The choice used to live only on LOGGED sets, so an answer given and not yet
 * logged was thrown away the moment the user changed lifts and came back — the
 * app fell back to last week's set and quietly contradicted them.
 */
describe('the equipment choice is remembered (§4, §11)', () => {
  test('it survives switching away and back, before anything is logged', () => {
    const { m } = model();
    m.selectExercise('bench');
    m.setEquipment('dumbbell');
    m.selectExercise('ohp');
    m.selectExercise('bench');
    assert.equal(m.state().equipment, 'dumbbell', 'the answer was thrown away');
  });

  test('a machine remembers which machine', () => {
    const { m } = model();
    m.selectExercise('latraise');
    m.setEquipment('machine', 'Arsenal');
    m.selectExercise('bench');
    m.selectExercise('latraise');
    const st = m.state();
    assert.equal(st.equipment, 'machine');
    assert.equal(st.machine, 'Arsenal');
  });

  test('it is per lift, not one answer for the whole app', () => {
    const { m } = model();
    m.selectExercise('bench');
    m.setEquipment('barbell');
    m.selectExercise('latraise');
    m.setEquipment('machine', 'Hammer Strength');
    m.selectExercise('bench');
    assert.equal(m.state().equipment, 'barbell', 'one lift’s answer leaked onto another');
    assert.equal(m.state().machine, null);
  });

  test('a fresh choice outranks what the last set was logged with', () => {
    const { repo, m } = model();
    m.selectExercise('bench');
    m.setEquipment('barbell');
    m.log();                        // a barbell set is now on record
    m.setEquipment('dumbbell');     // today it is dumbbells
    m.selectExercise('ohp');
    m.selectExercise('bench');
    assert.equal(m.state().equipment, 'dumbbell',
      'history overrode an answer the user gave more recently');
    assert.ok(repo.allSets().some(x => x.equipment === 'barbell'),
      'and the logged set still records what it was actually done with');
  });

  test('clearing is remembered too, rather than falling back to history', () => {
    const { m } = model();
    m.selectExercise('bench');
    m.setEquipment('barbell');
    m.log();
    m.setEquipment(null);
    m.selectExercise('ohp');
    m.selectExercise('bench');
    assert.equal(m.state().equipment, null, 'CLEAR did not stick');
  });

  test('a lift never answered for reports nothing, not "barbell"', () => {
    const { m } = model();
    m.selectExercise('bench');
    assert.equal(m.state().equipment, null);
  });
});

/*
 * The one preference whose effect is a question NOT being asked.
 *
 * §4 says the app never asks what it can infer, and "don't ask which machine"
 * is the user turning one question off — set from inside the sheet that asks
 * it, which is the right place. Walked on the running app: choosing MACHINE
 * shows WHICH ONE with a "Don't ask again" beside it; after that, coming from
 * BARBELL and choosing MACHINE records and closes with no question, exactly as
 * the Settings copy promises; and tapping MACHINE when it is already MACHINE
 * shows **"Not asking which machine. Tap MACHINE again to start asking."**
 *
 * The logic is covered above. What was not is that the state is EXPLAINED. A
 * preference you can set by tapping and un-set by tapping the same thing, with
 * nothing on screen saying which way it currently is, is a trap — the user has
 * no way to tell "it did nothing" from "it turned the question back on".
 */
describe('turning the machine question off says so, and says how to undo it', () => {
  test('the sheet states the state rather than just being quiet', () => {
    const sheet = nowScreenSource();
    assert.match(sheet, /T\('notAskingMachine'\)/,
      'the suppressed state is silent — nothing tells the user it is on');
  });

  test('and the message names the way back, in both languages', () => {
    for (const lang of ['en', 'es'] as const) {
      const msg = t(lang, 'notAskingMachine');
      assert.match(msg, /MACHINE|MÁQUINA/,
        `${lang} does not name the control that reverses it`);
      assert.ok(msg.length > 30, `${lang} message is too short to explain anything`);
    }
  });
});

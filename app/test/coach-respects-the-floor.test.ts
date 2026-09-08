import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { coachSuggestion } from '../src/domain/coach.ts';
import { EQUIPMENT_BASE } from '../src/domain/coldstart.ts';
import { t } from '../src/domain/i18n.ts';
import { around } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 9, 12);

/** Three sessions at one weight with reps falling — the shape of fatigue. */
function grinding(exerciseId: string, weight: number, unit: 'lb' | 'kg' = 'lb'): Repo {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  let n = 0;
  for (const [d, reps] of [[10, 8], [7, 6], [4, 5]] as [number, number][]) {
    const id = `s${d}`;
    repo.startSession(id, unit);
    repo.logSet({ id: `x${n++}`, sessionId: id, exerciseId, weight, reps, at: T0 - d * DAY });
    repo.endSession(id, T0 - d * DAY + 3600_000);
  }
  return repo;
}

function line(repo: Repo, exerciseId: string): string {
  const m = new NowModel(repo, () => T0, 'en-US');
  m.selectExercise(exerciseId);
  return m.state().lastTime.head;
}

/*
 * R541. `coldstart.ts` states a floor — "the empty version of each thing: a bar
 * with no plates, the lightest dumbbell, the first pin on a stack. The floor a
 * suggestion can never go below" — and the coach engine, written later in R517,
 * had never heard of it.
 *
 * Measured: three sessions of bench at 45 lb with reps falling produced
 * "45 is grinding — back off to 41". There is no way to load a barbell to 41;
 * the bar alone is 45. §16 asks that every number be checkable against a rack,
 * and this one could not be.
 *
 * Third round running that the defect was found by reading a comment making an
 * absolute claim (R539 "nothing else can", R540 "can never disagree", this one
 * "can never go below"). The claims were all true of the file they sat in and
 * false of the app, because a later module never read them.
 */
describe('a deload cannot suggest a weight the rack does not have (R541)', () => {
  test('grinding at the empty bar does not suggest 41 lb', () => {
    const said = line(grinding('bench', EQUIPMENT_BASE.barbell.lb), 'bench');
    assert.doesNotMatch(said, /\b4[0-4]\b/,
      `the coach suggested a weight below the empty bar: "${said}"`);
    assert.match(said, /hold here/,
      `at the floor the advice is to hold, not to back off. It said: "${said}"`);
  });

  test('and it does not fall through to "add weight" instead', () => {
    /*
     * The failure mode of the obvious fix. Reps are falling and three sessions
     * share a weight, so if the deload branch simply declines, PLATEAU fires
     * and says "try 46" — telling somebody having a bad week to add load,
     * which is the exact thing the deload branch exists to prevent. Skipping
     * the branch would have swapped an unloadable number for bad advice.
     */
    const said = line(grinding('bench', EQUIPMENT_BASE.barbell.lb), 'bench');
    assert.doesNotMatch(said, /try|add/i, `the coach recommended adding weight to a bad week: "${said}"`);
  });

  test('a real deload well above the floor is untouched', () => {
    /*
     * 165, not 167. R548 put every suggested weight on the loadable grid, and
     * 185 less ten per cent is 166.5 — a number no barbell makes. The FLOOR
     * still does nothing here, which is what this test is for; the grid is a
     * separate correction and 165 is the same advice expressed in plates.
     */
    const said = line(grinding('bench', 185), 'bench');
    assert.match(said, /back off to 165/,
      `the floor changed advice it had no business changing: "${said}"`);
    assert.equal(165 % 5, 0, 'the number this test pins is not on the 5 lb grid');
  });

  test('the floor is the equipment\'s, not one number for everything', () => {
    /*
     * A dumbbell bottoms out at 5 and a pull-up at 0 — flooring everything at
     * 45 would be a different bug wearing the same fix. The engine takes the
     * base as a parameter for exactly this reason.
     */
    const repo = grinding('curl', 10);
    const sets = repo.allSets();
    const atDumbbellFloor = coachSuggestion(sets, 'curl', T0,
      { unit: 'lb', base: EQUIPMENT_BASE.dumbbell.lb });
    assert.equal(atDumbbellFloor?.weight, 9,
      'a 10 lb dumbbell has room to come down to 9 and was floored anyway');
    const barbellFloor = coachSuggestion(sets, 'curl', T0,
      { unit: 'lb', base: EQUIPMENT_BASE.barbell.lb });
    assert.equal(barbellFloor?.kind, 'hold',
      'the same history under a barbell floor should hold, not deload below 45');
  });

  test('an engine given no base behaves exactly as it did', () => {
    // The parameter is optional and defaults to 0, so a caller that does not
    // know the equipment gets the old arithmetic rather than a wrong floor.
    const s = coachSuggestion(grinding('bench', 45).allSets(), 'bench', T0, { unit: 'lb' });
    assert.equal(s?.weight, 41, 'the default changed; every existing caller just moved');
  });

  test('both languages say it', () => {
    // §16: the domain returns a key, and a key with no Spanish is a blank line
    // on a Spanish phone that no other test would notice.
    for (const lang of ['en', 'es'] as const) {
      const s = t(lang, 'coachDeloadFloor');
      assert.ok(s && s !== 'coachDeloadFloor', `no ${lang} for coachDeloadFloor`);
      assert.match(s, /\{weight\}/, `the ${lang} line never names the weight`);
      assert.match(s, /\{n\}/, `the ${lang} line never cites the evidence`);
    }
    assert.notEqual(t('en', 'coachDeloadFloor'), t('es', 'coachDeloadFloor'),
      'the Spanish line is the English one, so it was never translated');
  });
});

/*
 * R573. The floor this whole file guards was silently WRONG for every
 * equipment except barbell, since the round that added it. `now-model.ts`
 * looked up the base as `exercises.get(this.exerciseId)?.equipment` -- but
 * `Exercise` has no `equipment` field; it lives on `LoggedSet`, per SET, not
 * per exercise. That is a type error `tsc --noEmit` catches immediately, and
 * nothing in this suite's own `test` script check ran it where a failure
 * would be seen: `npm test` chains `tsc --noEmit` at the very end, but a
 * session filtering its output for the test-runner's own pass/fail lines
 * (exactly what this session did, repeatedly) sees a clean "0 fail" and never
 * reaches the unmatched tsc error text below it.
 *
 * The expression type-checked as `any` and silently evaluated to `undefined`
 * on every call, so `?? 'barbell'` always won -- the floor was always 45/20
 * regardless of what the lift actually was. Right for a barbell lift by
 * coincidence, wrong and unnoticed for anything else. Measured: a lifter
 * grinding at 40 lb on a weighted (bodyweight-equipment) pull-up, reps
 * falling, was told "hold here" when the correct floor (0, not 45) allows a
 * real deload to 35.
 *
 * `this.equipment` -- the model's own tracked field for what the CURRENT lift
 * is being done on -- is what the line needed, and always could have used.
 */
describe('the deload floor uses the actual equipment, not a type error (R573)', () => {
  function pullupsOn(weight: number): Repo {
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
    let n = 0;
    for (const [d, reps] of [[10, 8], [7, 6], [4, 5]] as [number, number][]) {
      const id = `s${d}`;
      repo.startSession(id, 'lb', undefined, T0 - d * DAY);
      repo.logSet({ id: `x${n++}`, sessionId: id, exerciseId: 'pullup', weight, reps, at: T0 - d * DAY });
      repo.endSession(id, T0 - d * DAY + 3600_000);
    }
    return repo;
  }

  test('a bodyweight lift can deload below the barbell floor', () => {
    const repo = pullupsOn(40);
    const m = new NowModel(repo, () => T0, 'en-US');
    m.selectExercise('pullup');
    m.setEquipment('bodyweight');
    const said = m.state().lastTime.head;
    assert.match(said, /back off to 35/,
      `a weighted pull-up should deload freely down to 0, not the barbell floor of 45: "${said}"`);
    assert.doesNotMatch(said, /hold here/,
      `the floor blocked a real deload it had no business blocking: "${said}"`);
  });

  test('the lookup reads the CURRENT equipment, not a field Exercise never had', () => {
    const src = fs.readFileSync(path.join(HERE, '..', 'src', 'ui', 'now-model.ts'), 'utf8');
    const call = around(src, 'base: EQUIPMENT_BASE[', 0, 120);
    assert.match(call, /this\.equipment/,
      'the deload floor no longer reads this.equipment');
    assert.doesNotMatch(call, /exercises\.get\(this\.exerciseId\)\?\.equipment/,
      'the floor is reading equipment off Exercise again, which has never had that field');
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SPLIT_PLANS, PLAN_BLURB, PLAN_DAY_COVERS, inPlanDay, dayOf } from '../src/domain/split.ts';
import { PLAN_BLURB_KEY, t } from '../src/domain/i18n.ts';
import { BUILTIN } from '../src/domain/coldstart.ts';

/*
 * R673. The plan sheet's own words are a promise about what each day holds, and
 * the day a lift lands on is decided two files away, by `DAY_OF` and
 * `PLAN_DAY_COVERS`.
 *
 * UPPER / LOWER said "Two days. Everything above the waist, then everything
 * below." Measured on the real modules: the UPPER day carries 24 of the 32
 * built-ins, Deadlift among them, because `DAY_OF` puts the deadlift on `pull`
 * (deliberately — it is trained with the back) and upper is push + pull. LOWER
 * carries 8. So the sentence promised an anatomical split the app does not do,
 * to the one lifter who would notice: the one who picked UPPER / LOWER.
 *
 * Which day a hinge belongs on is a training opinion, filed in HANDOFF.md
 * rather than decided here. The words were corrected instead, and these tests
 * hold the two together from both ends.
 */
describe('the plan blurbs describe the days the app actually builds (R673)', () => {
  test('the domain seed and the string the screen renders are the same sentence', () => {
    // Two copies of one sentence: `PLAN_BLURB` in split.ts, which the i18n table
    // only seeds, and `planBlurb*`, which NowScreen renders through
    // PLAN_BLURB_KEY. Nothing held them together, so a correction to one could
    // leave the other promising the old thing for ever.
    for (const plan of SPLIT_PLANS) {
      assert.equal(PLAN_BLURB[plan], t('en', PLAN_BLURB_KEY[plan]),
        `split.ts and the English table disagree about what the ${plan} plan is`);
    }
  });

  test('no upper/lower blurb promises an anatomical split while upper is push + pull', () => {
    // The mapping is by movement pattern, not by anatomy, so the words must not
    // claim otherwise in either language. If the day mapping ever does become
    // anatomical (see HANDOFF), this is the test to revisit, not to delete.
    assert.deepEqual(PLAN_DAY_COVERS.upper, ['push', 'pull'], 'the upper day stopped being push + pull');
    assert.deepEqual(PLAN_DAY_COVERS.lower, ['legs'], 'the lower day stopped being legs');
    for (const [lang, anatomical] of [['en', /above the waist|below the waist/i], ['es', /cintura/i]] as Array<['en' | 'es', RegExp]>) {
      const blurb = t(lang, PLAN_BLURB_KEY['upper-lower']);
      assert.doesNotMatch(blurb, anatomical,
        `${lang} promises an anatomical split ("${blurb}") while the UPPER day is push + pull — ` +
        'which puts the deadlift, a hinge, on upper day and leaves it off lower');
    }
  });

  test('every built-in on the upper day is push or pull work, and every one on lower is legs', () => {
    for (const e of BUILTIN) {
      if (inPlanDay(e.id, 'upper')) {
        assert.ok(dayOf(e.id) === 'push' || dayOf(e.id) === 'pull',
          `${e.name} is offered on UPPER day but its split day is ${dayOf(e.id)}`);
      }
      if (inPlanDay(e.id, 'lower')) {
        assert.equal(dayOf(e.id), 'legs', `${e.name} is offered on LOWER day but its split day is ${dayOf(e.id)}`);
      }
    }
  });

  test('the deadlift is on upper day today — the filed question, pinned so moving it is deliberate', () => {
    // Not an endorsement: HANDOFF.md carries the open question of whether a
    // hinge belongs on UPPER or LOWER. Pinned so that answering it fails here
    // and forces the blurb above to be re-read at the same time.
    assert.equal(dayOf('deadlift'), 'pull');
    assert.equal(inPlanDay('deadlift', 'upper'), true, 'the deadlift moved days — re-read the UPPER / LOWER blurb');
    assert.equal(inPlanDay('deadlift', 'lower'), false, 'the deadlift moved days — re-read the UPPER / LOWER blurb');
  });
});

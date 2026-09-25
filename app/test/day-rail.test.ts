import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import {
  layoutFor,
  columnHeight,
  RAIL_MAX,
  RAIL_PAD,
  RAIL_CHIP,
  RAIL_LABEL,
  RAIL_WHY
} from '../src/ui/now-layout.ts';
import { DAY_HEADING } from '../src/domain/split.ts';
import { region } from './helpers/source.ts';
import { nowScreenSource } from './helpers/now-screen.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = nowScreenSource();
const MIN = 60_000;
const T0 = Date.UTC(2026, 6, 29, 18);

function model() {
  const repo = new Repo(new DatabaseSync(':memory:') as any, () => T0);
  return { repo, m: new NowModel(repo, () => T0, 'en-US') };
}

/**
 * The rail that replaced NEXT LIFT.
 *
 * The report was "when I am done with one set it isn't clear what to click next
 * to log my next set — once I am done with bench press I want easy access to
 * the next push day exercises such as tricep extensions or chest flys". Every
 * one of those movements was already in the library and already reachable
 * through the picker; nothing on the logging screen said so, because the only
 * thing offered was a single-guess button sharing a row with CLEAR and FINISH.
 */
describe('the day rail (§4, §7)', () => {
  /*
   * Written first as "it is empty until a day is known", which was wrong about
   * the app rather than about the rail: §4 says it never asks a question it
   * could answer, so the day is INFERRED from the opening lift and the rail is
   * populated from launch. What gates it is the render, not the data. The
   * invariant that actually matters is the one §7 states — the logging path
   * never shows a library.
   */
  test('it is a day, never the library (§7)', () => {
    const { repo, m } = model();
    const rail = m.state().dayRail;
    const library = repo.exercises().size;
    assert.ok(rail.length > 0, 'the day is inferred from the opening lift, so there is one');
    assert.ok(rail.length < library * 0.75,
      `the rail is ${rail.length} of ${library} movements — that is a library, not a day`);
  });

  test('with no day at all there is nothing to show', () => {
    const { repo, m } = model();
    // A movement the user invented belongs to no split day.
    repo.addExercise('mine', 'Sled Drag');
    m.selectExercise('mine');
    assert.equal(m.state().dayRail.length, 0,
      'a dayless lift should get no rail rather than a guess');
  });

  test('once the day is known it carries that day, and only that day', () => {
    const { m } = model();
    m.setPlan('ppl');
    m.setDay('push');
    const rail = m.state().dayRail;
    assert.ok(rail.length >= 6, `a push day should offer more than ${rail.length} movements`);
    const names = rail.map(r => r.name);
    // The two the user named by hand.
    assert.ok(names.includes('Tricep Extension'), names.join(', '));
    assert.ok(names.includes('Chest Fly'), names.join(', '));
    // And nothing from another day.
    assert.ok(!names.includes('Squat'), 'a leg movement is on the push rail');
    assert.ok(!names.includes('Deadlift'), 'a pull movement is on the push rail');
  });

  test('upper/lower gets the whole upper body, not the push half', () => {
    const { m } = model();
    m.setPlan('upper-lower');
    m.setDay('upper');
    const names = m.state().dayRail.map(r => r.name);
    assert.ok(names.includes('Bench Press'), 'no push movement on an upper day');
    assert.ok(names.includes('Barbell Row') || names.includes('Pull-up') || names.includes('Lat Pulldown'),
      `no pull movement on an upper day: ${names.join(', ')}`);
    assert.ok(!names.includes('Squat'), 'a leg movement is on the upper rail');
  });

  /*
   * The ordering defect, measured on the running app: about three chips fit
   * across a phone, and the visible three were the lift already on screen plus
   * two alphabetical accidents, while the app's own suggestion sat off the
   * right edge.
   */
  test('the suggestion leads, so the visible chips are the useful ones', () => {
    const { m } = model();
    m.setPlan('ppl');
    m.setDay('push');
    m.log();
    const rail = m.state().dayRail;
    const suggested = rail.findIndex(r => r.suggested);
    if (suggested >= 0) {
      assert.equal(suggested, 0, `the suggested lift is at position ${suggested}, off the visible row`);
    }
  });

  test('the lift you are already on does not lead the rail', () => {
    const { m } = model();
    m.setPlan('ppl');
    m.setDay('push');
    // The rail only renders once a set is logged, so that is the only state
    // worth asserting about. At that moment the lift you are on is DONE, which
    // is what sorts it to the back — `current` never enters the comparison,
    // because a rail that reorders when you tap it is worse than one in the
    // wrong order.
    m.log();
    const rail = m.state().dayRail;
    assert.ok(rail.length > 1);
    assert.equal(rail[0].current, false,
      'leading with the lift on screen spends the one visible slot on a no-op');
  });

  test('tapping a chip does not move the chips', () => {
    const { m } = model();
    m.setPlan('ppl');
    m.setDay('push');
    m.log();
    const before = m.state().dayRail.map(r => r.id);
    const target = m.state().dayRail.find(r => !r.done && !r.current)!;
    m.selectExercise(target.id);
    assert.deepEqual(m.state().dayRail.map(r => r.id), before,
      'the rail rearranged itself under the finger that tapped it');
  });

  test('a full-body plan still is not a library (§7)', () => {
    const { repo, m } = model();
    m.setPlan('full');
    m.setDay('full');
    const rail = m.state().dayRail;
    assert.ok(rail.length <= RAIL_MAX + 2,
      `a full-body day put ${rail.length} of ${repo.exercises().size} movements on the logging path`);
  });

  test('but a real day is never cut short of the movements it has', () => {
    const { m } = model();
    m.setPlan('ppl');
    m.setDay('push');
    const names = m.state().dayRail.map(r => r.name);
    for (const wanted of ['Tricep Extension', 'Tricep Pushdown', 'Chest Fly', 'Lateral Raise']) {
      assert.ok(names.includes(wanted), `${wanted} was capped off a push day: ${names.join(', ')}`);
    }
  });

  test('a lift already trained stays reachable, but yields the visible slots', () => {
    const { m } = model();
    m.setPlan('ppl');
    m.setDay('push');
    m.log();                       // bench is now done
    const rail = m.state().dayRail;
    const bench = rail.find(r => r.id === 'bench');
    assert.ok(bench, 'the trained lift fell off the rail — you often come back for another round');
    assert.equal(bench!.done, true);
    const notDone = rail.filter(r => !r.done && !r.current);
    assert.ok(rail.indexOf(bench!) > rail.indexOf(notDone[0]),
      'a finished lift is ahead of one still to do');
  });

  test('tapping a chip really switches the lift', () => {
    const { m } = model();
    m.setPlan('ppl');
    m.setDay('push');
    const target = m.state().dayRail.find(r => r.id === 'triext');
    assert.ok(target, 'tricep extension is not on the push rail');
    m.selectExercise(target!.id);
    const st = m.state();
    assert.equal(st.exercise.id, 'triext');
    assert.ok(st.weight > 0, '§4 — an empty number field is a bug');
  });

  test('it earns its place: nothing before the first set', () => {
    assert.match(SOURCE, /state\.canFinish && state\.dayRail\.length > 0/,
      'the rail must appear only once a set is logged, like the button it replaced');
  });

  test('the predictor\'s pick is not lost — it is a tag on a chip', () => {
    // The label goes through the translation table now, so the structural
    // check anchors on the key. What it guards is unchanged: the predictor's
    // pick must still be marked ON the chip rather than in a control of its own.
    assert.match(SOURCE, /lift\.suggested && <Text style=\{s\.railNext\}>\{T\('suggested'\)\}<\/Text>/,
      'NEXT LIFT was removed without keeping the one thing it told you');
  });
});

/*
 * The rail costs height on a screen that deliberately does not scroll (§4), so
 * the fit math has to know about it. It did not at first, and the column
 * overflowed by 63px on a 500px pane.
 */
describe('the rail is paid for, not borrowed (§4)', () => {
  test('columnHeight counts the rail, and the band around it', () => {
    const l = layoutFor(375, 812);
    const withRail = columnHeight(l);
    const without = columnHeight({ ...l, railHeight: 0 });
    /*
     * The rail lives in its own band inside the TODAY block, with a rule under
     * it and room either side, so it costs more than its own height: a 6px top
     * margin, 12px of bottom padding and a 1px rule.
     *
     * 22, not 16. The band no longer has an explicit height — it sizes to its
     * content, because a number the model computed and the stylesheet had to
     * match EXACTLY was wrong twice and both times shaved the bottom off the
     * chips. That makes this figure a RESERVE rather than a measurement, so it
     * only has to be generous; being a few pixels pessimistic costs nothing,
     * and being short is what put the chips through the rule.
     */
    assert.equal(withRail - without, l.railHeight + 22, 'the rail band is not in the fit math');
  });

  test('and every height either fits or degrades on purpose', () => {
    // `columnHeight` is a conservative estimate since the constants were
    // measured (HEADER_TEXT 58 -> 79, STEP_HINT 12 -> 40) and it budgets the
    // rail even before a set is logged. So the invariant is that TODAY gives up
    // its space before anything overflows — see now-model.test.ts.
    for (const h of [560, 568, 600, 667, 700, 736, 780, 812, 844, 932]) {
      const l = layoutFor(375, h);
      assert.ok(columnHeight(l) <= h || l.todayMin === 0,
        `at ${h}px the column needs ${columnHeight(l)}px and TODAY claims ${l.todayMin}px`);
    }
  });

  test('a real phone is left exactly as it was drawn', () => {
    for (const h of [812, 844, 932]) {
      const l = layoutFor(375, h);
      // 80 on an 812 since the logged-set list gained a heading: TODAY is the
      // part this layout lets give, and 18px of it goes to saying what the list
      // underneath actually is. See now-model.test.ts for the full note.
      assert.equal(l.todayMin, h >= 844 ? 90 : 80,
        'the short-screen rescue leaked onto a phone');
      assert.equal(l.logHeight, 72);
      assert.equal(l.railHeight, RAIL_PAD + RAIL_CHIP + RAIL_LABEL + RAIL_WHY,
        'the rail must fit a 44px chip, 8px of padding, its heading AND the line ' +
        'that says why the suggestion is the suggestion — the band is a fixed ' +
        'height, so anything drawn inside it that the model does not know about ' +
        'gets its bottom edge cut by the band rule below it');
    }
  });

  /*
   * The rail is kept on every phone that ships — the shortest is the SE at 568,
   * verified on the running app with a set logged and FINISH still on screen —
   * and only yields below that, where something genuinely has to give and the
   * alternative is losing the ability to finish a workout.
   */
  test('the chips keep their size on every phone that ships', () => {
    for (const h of [568, 600, 667, 812]) {
      const l = layoutFor(375, h);
      assert.ok(l.railHeight >= RAIL_PAD + RAIL_CHIP,
        `a ${h}px screen shrank the rail below its own chips — they would be clipped`);
    }
  });

  test('and it is never dropped now — the column scrolls instead', () => {
    /*
     * It used to be dropped below 568 so CLEAR and FINISH could not be pushed
     * off the bottom. That cost the day's other lifts on any window shorter
     * than an SE, to solve a problem scrolling answers properly — and a window
     * that short is not a phone, which is what §4's no-scroll rule is about.
     */
    for (const h of [400, 460, 520, 560]) {
      const l = layoutFor(375, h);
      assert.equal(l.railHeight, RAIL_PAD + RAIL_CHIP + RAIL_LABEL + RAIL_WHY, `a ${h}px screen lost the rail`);
    }
    // Scrolling starts where the fixed parts genuinely cannot fit, allowing for
    // the model's measured 46px of conservatism — so a 560px window, which is
    // 32px over on paper and fits in practice, still does not scroll.
    for (const h of [400, 460, 520]) {
      assert.equal(layoutFor(375, h).scrolls, true, `a ${h}px screen must scroll to stay reachable`);
    }
  });

  test('and no phone that ships ever scrolls the logging path (§4)', () => {
    for (const h of [568, 600, 667, 736, 812, 844, 932]) {
      assert.equal(layoutFor(375, h).scrolls, false,
        `a ${h}px phone was made to scroll a screen that fits`);
    }
  });
});

/*
 * "there's a next button, but it doesn't really imply what's next" — the rail
 * had a heading reading only "PUSH DAY", and on short screens it did not have
 * one at all, because 14px was bought back from it. That was the wrong thing to
 * cut: it is the line that says the row beneath it is what comes next.
 */
describe('the rail says what it is (§4)', () => {
  test('the heading names the day AND says these are next', () => {
    for (const [day, heading] of Object.entries(DAY_HEADING)) {
      assert.match(heading, /NEXT/, `${day} does not say these are what is next`);
      assert.ok(heading.length > 8, `${day}'s heading is too terse to explain anything`);
    }
    assert.match(DAY_HEADING.push, /PUSH/, 'and it has to name the actual day');
    assert.match(DAY_HEADING.legs, /LEG/);
  });

  test('the English is written out, not composed', () => {
    // "LEGS DAY" and "FULL BODY DAY" are not what anyone calls them.
    assert.doesNotMatch(DAY_HEADING.legs, /LEGS DAY/);
    assert.doesNotMatch(DAY_HEADING.full, /FULL BODY DAY/);
  });

  test('the heading is counted whenever the rail is shown at all', () => {
    for (const h of [568, 600, 667, 812]) {
      assert.equal(layoutFor(375, h).railHeight, RAIL_PAD + RAIL_CHIP + RAIL_LABEL + RAIL_WHY,
        `a ${h}px screen would have to drop the heading or clip the chips`);
    }
  });

  test('nothing gates it on the viewport', () => {
    const block = region(SOURCE, 's.railLabel');
    assert.doesNotMatch(block.slice(0, 200), /L\.railLabel &&/,
      'the heading is conditional again');
  });
});

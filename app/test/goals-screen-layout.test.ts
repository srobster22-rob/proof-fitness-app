import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { region, upTo } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, '..', 'app', 'goals.tsx'), 'utf8');

function style(name: string): string {
  // Built with String.raw: written through a bash heredoc, `\\n` collapses to a
  // real newline and `\\s` to a bare "s", which silently turns this into a
  // pattern that can never match. It did, and the failure read as "style
  // removed" rather than "your test is broken".
  const m = SOURCE.match(new RegExp(String.raw`\n  ${name}:\s*\{([^}]*)\}`, 's'));
  assert.ok(m, `no style named "${name}" — renamed or removed`);
  return m![1];
}

/**
 * Raising the cap from three to twelve was a product decision; these are the
 * two things it broke on the screen that has to hold them, both found by
 * walking it with a full slate rather than by any test.
 */
describe('the Goals screen holds a full slate (§5)', () => {
  /*
   * Measured with twelve goals: every card was 198px whether or not it had
   * anything to say, because an untrained goal still drew an empty progress
   * bar, a sentence explaining that it was empty, and a countdown. That is
   * 2,376px of scroll on the screen whose whole job is showing you where your
   * lifts are. Collapsing the ones with no data took the pitch to 128px and the
   * scroll to 1,591 — and a goal takes its full card straight back as soon as
   * it has a real number to show.
   */
  test('a goal with nothing to report does not draw a progress bar', () => {
    const card = region(SOURCE, 'function GoalCard', 'function AddGoal');
    assert.match(card, /\{line !== null && \(/,
      'the bar and narrative line must be conditional on there being progress');
    const barAt = card.indexOf('<View style={s.track}');
    const guardAt = card.indexOf('{line !== null && (');
    assert.ok(guardAt >= 0 && guardAt < barAt, 'the bar is still drawn unconditionally');
  });

  test('it still shows the target and the deadline — collapsed, not blank', () => {
    const card = region(SOURCE, 'function GoalCard', 'function AddGoal');
    assert.match(card, /s\.cardTargetQuiet/, 'the target must stay, at a smaller size');
    // These labels go through the translation table now; the structural rule
    // is unchanged and the anchors move to the keys.
    assert.match(card, /T\('notTrained'\)/, 'and the row has to say why it is empty');
    assert.match(card, /daysLeft > 0 \? `\$\{p\.daysLeft\} \$\{T\('daysLeft'\)\}`/,
      'the deadline must survive');
  });

  test('the quiet target is smaller than the loud one, but still the row hero', () => {
    const loud = Number(style('cardTarget').match(/fontSize:\s*(\d+)/)![1]);
    const quiet = Number(style('cardTargetQuiet').match(/fontSize:\s*(\d+)/)![1]);
    assert.ok(quiet < loud, 'a collapsed card must actually be shorter');
    assert.ok(quiet >= 20, `${quiet}px stops being the point of the row`);
  });

  /*
   * At the cap the "+ ADD A GOAL" button simply disappeared: the user could not
   * add a goal and was not told why, or what would let them.
   */
  test('the cap explains itself rather than removing the control silently', () => {
    assert.match(SOURCE, /canAddGoal\(repo\) \? \(/,
      'the add button is still all-or-nothing');
    assert.match(SOURCE, /s\.capNote/, 'nothing takes the button\'s place at the cap');
    assert.match(SOURCE, /to add another/, 'the note must say what would free a slot');
    assert.match(SOURCE, /\{MAX_GOALS\} of \{MAX_GOALS\}/,
      'the count comes from the constant, so it cannot drift from the real cap');
  });
});

/*
 * Found by seeding a year-two lifter — 62 weeks, half the programme abandoned,
 * and a goal whose date passed 40 days ago. No fixture and no walk had ever
 * reached that branch before.
 */
describe('an expired goal says it once (§15)', () => {
  test('pace is not printed after the date has passed', () => {
    const card = region(SOURCE, 'function GoalCard', 'function AddGoal');
    const meta = region(card, "T('pastDate')");
    assert.match(meta, /p\.daysLeft > 0\s+\? \(p\.onPace/,
      '"Past the date  ·  behind pace" says one thing twice, and says the harsher half second');
  });

  test('pace still prints while there is time left', () => {
    const card = region(SOURCE, 'function GoalCard', 'function AddGoal');
    assert.match(card, /T\('behindPace'\)/);
    assert.match(card, /T\('onPace'\)/);
  });
});

/**
 * The cap moved again, three → twelve → a hundred, and a hundred cards is a
 * different screen from twelve. These pin what that broke, both measured on the
 * running app with 36 goals seeded.
 */
describe('the Goals screen holds a hundred (§5)', () => {
  /*
   * A flex item will not shrink below its own content width unless it is told
   * it may. Without `minWidth: 0` the chip scroller kept its full natural width
   * (407px inside a 382px bar) and the sort button was drawn straight over the
   * DONE chip: measured with the caret at x719 and DONE's label at x764, on top
   * of each other, with the button ending 12px past the column edge.
   */
  test('the chip row can shrink, so the sort control is not drawn over it', () => {
    assert.match(style('filterScroll'), /minWidth:\s*0/,
      'without it the row overflows and the two controls overlap');
    assert.match(style('sortBtn'), /flexShrink:\s*0/,
      'the sort label changes length; squeezing it is how the row starts wrapping');
  });

  /*
   * Cards measured 198px each, so 31 live goals is 4,408px of scroll. The add
   * button used to be the last row of that scroll — a control that exists and
   * cannot be reached without a deliberate 4,000px swipe.
   */
  test('the add control is pinned below the list, not the end of it', () => {
    const at = SOURCE.indexOf('<ScrollView contentContainerStyle={[s.body');
    assert.ok(at > 0, 'the list ScrollView was renamed — this test is reading the whole file');
    const body = SOURCE.slice(at);
    const listEnd = body.indexOf('</ScrollView>');
    // The label goes through the translation table now, so the structural
    // check anchors on the key rather than on the English.
    const add = body.indexOf("T('addGoal')");
    assert.ok(listEnd > 0 && add > listEnd,
      'the add button is inside the scrolling list again');
    assert.match(style('footer'), /borderTopWidth/,
      'pinned to the bottom edge it needs a rule, or it reads as one more card');
  });

  /*
   * The list is the only thing on this screen that scrolls and it can be four
   * thousand pixels long. Suppressing the indicator was inherited from the
   * three-goal version, where there was nothing to indicate.
   */
  test('a list this long shows where you are in it', () => {
    const body = region(SOURCE, '<ScrollView contentContainerStyle={[s.body');
    assert.doesNotMatch(upTo(body, '>'), /showsVerticalScrollIndicator=\{false\}/,
      'no indicator on a 4,400px list reads as a list that ends where the window does');
  });

  /*
   * Under five goals every chip is a control for hiding a card already on
   * screen. The bar has to be able to go away again — and when it does, a
   * filter left over from the longer list must not keep hiding goals with no
   * visible control to undo it.
   */
  test('the bar can disappear without stranding the filter that was set', () => {
    assert.match(SOURCE, /const showBar = goals\.length > \d/,
      'the bar is unconditional, so it shows for two goals');
    assert.match(SOURCE, /shownFilter: GoalFilter = showBar && counts\[filter\] > 0 \? filter : 'open'/,
      'the filter must fall back to OPEN whenever its control is not on screen, ' +
      'or when the filter it remembered no longer holds anything');
    assert.match(SOURCE, /filterGoals\(goals, shownFilter, sort\)/,
      'the list reads `filter` directly and can be filtered by a control nobody can see');
  });

  /*
   * The card's top row holds a name and two controls now. Measured with the
   * library's longest name, "Machine Chest Press": 76px of slack on a 430px
   * column, which is 23px on a 375px phone and negative for any movement the
   * user invents with a longer one.
   */
  test('a long lift name truncates rather than shoving the controls off', () => {
    assert.match(style('cardLift'), /flexShrink:\s*1/,
      'without it the name grows and takes CHANGE and REMOVE with it');
    assert.match(style('cardActions'), /flexShrink:\s*0/,
      'and the controls must be the thing that does not give');
    const card = region(SOURCE, 'function GoalCard', 'function AddGoal');
    assert.match(card, /style=\{s\.cardLift\} numberOfLines=\{1\}/,
      'shrinking without numberOfLines wraps to two lines instead');
  });

  /*
   * An achieved goal is a record of something that happened. Editing it would
   * rewrite the target it was met against, which is the one number that made
   * it worth anything.
   */
  test('a goal already met cannot be edited, only wiped', () => {
    const card = region(SOURCE, 'function GoalCard', 'function AddGoal');
    assert.match(card, /\{!p\.achieved && \(/, 'the CHANGE control must be conditional');
    const change = card.indexOf("T('change')");
    const guard = card.indexOf('{!p.achieved && (');
    assert.ok(change > 0, 'the CHANGE control was renamed — this test reads nothing');
    assert.ok(guard > 0 && guard < change, 'the guard must come before the control it hides');
    assert.match(card, /T\('wipe'\)/, 'and wiping it stays available');
  });

  /*
   * Pinning the add button to the bottom edge left the one sentence explaining
   * an empty Goals screen floating a thousand pixels above the only control
   * that acts on it, with nothing in between. Measured at y93 and y1127.
   */
  test('an empty screen reads as one thing, not two ends of a window', () => {
    assert.match(style('bodyEmpty'), /justifyContent:\s*'center'/,
      'the empty message must sit with the control it is asking you to press');
    assert.match(style('bodyEmpty'), /flexGrow:\s*1/,
      'without it there is no space to centre within');
    assert.match(SOURCE, /goals\.length === 0 && s\.bodyEmpty/,
      'the style exists but nothing applies it');
  });

  test('a filter chip that would show nothing does not take the tap', () => {
    assert.match(SOURCE, /disabled=\{counts\[f\] === 0\}/,
      'an empty filter still costs a tap to discover');
    assert.match(SOURCE, /\{counts\[f\]\}/, 'the chip must say how many it holds');
  });
});

/*
 * R326: `counts.done` is already shown, but only inside the filter bar — and
 * the bar itself only exists once there are more than four goals. Someone
 * with a handful of goals, the common case, had a real trophy with no way to
 * see the tally. Shown as its own line ONLY while the bar is not already
 * saying the same number, so the two can never show conflicting counts.
 */
describe('the goals achieved so far, when the filter bar is not already saying it', () => {
  test('is suppressed once the bar exists — the bar already counts it', () => {
    assert.match(SOURCE, /\{!showBar && counts\.done > 0 && \(/,
      'the achieved line must go quiet once the filter bar can show the same count');
  });

  test('reads the real count, not a stub, and branches singular', () => {
    assert.match(SOURCE,
      /T\(counts\.done === 1 \? 'goalsAchievedLineOne' : 'goalsAchievedLine'\)/,
      'the achieved line no longer reads the real count, or lost its singular form');
  });
});

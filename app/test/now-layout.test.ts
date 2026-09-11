import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { region } from './helpers/source.ts';

/**
 * Layout invariants for the Now screen.
 *
 * Every other test in this suite runs against a model, because that is where
 * the rules with teeth live. Layout is the exception: it has no model, and the
 * bug these pin was invisible to all 232 of them — the exercise name and the
 * PROGRESS/GOALS links occupied the same band, so "TRICEP EXTENSION" printed
 * straight through "PROGRESS" and a custom movement ran 58px off the left edge
 * of a 375px screen. It was found by measuring the running app, and nothing in
 * the test suite could have caught it.
 *
 * So these read the source. That is crude and they know less than a browser
 * does — they cannot tell you the screen looks right. What they can do is fail
 * the moment someone reverts one of the two decisions that stopped the
 * collision, which is the only job being asked of them.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, '..', 'src', 'ui', 'NowScreen.tsx'), 'utf8');

/** The body of one entry in the `StyleSheet.create({ ... })` object. */
function style(name: string): string {
  const m = SOURCE.match(new RegExp(`\\n  ${name}:\\s*\\{([^}]*)\\}`, 's'))
    ?? SOURCE.match(new RegExp(`\\n  ${name}:\\s*([^,\\n]*)`));
  assert.ok(m, `no style named "${name}" — it was renamed or removed`);
  return m![1];
}

describe('Now screen — layout invariants', () => {
  // R640: the top link row is gone; the tab bar replaced it. Same rule, new
  // element: an absolute bar would sit over LOG SET instead of below it.
  test('the tab bar is in flow, so the column cannot slide under it', () => {
    assert.doesNotMatch(style('tabBar'), /position:\s*'absolute'/,
      'an absolute tabBar covers the bottom of the column on a short phone');
  });

  test('the screen has a content column below the links', () => {
    assert.match(SOURCE, /content:\s*\{[^}]*flex:\s*1/s,
      'without it the root centres everything including the nav row');
    assert.match(SOURCE, /<View style=\{\[s\.content,/,
      'the content style exists but nothing renders into it');
  });

  /*
   * The column is centred while there is room and top-aligned once there is
   * not. Centring is inert in the good case — `todayWrap` is `flex: 1` and eats
   * every spare pixel, so there is never free space to distribute — but in the
   * bad case it decided where overflow went, and it split it BOTH ways.
   * Measured at 281x460: a 401px column in a 391px container put the exercise
   * name at y34, above its own container's top at y39, drawn straight over the
   * PROGRESS / GOALS links. Ten pixels of overflow, overlapping text.
   */
  test('a column that cannot fit overflows downward, never into the nav', () => {
    assert.match(style('contentTight'), /justifyContent:\s*'flex-start'/,
      'once out of room the column must start at the top, so overflow goes down');
    assert.match(SOURCE, /tight && s\.contentTight/,
      'nothing switches the alignment when the screen runs out of room');
  });

  test('and a window too short to hold it scrolls rather than losing parts', () => {
    // §4's no-scroll rule is about phones, and `layoutFor` keeps `scrolls`
    // false for every device that ships. Below that the alternative was
    // throwing away the day rail so FINISH could survive.
    assert.match(SOURCE, /function ColumnWrap/, 'nothing decides between a column and a scroller');
    assert.match(SOURCE, /if \(!scrolls\)/, 'the fixed column must still be the default');
    assert.match(SOURCE, /contentContainerStyle=\{\[s\.content, s\.contentTight, \{ flexGrow: 1 \}\]\}/,
      'a ScrollView positions children through contentContainerStyle, and flexGrow ' +
      'is what lets todayWrap still absorb slack');
  });

  test('and it is still centred when it does fit', () => {
    // `flex-start` unconditionally was the first attempt: on a 375x812 phone it
    // collapsed the column to the top and left 340px of dead space under it.
    assert.match(style('content'), /justifyContent:\s*'center'/,
      'the roomy case must stay centred');
  });

  test('the exercise name has a definite width, so a long one truncates', () => {
    // R640: the name now shares its line with the streak, so the stretch is on
    // the line and the Pressable takes the remaining width with flex: 1 --
    // still a definite width, which is all numberOfLines needs.
    assert.match(style('exerciseLine'), /alignSelf:\s*'stretch'/,
      'the exercise line is shrink-to-fit, so the name inside it has no bound');
    assert.match(style('exerciseTap'), /flex:\s*1/,
      'the Pressable does not take the width of the line, so a long name is unbounded');
    assert.match(style('exerciseTap'), /minWidth:\s*0/,
      'without minWidth: 0 a flex child refuses to shrink below its content');
    // Through `pressStyle` now, which composes the base with the held state —
    // the stretch still has to be in there or the name shrink-wraps again.
    assert.match(SOURCE, /pressStyle\(s\.exerciseTap,/,
      'the style exists but the Pressable does not use it');
    assert.match(SOURCE, /style=\{s\.exercise\}\s+numberOfLines=\{1\}/,
      'a bounded width only ellipsizes with numberOfLines');
  });

  test('the picker sheet does not use the slide animation', () => {
    // On react-native-web "slide" is a 0.3s keyframe with
    // `animation-fill-mode: none`, so the sheet REVERTS to its start transform
    // when the animation ends: measured `translateY(812px)` on an 812px window.
    // The exercise picker rendered one full viewport below the screen and had
    // done since it was built — invisible, and undetected because every check
    // drove it with synthetic pointer events, which hit an element whether or
    // not a human can see it.
    assert.doesNotMatch(SOURCE, /animationType="slide"/,
      'the sheet slides off the bottom of the screen and stays there');
    assert.match(SOURCE, /<ScreenModal visible animationType="none" transparent/);
  });

  /*
   * Hitting a goal earns the accent; a gap still to close does not. §15 allows
   * one volt, and for the length of one set this is what it is for — a
   * different size class from the hero, so it draws the eye without competing
   * with the number.
   */
  test('only the set that hit the goal is volt', () => {
    assert.match(style('lastTimeHit'), /color:\s*VOLT/,
      'the one moment worth marking is drawn in the same grey as everything else');
    assert.match(SOURCE, /state\.lastTime\.hit \? s\.lastTimeHit : undefined/,
      'the accent must be conditional on the hit, not on there being a goal at all');
  });

  test('and the line can still only be one row', () => {
    // The colour needed a nested Text, and nesting is where numberOfLines
    // quietly stops applying. The height model treats this as exactly one row.
    assert.match(SOURCE, /<Text style=\{s\.lastTime\} numberOfLines=\{1\}>/);
    assert.match(style('lastTime'), /alignSelf:\s*'stretch'/,
      'numberOfLines can only ellipsize against a definite width');
  });

  test('the hero number is still the hero', () => {
    /*
     * A guard on the fix above: stretching the name must not have made it
     * compete with the number §4 puts at the centre of the screen.
     *
     * R511 asks this as the RELATIONSHIP rather than as the literal 22 it used
     * to pin. The bound is not a preference, it is `layoutFor`'s own floor --
     * `hero: Math.max(24, ...)` -- so a name at 24 or more outgrows the weight
     * on the smallest viewport the app supports. Pinning 22 said nothing about
     * WHY, and a restyle that read it as a stale constant would have shipped
     * exactly that bug -- this one did, and was caught here. Stating the reason
     * tells the next person what the size has to stay under.
     */
    const size = Number(/fontSize:\s*(\d+)/.exec(style('exercise'))?.[1]);
    const heroFloor = Number(/hero: Math\.max\((\d+),/.exec(
      fs.readFileSync(path.join(HERE, '..', 'src', 'ui', 'now-model.ts'), 'utf8'))?.[1]);
    assert.ok(heroFloor > 0, 'layoutFor no longer floors the hero; this guard has no bound');
    assert.ok(size < heroFloor,
      `the exercise name is ${size}px and the hero floors at ${heroFloor}px, so on ` +
      'the smallest screen the name is as large as the weight or larger');
    assert.match(SOURCE, /fontSize:\s*L\.hero/,
      'the weight is sized by layoutFor and dwarfs everything else');
  });

  test('every vertical measure comes from layoutFor, not the stylesheet', () => {
    // The screen does not scroll, so these are what decide whether it fits. A
    // hard-coded one is invisible to the fit tests and puts the footer back
    // below the fold on a short viewport.
    for (const [prop, style_] of [
      ['marginBottom', 'header'], ['marginTop', 'repsRow'], ['marginTop', 'restRow'],
      ['marginTop', 'footer'], ['marginTop', 'todayWrap'], ['minHeight', 'todayWrap'],
      ['height', 'logButton'], ['marginTop', 'logButton']
    ] as const) {
      assert.doesNotMatch(style(style_), new RegExp(`${prop}:\\s*\\d`),
        `${style_}.${prop} is hard-coded — layoutFor cannot shrink it`);
    }
    assert.match(SOURCE, /const L = useMemo\(\(\) => layoutFor\(width, height, heroChars\)/);
  });
});

/**
 * The same trap, swept across every screen.
 *
 * The Now picker was found off-screen by measuring the running app; the Goals
 * "add a goal" sheet had the identical bug and was found only because someone
 * went looking for the pattern afterwards. A defect that can hide for thirty
 * rounds in one file can hide in the next one, so this reads them all.
 */
describe('every screen — traps that make a surface invisible', () => {
  const ROOTS = [path.join(HERE, '..', 'src', 'ui'), path.join(HERE, '..', 'app')];

  function screens(): Array<{ name: string; text: string }> {
    const out: Array<{ name: string; text: string }> = [];
    for (const root of ROOTS) {
      for (const f of fs.readdirSync(root)) {
        if (!f.endsWith('.tsx')) continue;
        out.push({ name: f, text: fs.readFileSync(path.join(root, f), 'utf8') });
      }
    }
    return out;
  }

  test('there are screens to check', () => {
    assert.ok(screens().length >= 4, 'the sweep found nothing, so it proves nothing');
  });

  test('no sheet uses the slide animation', () => {
    // react-native-web reverts the element to `translateY(100%)` when the
    // keyframe ends — the sheet drops one full viewport below the screen and
    // stays there. Two of them shipped that way.
    for (const { name, text } of screens()) {
      assert.doesNotMatch(text, /animationType="slide"/,
        `${name}: this sheet renders below the fold and cannot be seen`);
    }
  });

  test('a platform call that can reject is never a bare onPress', () => {
    // `Share.share` REJECTS when the platform cannot open a share sheet — the
    // web preview rejects with "Share is not supported in this browser". Wired
    // straight into onPress, tapping the one button this product exists to
    // serve produced an unhandled promise rejection: a red stack trace over the
    // recap in development, and nothing at all in production.
    for (const { name, text } of screens()) {
      if (!/Share\.share/.test(text)) continue;
      assert.doesNotMatch(text, /onPress=\{\(\) => Share\.share/,
        `${name}: an unhandled rejection is one tap away`);
      assert.match(text, /catch/,
        `${name}: calls Share.share and never handles it failing`);
    }
  });

  test('no Modal is toggled with `visible`', () => {
    // The other half of the same lesson: a transparent RNW Modal does not
    // reliably disappear when `visible` goes false. Every sheet in this app is
    // mounted conditionally instead.
    for (const { name, text } of screens()) {
      assert.doesNotMatch(text, /<Modal[^>]*visible=\{/,
        `${name}: render the Modal conditionally rather than toggling visible`);
    }
  });
});

describe('Now screen — the picker can show the library (§7)', () => {
  const GOALS = fs.readFileSync(path.join(HERE, '..', 'app', 'goals.tsx'), 'utf8');
  const pct = (css: string) => Number((css.match(/maxHeight:\s*'(\d+)%'/) ?? [])[1]);

  /*
   * Journey C, measured on the running app. The picker is grouped by split day
   * (R33) and lists every movement the user invented alongside the ranked
   * twelve, so its content grows. At a 72% cap and with ONE custom movement
   * added, the list was 624px inside a 450px viewport: Leg Press and Squat —
   * the entire LEGS group — measured 0px visible, with a 7px sliver of Deadlift
   * as the only sign the list continued at all.
   */
  test('the picker sheet is not capped smaller than the Goals sheet', () => {
    const picker = pct(style('sheet'));
    const goals = pct(GOALS);
    assert.ok(picker >= goals,
      `the picker caps at ${picker}% and Goals at ${goals}% — the picker holds MORE, ` +
      `so a smaller cap on it is backwards`);
  });

  test('the cap leaves the backdrop something, rather than becoming a full screen', () => {
    // §5 caps the app at four screens. A sheet at 100% is a fifth one wearing
    // rounded corners; the visible backdrop is what keeps it a sheet.
    const picker = pct(style('sheet'));
    assert.ok(picker > 0 && picker <= 90, `${picker}% is not a sheet any more`);
  });

  /*
   * The cap cannot be the whole answer and is not claimed to be: twelve ranked
   * movements plus any number of custom ones will outgrow any percentage. So
   * the list has to say that it scrolls.
   */
  test('the picker list shows its scroll indicator', () => {
    const picker = region(SOURCE, 'function ExercisePicker');
    const list = picker.match(/<ScrollView([^>]*)>/s);
    assert.ok(list, 'the picker no longer has a ScrollView');
    assert.doesNotMatch(list![1], /showsVerticalScrollIndicator=\{false\}/,
      'a list that is cut off with no indicator reads as the whole library — ' +
      'that is how an entire split day went missing');
  });

  test('the add row is still pinned outside that list', () => {
    // R35 moved it below the scroll; an indicator must not have tempted it back
    // in, where it was the nineteenth row at y 1068.
    const picker = region(SOURCE, 'function ExercisePicker');
    const listEnd = picker.indexOf('</ScrollView>');
    // Translated behind T('somethingElse') now; the structural rule is
    // unchanged, so the anchor moves to the key.
    const addRow = picker.indexOf("T('somethingElse')");
    assert.ok(listEnd > 0 && addRow > listEnd,
      'the add row is inside the scrolling list again — it must sit below it');
  });
});

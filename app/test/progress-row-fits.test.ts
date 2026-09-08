import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPARK_POINTS } from '../src/ui/progress-model.ts';
import { MIN_BAR, MAX_BAR, GAP, sparkFloor } from '../src/ui/spark-geom.ts';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, '..', 'app', 'progress.tsx'), 'utf8');
/*
 * R475: the sparkline is one component now, shared with Measure, and its
 * geometry is real imported numbers rather than a regex over a StyleSheet —
 * see `spark-geom.ts`. Progress keeps only where the chart SITS, which is what
 * `src` is still read for below.
 */
const sparkSrc = readFileSync(path.join(HERE, '..', 'src', 'ui', 'Spark.tsx'), 'utf8');

/**
 * The narrowest phone §5 still has to work on. An iPhone SE is 320pt, and it
 * is the width nobody develops at — the bug below was invisible at 390.
 */
const SE = 320;

/**
 * Measured in the running app at fontSize 10, weight 800, letterSpacing 0.8:
 * "30 TO 225" renders 57pt wide. Four-digit targets ("120 TO 1000") are the
 * realistic worst case for a leg press, so the budget is checked against a
 * deliberately generous number rather than the one that happened to be on
 * screen.
 */
const GOAL_TAG_PT = 70;

/**
 * The same string as actually measured — 57pt for "30 TO 225".
 *
 * Deliberately a second constant. The two tests below ask different questions
 * and must not share an answer: "can anything be squeezed to zero" is a
 * worst-case question, and "does the chart reach full size on a normal phone"
 * is a typical-case one. Using the worst case for both failed by 4pt and would
 * have had me shaving a bar width to turn a green light on, which is the
 * failure mode this file exists to prevent.
 */
const GOAL_TAG_TYPICAL_PT = 57;

/** Pull a number out of a style declaration, so the test tracks the source. */
function styleNum(styleName: string, prop: string): number {
  const decl = region(src, `  ${styleName}: {`, '},');
  const m = decl.match(new RegExp(`${prop}:\\s*(-?[\\d.]+)`));
  assert.ok(m, `${styleName} no longer declares ${prop}`);
  return Number(m![1]);
}

/*
 * A Progress row has to fit on the narrowest phone, and the CHART is what
 * gives way — never a number.
 *
 * Found by loading a seeded 12-week history and measuring every leaf on the
 * running app at 320pt. The row wanted about 290pt before the goal tag had
 * said anything: ten fixed 14pt bars, three gaps, a 62pt trend column. The
 * flex spacer collapsed to nothing and then the goal tag itself collapsed to
 * **width 0** under `overflow: hidden` — not ellipsised, gone. "30 TO 225"
 * was simply absent, with nothing to say it had been dropped, on the row whose
 * job is reporting how far a lift is from its target.
 *
 * §16 says every number in the app has to be checkable. A number rendered at
 * zero width is worse than one that was never shown: the screen looks complete.
 *
 * The arithmetic below is the part that would have caught it. The style tests
 * pin the mechanism; this pins the BUDGET, so bumping the trend column or the
 * bar width fails here instead of silently squeezing a number off a phone
 * nobody is testing on.
 */
describe('a Progress row fits on the narrowest phone', () => {
  test('the fixed costs leave room for both numbers at 320pt', () => {
    const gutter = styleNum('body', 'paddingHorizontal');
    const gap = styleNum('rowBottom', 'gap');
    const trend = styleNum('trend', 'minWidth');
    const tagGap = styleNum('goalTag', 'marginLeft');
    const available = SE - gutter * 2;
    // spark, goalTag, trend — two gaps between three children.
    const chrome = gap * 2 + tagGap + trend + GOAL_TAG_PT;
    const floor = sparkFloor(SPARK_POINTS);

    assert.ok(chrome + floor <= available,
      `a row needs ${chrome + floor}pt but a 320pt phone offers ${available}pt — ` +
      'something will be squeezed to zero width, and it will be a number');
  });

  test('and the chart can still reach its full size on a normal phone', () => {
    const gutter = styleNum('body', 'paddingHorizontal');
    const gap = styleNum('rowBottom', 'gap');
    const trend = styleNum('trend', 'minWidth');
    const tagGap = styleNum('goalTag', 'marginLeft');

    const full = SPARK_POINTS * MAX_BAR + (SPARK_POINTS - 1) * GAP;
    const available = 390 - gutter * 2 - (gap * 2 + tagGap + trend + GOAL_TAG_TYPICAL_PT);
    assert.ok(full <= available,
      'the chart cannot reach full size even on a 390pt phone — the cap is decorative');
  });
});

/*
 * Every sparkline on the screen is the same width.
 *
 * The goal tag used to render only on rows that HAD a goal, so a goal-less row
 * gave that space to its chart — and at 320pt the screen came out with 14pt
 * bars on most rows and 8pt bars on the one with a goal. Seen as a rendered
 * picture rather than as numbers, the odd row reads as a mistake and, worse, as
 * a different SHAPE: a sparkline column exists to be scanned downward, and two
 * scales cannot be compared. Measured after reserving the slot: ONE bar width
 * across all 72 bars at 320pt, and 390pt untouched at 14.
 */
describe('the sparkline column can be compared down its length', () => {
  test('the goal slot is reserved whether or not there is a goal', () => {
    assert.match(src, /row\.goal \? goalTag\(/,
      'the tag renders conditionally again, so rows without a goal will grow their chart');
    assert.doesNotMatch(src, /row\.goal && \(/,
      'the conditional wrapper is back around the goal tag');
  });

  test('the slot has a width to reserve', () => {
    const min = styleNum('goalTag', 'minWidth');
    assert.ok(min >= 57,
      `${min}pt is narrower than the measured "30 TO 225" (57pt), so a real tag would still take extra`);
  });

  test('and reserving it still leaves the chart its full size at 390', () => {
    // The reservation must cost nothing on the common phone.
    const available = 390 - styleNum('body', 'paddingHorizontal') * 2
      - (styleNum('rowBottom', 'gap') * 2 + styleNum('goalTag', 'marginLeft')
         + styleNum('goalTag', 'minWidth') + styleNum('trend', 'minWidth'));
    const full = SPARK_POINTS * MAX_BAR + (SPARK_POINTS - 1) * GAP;
    assert.ok(full <= available,
      `reserving the tag leaves ${available}pt and the chart needs ${full}pt at full size`);
  });
});

describe('the chart yields, not the numbers', () => {
  test('spark is the flex child that absorbs the shortfall', () => {
    // Where the chart sits is still Progress's business — see Spark.tsx's own
    // note on what belongs to the component and what belongs to the screen.
    assert.match(region(src, '  sparkFlex: {', '},'), /flex:\s*1/);
    assert.match(src, /<Spark values=\{row\.spark\} style=\{s\.sparkFlex\} \/>/,
      'Progress no longer hands the shared sparkline its own layout');
  });

  /*
   * R338: `minWidth: 0` (the original fix) let the CONTAINER shrink freely,
   * but the bars inside it have their own floor (`bar.minWidth`) that does
   * not shrink with it — so at extreme Dynamic Type scale, `goalTag`'s
   * inflated text claimed the space flexbox thought `spark` had given up,
   * and the bars (still their own minimum size, unable to compress
   * further) rendered on top of it. `spark`'s own floor has to be what its
   * BARS actually need — not zero — so flexbox refuses to shrink it below
   * that and `rowBottom`'s wrap has real overflow to detect instead of
   * silently absorbing it as invisible bar overlap.
   */
  test('but spark\'s own floor is what its bars actually need, not zero', () => {
    // Arithmetic on the real numbers now, rather than a regex over a
    // StyleSheet: the floor has to BE what ten bars at their own minimum, with
    // real gaps, actually need — and the component has to apply it.
    assert.equal(sparkFloor(SPARK_POINTS), SPARK_POINTS * MIN_BAR + (SPARK_POINTS - 1) * GAP,
      'spark\'s floor no longer matches what ten bars at their own minimum, with real gaps, actually need');
    assert.match(sparkSrc, /minWidth: floor/,
      'the sparkline no longer applies its own floor, so flexbox may shrink it past its bars');
  });

  test('rowBottom can wrap once its floors genuinely do not fit', () => {
    const rowBottom = region(src, '  rowBottom: {', '},');
    assert.match(rowBottom, /flexWrap:\s*'wrap'/,
      'without wrap, content past every floor silently overlaps instead of dropping to a second line');
  });

  test('both numbers are pinned against shrinking', () => {
    assert.match(region(src, '  goalTag: {', '},'), /flexShrink:\s*0/);
    assert.match(region(src, '  trend: {', '},'), /flexShrink:\s*0/);
  });

  test('bars grow and cap rather than sitting at a fixed width', () => {
    const bar = region(sparkSrc, '  bar: {', '},');
    assert.match(bar, /flexShrink:\s*1/);
    assert.match(bar, /maxWidth: MAX_BAR/);
    assert.match(bar, /minWidth: MIN_BAR/);
    assert.ok(MAX_BAR > MIN_BAR && MIN_BAR >= 1,
      'the cap must actually cap, and a compressed bar must not vanish into a hairline');
    assert.doesNotMatch(bar, /\bwidth:\s*\d/,
      'a fixed bar width is what forced the goal tag to zero');
  });

  test('the dead flex spacer is gone, not left behind', () => {
    // It was `<View style={s.rowSpacer} />` between the chart and the tag. With
    // spark greedy it does nothing, and a leftover style is the kind of thing
    // that gets re-added later "because there is a style for it".
    assert.doesNotMatch(src, /rowSpacer/);
  });
});

/*
 * R313: a past day's summary could say "what did I do" but not "show me the
 * card" — the recap that day actually produced. Tapping it now reopens that
 * exact card, so this pins the wiring rather than the pixels: a
 * PastSession that silently stopped navigating would look identical to one
 * that never could, unless something asserts the route is really there.
 */
describe('a past day\'s summary reopens its own recap', () => {
  test('PastSession is pressable and carries the session id to the recap route', () => {
    assert.match(src, /push\(\{ pathname: '\/recap', params: \{ session: h\.id \} \}\)/,
      'the history list no longer routes a tap to its own recap');
  });

  test('the row itself is a Pressable, not a static View', () => {
    const body = region(src, 'function PastSession({ h, onPress }', 'function Row(');
    assert.match(body, /<Pressable accessibilityRole="button" onPress=\{onPress\}/);
  });
});

/*
 * R320: `weekStreak` has been pure and testable since §10 shipped it, and
 * the only place it was ever readable was the recap, for the few seconds
 * right after FINISH — a lifter deciding whether to train today had no way
 * to check it — which turned out to be false. R327: driving the app with an
 * actual multi-week streak (rather than the single-week data every earlier
 * round happened to have) showed the Now screen's own top-right corner
 * already names it, persistently, on the app's most-visited screen —
 * `NowScreen.tsx`'s `state.streak` badge predates this round entirely. The
 * line this test used to pin, restating that same number on Progress, was
 * removed as a genuine duplicate rather than a new capability. `weekStreak`
 * is still computed here — unrendered — purely to gate the best-streak line
 * below.
 */
describe('the current streak is computed but deliberately not shown a second time', () => {
  test('still reads real history, to gate the best-streak line correctly', () => {
    assert.match(src, /weekStreak\(repo\.allSets\(\), Date\.now\(\)\)/,
      'the gating computation no longer reads real set history');
  });

  test('is not rendered on its own — that would restate the Now screen\'s own badge', () => {
    assert.doesNotMatch(src, /T\('streakLine'\)/,
      'a removed duplicate has come back — the current streak already has a home, on Now');
  });
});

/*
 * R324/R327: `longestStreakBefore` has existed since the recap's own
 * streakRecord flag was built, asked only a yes/no question. Pins that
 * Progress reads the real function and only shows it as a DISTINCT fact
 * from the current streak — the failure mode being a redundant "BEST: 3"
 * sitting right under the Now screen's own current-streak badge once the
 * current run reaches its own record.
 */
describe('the streak names the record to chase, only while it is a different fact', () => {
  test('reads the real longestStreakBefore, not a stub', () => {
    assert.match(src, /longestStreakBefore\(repo\.allSets\(\), Date\.now\(\)\)/,
      'the best-streak line no longer reads real history');
  });

  test('is suppressed once the current streak reaches or passes it', () => {
    assert.match(src, /b > streak && streakWorthShowing\(b\)/,
      'the best line must go quiet once it stops being a fact distinct from the current streak');
  });
});

/*
 * R327: found by driving the app with a real two-year gap in training
 * history — an old and a new session sat side by side in the recent-
 * workouts list with no year on either date, reading as ten months apart
 * within one year rather than two years apart. Mirrors `trendLine`'s own
 * fix in measure-model.ts for the identical shape.
 */
describe('a stale session in the recent-workouts list names its year', () => {
  test('the year is added only once it differs from this one', () => {
    assert.match(src, /startedDate\.getFullYear\(\) !== new Date\(\)\.getFullYear\(\)/,
      'the recent-workouts date no longer checks whether it needs a year');
    assert.match(src, /year:\s*'numeric'/,
      'the year option itself is gone — an old session reads as this year again');
  });
});

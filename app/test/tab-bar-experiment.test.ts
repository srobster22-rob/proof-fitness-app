import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TAB_BAR_HEIGHT, goTab, type Tab } from '../src/ui/tab-bar.ts';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = fs.readFileSync(path.join(HERE, '..', 'src', 'ui', 'NowScreen.tsx'), 'utf8');
const BAR = fs.readFileSync(path.join(HERE, '..', 'src', 'ui', 'TabBar.tsx'), 'utf8');
const screen = (f: string) => fs.readFileSync(path.join(HERE, '..', 'app', f), 'utf8');

/*
 * R523 built the bar as an experiment that shipped to nobody. R640 shipped it:
 * owner, 2026-09-10, "ship the tab bar, move the streak to the exercise line".
 * What matters now is that it stays ONE design -- no flag quietly bringing the
 * old top row back -- and that the streak §10 wants visible on launch survived
 * the move.
 */
describe('the tab bar is the layout, and the streak moved with it (R640)', () => {
  test('there is no flag left: the bar always renders', () => {
    assert.doesNotMatch(SCREEN, /tabBarOn|PREF_TAB_BAR|\{tabBar && \(/,
      'the bar is behind a condition again -- a lifter can land on the old layout');
    assert.match(SCREEN, /<TabBar current="now"/);
  });

  /*
   * R645. The bar shipped on Now alone, so tapping PROGRESS made it vanish.
   * Every tab it names renders it, with itself lit, and the shared component
   * is the only place the bar is drawn -- a second copy would drift.
   */
  test('every tab the bar names renders the bar, lit on itself', () => {
    assert.match(screen('progress.tsx'), /<TabBar current="progress"/);
    assert.match(screen('goals.tsx'), /<TabBar current="goals"/);
    assert.match(screen('settings.tsx'), /<TabBar current="settings"/);
    for (const f of ['progress.tsx', 'goals.tsx', 'settings.tsx']) {
      assert.match(screen(f), /go=\{tab => goTab\(router, tab\)\}/,
        `${f}: tab routing must go through goTab, the one place that knows NOW is the root`);
    }
    assert.doesNotMatch(SCREEN, /tabGlyph|tabLabel:/, 'Now still has its own copy of the bar styles');
  });

  /*
   * Behaviour, not source: goTab lives in tab-bar.ts, which has no
   * react-native import, so it runs here against a fake router.
   */
  function fakeRouter(canGoBack: boolean) {
    const calls: string[] = [];
    return {
      calls,
      canGoBack: () => canGoBack,
      dismissAll: () => { calls.push('dismissAll'); },
      replace: (h: never) => { calls.push(`replace ${h as unknown as string}`); }
    };
  }

  test('NOW pops back to the root Now when it is underneath (R646)', () => {
    const r = fakeRouter(true);
    goTab(r, 'now');
    assert.deepEqual(r.calls, ['dismissAll'],
      'NOW replaced instead of popping -- that stacks a second Now under every trip');
  });

  test('NOW still works when the app was opened straight onto another tab (R648)', () => {
    // A refresh or deep link onto /progress leaves nothing underneath, and
    // popping to the top of a one-screen stack does nothing.
    const r = fakeRouter(false);
    goTab(r, 'now');
    assert.deepEqual(r.calls, ['replace /'],
      'with nothing underneath, NOW must replace to the root or it is a dead button');
  });

  test('the other tabs replace, never push or pop', () => {
    for (const tab of ['progress', 'goals', 'settings'] as Tab[]) {
      for (const back of [true, false]) {
        const r = fakeRouter(back);
        goTab(r, tab);
        assert.deepEqual(r.calls, [`replace /${tab}`], `${tab} with canGoBack=${back}`);
      }
    }
  });

  test('the top link row it replaced is gone', () => {
    // Keeping both would put PROGRESS / GOALS / settings on screen twice.
    assert.doesNotMatch(SCREEN, /style=\{s\.topBar\}|style=\{s\.topLink\}|style=\{s\.topGear\}/,
      'the old top row is back alongside the bar');
  });

  test('the streak sits on the exercise line, outside the picker control', () => {
    const line = region(SCREEN, '<View style={s.exerciseLine}>', '{state.lastTime.head}');
    const streakAt = line.indexOf('style={s.streak}');
    assert.ok(streakAt >= 0, 'the streak is not on the exercise line -- §10 lost its launch-screen streak');
    assert.ok(line.lastIndexOf('</Pressable>', streakAt) >= 0,
      'the streak is INSIDE the pressable that opens the picker, so it reads as part of that control (§15)');
    assert.match(line, /streakWorthShowing\(state\.streak\)/,
      'the streak no longer uses the recap\'s rule, so the screen and the card can disagree');
  });

  test('the bar is a real bar, not a mock', () => {
    assert.ok(TAB_BAR_HEIGHT >= 56, `${TAB_BAR_HEIGHT}px is not a tab bar, it is a row of icons`);
    const style = region(BAR, '  tabBar: {', '  tabItem:');
    assert.match(style, /height: TAB_BAR_HEIGHT/);
    assert.match(style, /borderTopWidth: 1/, 'nothing separates the bar from the content above it');
  });

  test('and it says which destination you are on', () => {
    assert.match(BAR, /const on = id === current;/);
    assert.match(BAR, /on && s\.tabGlyphOn/);
    assert.match(BAR, /tabGlyphOn: \{ color: VOLT \}/);
    assert.match(BAR, /disabled=\{on\}/, 'the tab you are on must not be a link to itself');
  });
});

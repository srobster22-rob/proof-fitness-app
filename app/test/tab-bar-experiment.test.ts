import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TAB_BAR_HEIGHT } from '../src/ui/tab-bar.ts';
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
      assert.match(screen(f), /go=\{tab => router\.replace\(TAB_ROUTE\[tab\] as never\)\}/,
        `${f}: a tab tap must replace, not push -- a push stacks tab on tab`);
    }
    assert.doesNotMatch(SCREEN, /tabGlyph|tabLabel:/, 'Now still has its own copy of the bar styles');
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

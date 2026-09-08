import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { tabBarOn, PREF_TAB_BAR, TAB_BAR_HEIGHT } from '../src/ui/tab-bar.ts';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = fs.readFileSync(path.join(HERE, '..', 'src', 'ui', 'NowScreen.tsx'), 'utf8');

/*
 * R523. OWNER.md, 2026-09-08: "the bottom tab bar — BUILD BOTH and show me...
 * Do not ship either as the default until I have chosen."
 *
 * So the one property that matters about this code is that it reaches nobody.
 * An experiment that quietly becomes the default is worse than not building it,
 * because the owner would be choosing from pictures of something the app is
 * already doing.
 */
describe('the tab bar is built, and shipped to nobody (R523)', () => {
  test('it is off unless explicitly turned on', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => Date.now());
    assert.equal(tabBarOn(repo), false, 'a fresh install gets the experiment');
    repo.setPref(PREF_TAB_BAR, '0');
    assert.equal(tabBarOn(repo), false);
    repo.setPref(PREF_TAB_BAR, 'yes');
    assert.equal(tabBarOn(repo), false, 'anything but "1" must read as off');
    repo.setPref(PREF_TAB_BAR, '1');
    assert.equal(tabBarOn(repo), true, 'it cannot be turned on, so it cannot be compared');
  });

  test('there is no way to switch it on from inside the app', () => {
    /*
     * Deliberately not a Settings control. Adding one would ship the choice to
     * every user as a half-answered question, which is the opposite of what the
     * owner asked for. The screenshots were taken by writing the preference
     * into a copy of the seed database.
     */
    const settings = fs.readFileSync(path.join(HERE, '..', 'app', 'settings.tsx'), 'utf8');
    assert.doesNotMatch(settings, /PREF_TAB_BAR|tabBar/,
      'the experiment has grown a Settings control, so it is now shipped');
  });

  test('the variant removes the row it replaces', () => {
    /*
     * The honest version of the comparison. Keeping the top links AND adding a
     * bar would make the bar look like pure cost; the bar buys that row back,
     * and the owner asked what came off the screen to pay for it.
     */
    assert.match(SCREEN, /\{!tabBar && \(\s*<View style=\{s\.topBar\}>/,
      'the top link row survives alongside the bar, which is not either design');
  });

  test('the bar is a real bar, not a mock', () => {
    // 56px keeps a 44pt target with a label under the glyph. Measuring the
    // current screen against a fake would answer nothing.
    assert.ok(TAB_BAR_HEIGHT >= 56, `${TAB_BAR_HEIGHT}px is not a tab bar, it is a row of icons`);
    const style = region(SCREEN, '  tabBar: {', '  tabItem:');
    assert.match(style, /height: TAB_BAR_HEIGHT/);
    assert.match(style, /borderTopWidth: 1/, 'nothing separates the bar from the content above it');
  });

  test('and it says which destination you are on', () => {
    // The thing a tab bar gives that a link row cannot. Without it this is a
    // row of links that happens to be at the bottom.
    assert.match(SCREEN, /id === 'now' && s\.tabGlyphOn/);
    assert.match(SCREEN, /tabGlyphOn: \{ color: VOLT \}/);
  });
});

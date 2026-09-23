import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = readFileSync(path.join(HERE, '..', 'src', 'ui', 'NowScreen.tsx'), 'utf8');

/*
 * R686. At 375x812 THIS WORKOUT is a one-line window, and R684 made it show a
 * lift's last line. But after three sets the chips wrapped onto a line of their
 * own and the last line was UNDO and + with no set beside them (R685's blind
 * re-score), and after four Chrome's scroll anchoring moved the list up past
 * them. Nothing renders React Native here, so these pin the structure; the live
 * check is tools/playtests/latest-set-sweep.mjs, which sweeps 1 to 7 sets.
 */
describe('the set just logged keeps its UNDO and + beside it (R686)', () => {
  test('the latest set and its two buttons are one slot the list cannot split', () => {
    assert.match(SCREEN, /<View key=\{set\.id\} style=\{i === lift\.sets\.length - 1 \? s\.lastSetGroup : undefined\}>/,
      'each set is no longer its own keyed slot, or the last one is not the group');
    assert.match(SCREEN, /\{i === lift\.sets\.length - 1 && \(<>[\s\S]{0,1200}T\('undo'\)[\s\S]{0,1600}s\.addSetText\}>\+<\/Text>/,
      'UNDO and + are not inside the latest set\'s slot');
    const group = SCREEN.match(/\n  lastSetGroup: \{([^}]*)\}/)?.[1] ?? '';
    assert.match(group, /flexDirection: 'row'/);
    assert.doesNotMatch(group, /flexWrap/, 'the group itself wraps, so the buttons can leave the set again');
  });

  test('a chip already on screen is not remounted when the next set arrives', () => {
    // The slot carries the key, so the chip inside keeps its Arrive and does
    // not replay its entrance as the buttons move on.
    assert.match(SCREEN, /<View key=\{set\.id\}[^>]*>\s*<Arrive>/);
    assert.doesNotMatch(SCREEN, /<Arrive key=\{set\.id\}>/, 'the key moved back onto Arrive');
  });

  test('the list decides where it sits, not the browser', () => {
    assert.match(SCREEN, /setProperty\('overflow-anchor', 'none'\)/, 'scroll anchoring can move the list again');
    assert.match(SCREEN, /const scrollTop = typeof node\?\.scrollTop === 'number' \? node\.scrollTop : todayMetrics\.current\.scrollTop;/,
      'the reveal reads a position a frame out of date');
  });
});

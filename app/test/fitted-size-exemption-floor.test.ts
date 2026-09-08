import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');

/*
 * R570, following R569's own stated gap: "the population is currently just
 * NowScreen.tsx -- goals.tsx and recap.tsx carry the other 31 exemptions from
 * the same fix pattern and are worth the same structural check".
 *
 * They are NOT worth the same check, and finding that out is this round's
 * actual content. R569's scan finds `fontSize: L.<name>` -- a size computed
 * inline from layoutFor -- and requires the exemption nearby. Neither
 * goals.tsx nor recap.tsx has ANY such expression: both files zero, both
 * files still carrying 31 `allowFontScaling={false}` exemptions between them.
 * They opt out through a NAMED STYLESHEET STYLE (`s.targetValue`, `s.stepText`
 * ...) rather than an inline computed size, so R569's pattern would have
 * passed on these two files by finding NOTHING TO CHECK -- exactly the
 * fail-open shape trap 16 warns about, extended to a structural scan rather
 * than a regex matcher. Widening the FILES list without widening the pattern
 * to match would have been a gate that looks broader and checks nothing new.
 *
 * So this is a narrower, honest claim for these two files: not "every fitted
 * element opts out" (unprovable here without knowing which styles are
 * fitted), but "the 31 exemptions already measured and fixed, round by round,
 * do not silently drop below their current count". A floor, not a scan --
 * true to what was actually verified rather than what would be nice to claim.
 */
describe('goals.tsx and recap.tsx keep their measured font-scale exemptions (R570)', () => {
  test('R569\'s inline-fitted-size pattern finds nothing in either file', () => {
    // The negative result that makes the floor-only approach honest rather
    // than lazy. If this ever finds a match, these files have grown the same
    // inline pattern NowScreen.tsx has, and R569's real scan belongs here too.
    for (const file of ['app/goals.tsx', 'app/recap.tsx']) {
      const src = fs.readFileSync(path.join(APP, file), 'utf8');
      const matches = src.match(/fontSize:\s*L\.\w+/g) ?? [];
      assert.equal(matches.length, 0,
        `${file} now has an inline layoutFor fontSize -- move it into R569's scan, ` +
        'not this floor check');
    }
  });

  test('the exemption count in each file has not dropped', () => {
    const FLOORS: Record<string, number> = { 'app/goals.tsx': 8, 'app/recap.tsx': 23 };
    for (const [file, floor] of Object.entries(FLOORS)) {
      const src = fs.readFileSync(path.join(APP, file), 'utf8');
      const count = (src.match(/allowFontScaling=\{false\}/g) ?? []).length;
      assert.ok(count >= floor,
        `${file} has ${count} allowFontScaling exemptions, was ${floor} -- something that ` +
        'used to opt out of Dynamic Type no longer does');
    }
  });

  test('the round-tagged exemptions still carry their evidence', () => {
    // A handful of these are tied to a specific measured overflow (R339,
    // R341, R347). Losing the comment does not break the app, but it does
    // turn a measured fix back into an unexplained prop the next edit could
    // remove without knowing what it was protecting.
    for (const file of ['app/goals.tsx', 'app/recap.tsx']) {
      const src = fs.readFileSync(path.join(APP, file), 'utf8');
      const tagged = (src.match(/R3(39|41|47)/g) ?? []).length;
      assert.ok(tagged > 0, `${file} lost every reference to the rounds that measured its overflow`);
    }
  });
});

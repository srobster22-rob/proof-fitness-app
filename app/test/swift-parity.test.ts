import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const require_ = createRequire(import.meta.url);
const R = require_(path.join(ROOT, 'spike', 'recap.js'));
const js = readFileSync(path.join(ROOT, 'spike', 'recap.js'), 'utf8');
const swift = readFileSync(path.join(ROOT, 'spike', 'ios-module', 'RecapRenderer.swift'), 'utf8');

/*
 * §12: "spike/recap.js is the design source of truth ... then ported to Swift.
 * **Keep the two in sync deliberately.**" Nothing did.
 *
 * The Swift port is uncompiled and needs a Mac (§12 says so), so this does not
 * try to fix it — writing Swift nobody here can build is worse than leaving it.
 * What it does is make the drift VISIBLE and bounded: the geometry both
 * renderers must agree on is asserted outright, and everything already known to
 * have diverged is listed with what it is, so a NEW divergence stands out
 * instead of joining an undifferentiated pile.
 *
 * The same shape as `orphan-scan`'s acknowledged list, and for the same reason:
 * a report that always looks identical is a report nobody reads.
 */
/*
 * R528. `KNOWN_DRIFT` is the list; HANDOFF.md and other comments quote its
 * SIZE as a sentence — "the Swift port is five changes behind".
 *
 * A number quoted in prose cannot notice when the list it describes changes.
 * It already had not: R476 extended the list and `spark-is-shared.test.ts`
 * still said four, so two files in this repo disagreed about the same count
 * and both read as authoritative. Nobody was going to catch that by reading,
 * because each is right on its own page.
 */
describe('the divergence count in prose matches the list (R528)', () => {
  const HANDOFF = readFileSync(path.join(HERE, '..', '..', 'HANDOFF.md'), 'utf8');
  const WORDS: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10
  };

  test('HANDOFF still states a count, in a form this can read', () => {
    // Guard on the instrument: if the sentence is rewritten, this test must
    // fail loudly rather than quietly stop checking anything.
    assert.match(HANDOFF, /Swift port is (\w+) changes behind/,
      'HANDOFF no longer states how far behind the Swift port is, so nothing ' +
      'pins the number this list defines');
  });

  test('and the number it states is the length of KNOWN_DRIFT', () => {
    const stated = /Swift port is (\w+) changes behind/.exec(HANDOFF)![1];
    const n = WORDS[stated.toLowerCase()] ?? Number(stated);
    assert.ok(Number.isFinite(n), `cannot read "${stated}" as a number`);
    assert.equal(n, KNOWN_DRIFT.length,
      `HANDOFF says the Swift port is ${stated} changes behind and KNOWN_DRIFT ` +
      `has ${KNOWN_DRIFT.length} entries — one of them moved without the other`);
  });
});

describe('the Swift port and the JS source of truth agree on geometry', () => {
  const num = (src: string, re: RegExp, what: string) => {
    const m = src.match(re);
    assert.ok(m, `could not find ${what}`);
    return Number(m![1]);
  };

  test('the canvas is the same size in both', () => {
    /*
     * The renderer takes W/H from its caller — correctly, since the exporter
     * owns the video size — so the number to compare against lives in
     * `RecapExporter.swift`, not here. Asserting a literal in the renderer was
     * this test's first form and it was wrong about the design.
     */
    assert.equal(R.W, 1080);
    assert.equal(R.H, 1920);
    assert.match(swift, /let W: CGFloat$/m,
      'the renderer stopped taking its size from the caller');
    const exporter = readFileSync(
      path.join(ROOT, 'spike', 'ios-module', 'RecapExporter.swift'), 'utf8');
    assert.equal(R.W, num(exporter, /static let width = (\d+)/, 'exporter width'));
    assert.equal(R.H, num(exporter, /static let height = (\d+)/, 'exporter height'));
  });

  test('the safe box matches, which is what keeps text out of the caption UI', () => {
    // A divergence here is invisible until a real Story crops a real card.
    assert.equal(R.SAFE.top, num(swift, /safeTop: CGFloat = (\d+)/, 'safeTop'));
    assert.equal(R.SAFE.left, num(swift, /margin: CGFloat = (\d+)/, 'margin'));
    assert.equal(R.H - R.SAFE.bottom, num(swift, /H - (\d+)/, 'safeBottom offset'));
    assert.equal(R.W - 200, R.W - num(swift, /rail: CGFloat \{ W - (\d+)/, 'rail'));
  });
});

/*
 * Known divergences, each one a thing the Swift port would render differently
 * from the card this repo tests. Listed so the next person with a Mac has a
 * precise worklist rather than "check if it still matches".
 */
const KNOWN_DRIFT: Array<[string, RegExp, string]> = [
  ['localised labels (R221)', /LABELS/,
   'recap.js selects its chrome from a per-language table; the Swift file has ' +
   'the English strings inline, so a Spanish card would render TOTAL VOLUME / ' +
   'SETS / TIME / STREAK'],
  ['the streak guard (R150/R221)', /streak >= 2|streak > 1/,
   'recap.js only draws the streak cell at 2+ weeks — a one-week streak is not ' +
   'a streak, and the wire format DELETES the field below that, which is how ' +
   'the JS renderer once printed "undefined WK". Swift draws it unconditionally'],
  ['the weekly card (R228)', /weekly|kind/,
   'recap.js grows a §10 weekly variant: gain as the hero, an empty stat row, ' +
   'one lift. Swift has no `kind` at all'],
  ['the streak-record accent (R271)', /streakRecord/,
   'recap.js draws the streak cell in volt when this session\'s run just beat ' +
   'every earlier one (`longestStreakBefore` in session.ts). Swift has no such ' +
   'field and would draw every streak the same, unaccented colour'],
  ['the claim slab top-row budget (R476)', /fitTracked|trackedWidth/,
   'recap.js measures the claim label and its right-hand qualifier against each ' +
   'other and trims the qualifier first — without it the two are drawn towards ' +
   'each other from opposite edges of the slab and overprint, which is exactly ' +
   'what Spanish did ("NUEVO RECORD PERSOÑOAMEJOR HASTA AHORA") until R476. ' +
   'Swift draws both unmeasured, so it carries the original bug']
];

describe('the Swift port is behind, and by exactly this much', () => {
  for (const [what, present, why] of KNOWN_DRIFT) {
    test(`still missing: ${what}`, () => {
      /*
       * Asserted as STILL ABSENT on purpose. When somebody ports one of these,
       * this test fails and tells them to strike it off the list — which is the
       * only way a "known issues" list stays true rather than rotting.
       */
      assert.equal(present.test(swift), false,
        `${what} now appears in the Swift port — remove it from KNOWN_DRIFT (${why})`);
    });
  }

  test('and the JS side really does have each of them', () => {
    // Otherwise this file would be recording drift from a feature that was
    // removed, which is the same rot pointing the other way.
    assert.match(js, /var LABELS = \{/);
    assert.match(js, /D\.streak >= 2/);
    assert.match(js, /kind === 'weekly'/);
    assert.match(js, /D\.streakRecord/);
    assert.match(js, /function fitTracked/);
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const require_ = createRequire(import.meta.url);

const RecapRender = require_(path.join(ROOT, 'spike', 'recap.js'));
const { createCanvas, GlobalFonts } = require_('@napi-rs/canvas');
GlobalFonts.loadSystemFonts();

const LIFT = (n: number): Array<[string, string, boolean]> =>
  Array.from({ length: n }, (_, i) => [`Movement Number ${i + 1}`, `${100 + i} × 8`, i === 0]);

function card(lifts: number) {
  const data = {
    title: 'WORKOUT', date: 'WED 29 JUL', volume: 5960, sets: lifts,
    duration: '65 MIN', streak: 7, unit: 'lb', watermark: 'PROOF',
    pr: { lift: 'Bench Press', weight: 205, reps: 5, prev: 200, gain: 5 },
    lifts: LIFT(lifts)
  };
  const c = createCanvas(RecapRender.W, RecapRender.H);
  RecapRender.render(c.getContext('2d'), RecapRender.DURATION, { data });
  return c;
}

/** The brightest pixel on each row — text is near-white or volt, the ground is #08090A. */
function brightestBelow(c: any, y0: number): { y: number; lum: number } {
  const ctx = c.getContext('2d');
  const { data } = ctx.getImageData(0, y0, c.width, c.height - y0);
  let best = { y: -1, lum: 0 };
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    if (lum > best.lum) best = { y: y0 + Math.floor(i / 4 / c.width), lum };
  }
  return best;
}

/**
 * The shared card is the artifact that actually leaves the app, and §5 judges
 * the product on it.
 *
 * The lift list was `1140 + j * 82` with no bound while the watermark is drawn
 * at a fixed y. Rendered from a real eight-lift session the list reached y1714:
 * through the mark, which came out overprinted on "Lateral Raise" and
 * illegible, and 154px past the safe box — where a Story or Reel covers it with
 * the host app's caption UI. Eight lifts is an ordinary session.
 */
describe('the shared card stays inside its safe box (§5)', () => {
  const FLOOR = RecapRender.SAFE.bottom;

  for (const n of [1, 3, 5, 8, 12, 20]) {
    test(`${n} lifts paint nothing below the safe box`, () => {
      // A little below the watermark's baseline, so its own glyphs do not count.
      const found = brightestBelow(card(n), FLOOR + 24);
      assert.ok(found.lum < 60,
        `something readable is painted at y${found.y} (luminance ${Math.round(found.lum)}), ` +
        `below the safe floor of ${FLOOR} — a Story covers it with caption UI`);
    });
  }

  test('a long session truncates rather than overflowing', () => {
    const ctx = card(20).getContext('2d');
    /*
     * The "+N more" line is the only MUTED text in the list band — the lift rows
     * are near-white or volt. Matched on luminance rather than on the #7C8792
     * token, because it is drawn at 0.75 alpha over a near-black ground and
     * lands about 28 points darker than the token itself, which a tight
     * colour match misses.
     */
    const band = ctx.getImageData(0, 1380, RecapRender.W, 120).data;
    let muted = 0;
    for (let i = 0; i < band.length; i += 4) {
      const lum = 0.2126 * band[i] + 0.7152 * band[i + 1] + 0.0722 * band[i + 2];
      if (lum > 45 && lum < 130) muted++;
    }
    assert.ok(muted > 100, `no "+N more" line (${muted} muted pixels) — the card dropped lifts silently`);
  });

  test('the mark still lands, and inside the box', () => {
    const c = card(8);
    const ctx = c.getContext('2d');
    // Volt pixels in the watermark's row band.
    const band = ctx.getImageData(0, FLOOR - 40, 400, 48).data;
    let volt = 0;
    for (let i = 0; i < band.length; i += 4) {
      if (band[i] > 150 && band[i + 1] > 220 && band[i + 2] < 90) volt++;
    }
    assert.ok(volt > 200, 'the watermark is missing or has been overprinted');
  });
});

/*
 * `link/build.cjs` copies spike/recap.js into link/dist. The copy was stale, so
 * the deployed page was rendering with an older version of the renderer than
 * the one under test — which is how the missing `gain` went unnoticed.
 *
 * This covered `recap.js` alone, and was demonstrated to be a real hole:
 * appending a line to `link/dist/share-url.js` left all 1,257 tests passing.
 * That is the WORSE of the two to leave unguarded — a stale renderer still
 * decodes correctly, while a stale DECODER silently drops fields it has never
 * heard of, and `share-url.js`'s own comment is explicit that the failure is
 * invisible: "the link does not error, it renders an empty card."
 *
 * So every file the build copies is checked, derived from `build.cjs` itself
 * rather than listed again here — a second hardcoded list is one more thing to
 * forget, which is the entire failure mode this guards.
 */
describe('the deployed page is the one under test', () => {
  /** The (source, dist) pairs build.cjs actually copies. */
  const copied = (): Array<[string, string]> => {
    const build = fs.readFileSync(path.join(ROOT, 'link', 'build.cjs'), 'utf8');
    const rows = [...build.matchAll(/\[path\.join\(([^\]]+?)\)\s*,\s*path\.join\(([^\]]+?)\)\]/g)];
    assert.ok(rows.length >= 4, 'could not read the copy list out of build.cjs — has it been rewritten?');
    const resolve = (expr: string, distRoot: string) =>
      path.join(...expr.split(',').map(s => s.trim()).map(s =>
        s === 'HERE' ? path.join(ROOT, 'link')
        : s === 'DIST' ? distRoot
        : s === 'WELL_KNOWN' ? path.join(distRoot, '.well-known')
        : s.replace(/^['"]|['"]$/g, '')));
    const DIST = path.join(ROOT, 'link', 'dist');
    return rows.map(m => [resolve(m[1], DIST), resolve(m[2], DIST)] as [string, string]);
  };

  for (const [src, dist] of copied()) {
    const name = path.basename(dist);
    test(`link/dist/${name} matches its source`, () => {
      assert.ok(fs.existsSync(dist), `${dist} is missing — run \`node link/build.cjs\``);
      assert.deepEqual(fs.readFileSync(dist), fs.readFileSync(src),
        `link/dist/${name} is stale — run \`node link/build.cjs\`; the deployed page ` +
        'uses whatever is in dist, not the file this suite exercises');
    });
  }
});

/*
 * The claim slot sits above the lift list. It used to run on its animation
 * segment alone and read `D.pr.weight` unguarded — and the spike's demo data
 * always has a PR, so nothing ever exercised the other case. §8 forbids a PR in
 * an exercise's first three sessions, so EVERY first-ever workout has none, and
 * most ordinary sessions have none either: rendering one threw and the shared
 * link came up blank, for exactly the user most likely to send one.
 */
describe('the card renders without a PR (§8)', () => {
  const base = {
    title: 'WORKOUT', date: 'WED 29 JUL', volume: 1360, sets: 3,
    duration: '45 MIN', unit: 'lb', watermark: 'PROOF',
    lifts: [['Bench Press', '95 x 8', false]] as Array<[string, string, boolean]>
  };

  const draw = (data: any) => {
    const c = createCanvas(RecapRender.W, RecapRender.H);
    RecapRender.render(c.getContext('2d'), RecapRender.DURATION, { data });
    return c;
  };

  /** Volt pixels inside the claim band at y850..y1026. */
  const voltInClaim = (c: any) => {
    const d = c.getContext('2d').getImageData(0, 850, RecapRender.W, 176).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 150 && d[i + 1] > 220 && d[i + 2] < 90) n++;
    }
    return n;
  };

  test('a session with no PR does not throw', () => {
    assert.doesNotThrow(() => draw({ ...base }));
  });

  test('a first session claims a baseline instead', () => {
    const c = draw({ ...base, firstSession: true, best: { lift: 'Bench Press', weight: 95, reps: 8 } });
    assert.ok(voltInClaim(c) > 200, 'no SESSION ONE label in the claim band');
  });

  test('and it is outlined, not the filled slab a record gets', () => {
    const first = draw({ ...base, firstSession: true, best: { lift: 'Bench Press', weight: 95, reps: 8 } });
    const record = draw({ ...base, pr: { lift: 'Bench Press', weight: 205, reps: 5, prev: 200, gain: 5 } });
    assert.ok(voltInClaim(record) > voltInClaim(first) * 5,
      'the volt fill is reserved for a beaten record; a starting line is outlined');
  });

  test('with no PR and no baseline, a standing goal carries the slot', () => {
    const c = draw({ ...base, goalLine: '20 lb from a 225 bench press' });
    assert.ok(voltInClaim(c) > 50, 'the goal line did not reach the card');
    assert.ok(voltInClaim(c) < 2000, 'a goal must not be dressed as a record');
  });

  test('with nothing true to say, the slot is empty rather than invented', () => {
    // §5 - an absent line beats an invented one.
    assert.ok(voltInClaim(draw({ ...base })) < 50);
  });

  /*
   * Beat your own best while §8 is still withholding the word "record". The
   * in-app card and the share message got this in R183-R184; the shared card
   * renders from the URL through this file's own copy of the logic, so it
   * needed the branch too or the recipient saw an empty slot the sender saw
   * filled.
   */
  test('a best-yet session fills the claim slot on the shared card', () => {
    const c = draw({ ...base, bestYet: { prev: 90 },
                     best: { lift: 'Bench Press', weight: 135, reps: 8 } });
    assert.ok(voltInClaim(c) > 200, 'BEST YET never reached the claim band');
  });

  test('and it is outlined too — no record was broken', () => {
    const yet = draw({ ...base, bestYet: { prev: 90 },
                       best: { lift: 'Bench Press', weight: 135, reps: 8 } });
    const record = draw({ ...base, pr: { lift: 'Bench Press', weight: 205, reps: 5, prev: 200, gain: 5 } });
    assert.ok(voltInClaim(record) > voltInClaim(yet) * 5,
      'the volt fill is reserved for a beaten record');
  });

  /*
   * R435: a positive `gain` is not the same fact as `heaviest`. `gain` only
   * says this beat the same rep count's own previous best — 230x5 over 225x5
   * is a genuine +5 — but with a 275x3 already on the books it is not the
   * heaviest thing this lifter has ever moved. The shared TEXT already
   * downgraded this exact case to "best set yet" (session.ts/recap-model.ts);
   * this file draws the shareable IMAGE from a separate copy of the claim
   * logic and was still burning '+5 LB' into the picture for it.
   */
  test('a real gain that is not the heaviest ever still says BEST YET, not a number', () => {
    const notHeaviest = draw({ ...base,
      pr: { lift: 'Bench Press', weight: 230, reps: 5, prev: 225, gain: 5, heaviest: false } });
    const [text] = drawnText({ ...base,
      pr: { lift: 'Bench Press', weight: 230, reps: 5, prev: 225, gain: 5, heaviest: false } });
    assert.ok(text.includes('BEST YET'), 'a non-heaviest PR must not claim a bare "+5" as if it were a record');
    assert.ok(!text.includes('+5'), 'the gain number must not appear when this was not actually the heaviest ever');
    assert.ok(voltInClaim(notHeaviest) > 200, 'BEST YET must still fill the claim slab — this IS a real PR');
  });

  test('a genuinely heaviest-ever PR still shows its gain number', () => {
    const [text] = drawnText({ ...base,
      pr: { lift: 'Bench Press', weight: 230, reps: 5, prev: 225, gain: 5, heaviest: true } });
    assert.ok(text.includes('+5'), 'a real heaviest-ever gain must still show its number');
  });
});

/*
 * The hero number. `volumeKnown === false` means the session contains
 * bodyweight work with no reading behind it, so `volume` is the weight ADDED
 * — zero for a strict push-up. Counting a giant "0" up to the top of the card
 * tells a reader who was not there that the sender moved nothing.
 */
describe('the shared card does not draw a volume it does not have', () => {
  const base = {
    title: 'PUSH DAY', date: 'THU 27 AUG', volume: 0, sets: 1,
    duration: '12 MIN', unit: 'lb', watermark: 'PROOF',
    lifts: [['Push-up', 'BW x 12', false]] as Array<[string, string, boolean]>
  };
  const draw = (data: any) => {
    const c = createCanvas(RecapRender.W, RecapRender.H);
    RecapRender.render(c.getContext('2d'), RecapRender.DURATION, { data });
    return c;
  };
  /** Ink in the hero band, where the 230px volume number is drawn. */
  const heroInk = (c: any) => {
    const d = c.getContext('2d').getImageData(0, 430, RecapRender.W, 200).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] > 120) n++;
    }
    return n;
  };

  test('an ordinary session still draws its number', () => {
    assert.ok(heroInk(draw({ ...base, volume: 5960 })) > 3000,
      'the hero volume stopped rendering for everyone');
  });

  test('an unknown volume does not render as a giant zero', () => {
    const zero = heroInk(draw({ ...base }));
    const unknown = heroInk(draw({ ...base, volumeKnown: false }));
    assert.ok(unknown < zero,
      'the unknown case is drawing at least as much ink as the "0" it replaces');
  });

  test('it says why, rather than going blank', () => {
    // Something is still drawn — a hero that vanishes reads as a broken card.
    assert.ok(heroInk(draw({ ...base, volumeKnown: false })) > 200,
      'the slot went empty; the reader cannot tell a missing number from a bug');
  });

  test('an ordinary session is unaffected by the flag being absent', () => {
    assert.equal(heroInk(draw({ ...base, volume: 5960 })),
                 heroInk(draw({ ...base, volume: 5960, volumeKnown: true })),
      'an explicit true must render identically to the default');
  });

  /*
   * `streakWorthShowing` is >= 2 — §6 makes the streak read 1 the moment
   * anything is logged, so a first workout claiming "1 WK" is the app lying
   * for the user. Both the in-app card and the share message check it; the
   * WIRE FORMAT enforces it by deleting the field (`if (w.streak < 2) delete
   * o.k`), and the shared card then drew `D.streak + ' WK'` unconditionally
   * on the missing field — literally "undefined WK", to the one reader who
   * was not there.
   */
  /*
   * `pack` drops `lifts` entirely when the array is empty (`if (w.lifts &&
   * w.lifts.length)`), so a payload can legitimately arrive with the field
   * absent — and `fitList` dereferences `D.lifts.length` unconditionally,
   * before any of the guards further down. The card comes up BLANK rather
   * than throwing visibly, which is exactly how the missing `gain` and the
   * unguarded `D.pr.weight` both went unnoticed: the acquisition path fails
   * silently for the recipient and nobody on the sending side can see it.
   */
  /*
   * The claim slab occupies y850..1026 and the lift list began at a fixed
   * 1140 regardless, so a session with NO claim rendered a ~290px void
   * between the stat row and the lifts. That is the common case, not an edge:
   * §8 makes PRs deliberately rare, plenty of lifters set no goals, and it is
   * neither a first session nor a best-yet. Rendered and looked at, the card
   * read as something that had failed to finish drawing.
   *
   * Measured as ink in the band the void occupied. Nothing is invented to
   * fill it — the LIST moves up into the space and is centred in it.
   */
  const bandInk = (c: any, y0: number, h: number) => {
    const d = c.getContext('2d').getImageData(0, y0, RecapRender.W, h).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] > 90) n++;
    }
    return n;
  };

  test('a session with no claim does not leave a hole where the slab would be', () => {
    // Measured ABOVE the old fixed LIST_TOP of 1140, so the band is one the
    // broken layout left completely empty — sampling across 1140 would find
    // the first list row either way and pass regardless, which is exactly
    // what the first version of this test did.
    const plain = draw({ ...base, volume: 5960, streak: 6, lifts: LIFT(5) });
    assert.ok(bandInk(plain, 940, 180) > 800,
      'the band between the stats and the lifts is empty — the card reads as unfinished');
  });

  test('and a session WITH a claim is laid out exactly as before', () => {
    // `listOffset` is 0 whenever the slab is used, so the PR card must be
    // untouched by the reclaim — this is the regression the change risks.
    const withPr = draw({ ...base, volume: 5960, streak: 6, lifts: LIFT(5),
      pr: { lift: 'Bench Press', weight: 205, reps: 5, prev: 200, gain: 5 } });
    // The first list row sits at the original LIST_TOP of 1140.
    assert.ok(bandInk(withPr, 1140, 90) > 500, 'the lift list moved on a PR card');
    assert.ok(bandInk(withPr, 850, 176) > 1000, 'the claim slab stopped drawing');
  });

  test('a payload with no lift list does not blank the card', () => {
    assert.doesNotThrow(() => draw({ ...base, volume: 5960, lifts: undefined }),
      'the renderer threw on a field the wire format is entitled to omit');
  });

  test('a suppressed streak does not render as "undefined WK"', () => {
    const c = draw({ ...base, volume: 5960 });   // streak absent, as the wire format leaves it
    const ctx = c.getContext('2d');
    // The stat row's values are drawn at y772; sample the band around it.
    const d = ctx.getImageData(0, 740, RecapRender.W, 80).data;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] > 120) ink++;
    }
    const withStreak = (() => {
      const c2 = draw({ ...base, volume: 5960, streak: 7 });
      const e = c2.getContext('2d').getImageData(0, 740, RecapRender.W, 80).data;
      let n = 0;
      for (let i = 0; i < e.length; i += 4) {
        if (0.2126 * e[i] + 0.7152 * e[i + 1] + 0.0722 * e[i + 2] > 120) n++;
      }
      return n;
    })();
    assert.ok(ink < withStreak,
      'the suppressed case draws as much as a real streak — it is painting "undefined WK"');
  });
});

/*
 * The card takes exercise names the user typed, and nothing capped them.
 * Rendered with a real one - "Single-Arm Cable Lateral Raise (Left Side, Slow
 * Eccentric)", the kind of thing people genuinely write down - the name
 * overprinted the PR weight inside the slab, ran straight through the load
 * column in the lift list, and reached 1028px on a canvas whose safe box ends
 * at 996. Two overlapping strings and nothing readable.
 */
describe('a long lift name is trimmed, not printed over the numbers', () => {
  const LONG = 'Single-Arm Cable Lateral Raise (Left Side, Slow Eccentric)';

  const draw = (data: any) => {
    const c = createCanvas(RecapRender.W, RecapRender.H);
    RecapRender.render(c.getContext('2d'), RecapRender.DURATION, { data });
    return c;
  };

  /** The rightmost pixel with real ink on it. */
  const rightEdge = (c: any) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let maxX = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] > 90 && x > maxX) maxX = x;
      }
    }
    return maxX;
  };

  const withName = (name: string) => ({
    title: 'WORKOUT', date: 'WED 29 JUL', volume: 5960, sets: 8, duration: '65 MIN',
    streak: 7, unit: 'lb', watermark: 'PROOF',
    pr: { lift: name, weight: 205, reps: 5, prev: 200, gain: 5 },
    lifts: [[name, '205 x 5', true], ['Bench Press', '115 x 5', false]]
  });

  test('nothing reaches past the safe box', () => {
    assert.ok(rightEdge(draw(withName(LONG))) <= RecapRender.SAFE.right,
      'a typed-in name pushed ink outside the box a Story leaves visible');
  });

  test('an ordinary name is unaffected', () => {
    const c = draw(withName('Bench Press'));
    assert.ok(rightEdge(c) <= RecapRender.SAFE.right);
  });

  /*
   * R69 extracted `drawClaim` so the record and baseline slabs could not drift
   * in size or position, and then left the PR branch as its own copy - so they
   * drifted anyway, and the long-name fix landed on one and not the other. An
   * extracted helper only helps the callers that actually call it.
   */
  test('every slab goes through one painter', () => {
    const src = fs.readFileSync(path.join(ROOT, 'spike', 'recap.js'), 'utf8');
    /*
     * The definition, plus one call per claim slab. Three slabs now: the
     * record, SESSION ONE, and BEST YET (a session that beat its own best
     * while §8 is still withholding the word "record").
     *
     * If this number is one short after adding a slab, the new branch is
     * painting its own — which is the drift R69 extracted `drawClaim` to
     * prevent and then suffered anyway. Bumping the number is only the right
     * fix once the new branch actually calls the painter.
     */
    const CLAIM_SLABS = 3;
    const uses = (src.match(/drawClaim\(ctx, M, RAIL/g) || []).length;
    assert.equal(uses, CLAIM_SLABS + 1, 'a claim slab is not sharing the painter');
    assert.doesNotMatch(src, /fillText\(D\.pr\.lift/,
      'the PR branch is drawing its own name again, outside the painter that trims it');
  });
});

/*
 * Every string on this card arrives from a URL fragment, which means none of
 * them is known-good: the landing page renders whatever a link carries. A long
 * name was the first to turn up, and the same class then took the title and the
 * goal line to the full 1080px width, straight off the canvas.
 *
 * This sweeps the values rather than fixing them one at a time, so the next
 * string added to the card is caught by a test that already exists.
 */
describe('no value on the card can escape the safe box', () => {
  const base = {
    title: 'WORKOUT', date: 'WED 29 JUL', volume: 5960, sets: 8, duration: '65 MIN',
    streak: 7, unit: 'lb', watermark: 'PROOF',
    pr: { lift: 'Bench Press', weight: 205, reps: 5, prev: 200, gain: 5 },
    lifts: [['Bench Press', '205 x 5', true]] as Array<[string, string, boolean]>
  };

  const inkRight = (data: any) => {
    const c = createCanvas(RecapRender.W, RecapRender.H);
    RecapRender.render(c.getContext('2d'), RecapRender.DURATION, { data });
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let maxX = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] > 90 && x > maxX) maxX = x;
      }
    }
    return maxX;
  };

  const CASES: Array<[string, any]> = [
    ['an ordinary session', base],
    ['a seven-figure volume', { ...base, volume: 9999999 }],
    ['999 sets and a 999-week streak', { ...base, sets: 999, duration: '999 MIN', streak: 999 }],
    ['a four-figure PR', { ...base, pr: { lift: 'Deadlift', weight: 1005, reps: 12, prev: 1000, gain: 5 } }],
    ['half-kilo decimals', { ...base, unit: 'kg', volume: 12345.5,
      pr: { lift: 'Bench Press', weight: 102.5, reps: 5, prev: 100, gain: 2.5 } }],
    ['a long goal line', { ...base, pr: undefined,
      goalLine: 'Only 12 lb from a 405 conventional deadlift at five reps' }],
    ['a long title', { ...base, title: 'FRIDAY EVENING PUSH SESSION AT THE GYM' }],
    ['an absurd title', { ...base, title: 'A'.repeat(120) }],
    ['an absurd goal line', { ...base, pr: undefined, goalLine: 'x'.repeat(300) }],
    ['an absurd lift name', { ...base, lifts: [['B'.repeat(140), '205 x 5', true]] as any }]
  ];

  for (const [label, data] of CASES) {
    test(label, () => {
      assert.ok(inkRight(data) <= RecapRender.SAFE.right,
        `${label} pushed ink past the box a Story leaves visible`);
    });
  }
});

/**
 * The goal line on the artifact that leaves the app.
 *
 * The claim slab takes the best TRUE claim in order — a PR beats a first
 * session beats a standing goal — and that order is right. But a lifter who is
 * progressing sets PRs, so the goal branch never fired for them and their goals
 * never reached the shareable at all. §5 says goals earn their place by feeding
 * the output, and "only on the sessions where nothing else happened" is not
 * feeding it. It has its own row under the list now.
 */
describe('goals reach the shareable even when a PR is on it (§5)', () => {
  const FLOOR = RecapRender.SAFE.bottom;
  const GOAL = '42 lb from a 315 squat';

  function withGoal(lifts: number, extra: Record<string, unknown> = {}) {
    const data = {
      title: 'WORKOUT', date: 'WED 29 JUL', volume: 5960, sets: lifts,
      duration: '65 MIN', streak: 7, unit: 'lb', watermark: 'PROOF',
      pr: { lift: 'Bench Press', weight: 205, reps: 5, prev: 200, gain: 5 },
      lifts: LIFT(lifts), goalLine: GOAL, ...extra
    };
    const c = createCanvas(RecapRender.W, RecapRender.H);
    RecapRender.render(c.getContext('2d'), RecapRender.DURATION, { data });
    return c;
  }

  /** Ink in the band between the list and the watermark. */
  function inkAt(c: any, y0: number, y1: number): number {
    const { data } = c.getContext('2d').getImageData(0, y0, c.width, y1 - y0);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] > 90) lit++;
    }
    return lit;
  }

  test('a five-lift session carries both the PR and the goal', () => {
    const lit = inkAt(withGoal(5), FLOOR - 110, FLOOR - 50);
    assert.ok(lit > 200, `only ${lit} lit pixels in the goal row — the line is missing`);
  });

  /*
   * The trade that had to be got right. Reserving the row unconditionally cost
   * two rows on an ordinary five-lift session — the pitch has a 56px floor, so
   * the shortened band fell one row short and the list came out as three lifts
   * and "+2 more". The lifts are what the user actually did.
   */
  test('and it costs the list nothing', () => {
    const ctx = withGoal(5).getContext('2d');
    const plain = card(5).getContext('2d');
    const countRows = (c: any) => {
      // Row dividers are the only horizontal rules in the band; count the rows
      // by sampling the load column, which is bright text on every row.
      let rows = 0, wasLit = false;
      for (let y = 1100; y < FLOOR - 120; y++) {
        const { data } = c.getImageData(900, y, 60, 1);
        let lit = false;
        for (let i = 0; i < data.length; i += 4) {
          if (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] > 120) lit = true;
        }
        if (lit && !wasLit) rows++;
        wasLit = lit;
      }
      return rows;
    };
    assert.equal(countRows(ctx), countRows(plain),
      'the goal line took a lift off the card — that is the wrong way round');
  });

  test('nothing is drawn when there is no goal', () => {
    const lit = inkAt(card(5), FLOOR - 110, FLOOR - 50);
    assert.ok(lit < 60, `${lit} lit pixels where there is no goal line to draw`);
  });

  /*
   * On a heavy session the list needs the whole band, and it wins. §5 already
   * says an absent line beats an invented one; this is the same rule applied to
   * an absent line beating a truncated list.
   */
  test('a heavy session keeps its lifts and drops the goal line', () => {
    const lit = inkAt(withGoal(12), FLOOR - 110, FLOOR - 50);
    assert.ok(lit < 60, `${lit} lit pixels — the goal line pushed into a full list`);
  });

  test('the goal keeps the slab when there is no PR to put in it', () => {
    // The original branch, unchanged: with nothing else to claim, the goal is
    // the claim, and it must not ALSO print at the bottom.
    const c = createCanvas(RecapRender.W, RecapRender.H);
    RecapRender.render(c.getContext('2d'), RecapRender.DURATION, { data: {
      title: 'WORKOUT', date: 'WED 29 JUL', volume: 5960, sets: 5,
      duration: '65 MIN', streak: 7, unit: 'lb', watermark: 'PROOF',
      lifts: LIFT(5), goalLine: GOAL
    } });
    assert.ok(inkAt(c, 850, 990) > 200, 'the slab lost the goal line');
    assert.ok(inkAt(c, FLOOR - 110, FLOOR - 50) < 60, 'and it is printed twice');
  });

  test('nothing spills past the safe box with the extra row', () => {
    for (const n of [1, 5, 8, 12]) {
      const found = brightestBelow(withGoal(n), FLOOR + 24);
      assert.ok(found.lum < 60,
        `${n} lifts plus a goal line paint at y${found.y}, below the safe box`);
    }
  });
});

/**
 * R435-439: the bodyweight-milestone line reaches the image, verified by
 * RENDERING it — the peer's explicit correction after `heaviest`'s fix
 * (R435) and the `multiple` wire-format fix (R439) both landed on this same
 * file's layout code without ever drawing a pixel. A hand-tuned fixed-pixel
 * canvas with a documented history of overlap bugs (the watermark-overprint
 * incident this very file's header describes) is precisely the class of
 * claim source-reading cannot settle — "the milestone appears and nothing
 * overlaps" is a rendering fact, not a code-reading one.
 *
 * Shares the SAME reserved bottom row the goal/trend line already uses
 * (`BOTTOM_LINE` in recap.js) rather than a second row: the live app screen
 * has unlimited scroll and stacks both unconditionally, but the image has a
 * fixed budget, so `multiple` is a FALLBACK for that one slot — shown only
 * when the goal/trend slot would otherwise be empty — not an addition next
 * to it. That is a deliberate simplification, tested for directly below.
 */
describe('the bodyweight milestone reaches the shareable image (R435-439)', () => {
  const FLOOR = RecapRender.SAFE.bottom;
  const MULTIPLE = 'Squat 350 × 8 — 1.89× bodyweight';

  function withMultiple(lifts: number, extra: Record<string, unknown> = {}) {
    const data = {
      title: 'WORKOUT', date: 'WED 29 JUL', volume: 5960, sets: lifts,
      duration: '65 MIN', streak: 7, unit: 'lb', watermark: 'PROOF',
      pr: { lift: 'Bench Press', weight: 205, reps: 5, prev: 200, gain: 5 },
      lifts: LIFT(lifts), multiple: MULTIPLE, ...extra
    };
    const c = createCanvas(RecapRender.W, RecapRender.H);
    RecapRender.render(c.getContext('2d'), RecapRender.DURATION, { data });
    return c;
  }

  function inkAt(c: any, y0: number, y1: number): number {
    const { data } = c.getContext('2d').getImageData(0, y0, c.width, y1 - y0);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] > 90) lit++;
    }
    return lit;
  }

  test('a five-lift session with no goal carries the milestone in the reserved row', () => {
    const lit = inkAt(withMultiple(5), FLOOR - 110, FLOOR - 50);
    assert.ok(lit > 200, `only ${lit} lit pixels in the reserved row — the milestone is missing`);
  });

  test('nothing is drawn when there is no milestone', () => {
    const lit = inkAt(card(5), FLOOR - 110, FLOOR - 50);
    assert.ok(lit < 60, `${lit} lit pixels where there is no milestone to draw`);
  });

  test('a standing goal wins the row; the milestone does not print underneath it too', () => {
    const c = withMultiple(5, { goalLine: '42 lb from a 315 squat' });
    // Both are real ink in the same row — this only proves ONE line is there,
    // not which. The row-count check below proves it is not two overlapping.
    const lit = inkAt(c, FLOOR - 110, FLOOR - 50);
    assert.ok(lit > 200, 'the row should still hold the goal line');
    // A goal line is ~40 chars; this milestone is longer. If both painted into
    // the same 34px row they would overlap into a smear brighter and messier
    // than either alone — bound it against the goal-only ink count instead of
    // asserting an exact figure, which is what an overlap would actually do.
    const goalOnly = inkAt(withGoal5Only(), FLOOR - 110, FLOOR - 50);
    assert.ok(lit < goalOnly * 1.4,
      `${lit} lit pixels vs ${goalOnly} for the goal alone — looks like both lines painted into one row`);
  });

  function withGoal5Only() {
    const c = createCanvas(RecapRender.W, RecapRender.H);
    RecapRender.render(c.getContext('2d'), RecapRender.DURATION, { data: {
      title: 'WORKOUT', date: 'WED 29 JUL', volume: 5960, sets: 5,
      duration: '65 MIN', streak: 7, unit: 'lb', watermark: 'PROOF',
      pr: { lift: 'Bench Press', weight: 205, reps: 5, prev: 200, gain: 5 },
      lifts: LIFT(5), goalLine: '42 lb from a 315 squat'
    } });
    return c;
  }

  test('when the goal itself has the claim slab, the milestone still reaches the row below', () => {
    // No PR, no firstSession, no bestYet — the goal takes the SLAB, which per
    // `BOTTOM_LINE` means the reserved row is free for the milestone instead
    // of repeating the goal a second time.
    const c = createCanvas(RecapRender.W, RecapRender.H);
    RecapRender.render(c.getContext('2d'), RecapRender.DURATION, { data: {
      title: 'WORKOUT', date: 'WED 29 JUL', volume: 5960, sets: 5,
      duration: '65 MIN', streak: 7, unit: 'lb', watermark: 'PROOF',
      lifts: LIFT(5), goalLine: '42 lb from a 315 squat', multiple: MULTIPLE
    } });
    assert.ok(inkAt(c, 850, 990) > 200, 'the slab lost the goal line');
    assert.ok(inkAt(c, FLOOR - 110, FLOOR - 50) > 200,
      'the milestone should fill the row the goal vacated by moving into the slab');
  });

  test('and it costs the list nothing', () => {
    const ctx = withMultiple(5).getContext('2d');
    const plain = card(5).getContext('2d');
    const countRows = (c: any) => {
      let rows = 0, wasLit = false;
      for (let y = 1100; y < FLOOR - 120; y++) {
        const { data } = c.getImageData(900, y, 60, 1);
        let lit = false;
        for (let i = 0; i < data.length; i += 4) {
          if (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] > 120) lit = true;
        }
        if (lit && !wasLit) rows++;
        wasLit = lit;
      }
      return rows;
    };
    assert.equal(countRows(ctx), countRows(plain),
      'the milestone row took a lift off the card — that is the wrong way round');
  });

  test('a heavy session keeps its lifts and drops the milestone', () => {
    const lit = inkAt(withMultiple(12), FLOOR - 110, FLOOR - 50);
    assert.ok(lit < 60, `${lit} lit pixels — the milestone pushed into a full list`);
  });

  test('nothing spills past the safe box with the extra row', () => {
    for (const n of [1, 5, 8, 12]) {
      const found = brightestBelow(withMultiple(n), FLOOR + 24);
      assert.ok(found.lum < 60,
        `${n} lifts plus a milestone paint at y${found.y}, below the safe box`);
    }
  });

  test('an absurdly long milestone does not push ink past the right edge', () => {
    const inkRight = (data: any) => {
      const c = createCanvas(RecapRender.W, RecapRender.H);
      RecapRender.render(c.getContext('2d'), RecapRender.DURATION, { data });
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let maxX = 0;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          if (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] > 90 && x > maxX) maxX = x;
        }
      }
      return maxX;
    };
    const found = inkRight({
      title: 'WORKOUT', date: 'WED 29 JUL', volume: 5960, sets: 5,
      duration: '65 MIN', streak: 7, unit: 'lb', watermark: 'PROOF',
      pr: { lift: 'Bench Press', weight: 205, reps: 5, prev: 200, gain: 5 },
      lifts: LIFT(5), multiple: 'A'.repeat(20) + ' 999999 × 999 — 99.99× bodyweight'
    });
    assert.ok(found <= RecapRender.SAFE.right, 'an absurd milestone pushed ink past the safe box');
  });
});

/**
 * Record every string the renderer draws, while still drawing it.
 *
 * A Proxy over the real context rather than a stub: `recap.js` uses two dozen
 * Canvas2D calls and any hand-written fake would drift from it, which is the
 * failure this whole file exists to avoid. Text is measured and laid out for
 * real; the proxy only listens.
 */
function drawnText(data: Record<string, unknown>): string[] {
  const c = createCanvas(RecapRender.W, RecapRender.H);
  const ctx = c.getContext('2d') as unknown as
    { fillText: (t: unknown, ...r: unknown[]) => unknown };
  const said: string[] = [];
  const original = ctx.fillText.bind(ctx);
  // Patched in place rather than wrapped in a Proxy: `@napi-rs/canvas` hands
  // back a native object and refuses a proxy of it outright — "Failed to unwrap
  // exclusive reference of CanvasRenderingContext2D". Replacing the one method
  // keeps the object identity the binding needs.
  ctx.fillText = (text: unknown, ...rest: unknown[]) => {
    said.push(String(text));
    return original(text, ...rest);
  };
  RecapRender.render(ctx, RecapRender.DURATION, { data });
  // `tracked()` draws one glyph per call, so labels arrive letter by letter.
  return [said.join(''), ...said];
}

/*
 * The card speaks the language the workout was logged in.
 *
 * `buildRecap` already localises the values — title, date, duration — but every
 * label the renderer draws itself was an English literal. A Spanish lifter's
 * own recap screen read VOLUMEN TOTAL / SERIES / TIEMPO / RACHA and the card
 * they SENT read TOTAL VOLUME / SETS / TIME / STREAK: one claim, two surfaces,
 * disagreeing on the artifact §5 says the product is judged by. Nobody saw it
 * because everybody builds in English.
 */
describe('the shared card is drawn in the payload language', () => {
  const base = {
    title: 'DÍA DE TIRÓN', date: 'JUE 27 AGO', volume: 14_820, sets: 18,
    duration: '54 MIN', streak: 6, unit: 'lb', watermark: 'PROOF',
    lifts: [['Barbell Row', '185 × 8', true]] as Array<[string, string, boolean]>
  };

  test('English is still exactly what it was', () => {
    const [all] = drawnText({ ...base, pr: { lift: 'Barbell Row', weight: 185, reps: 8, prev: 175, gain: 10 } });
    assert.match(all, /TOTAL VOLUME/);
    assert.match(all, /SETS/);
    assert.match(all, /STREAK/);
    assert.match(all, /NEW PERSONAL RECORD/);
  });

  test('a Spanish session draws Spanish chrome, including the week unit', () => {
    const [all] = drawnText({ ...base, lang: 'es', pr: { lift: 'Barbell Row', weight: 185, reps: 8, prev: 175, gain: 10 } });
    assert.match(all, /VOLUMEN TOTAL/);
    assert.match(all, /SERIES/);
    assert.match(all, /TIEMPO/);
    assert.match(all, /RACHA/);
    assert.match(all, /NUEVO RÉCORD PERSONAL/);
    // "6 WK" on a Spanish card was the smallest and most obvious tell.
    assert.ok(all.includes('6 SEM'), 'the streak still reads in English weeks');
    assert.doesNotMatch(all, /TOTAL VOLUME|NEW PERSONAL RECORD/);
  });

  test('both baseline slabs translate too, not just the PR one', () => {
    const best = { lift: 'Bulgarian Split Squat', weight: 225, reps: 5 };
    const [first] = drawnText({ ...base, lang: 'es', firstSession: true, best });
    assert.match(first, /SESIÓN UNO/);
    assert.match(first, /LA MARCA A BATIR/);

    const [yet] = drawnText({ ...base, lang: 'es', best, bestYet: { prev: 215 } });
    assert.match(yet, /LO MEJOR HASTA AHORA/);
    assert.match(yet, /ANTES 215/);
  });

  test('an unknown language falls back to English rather than drawing nothing', () => {
    // A card built by a newer app must still render in an older renderer —
    // the wire format is forward-compatible and this is the half that has to
    // hold up its end.
    const [all] = drawnText({ ...base, lang: 'xx' });
    assert.match(all, /TOTAL VOLUME/);
    assert.match(all, /SETS/);
  });

  test('the spy sees real drawing, not an empty run', () => {
    // Same non-vacuity rule as the layout sweeps: every assertion above is a
    // match against one big string, and an empty string fails them loudly —
    // but `doesNotMatch` would pass on one, so pin that text was drawn at all.
    const [, ...calls] = drawnText(base);
    assert.ok(calls.length > 20, `only ${calls.length} fillText calls — the card barely drew`);
  });
});

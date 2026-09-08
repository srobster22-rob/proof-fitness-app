import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { region } from './helpers/source.ts';

/**
 * Layout invariants for the Recap. PROMPT.md §5, §15.
 *
 * Same crude approach as `now-layout.test.ts`, for the same reason: this has no
 * model, and the defect it pins was invisible to every other test in the suite.
 * These read the source. They cannot tell you the screen looks right — what
 * they can do is fail the moment someone reverts the decision that composed it.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, '..', 'app', 'recap.tsx'), 'utf8');

/** The body of one entry in the `StyleSheet.create({ ... })` object. */
function style(name: string): string {
  const m = SOURCE.match(new RegExp(`\\n  ${name}:\\s*\\{([^}]*)\\}`, 's'));
  assert.ok(m, `no style named "${name}" — it was renamed or removed`);
  return m![1];
}

describe('Recap — it composes at any length (§5, §15)', () => {
  /*
   * Measured on the running app: the actions row is pinned to the bottom of the
   * screen and the scroll content is top-aligned, so on a two-lift session
   * every pixel of slack collected in one place — the lift list ended at y 421
   * and SHARE sat at y 744, leaving 323px of nothing in the middle of the
   * screen §5 judges the whole product on.
   */
  test('the content container can grow, or nothing can absorb the slack', () => {
    assert.match(style('body'), /flexGrow:\s*1/,
      'without flexGrow the container is only as tall as its content, so there is ' +
      'no free space and the spacer collapses on exactly the screens that need it');
  });

  test('there is a spacer, and it grows', () => {
    assert.match(style('slack'), /flexGrow:\s*1/);
    assert.match(SOURCE, /<View style=\{s\.slack\} \/>/,
      'the style exists but nothing renders it');
  });

  /*
   * The trap this avoids. `justifyContent: 'center'` on a content container
   * that overflows pushes its top ABOVE the scroll origin, where no amount of
   * scrolling reaches it — the header would be permanently cut off on a short
   * phone. `flexGrow` distributes only positive free space, so when the session
   * is long enough to fill the screen the spacer is simply 0.
   */
  test('the content is never centred — an overflowing centre hides its own top', () => {
    assert.doesNotMatch(style('body'), /justifyContent:\s*'center'/,
      'a centred scroll container makes the top of a long recap unreachable');
  });

  test('a fixed height would defeat the point', () => {
    assert.doesNotMatch(style('slack'), /height:\s*\d/,
      'a fixed spacer adds dead space to a long recap instead of absorbing a short one\'s');
  });

  /*
   * The composition, not just the absence of a gap: what the workout came to
   * at the top — volume, stats, the PR slab, the goal — and the itemisation at
   * the bottom, meeting the button that sends it.
   */
  test('the spacer sits between the claim and the itemisation', () => {
    const spacer = SOURCE.indexOf('<View style={s.slack} />');
    // The narrative slot, whichever occupies it. R255 gave §8's second lead
    // the same row — `goalLine ?? trendLine`, never both — so the anchor is
    // the slot rather than one of its two tenants.
    const goal = SOURCE.indexOf('(payload.goalLine ?? payload.trendLine) &&');
    const lifts = SOURCE.indexOf('<View style={s.lifts}>');
    assert.ok(spacer > 0 && goal > 0 && lifts > 0, 'one of the three blocks moved');
    assert.ok(goal < spacer, 'the narrative line belongs with the summary above the slack');
    assert.ok(spacer < lifts, 'the lift list belongs below it, against the actions');
  });

  test('the PR slab stays with the summary, not below the gap', () => {
    const pr = SOURCE.indexOf('payload.pr &&');
    const spacer = SOURCE.indexOf('<View style={s.slack} />');
    assert.ok(pr > 0 && pr < spacer,
      'a PR is the most important thing on this screen — it does not get pushed to the bottom');
  });

  /*
   * The single spacer was only half the fix. Measured on the running app after
   * a five-set first session: the summary ended at y257, the lift list began at
   * y637 — 380px of nothing in one place, on the recap most likely to be shared
   * and the one screen §5 judges the product on. Sharing the slack turns the
   * same emptiness into margin rather than a hole.
   */
  test('the slack is shared between two spacers, not pooled in one', () => {
    assert.match(style('slackTop'), /flexGrow:\s*0?\.\d/,
      'the upper spacer must take a SMALLER share — an equal one just moves the hole');
    assert.match(SOURCE, /<View style=\{s\.slackTop\} \/>/, 'the style exists but nothing renders it');
    const top = SOURCE.indexOf('<View style={s.slackTop} />');
    const mid = SOURCE.indexOf('<View style={s.slack} />');
    assert.ok(top > 0 && top < mid, 'the smaller spacer belongs above the larger one');
    /*
     * The failure this exists for. Two ADJACENT spacers distribute nothing —
     * they split one gap in one place, which is what a single spacer already
     * did. Written that way first, and every other assertion here still passed.
     * Real content has to sit between them for the slack to land in two places.
     */
    const between = SOURCE.slice(top, mid);
    assert.match(between, /<Text|<View style=\{s\.(volumeRow|stats)\}/,
      'the two spacers are adjacent, so they share one gap instead of making two');
    assert.ok(between.length > 200,
      'nothing substantial sits between the spacers');
  });

  test('the actions row stays outside the scroll', () => {
    const scrollEnd = SOURCE.indexOf('</ScrollView>');
    const actions = SOURCE.indexOf('<View style={s.actions}>');
    assert.ok(scrollEnd > 0 && actions > scrollEnd,
      'SHARE must be pinned and predictable, not scroll away with the content');
  });
});

/*
 * A bare `router.back()` is a no-op when the screen IS the entry route — a web
 * reload, or any of the deep links app.json declares. Measured: arriving on
 * /progress and tapping DONE left the user stranded with no route to the
 * logging path. The console had been saying so: "GO_BACK was not handled by
 * any navigator."
 *
 * R387: the canGoBack()-then-replace() logic itself moved into one shared
 * `useGuardedLeave` (src/ui/guarded-push.ts) — a double-tap on DONE produced
 * a genuine "GO_BACK was not handled" error too (the same same-tick timing
 * gap as everywhere else this session), and five identical copies of the
 * fallback logic was five places that fix would have had to land separately.
 * This test now pins the shared helper once, plus that every screen actually
 * reaches it, rather than re-deriving the fallback logic per screen.
 */
describe('every screen can be left (§5)', () => {
  /*
   * Derived from the directory, not hand-maintained: a fixed array of screen
   * names is the exact failure mode this test exists to prevent — a sixth
   * screen added later with no DONE-guard gets silently skipped because
   * nobody remembered to add its name here. `index.tsx` is excluded for a
   * stated reason rather than just left off the list: it is the entry route
   * itself (§4), so it has nowhere to "leave" TO and legitimately carries no
   * leave button at all.
   */
  /*
   * Two exclusions, each with its own checked reason rather than just left
   * off a list: `_layout.tsx` is the Stack shell, not a navigable screen, so
   * "can it be left" does not apply to it at all. `+not-found.tsx` uses
   * expo-router's own `<Link href="/">` rather than `useGuardedLeave` — found
   * by this very scan when it was still a hand-picked array — and it was
   * checked live rather than assumed exempt: a real anchor's own navigation
   * (not a raw router.push/back() call) landed cleanly on a real same-tick
   * double-click, with no stuck state, and the page is reachable only from a
   * dead external link, never from in-app navigation.
   */
  const SCREENS = fs.readdirSync(path.join(HERE, '..', 'app'))
    .filter(f => f.endsWith('.tsx') && f !== 'index.tsx' && f !== '_layout.tsx' && f !== '+not-found.tsx');
  const shared = fs.readFileSync(path.join(HERE, '..', 'src', 'ui', 'guarded-push.ts'), 'utf8');

  test('the scan actually found the screens it means to cover', () => {
    assert.ok(SCREENS.length >= 5, 'the scan found nothing, so it proves nothing');
  });

  test('the shared helper checks canGoBack() before falling back', () => {
    assert.match(shared, /canGoBack\(\)/, 'nothing checks whether there is anywhere to go back to');
    assert.match(shared, /router\.replace\(/, 'and nothing sends them home when there is not');
  });

  for (const name of SCREENS) {
    const src = fs.readFileSync(path.join(HERE, '..', 'app', name), 'utf8');

    test(`${name} has no unguarded router.back()`, () => {
      assert.doesNotMatch(src, /onPress=\{\(\) => router\.back\(\)\}/,
        'a bare back() strands the user when this screen is the entry route');
    });

    test(`${name} leaves through the shared, guarded helper`, () => {
      assert.match(src, /useGuardedLeave\(/, 'not routed through the shared canGoBack()/replace() fallback');
    });
  }
});


/*
 * A first workout can never produce a PR — §8's "never cry wolf" means the app
 * does not get to call an opening set a record. That left the first recap with
 * no PR, no goal and nothing but a volume number, which is exactly the recap a
 * new user is most likely to share.
 */
describe('the first recap has something true to say (§8, §5)', () => {
  test('the card claims a baseline, not a record', () => {
    const start = SOURCE.indexOf('payload.firstSession');
    assert.ok(start > 0, 'nothing renders the first-session case');
    const block = SOURCE.slice(start, start + 700);
    assert.match(block, /!payload\.pr/, 'the baseline must yield to a real PR when there is one');
    assert.doesNotMatch(block, /PERSONAL RECORD|\bPR\b/,
      'a first session broke no record — saying so is the crying wolf §8 forbids');
  });

  test('it is not dressed as the PR slab', () => {
    assert.doesNotMatch(style('baseSlab'), /backgroundColor:\s*VOLT/,
      'the volt fill is reserved for a beaten record; a starting line is outlined');
    assert.match(style('prSlab'), /backgroundColor:\s*VOLT/, 'the real PR slab lost its fill');
  });

  test('it sits with the summary, above the slack', () => {
    const base = SOURCE.indexOf('payload.firstSession');
    const spacer = SOURCE.indexOf('<View style={s.slack} />');
    assert.ok(base < spacer, 'the claim belongs with the summary, not pushed to the bottom');
  });
});

/*
 * Capping the recap to a phone column turned a harmless style into a broken
 * screen. The share error was a third child of the actions ROW, in which SHARE
 * was the only child that grew — so the error's ~250px came out of SHARE's
 * width. At the old full-window width there was slack to spare; at 430 the row
 * had 354px for 320px of fixed children and the volt button collapsed to a
 * splinter with its black label spilling onto the black background. Measured
 * after the fix: SHARE is 296px wide with the error showing, unchanged from
 * without it.
 */
describe('the recap actions survive a share error (§5)', () => {
  test('the error is not a child of the button row', () => {
    const row = region(SOURCE, '<View style={s.actionRow}>', '</View>');
    assert.doesNotMatch(row, /shareError/,
      'the error is back inside the flex row, where it eats the width of the only child that grows');
  });

  test('the row holds exactly the two buttons', () => {
    /*
     * To the row's own closing tag, not to `{shareError}`.
     *
     * The old end anchor swept up everything between the row and the error
     * line, so a control added BELOW the row — a sibling, in its own block —
     * counted as a third child of it. The rule being defended is about what
     * shares SHARE's width, and that is decided by the row's boundaries.
     */
    const row = region(SOURCE, '<View style={s.actionRow}>', '</View>');
    assert.equal((row.match(/<Pressable/g) || []).length, 2,
      'a third growing-or-fixed child in this row comes straight out of SHARE');
  });

  test('the cap is on the block, the direction is on the row', () => {
    assert.match(style('actions'), /\.\.\.COLUMN/, 'the actions block lost its phone-column cap');
    assert.doesNotMatch(style('actions'), /flexDirection/,
      'capping a flex ROW is what caused this; the cap belongs on the block around it');
    assert.match(style('actionRow'), /flexDirection:\s*'row'/);
  });
});

describe('the frame benchmark reports drawing separately from PNG compression', () => {
  /*
   * §12's "overlay drawing costs ~4 ms/frame" is load-bearing — it is the reason
   * the recap is a real render and not a pre-baked template. The tool that
   * produces that number used to time `render()` and `encodeSync('png')` in one
   * region and print the sum as "avg / frame". Measured today that is 0.54 ms of
   * drawing and ~68 ms of zlib, so the headline read seventeen times over budget
   * while the thing being claimed was fine.
   *
   * The device pipeline writes frames to an AVAssetWriter and never encodes a
   * PNG. Merging the two again would not be a slower renderer, it would be a
   * broken instrument — the same failure this suite has caught nine times.
   */
  const SPIKE = path.join(HERE, '..', '..', 'spike');
  const bench = region(
    fs.readFileSync(path.join(SPIKE, 'render-frames.cjs'), 'utf8'),
    "if (process.argv.includes('--bench'))",
    'process.exit(0);'
  );

  test('the drawing is timed without the encode', () => {
    assert.match(bench, /sample\(s => Recap\.render\(ctx, s\)\)/,
      'nothing measures render() on its own any more');
  });

  test('the encode is reported as harness cost, not as frame cost', () => {
    assert.match(bench, /harness only/i,
      'the PNG cost is no longer labelled as something the device does not do');
    assert.doesNotMatch(bench, /raster incl\. PNG encode/,
      'the misleading combined headline is back');
  });

  test('SPIKE.md keeps the reason next to the number', () => {
    const doc = fs.readFileSync(path.join(SPIKE, 'SPIKE.md'), 'utf8');
    assert.match(doc, /AVAssetWriter/,
      'the note explaining why PNG time is excluded has been removed');
  });
});

/*
 * R313: reopening a session from Progress's history rewrites `ended_at` and
 * hands it to the Now screen as the CURRENTLY live workout — right for the
 * one you just finished, wrong for one from three weeks ago. The reopen
 * button has to be unreachable from a historical view, not just unlikely to
 * be tapped.
 */
describe('a historical recap cannot be reopened', () => {
  test('the reopen button is gated behind the live path, not shown unconditionally', () => {
    const guard = SOURCE.match(/\{recap && !viewingHistory && \(/);
    assert.ok(guard, 'the reopen button no longer checks viewingHistory — a stale session could go live again');
  });

  test('viewing history freezes "now" at the session\'s own end, not the real clock', () => {
    assert.match(SOURCE, /recapFor\(repo, sessionParam, s\.endedAt \?\? s\.startedAt\)/,
      'a historical recap must not be built against today\'s real Date.now()');
  });
});

/*
 * PROMPT.md §5's own cap: "≤ 4 core screens (Now/Progress/Goals/Recap) —
 * plus Settings and Measure/YOU... no SEVENTH screen by default." That line
 * had no gate at all — pure prose nobody would notice violating. `index.tsx`
 * IS the Now screen (§4: cold launch opens straight into it, never a home
 * screen), so the six real product screens are index/goals/progress/
 * recap/settings/measure. `_layout.tsx` (the Stack shell) and
 * `+not-found.tsx` (a dead-link fallback) are infrastructure, not a seventh
 * PRODUCT screen, and are named here rather than silently excluded.
 */
describe('PROMPT.md §5\'s screen cap has a real gate, not just a claim', () => {
  const files = fs.readdirSync(path.join(HERE, '..', 'app')).filter(f => f.endsWith('.tsx'));
  const INFRASTRUCTURE = new Set(['_layout.tsx', '+not-found.tsx']);
  const productScreens = files.filter(f => !INFRASTRUCTURE.has(f));

  test('exactly six product screens exist — a seventh needs a deliberate PROMPT.md update, not a silent add', () => {
    assert.deepEqual(
      productScreens.sort(),
      ['goals.tsx', 'index.tsx', 'measure.tsx', 'progress.tsx', 'recap.tsx', 'settings.tsx'],
      'a screen was added or removed — update PROMPT.md §5\'s own count in the same change'
    );
  });
});

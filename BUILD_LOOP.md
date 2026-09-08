# Build loop — drive the app, fix what breaks

Paste this to run one round. It assumes the app runs (`npm run web` → localhost:8099).

---

## Why this loop and not another

For 26 rounds the project was improved by reading and reasoning. That found real defects, but
the three worst bugs in the whole build were found in the first hour of actually *using* it —
a tap that could silently cost you a set, a sheet that would not close, and a screen showing a
set the user never performed. None were reachable by reading.

**So the unit of work is now a user journey, not a file.** Walk the app as a person, find where
it is confusing, ugly, slow or wrong, fix that, and pin it with a test.

## The four things this app is for

Judge every round against these, in this order. They come from the person who asked for it:

1. **Easy to use** — a set is logged in one tap and the app never asks a question it could answer
2. **Noob friendly** — someone who has never lifted is not lost, and is never made to feel stupid
3. **TikTok friendly** — what comes out is worth sending, and getting it out takes one tap
4. **Great to look at** — it holds up next to the apps it sits beside on a home screen

If a round improves none of these, it was the wrong round.

## One round

**1. Pick the journey.** Rotate; do not repeat until all have been walked:

| | Journey | Watch for |
|---|---|---|
| A | First ever launch → log 3 sets → finish | Is the next action ever unclear? Any blank, any jargon? |
| B | Returning user, second session | Are last time's numbers right there? Is anything re-asked? |
| C | Switch lift mid-session, add a custom one | Does the picker get in the way? |
| D | Set a goal, then train toward it | Does the goal show up where it matters? |
| E | Finish → recap → share | Is the output worth sending? How many taps? |
| F | Progress after several sessions | Honest? Legible? Is any number invented? |
| G | Mistakes — mis-tap, wrong weight, abandon mid-set | Can it be undone without thinking? |
| H | Empty and edge states — no history, one set, 200 sessions | Does anything read as broken? |

**2. Walk it.** Reload, then drive with real interaction. React Native Web's `Pressable`
listens for **pointer events** — a synthetic `click()` does nothing and looks exactly like a
broken button. Dispatch `pointerdown` + `pointerup` + `click`.

**⚠ `innerWidth` is not the screen.** When content overflows horizontally the window reports the
CONTENT width, so every "is this off screen?" check written as `rect.right > innerWidth` answers
no — including while the page is 135px too wide. Compare `documentElement.scrollWidth` against
`documentElement.clientWidth` instead; that pair cannot be fooled by the thing it is measuring.
A 3-digit weight had been overflowing a 375px screen for the whole project behind that mistake.

**⚠ Put a gap between `pointerdown` and `pointerup`.** Dispatched in the same tick they can be
swallowed, and the tap looks exactly like a control that does nothing — an UNDO button was
briefly "broken" for that reason alone. `await` ~50ms between them before believing a press
failed.

**⚠ A synthetic tap hits an element whether or not a human could see it.** The exercise picker
rendered one full viewport below the screen for thirty rounds — `translateY(812px)`, completely
invisible — and every round said "verified live", because dispatching pointer events at a node
works fine on a node nobody can see. Reading `innerText` has the same hole: the text is in the
DOM either way.

**⚠ A hidden pane also THROTTLES `setTimeout`, so every timing you take is wrong.**
Chrome clamps timers in a backgrounded page. Measured here with the pane hidden: `setTimeout(0)`
returned in 0ms, `setTimeout(60)` in **408ms**, `setTimeout(240)` in **992ms**. Any driver that
awaits a sleep between taps therefore reports the *throttle*, not the app — an "8x performance
regression" on the Progress screen turned out to be exactly this, and it reproduced consistently
three times in a row, which is what made it convincing.

The tell is that the number does not move with the workload: Progress took ~1700ms on 210 seeded
sessions **and ~1700ms on an empty database**. A cost that ignores its input is measuring your
instrument.

Time on **microtasks**, which are not throttled, and never wrap an awaited sleep in a measurement:

```js
const until = async (pred, cap = 4000) => {          // poll without setTimeout
  const t0 = performance.now();
  while (!pred() && performance.now() - t0 < cap) await Promise.resolve();
  return Math.round(performance.now() - t0);
};
fire(button);                                        // dispatch synchronously
const ms = await until(() => document.body.innerText.startsWith('PROGRESS'));
```

Same page, same data, remeasured this way: **46-62ms**. Check `document.hidden` before believing
any duration.

**⚠ A hidden preview pane pauses the frame loop, and that silently disables `onLayout`.**
react-native-web implements `onLayout` and `onContentSizeChange` with a **ResizeObserver**, and
ResizeObserver delivers on an animation frame. When the Browser pane is not displayed the page
stops compositing, no frames are produced, and **no layout callback ever fires** — so any
behaviour driven by measured layout reads as completely dead code, with the handlers correctly
attached and `viewport`/`content` stuck at 0. Animated `scrollTo` does not move either, for the
same reason.

Confirm it rather than debugging the app: observe any node with a ResizeObserver of your own and
see whether it fires within a few hundred ms. Zero means the pane, not your code.

```js
let fired = 0; const ro = new ResizeObserver(() => fired++);
ro.observe(document.body); await new Promise(r => setTimeout(r, 400)); ro.disconnect();
// fired === 0  ->  frames are paused; onLayout cannot work; ask for the pane
```

To test the wiring anyway, deliver what the observer would, with real geometry — this exercises
every line you wrote, and leaves only ResizeObserver itself unproven:

```js
node.__reactLayoutHandler({ nativeEvent: { layout: { x: 0, y, width, height } } });
```

So driving it is not looking at it. For anything that should be *on screen*, check geometry:

```js
const r = el.getBoundingClientRect();
const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
const onScreen = cy > 0 && cy < innerHeight;
const top = document.elementFromPoint(cx, cy);      // is anything covering it?
const tappable = top === el || el.contains(top) || top.contains(el);
```

Run it over every row that matters, not one. A screenshot is better still when the pane is
displayed — take one before believing a layout is fine.

**3. Write down what you actually saw**, before deciding anything. Distinguish three kinds:

- **Broken** — it does the wrong thing. Fix now.
- **Confusing** — it works and the user would hesitate. Fix now; this is what "noob friendly"
  means in practice.
- **Plain** — it works and reads as unfinished. Fix if cheap; note it if not.

**4. Fix one thing properly** rather than three things partly.

**⚠ "Properly" means EVERY surface that renders the claim — grep for it, do not guess.** The
same fact is drawn by several independent implementations, and fixing one is a fraction of a fix:

| Surface | Where | Fails as |
|---|---|---|
| the in-app card | `app/recap.tsx` | what the sender sees |
| the share message | `shareText` in `src/ui/recap-model.ts` | the text that reaches the chat |
| the shared link | `spike/recap.js`, fed by the wire format in **both** `app/src/domain/share-url.ts` *and* `link/share-url.js` | what the RECIPIENT sees — the one reader who was not there |
| Progress history | `recentSessions` in `src/ui/progress-model.ts` | the same session, contradicting the card two screens away |
| the live running total | `NowState.totalVolume` in `src/ui/now-model.ts` | wrong **during** the workout, under the sets they just did |

This is a property of the design, not bad luck, and it has now bitten four times: R183-R185 shipped
one claim across three rounds, R188-R189 did the same with a volume, `shareText`'s own comment
records an earlier instance ("Same defect the card had, one layer up, found by fixing the card"),
and R190 wrote this very table saying **three** surfaces — then R192 found the volume claim on a
fourth, in Progress's history list, printing "1 set · 0 lb" directly under a row reading "BW × 12".

So the table is a starting point, not the answer — it said three, then four, then five, each time
because someone stopped counting instead of grepping. **Grep for the field** (`volume`, `pr`,
`best`, `streak`…) across `app/`, `src/ui/`, `src/domain/` and `spike/`, and fix every hit in one
round: a surface found later is a round spent, and worse, a window where two screens disagree.

Grep the SHARED FUNCTION too, not just the field name. The fifth volume surface was found with
`grep -rn "sessionStats(" src/ app/` — four callers, and the fix had reached three. Consolidating
onto one function stops the surfaces disagreeing about the number; it does not stop them
disagreeing about a NEW field nobody remembered to read off it.

A field that rides the URL needs adding to both wire implementations — two codebases holding one
format, which is why `share-url.test.ts` encodes with one and decodes with the other. Then
`node link/build.cjs`, or `link/dist` ships stale.

**5. Pin it.** Every fix gets a test that fails without it. If the bug was only visible in the
UI, the test goes on the model behind it — that is what the model/screen split is for. The
shared card has a real canvas harness (`share-card.test.ts`): it renders offscreen and counts
ink, so "does this actually draw?" is answerable without a device.

**6. Verify.** `npm test` must pass, and the journey must be re-walked in the browser. A fix
that was not re-driven is not a fix — and per step 2, a screen that was not measured or
photographed was not looked at.

**7. Log one line** in `LOOP_LOG.md`: what was walked, what broke, what changed.

## Standing rules

- **`cd C:\Users\srobs\fitness-app\app` first.** The parent directory is a different Expo
  project; a drifted cwd once patched its files and bundled the wrong app.
- **Never `npm install <pkg>` bare** — it resolves SDK 57 against expo 54. Look the version up
  in `expo/bundledNativeModules.json`, install `--save-exact`, then `npm run check-deps`.
- **Do not add a screen by default.** §5's core four (Now/Progress/Goals/Recap) grew to six —
  Settings and Measure/YOU both shipped with the owner's explicit approval (R111, R140), and
  §9's settings-screen ban is superseded, not live. The cap's real meaning now: a new idea does
  not get a SEVENTH screen automatically — it goes at the bottom of a screen that already
  exists, and a genuine case for an eighth is a product decision, not a loop round's to make.
  (This exact line cited a dead ban for over a hundred rounds before R276 caught it — see
  HANDOFF's "How to work on this".)
- **Do not add a dependency** to solve a problem plain code solves. The sparklines are ten
  `View`s for this reason.
- **§17's gate still applies:** anything not in §5 must answer, in writing — does it add a tap
  to the logging path, does it serve first-run friction or shareable output, and what is being
  removed to make room.

## Look at the card before believing the tests

`npm run cards` writes `app/out/card-sheet.png` — every claim state across, and four
rows down: each language as it usually looks, then each language at the worst
realistic case. One command, one look.

**Look at the HARD rows first.** For its whole life this sheet drew only the tidy
case — three short lift names, a four-digit volume — so it rendered cards that
physically could not overprint, and R476's 69px collision on the Spanish PR slab
had to be found by eye on a sheet that was drawing it happily. The worst-case rows
take a typed 57-character movement name, a seven-figure volume and three-digit
sets and streak, all derived from the real library so a longer movement reaches
them automatically (R477).

It exists because the same thing happened four times. `npm run e2e` renders a session
**with a PR**, and §8 makes that the rarest card there is; every other state went undrawn, and
every state that went undrawn eventually turned out to be broken:

| Round | What only a PNG showed |
|---|---|
| R208 | an empty claim slot left a ~290px void above the fold |
| R215 | six of thirty-three real movement names truncated on the goal card |
| R221 | the renderer's own labels were English on a Spanish card |
| R222 | a change all 1,376 tests approved of, and the image rejected |

R222 is the one to remember: the arithmetic was right, the suite was green, the six safe-box
cases passed, and the card was worse. **A layout test can only fail on what somebody thought
to measure.** Render the sheet and look at it before and after anything that moves type.

## Seeing a screen when you cannot screenshot one

The Browser pane does not composite frames unless it is displayed, so
`computer{action:'screenshot'}` times out here. Every judgement about the four screens has
therefore come from an accessibility tree and arithmetic — enough to catch a clipped string,
useless for whether a block floats or a gap is a margin.

Capture the geometry in the page, then draw it:

```js
const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TITLE', 'HEAD']);
const vis = e => typeof e.checkVisibility === 'function'
  ? e.checkVisibility({ checkVisibilityCSS: true }) : e.offsetParent !== null;
const hex = s => { const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(s || '');
  return m ? '#' + [1,2,3].map(i => (+m[i]).toString(16).padStart(2,'0')).join('') : null; };
const els = [];
/*
 * On screen means: is this what you would actually TOUCH at its own centre?
 *
 * `checkVisibility` answers "is this displayed", not "is this visible" — a row
 * scrolled out of a ScrollView still passes it and still reports a rect, which
 * can sit right on top of a pinned footer. A capture without this draws content
 * over controls and invents collisions; it nearly cost a round chasing two that
 * were not there (R245).
 *
 * An ancestor-walk over scrollers was tried and is not enough either: it does
 * not know about overlays, so with the picker open it reported the sheet's text
 * colliding with the Now screen underneath (R246). `elementFromPoint` is the
 * browser's own answer and handles scroll clipping, overlays and z-index at
 * once. Measured with the picker open: 11 hittable, all of them the sheet;
 * the 35 rejected are the screen it covers.
 */
const hittable = e => {
  const r = e.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
  const hit = document.elementFromPoint(x, y);
  return !!hit && (hit === e || e.contains(hit) || hit.contains(e));
};
document.body.querySelectorAll('*').forEach(e => {
  if (skip.has(e.tagName) || !vis(e) || !hittable(e)) return;
  const b = e.getBoundingClientRect();
  const cs = getComputedStyle(e);
  // DIRECT text nodes, not `innerText` on leaves only — see below.
  const t = [...e.childNodes].filter(n => n.nodeType === 3)
    .map(n => n.textContent.trim()).join(' ').trim().slice(0, 26);
  const bg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? hex(cs.backgroundColor) : null;
  const bb = cs.borderBottomWidth !== '0px' ? hex(cs.borderBottomColor) : null;
  if (!t && !bg && !bb) return;
  els.push({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width),
    h: Math.round(b.height), fs: Math.round(parseFloat(cs.fontSize)),
    c: hex(cs.color), bg, bb, fw: parseInt(cs.fontWeight) || 400, t });
});
JSON.stringify({ vw: innerWidth, vh: innerHeight, els })
```

Save that to a file, then `node tools/screen-render.cjs <file.json> <name>` writes
`out/<name>.png`. It is **not** a screenshot and does not pretend to be: every box is the real
`getBoundingClientRect`, every colour and type size is the real computed one, and only the
glyph shapes are invented. Spacing, alignment, overlap and voids are exactly what the browser
produced.

**Then check nothing overlaps anything.** A capture of what is genuinely on screen makes a
second check almost free, and it is one nothing here had ever run:

```js
const on = leaves.filter(hittable);
const hits = [];
for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
  const a = on[i].getBoundingClientRect(), b = on[j].getBoundingClientRect();
  const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (ox > 2 && oy > 2) hits.push(`${on[i].innerText.trim()} ⨯ ${on[j].innerText.trim()}`);
}
```

Two texts sharing pixels is unambiguous — unlike a clipped string, there is no honest version of
it. Measured across all four screens and the picker: **zero**. Run it with `hittable`, never
without: the same sweep on raw rects reports every scrolled-away row and every screen behind an
overlay, which is how it produced two convincing false positives in R245.

**Take direct text nodes, not leaves.** The first version used
`e.children.length ? '' : e.innerText`, which reads as the obvious way to avoid drawing a
string once per ancestor. It silently drops any element holding both text and an element
child — on the Now screen the rep VALUE is exactly that (`9` beside a nested ` reps`), so the
render came out with steppers around an empty space and the number simply gone. That is the
third time an instrument in this loop has quietly measured less than it claimed: the sweep
scoped to `#root` and saw no sheets (R217), the same sweep counted hidden screens as failures
(R220), and this dropped nested text. **Each was found by running the instrument against a
case whose answer was already known** — render a screen you have already read, and check the
picture says what the tree said.

## The sweep that finds layout bugs you cannot see

Three rounds in a row found real defects this way and no other way, so it is a step rather
than a trick. Everything it catches is invisible at the width a developer works at.

**Load real data first.** `npm run seed` (12 weeks) or `node tools/stress-web.ts` (700
sessions, 100 goals), then in the page:

```js
fetch('/seed.b64').then(r => r.text())
  .then(t => { localStorage.setItem('proof.db.v1', t); location.reload(); })
```

**Then sweep at 320pt** — an iPhone SE, and the width nothing is ever checked at. Run this on
every screen, in both languages:

```js
const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TITLE', 'HEAD']);
const visible = e => typeof e.checkVisibility === 'function'
  ? e.checkVisibility({ checkVisibilityCSS: true })
  : e.offsetParent !== null;
const leaves = [...document.body.querySelectorAll('*')]
  .filter(e => !e.children.length && !skip.has(e.tagName) && (e.innerText || '').trim());
const shown = leaves.filter(visible);
const bad = shown.filter(e =>
  e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().width < 1);
({ leaves: leaves.length, checked: shown.length, bad: bad.length,
   where: bad.map(e => e.innerText.trim().slice(0, 30) + ` [${e.scrollWidth}>${e.clientWidth}]`) })
```

**Filter to what is actually on screen.** A route stacked over another leaves the one
underneath mounted at zero width, and every leaf in it then looks like the silent-disappearance
bug. Measured on the recap over the Now screen at 320pt: **67 leaves, 51 "failures", all of
them the hidden screen behind** — and 16 genuinely visible leaves, 0 bad. Without the
visibility filter the sweep cries wolf on every screen that opens over another, which is how a
tool stops being read.

**Report `checked`, and look at it before you believe `bad: 0`.** This snippet used to scope
to `#root`, which reads as a sensible way to skip the HTML shell's `<title>` and `<noscript>`.
It is not: **every sheet in this app renders as a sibling of `#root`, directly under `body`** —
the exercise picker, the goal sheet, `ConfirmSheet`, `SettingsSheet`, `ScreenModal`. So the
scoped sweep silently examined *nothing* on any of them and returned a clean result, which is
worse than no check at all, because a clean result gets written down. Measured with the picker
open on a 320pt screen: the `#root` version found **0 leaves**, the version above found **107**.
Excluding by tag skips the shell without skipping half the app.

What the two failures look like, and they are not equally bad:

- **`width: 0`** — the element collapsed entirely. Nothing is drawn and nothing indicates
  anything is missing. A goal readout disappeared this way on every SE (R210).
- **`scrollWidth > clientWidth`** — truncated. Check `textOverflow` before calling it a bug:
  with `ellipsis` it is honest degradation, and 72 clipped names on Goals turned out to be
  exactly that. It only matters when the truncated thing is the row's *identity* (R215).

A sheet is not broken merely for being taller than the screen — it is broken if it cannot be
scrolled. Check that separately, and that a scroller actually exists:

```js
[...document.body.querySelectorAll('*')]
  .filter(e => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1)
  .map(e => ({ sh: e.scrollHeight, ch: e.clientHeight }))
```

The picker holding a hundred movements reports 4,596px of content in a 353px window, which is
right. Content taller than its box with `overflow: hidden` and no scroller is the failure.

**Measure real names, not the fixture's.** Synthetic data has its own name lengths and will
lie to you in both directions. Clone a live node's computed style and measure the actual
library through it:

```js
const cs = getComputedStyle(someRenderedNameNode);
const probe = document.createElement('span');
Object.assign(probe.style, { position: 'absolute', visibility: 'hidden',
  whiteSpace: 'nowrap', font: cs.font, letterSpacing: cs.letterSpacing });
document.body.appendChild(probe);
// probe.textContent = name; probe.getBoundingClientRect().width
```

That is what turned "the name looks a bit tight" into "six of thirty-three built-in movements
do not fit", which is a decidable claim.

**Re-run the sweep after the fix, at both widths.** A fix that moves a squeeze somewhere else
passes every test you were looking at: giving the goal name its line made the *deadline*
truncate on 89 of 100 cards, and the only thing that caught it was running the same sweep
again instead of checking the thing being fixed.

## What "great to look at" is allowed to mean

Not a redesign. The identity is settled: near-black, one volt accent, numbers as the hero, no
nav chrome. Within that, these are fair game and mostly cheap:

- spacing that is inconsistent between screens
- a state that renders as an empty gap rather than as something
- type that is too small to read at arm's length, or too heavy to scan
- a control that does not look pressable, or looks pressable and is not
- an animation that would make a transition feel deliberate instead of abrupt

## When to stop

Stop when a round's honest answer to "did this serve one of the four?" is no, and write the
next journey into `LOOP_LOG.md` so the next run picks up cleanly.

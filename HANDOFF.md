# PROOF — handoff

Paste this into a fresh chat to pick up cleanly.

---

## What this is

**PROOF** — a lifting log where the fastest way to record a set also produces a clip worth
posting. iOS-first, Expo/React Native, local-first SQLite, no account.

Repo: `C:\Users\srobs\fitness-app`. The app lives in `app/`.

Read these in order before touching anything:

| File | What it is |
|---|---|
| `PROMPT.md` | The spec, v10. Numbered sections (§4 tap budget, §5 scope, §6 cold start, §7 prediction, §8 definitions, §8b Live Activity, §11 data) are referenced throughout the code. |
| `LOOP_LOG.md` | One line per build round, newest first, through R269. Each entry ends with what to do next; the newest one is where to start. |
| `BUILD_LOOP.md` | The working loop: walk a user journey in the running app, fix what breaks, pin it with a test. |
| `ITERATIONS.md` | How the spec got to v10 and why. Read only if changing the spec. |

## It runs

```bash
cd C:\Users\srobs\fitness-app\app
npm test        # deps audit + domain bundle + tests + tsc; run it for the count
npm run web     # the SAME app, running through react-native-web at localhost:8099
```

**Why web, when §9 bans "web app" as a v1 non-goal**: iOS is the shipping target
(`npm run bundle` exports iOS only), and §9's ban is about not building a second,
separately-designed web product. This is not that — it is Expo's own web target,
used here because this environment has no iOS simulator, and it is how nearly
every round in `LOOP_LOG.md` was verified. The screens, models and domain code
are one codebase; react-native-web is the only thing making them visible without
a Mac. Nobody has decided to ship this as a product.

Also: `npm run bundle` (Metro → 1.7 MB iOS bundle, no device needed), `npm run e2e`
(simulated training → domain → a real PNG recap).

### Looking at things, which is how most defects here were actually found

| Command | What it gives you |
|---|---|
| `npm run cards` | `out/card-sheet.png` — every claim state × four rows: each language as it usually looks, then each language at the WORST realistic case (a typed 57-character movement name, a seven-figure volume, three-digit sets and streak). `npm run e2e` draws only the PR case, and §8 makes that the rarest one. The hard rows exist because for its whole life this sheet drew fourteen cards that physically could not overprint, which is why R476's 69px collision had to be found by eye (R477). |
| `npm run seed` | 12 weeks of history into `public/seed.b64`; `node tools/stress-web.ts` does 700 sessions / 14,000 sets / 100 goals. Load either from the page (the tool prints how). |
| `node tools/screen-render.cjs <capture.json> <name>` | Draws an app SCREEN from captured geometry. Complements `computer{action:'screenshot'}`, which DOES work (R531): this one reports geometry as numbers, which a photo cannot. Capture snippet is in `BUILD_LOOP.md`. |
| `node tools/predict-probe.ts <db>` | What the §7 predictor would suggest and why: score, typical position and day per lift. |
| `node build-domain.cjs --check` | Reports whether `dist/proof-domain.js` is stale WITHOUT rebuilding it. Run this before the harness: `npm test` rebuilds the bundle first, so the parity tests can never catch a stale one, and `harness/index.html` loads that file directly. |
| `node tools/orphan-scan.cjs` | Tested exports with no production caller, split into NEW versus the five knowingly kept. Runs inside `npm test` too. |
| `node tools/field-scan.cjs` | One level under orphan-scan: a FIELD on a tracked interface (ProgressRow, GoalProgress, NowState, RailLift, KindRow, MeasureGoalProgress) that is computed and returned but never read anywhere — a function can have a live caller while a field inside what it returns is still dead weight, which orphan-scan cannot see. Found `reachedAt`, `weeklyCard`'s `kind`, `bestAt`, `trendSince` and `goalBarA11y`'s date by hand across R267-R295 before this made the check mechanical; caught `ProgressRow.lastTrainedAt` and three fields on `NowState` (`upNext`, `prefillSource`, `planDays`) the first time it ran (R296). Runs inside `npm test` too. |

`BUILD_LOOP.md` has three sections worth reading before any layout work: the card sheet, the
screen renderer, and the 320pt sweep. Four rounds' worth of defects were invisible to a green
test suite and obvious in a picture.

## ⚠ Traps that have already cost hours

1. **`cd` into `app/` explicitly in every shell command.** `C:\Users\srobs` is a *different*
   Expo project with its own `package.json` and `node_modules`. A drifted working directory
   once patched its files and bundled the wrong app entirely.
2. **Never `npm install <pkg>` bare** — it resolves SDK 57 versions against Expo 54, and caret
   ranges drift silently. Look the version up:
   `node -e "console.log(require('expo/bundledNativeModules.json')['expo-foo'])"`, then
   `npm install --save-exact expo-foo@<that>`, then `npm run check-deps`.
3. **npm does not reliably repair a transitive tree after a version pin.** Verify with
   `npm run check-deps`; if it complains, `rm -rf node_modules package-lock.json && npm install`.
4. **Driving the app from automation:** dispatch a plain `click`. This note used to say the
   opposite — that `Pressable` listens for pointer events and a synthetic `click()` does
   nothing — and R75 measured it directly against a countable control (LOG SET, counting the
   sets it adds): `pointerdown`+`pointerup` alone fires **zero** presses, a bare `click` fires
   **one**, and the full five-event sequence also fires exactly one, not two. Following the old
   note gets you a button that never responds, which looks exactly like the broken button it was
   written to warn about. Send `click`; the pointer events are harmless but do nothing.
   RE-MEASURED R532, same control, all three numbers held: pointer-only 0 sets, bare click 1,
   full five-event sequence exactly 1 more — so the five-event form used throughout R511-R531
   is one press, and R521's tap counts rest on that.
5. **Do not toggle a `Modal` with `visible`** — this said "on react-native-web a transparent
   modal stays on screen", and R547 could not reproduce that on the version actually installed.
   Probe: forced `visible={false}` onto the `<Modal>` inside `ScreenModal` and drove the CLEAR
   confirm sheet — nothing appeared, no CANCEL, no copy. Reverted the one-line probe and drove
   the identical clicks — "Clear this workout? ... CANCEL / CLEAR". So on react-native-web
   0.21.0 `visible={false}` hides a transparent modal, and the reason for the two runs is that
   "no sheet" only means something once the same steps are shown to produce one.

   THE ADVICE STANDS ANYWAY, for a different and better reason than the one it gave.
   `ScreenModal` returns null when it is not focused, and that conditional render is what makes
   the entrance and exit animations possible at all — a modal held mounted behind `visible`
   has no unmount to animate out of. Keep rendering conditionally; just do not keep repeating
   the web bug as the reason, because a session that tests it will find it false and then has
   no idea which half of the entry to trust.
6. **The web database is sql.js** (`src/data/web-db.ts`, dev only, backed by localStorage under
   `proof.db.v1`). Clear it from the page to simulate a fresh install. Native uses expo-sqlite.
   Both go through the same two-method `Db` interface, so `Repo` is identical on each.
7. **Start the app with `preview_start {name: 'proof-web'}`.** The config the tool reads is
   `~/.claude/launch.json`, NOT `fitness-app/.claude/launch.json` — the local one existed and
   was never consulted, so for a while no session could start the app by name at all and every
   "verify it live" step depended on a server someone had started by hand. Port **8099**, matching the `web` script in `package.json` — that script is the command
   that binds the socket, so it is the copy that cannot be wrong. `tools/dev-port.ts` reads it
   rather than duplicating it, because the seeding tools used to print a hardcoded 8099 while
   the launch entry had moved to 8100, sending whoever ran them to a dead page. The other
   projects in that file use their own ports.
8. **`input.value` is not in `document.body.innerText`.** Reading a typed field back through
   page text returns the placeholder or nothing, which looks exactly like a control that failed
   to accept input. Read `el.value` off the node. Related: with the Browser pane hidden,
   `blur` events do not reliably fire, so never wait on a blur-commit to observe a value — drive
   the commit the user would (tap the button) instead.
   MEASURED R532 rather than asserted: typing 205 into the weight field gives `el.value === '205'`
   while `document.body.innerText` does not contain 205 at all.
9. **A cross-unit weight bug does not look like a bug.** A `LoggedSet` carries no unit — the
   SESSION owns it — so any comparison of `s.weight` across sessions is silently wrong for
   anyone who has ever switched lb/kg. Five independent instances were found this way (R179-R181)
   and the symptom was never an error: a false "Heaviest 5-rep bench press" for a set that was
   15 lb LIGHTER than the real best, a goal reading 44% when it was essentially done, a suggested
   target of 110 lb for someone benching 220. Anything comparing weights across sessions needs
   `repo.sessionUnits()`; anything scoped to ONE session's own sets is already safe.

10. **An instrument here has silently measured nothing at least FOURTEEN times** — this
   entry said "three" until R533, and the number is the whole point of it, so being three
   times out of date made it read as a curiosity rather than as the most common failure in
   this repo. Eleven further rounds hit it (R500, R501, R510, R512, R513, R516, R520, R525,
   R526, R529, R532), each by a DIFFERENT mechanism: a gate whose glob could not see a
   planted failing test; a reporter that passed while incapable of failing; an assertion that
   passed against the exact state it was written to rule out; a text check that cannot see
   occlusion; four fixtures in one sitting that never exercised the path they judged; three
   successive tests that could not fail; a regexp whose backslashes had collapsed so it
   matched nothing; and plants that silently failed to apply and were read as "not caught".
   THE DEFENCE, which is the part worth carrying: plant the defect, and then check the plant
   ACTUALLY FIRED AND ACTUALLY APPLIED. A plant that produces no failure means one of two
   things — the instrument is blind, or the edit never landed — and both are findings. An
   instrument reporting no problems must also say how much it examined.
   The original three. The 320pt layout sweep
   was scoped to `#root` and therefore examined **zero** elements on every sheet in the app,
   reporting clean (R217). The same sweep then counted the screen *behind* a stacked route as
   51 failures (R220). The screen-capture snippet took leaf text only and dropped the Now
   screen's rep VALUE, which is a direct text node beside a nested ` reps` (R224). Two test
   sweeps could also pass having read no files at all, proven by breaking their extension
   filter (R218). **Every one was found by running the instrument against a case whose answer
   was already known.** Anything that reports "no problems" must also report how much it
   examined — and you must look at that number.
11. **Screenshots DO work — this entry used to say they do not, and that was wrong (R531).**
   `computer{action:'screenshot'}` returns real images, including at an emulated phone size.
   Dozens were taken across R511-R530: the main screen at 375x812, both tab-bar variants at
   two sizes for an owner decision, and Progress, Goals and the Recap. Believing the old
   wording would have made an owner request — *screenshot each and put them side by side* —
   look impossible.
   What is TRUE is the failure mode underneath it: a hidden or minimised pane can stop the
   page drawing, and the call then times out after 5s. The fix is to call it again; the error
   message says so itself, and a retry has worked every time it has happened here.
   `tools/screen-render.cjs` is still worth having, for a different reason: it reports
   `getBoundingClientRect` boxes as NUMBERS. A photo cannot tell you an element is 3px wide
   or 8px past the fold, and the layout defects turned on exactly that.
12. **Reading DOM state in the SAME script execution as the click sees pre-render state —**
   and this produced three false "this button doesn't respond to automation" conclusions in
   one session (R263, R272, R273) before R277 caught it. React batches the state update from
   a dispatched event, so `el.click(); return document.body.innerText` reads BEFORE the
   render commits — the click worked, the read just ran too early. Confirmed by reversing
   each false conclusion: the exercise picker, `ConfirmSheet`'s CANCEL and the CLEAR-workout
   flow all open and close correctly once the check is a *separate* call, or a `setTimeout`
   inside the same one. Also: check the actual portal — sheets render as siblings of `#root`
   under `body` (trap 10 already says this for the sweep; it applies to ad-hoc checks too) —
   `document.body.innerText` does eventually include portal content, but reading it via
   `[...document.body.children]` and inspecting the LAST sibling div directly is more precise
   and does not depend on innerText's own quirks. **Always separate "dispatch the event" from
   "read the result" into two steps, or bridge them with a delay**, before concluding a control
   is unresponsive.
   RE-MEASURED R533 and it holds exactly: dispatching `click` on LOG SET and reading
   `document.body.innerText` in the SAME execution reports 0 sets; reading it after a delay
   reports 1. The press landed both times — only the read was early.

13. **A hand-maintained list of "things that must all do X" drifts, every time.** Eight times now, and the first two were:
   `RecapPayload` field had to reach `recap.tsx`, `shareText` and `spike/recap.js`, and enumerating
   them by hand let `pr.heaviest` and `multiple` ship silently absent from the render surfaces
   (R435-442) — `firstSession` was caught only because the *fourth* one derived the list from the
   interface's own source instead of restating it. Same shape again for weight display: every
   function returning a type with `unit: Unit` has to source that unit from `displayUnit()`, and
   `progressRows` got the fix and a test for it while `recentSessions`, a sibling written later,
   silently never did (R454). The fix both times is the same shape, now in
   `test/recap-fields-reach-consumers.test.ts` and `test/weight-display-unit-coverage.test.ts`:
   **derive the population from source** (regex the interface body, or find every exported
   function whose return-type annotation constructs a flagged interface) so a new field or a new
   sibling function enters the checked set automatically, with nobody remembering a list exists;
   **exempt explicitly, with a stated reason**, never by silently excluding an inconvenient case
   (`lang`/`kind`/`watermark` for `recap.tsx`, `GoalDraft` for the unit gate) — a positive
   assertion must fail loudly unless someone named why it doesn't apply; and **prove the gate can
   fail before trusting it** — plant the exact bug the gate exists to catch (comment out the call,
   or `sed` a hardcoded value over the real one) and confirm a correctly-worded failure, THEN
   restore the file and verify byte-for-byte that nothing real was left behind. A completeness
   check that has never been watched to fail is a claim, not a gate. The next class of this shape
   — "every X must do Y" enforced only by someone remembering — should get the same three-part
   treatment rather than a fifth hand-swept instance.
   SIX MORE SINCE (R507, R508, R520, R526, R527, R529), which is why the count above moved from
   two to eight: `build-domain.cjs` verified a hand-written list of 28 export names while the
   bundle published 108; `bundle-parity` checked seven names under the title "everything the
   harness needs", of which the harness needed two; the preference sweep, two allow-lists, and a
   test count in this very file. Every one was found by asking what DEFINES the list rather than
   by reading the list.
   AND THE EXEMPTION EXAMPLE ABOVE WAS ITSELF WRONG, which is the sharpest illustration this
   entry has. `lang` was exempted from the `recap.tsx` check on the stated grounds that the live
   screen knows its own language — and `recap.tsx` reads `payload.lang` to format the volume,
   because a thousands separator is a locale decision. So the field was being skipped by the very
   test written to catch an unread field, for the reason that it did not need checking. R526
   removed it and made each exemption assert that the consumer genuinely does NOT read the field,
   so a reason that stops being true now fails the build. A stated reason is necessary and is not
   sufficient: prose does not fail. The surviving exemptions are `kind` and `watermark`.

14. **A `<Text>` child does NOT give a control an accessible name.** react-native-web renders
   `<Text>` as a `<div>`, and Chrome's name-from-content does not cross it — measured against a
   planted probe in the running app (R473), where `<button>TEXT</button>` came back named and
   `<button role="button"><div>TEXT</div></button>` came back anonymous. So a `Pressable` whose
   only "name" is the label drawn inside it is silent to VoiceOver, and it LOOKS completely
   correct on screen. `test/accessibility.test.ts` believed the opposite for a long time and
   excused 25 real controls on that basis; it now demands an explicit `accessibilityLabel` on
   every non-structural `Pressable`. This is also the actual explanation for R450, which
   hand-fixed nine of them (FINISH included) while the gate stayed green.

   RE-MEASURED R545, and it holds, with one detail the entry did not have. Planted the same
   four probes into the running app: `<button>PLAINTEXT</button>` came back `button "PLAINTEXT"`,
   while `<button role="button"><div>DIVCHILD</div></button>`, and the same with a `<span>`, and
   a `<div role="button">` wrapper, ALL came back with the button anonymous and only the inner
   node named. So it is not specific to react-native-web or to a div-role-button: a REAL
   `<button>` element loses name-from-content the moment its text sits inside a child element.
   Checked the other direction too, which is the half that proves the app is not accidentally
   fine: every named control on the Now screen — LOG SET, PUSH, PULL, LEGS — carries an explicit
   `aria-label` AND has a `DIV` child, so each would be silent without it. Removing one label
   fails `accessibility.test.ts` by name, so the gate is what keeps this invisible.

15. **`accessibilityState` is dead on web, and `getComputedStyle` lies right after a render.**
   react-native-web 0.21 dropped `accessibilityState` from its forwarded props entirely (R474),
   so the three places using it announced nothing in the browser while reading perfectly in the
   source. Selection state goes through `onState()` in `press-style.ts`, which emits BOTH
   `aria-selected` (React Native maps it to the iOS trait) and `aria-pressed` (the valid web
   answer on `role="button"`) — neither one covers both platforms. Separately: reading
   `getComputedStyle(el).backgroundColor` immediately after a React re-render returned the OLD
   colour while `el.className` already carried the new one, which looked exactly like the app
   painting one chip and announcing another. **The class list is authoritative**; a reload
   settles any disagreement.

   RE-MEASURED R545/R546, and BOTH halves hold. The dependency is still react-native-web
   0.21.0, and a probe put `accessibilityState={{ selected: true, disabled: false, busy: true }}`
   on LOG SET and reloaded: the rendered node carried `aria-label`, `role`, `tabindex`, `type`,
   `class` and `style` and NOT ONE of `aria-selected`, `aria-disabled` or `aria-busy`. The prop
   is dropped whole, so anything relying on it announces nothing. `data-*` attributes are
   dropped the same way, which is worth knowing before reaching for one as a test hook.

   The `getComputedStyle` half reproduced too, and more strongly than written: selecting a rail
   lift left `className` carrying the new background class within 1ms while
   `getComputedStyle(el).backgroundColor` still read the OLD `rgb(16, 19, 22)` at 1, 30, 80,
   150 and 300ms — long past the 90ms colour transition — and only agreed on a later read. So
   the class list is authoritative by a wide margin, not a narrow one.

   CAVEAT, because the mechanism is not established: every one of those readings was taken with
   `document.visibilityState === "hidden"`, which stayed hidden even after fronting the tab, and
   a hidden page defers style recalculation (it is the same condition that stops `rAF` firing —
   see trap 12). The ADVICE is right either way and that is what matters here. Whether a visible
   pane behaves differently is untested, so do not repeat the mechanism as though it were.
16. **An empty matcher matches EVERYTHING, and an empty population asserts NOTHING.**
   Both are ways a check passes while looking at nothing, and neither is visible in a diff.

   Measured in R553, twice in one round. A vocabulary was parsed out of another file with a
   regex whose escape had collapsed (trap 7), so it found no labels; `[].join("|")` is `""`,
   `new RegExp("")` matches every string, and every card in both languages was then reported as
   claiming a personal record. Note the direction: an empty pattern does NOT read as "no match",
   it reads as "the FIRST branch", on every input. The same shape reaches interpolation:
   a pattern built as `\b` plus an empty name plus `\b` is `/\b\b/`, which matches everywhere.

   The sibling is quieter. `for (const x of derived) assert...` over an empty `derived` is a
   test that passes without executing a single assertion, which is what `bundle-verify-is-
   derived.test.ts` guards with a `deepEqual` on the population before the loop, and what
   `no-control-bytes.test.ts` guards with "there are source files to scan at all".

   The defence is the same both times and it is one line: **make the empty case throw or fail,**
   **never continue.** Assert the population is non-empty before looping; throw when a matcher
   is built from nothing. `anyOf` in `card-and-message-agree.test.ts` is the worked example.

   RE-MEASURED R554: the rest of the repo is clean, and clean for a reason worth knowing rather
   than by luck. `field-scan.cjs` and `orphan-scan.cjs` interpolate names captured by
   `([a-zA-Z_][A-Za-z0-9_]*)`, which cannot match an empty string, so their patterns cannot
   collapse; the derived-population loops in the suite each assert their population first.

17. **A hidden pane delivers NO focus events, so `onBlur`/`onFocus` behaviour cannot be
   tested from here.** Measured R557 and the numbers are unambiguous: `el.focus()` moved
   `document.activeElement` (so focus really changed), moving focus away changed it back, and
   across `blur`, `focusout`, `focus` and `focusin` listeners attached to that same element,
   ZERO events fired. `document.hasFocus()` was false and `document.visibilityState` was
   "hidden" throughout — and fronting the tab does not clear it, because the pane is hidden by
   the window, not by the tab.

   Why it costs a round if you do not know it: the app looks like it is ignoring a handler.
   R557 added an `onBlur` to the machine-name field, confirmed the handler was IN THE BUNDLE,
   drove a real focus change, and saw nothing happen — which reads exactly like "react-native-
   web drops onBlur" (trap 15 is a real instance of that shape, so it is a believable
   conclusion) and is not what happened. `NowScreen.tsx` already uses `onBlur` in two places
   for the typed weight and reps fields, so the handler is not the suspect; the pane is.

   This is device-blocked, like the native-only checks: do not "verify" a focus behaviour from
   this pane and do not ship a change whose only evidence would have to come from one. The
   pieces that ARE testable stay testable — the model behind the field is pure and covered by
   `recent-surface-edges.test.ts` (colon in the name, blank name, switching kit).

18. **A crash inside the DEV preview shows Metro's overlay, not the app's own error screen —**
   **so the two crash-recovery paths this app has can only be confirmed correct by READING,**
   **not by triggering a crash here.** Checked R576: `app/_layout.tsx` re-exports `ErrorBoundary`
   from `expo-router`, which is the framework's documented convention (confirmed against its own
   `.d.ts` — a real `Component` with `getDerivedStateFromError`, wired automatically onto every
   route by the router's `Try` wrapper) and is already commented in place, not an oversight. The
   ONE gap that boundary does not cover — a database open or migration failing before any route
   renders — has its own dedicated handler, `RepoGate` -> `StorageError`, comprehensively tested
   in `storage-error.test.ts` (escalating guidance, both languages, no destructive button, the
   device's own language rather than the possibly-broken repo's). Both paths are real and
   correctly wired. What is NOT verified, and cannot be from here: that either one actually
   fires and renders on a genuine crash in a PRODUCTION build, because a dev server routes an
   uncaught render error to Metro's LogBox instead of letting `expo-router`'s boundary catch it
   — the same shape as trap 17, a real behaviour this pane's dev mode structurally cannot show.
   Do not "verify" a crash screen from here; the source-level confirmation above is the ceiling.

19. **`node --test` runs test FILES concurrently by default, so any test that writes to a**
   **real, shared path on disk can race any other test that reads that same path.** Found R596,
   live: `test/landing-page.test.ts` reads `link/dist/index.html`, and
   `test/link-build-is-self-contained.test.ts` rebuilds that exact real, shared file three times
   per run via `spawnSync(['link/build.cjs'])` — one of the three deliberately leaving it BROKEN,
   to prove the build fails loudly on a real defect. `link/build.cjs` itself does
   `fs.rmSync(DIST, {recursive:true})` before writing it back, so the window where a concurrent
   reader hits the directory outright missing, or holding the deliberately-broken build, is real,
   not theoretical — `npm test` came back red with zero source changes, then clean on every
   rerun, which is exactly the signature of this class of bug and exactly why a flake should
   never be shrugged off as a fluke without checking. Fixed with an env-var override
   (`PROOF_LINK_DIST`, mirroring `PROOF_BUNDLE_OUT`'s already-existing pattern for the domain
   bundle) so the test that rebuilds can write to a private `mkdtempSync` directory instead of
   the shared one. `test/bundle-parity.test.ts` had already hit this exact class once before,
   independently, for `dist/proof-domain.js` — hardened with an atomic temp-file-plus-rename
   swap rather than full path isolation, a different valid fix for the same root cause. Before
   adding a new subprocess-spawning test that writes ANY file: check whether another test reads
   that same path, and if so, redirect the write rather than trusting it will never race.

20. **A hidden pane freezes CSS TRANSITIONS at frame 0, not just rAF — and a screenshot of that**
   **frozen frame looks exactly like a layout bug.** Cost R628-R633: every sheet enters on a
   220ms opacity/`translateY(12)` transition (ScreenModal's `RISE`). With `document.hidden`
   true, both CSSTransitions sat at `currentTime 0` for seconds, so the sheet was really at
   opacity 0 and 12px low. Screenshots force a paint of that state, and the result is a ghosted
   sheet over a bright LOG SET that reads as an overlap. It was filed as two bugs, "fixed" once
   (no effect, the code was fine), and diagnosed for three rounds. Before measuring or
   screenshotting anything that animates in, run
   `document.getAnimations().forEach(a => a.finish())`, then use `elementFromPoint` to decide
   what is actually on top. A resting sheet over a dimmed screen is not an overlap.


## Architecture in one paragraph

Every rule with teeth lives in a **pure model** that runs under `node --test` with no
simulator: `src/domain/` (PR detection, exercise prediction, session lifecycle, goals, cold
start, rest) and `src/ui/*-model.ts` (per-screen state machines). The `.tsx` files are thin
bindings that render and forward taps. `src/data/repo.ts` takes a two-method `Db` interface and
imports no driver. **Keep this split** — it is why the whole suite (see "It runs" above for the
current count) runs on a laptop in a few seconds.

## Where it stands

Built, tested and verified live in the browser: cold start, one-tap logging, plate-correct
steppers, exercise picker, custom exercises, rest timer, resume-on-relaunch, session recap with
PR/goal/streak, Progress, Goals, JSON export/restore. The video renderer for the shareable clip
exists in `spike/ios-module/` (Swift, uncompiled) and its design is proven in `harness/`.

## Nothing in flight

**The app asks what split you run and which day it is** before the workout, once per workout.
Upper/lower and full body are derived from push/pull/legs rather than modelled separately, so the
picker narrows correctly for any of the three. SKIP falls back to the old inference.

**Starting weights are scaled to the lifter** — an empty barbell is 45 lb / 20 kg, a dumbbell 5,
a machine 5, and above that `startingWeight` scales from what they already lift: a 315 bench
suggests 135 for a first overhead press.

Settings is a **real screen** (`app/settings.tsx`) reachable from both Now's gear icon and
Progress — §9's ban was overruled (R111), and the sheet-only version (`SettingsSheet.tsx`) that
predates this paragraph was deleted in R232 once it turned out to be a second, drifting copy of
the same screen. On Now you tap the weight or the rep number itself to type it — the `±5 · TYPE`
control that used to sit between them is gone.

**Schema is at version 6** (`SCHEMA_VERSION` in `schema.ts`) — v3 added `equipment` and
`machine` to `sets`, v4 a free-text `note`, v5 the `measurements` table, v6 `measure_goals`.
Every migrated column is nullable: a set logged
before the columns existed has no answer, and inventing one would be a made-up fact.

CLEAR (this workout) and ERASE EVERYTHING (all of it) both ask first, through `ConfirmSheet`.
The jump amounts are user-settable from Settings. The library is 60 movements (`BUILTIN` —
12 in `STARTING_TWELVE`, 20 in `MORE_MOVEMENTS`, 28 in `WIDER_LIBRARY` since R678), and
the picker opens on the day being trained with the other days one tap away.

UP NEXT is gone from the footer (the picker already does it, more precisely), and the bottom
block leads with `NEXT  SET n` instead of a receipt of what was done.

Four big-jump buttons on the Now screen (plus and minus 45 lb / 20 kg, and plus and minus 5 reps),
drawn smaller than the steppers they flank; the goal sheet's FOR and BY rows have full chip sets plus an OTHER that
takes a typed value.

**Seven bugs from an adversarial hunt are fixed (R50)** — the recap's PR block no longer prints
the whole bar as the improvement or claims "heaviest ever" when it is not, `weekStreak` counts
LOCAL calendar weeks instead of Thursday-00:00-UTC ones, `restore` keeps each session's real date
and survives a backup made before an undo, UP NEXT advances instead of ping-ponging between two
lifts, and no screen can strand you when it is the entry route.

The recap card no longer credits a first-ever session with a one-week streak — the card and the
share message answer to one `streakWorthShowing` threshold now, instead of only the message
knowing.

A set logged wrong in the middle can be removed on its own: **tap its chip to open EDIT SET, then
REMOVE THIS SET** — the same sheet that edits the weight, the reps and the note. (It was a
tap-to-arm, tap-again gesture when this was first built; that is why `armSet` turned up as a
tested export with no caller in R176. Walked on the running app in R232: three sets of 175, 220
and 265 total 3,300 lb, removing the middle one leaves **2 sets · 2,200 lb** and renumbers the
survivor to 2.) UNDO only ever popped the tail, so the fix used to mean destroying the good sets
after it.

The recap composes at any length: a `flexGrow` spacer puts the summary and its claim at the top
and the lift list against the actions, instead of 323px of nothing in the middle.

Progress reports a half-unit gain as a half unit. `Math.round` was turning 12.5 into 13, so the
trend and the best set no longer reconciled to a weight the user had lifted.

The share message always opens with a lift and a number. Only the PR branch named the work
before, and §8 makes PRs rare, so the ordinary session went out naming no lift it had trained.

A goal you have already hit no longer blocks a new goal on the same lift, and no longer speaks
for workouts it had nothing to do with — `headlineGoal` takes the session start and an older
trophy does not headline.

The exercise picker caps at 86% rather than 72% and shows its scroll indicator: at the old cap
one added movement pushed the whole LEGS group out of a list that looked complete.

TODAY now scrolls itself to keep the lift being trained in view — `revealOffset` in
`now-model.ts` decides, `NowScreen` supplies the measurements. Before it, the third lift of a
session sat below the fold of an unmarked scroller with its sets and its UNDO.

The database opens from the **App Group container** (§8b) — `src/data/db-location.ts` holds
the rules, `db.ts` makes the two filesystem calls, 32 tests pin them. A build without the
entitlement falls back and says so; a half-finished move opens the old directory rather than
manufacturing an empty database beside a full one.

**Goals are capped at 100, not three** (R96–R109). The cap is the number that stops a runaway
rather than a design statement, and the screen earns it by letting you cut the list down:
`src/ui/goal-filters.ts` holds OPEN / PUSH / PULL / LEGS / DONE with live counts and a sort that
cycles CLOSEST → SOONEST → NEWEST. The filter and sort survive navigation but NOT a restart — in
memory, deliberately, because a filter that outlives the session is a hidden mode. OPEN is called
open and not "all" because it excludes met goals.

**One LIVE goal per lift, everywhere.** `activeGoals`, not `goals`: a met goal is a trophy, takes
no slot, and does not stop you aiming higher on the same lift. The add sheet leaves out only the
lifts with a live goal, and says so instead of rendering a form whose only outcome is a refusal.

**A goal can be amended** — CHANGE on the card keeps its id and `createdAt`, so the progress bar
keeps the baseline it is measured from. The lift itself is fixed; an achieved goal has no CHANGE
control. `editGoal` and `targetBase` in `goals-model.ts`.

**The goal rides the Now screen's "last time" line** — "Last time  125 × 8   ·   97 to 222 × 3",
and the set that hits it flips the clause to a volt "goal hit: 222 × 3" for that session only.
Same row, so it costs no vertical space on a path §4 forbids to scroll. `lastTimeParts` and
`goalTail` in `now-model.ts`.

**The recap carries a goal even when it carries a PR.** The claim slab takes the best true claim
in order, so a progressing lifter's goals never reached it; the goal line has its own row under
the lift list now, drawn only when it costs the list nothing. Same fix in the share text, where
the comment had described the correct behaviour and the code did the opposite.

**Raising the cap was a performance change.** `rankGoals` was 48ms per render at 100 goals against
20,000 sets, and `progressRows` had the same shape — both bucket the history by exercise once now,
and both carry a frame-budget guard test. `repo.goals()` is memoised like `allSets()`.

**Source-reading tests go through `test/helpers/source.ts`.** `slice(indexOf(...))` returns the
last character rather than throwing when an anchor moves, so 24 assertions could silently stop
testing — one of them did. Use `region` / `upTo` / `around`; a standing sweep fails on the next
bare one.

Typed weight entry commits on **every keystroke**
— parsing lives in `typedWeight()` in `src/ui/now-model.ts`, not in the component, because it is
the feature and in the `.tsx` nothing could test it. Steppers close the field when pressed.
A `TODAY` section on Now shows the whole workout as it accumulates.

## Continue the loop

**Read the newest `LOOP_LOG.md` entry first — every entry ends with a `next:` line, and that is
the most current statement of where the work is.** What follows is the standing shape of the
loop, not a live to-do.

All eight journeys have been re-walked with working instruments more than once (R41-R49, and
again through R174-R186), and nothing is knowingly broken and left unfixed. The rotation is
clean. The largest remaining gaps are not reachable from this machine — they need a device or
people, and they are listed below.

**The most productive recent rounds were not journey walks.** Two patterns paid better:

- **Verify a claim this file or a comment makes, rather than reading it.** "A test fails if
  `link/dist` is stale" was two-thirds false (R186); the `armSet` safety mechanism had been
  superseded and its tests were guarding dead code (R176). Both were found by checking, and
  neither would have been found by reading.
- **Once a bug is found, sweep for the SHAPE of it.** One cross-unit comparison bug turned out
  to be five (R179-R181), and one missing recap claim turned out to be missing on all three
  surfaces that carry it — card, share message, and shared link (R183-R185). The first instance
  is rarely the only one.

**Re-seed before walking anything date-dependent** — `npm run seed` was writing every session's
`started_at` as *now*, so the recap's date tile read today and its duration read 1 MIN for all 36
seeded workouts. Fixed in R45; a seed built before it is still wrong.

**Ask for the Browser pane to be displayed before driving anything layout-related.** R42's fix
could not be re-driven end to end: a hidden pane pauses the frame loop, ResizeObserver never
delivers, and `onLayout` therefore never fires. See BUILD_LOOP.md step 2.

**Read BUILD_LOOP.md step 2 before driving anything.** The exercise picker was invisible for
thirty rounds — rendered one full viewport below the screen — and every round said "verified
live", because synthetic pointer events and `innerText` both work fine on an element nobody can
see. Check geometry, and take a screenshot when the preview pane is displayed.

Small things seen and judged not worth a round yet:

- The split is push/pull/legs. Upper/lower falls out of it for free; a routine builder does not.
- **`goalE1rmGap` (`src/domain/goals.ts`) is built and documented ("for the Progress screen's
  secondary readout") but never called from `progress-model.ts` or anywhere else** (R461, found by
  grepping every `export function` in `src/` for zero references outside its own definition —
  the same query that also caught `missingKeys` sitting unwired before R460). Now has correctness
  tests (`test/goals.test.ts`) so it is at least verified for whenever it is wired, but building
  the actual readout is a product surface decision this loop declined to make unasked. Either wire
  it into Progress or delete it — owner's call.
- **`headline` (`src/ui/recap-model.ts`) is a tested reference model with no production caller —
  its old acknowledged-list reason was wrong, AND the function itself was stale, not just unwired**
  (R462-R463). It encodes the claim-priority rule (PR beats a first session beats an early best
  beats a goal/trend line beats plain volume), which `recap.tsx`'s JSX and `spike/recap.js`
  (`drawClaim`/`NARRATIVE`) each independently REIMPLEMENT rather than call — neither can import TS
  domain code, the same boundary `bundle-parity.test.ts` exists for. `link/copy.js` was named as a
  third instance in R462 and that was itself a mistake, corrected R463: its `resolve()` answers a
  different question (which of four landing-page marketing variants to show), not this rule.
  Nothing enforces the two real copies agree with `headline` or with each other, the same
  unenforced-drift shape as the Swift port (above) on a smaller surface. `tools/orphan-scan.cjs`'s
  ACKNOWLEDGED list previously excused `headline` with "shareText covers the shipped path" —
  checked against the real call graph in R462 and found false: `shareText` solves a different
  problem (the share TEXT message) and never touches this logic. That false reason was standing in
  front of a real bug: `headline` predates `firstSession`/`bestYet` on `RecapPayload` (R435-442)
  and was missing both branches entirely — fixed in R463, with tests pinning the two new branches
  against `recap.tsx`'s and `recap.js`'s real guards. **The completeness gate is built** (R466 —
  `test/claim-priority-parity.test.ts`), scoped to the SLAB choice (PR / first session / early
  best / neither) specifically: `recap.tsx` renders the goal line in its own row additionally
  whenever present, while `headline`/`recap.js` use it only as a fallback when nothing else claimed
  the slot — a deliberate, already-documented difference (§5), not something the gate forces to
  agree. Proven to fail correctly by planting `false &&` in front of `headline`'s firstSession
  branch and confirming a real failure before restoring it byte-for-byte. Only remaining decision:
  delete `headline` if an owner decides the redundancy isn't worth carrying now that agreement is
  actually enforced rather than hoped for.
- **`resetWebDb` (`src/data/web-db.ts`) has zero references anywhere**, including no `window.`/
  `globalThis.` exposure that would make it reachable from a devtools console (R461, same sweep).
  Its own comment calls it "Development affordance, not a product feature," which reads as
  deliberate, but as written it cannot currently be invoked by anyone — not wired to a console
  global, a debug menu, or a test. Left as-is: wiring it up would be inventing a debug surface
  nobody asked for, and deleting a working utility on a guess feels wrong too. Flagging so a human
  decision resolves which one it is, rather than the ambiguity sitting silently as it has been.
- **Which day a hinge belongs on under UPPER / LOWER** (R673). `DAY_OF` maps `deadlift` to `pull`
  deliberately — it is trained with the back, which is right for PUSH / PULL / LEGS — and
  upper/lower is derived from that for free (`upper = push + pull`). Measured on the real modules:
  the UPPER day carries 24 of the 32 built-ins INCLUDING Deadlift, while LOWER carries 8 and does
  include Romanian Deadlift and Hip Thrust. So an upper/lower lifter is offered deadlifts on upper
  day and never on lower. R673 made the app's own words match what the code does rather than move
  anybody's lift, because which day a hinge belongs on is a training opinion and not mine: a
  powerlifter deadlifts with the back, and plenty of programmes put it on lower. If it should move,
  `PLAN_DAY_COVERS` wants a per-plan override rather than a second flat list, and
  `test/the-split-blurb-matches-the-days.test.ts` pins today's answer so the change is deliberate.

## Still open, needing a device or people

**App store submission is scaffolded, not ready.** `eas.json` exists (development/preview/
production build profiles, a `submit.production` stub) and `app.json` now has the fields a native
build actually needs — `icon`, `splash.image`, `android.adaptiveIcon`, `ios.buildNumber`,
`android.versionCode`, `ITSAppUsesNonExemptEncryption` — where none of that existed before. What is
still a placeholder, on purpose, pending the owner's own accounts and decisions:
- `assets/icon.png`, `assets/splash-icon.png`, `assets/adaptive-icon.png` are a flat generated
  placeholder (a volt "P" on near-black, matching §15's own accent) so the build pipeline has real
  files to point at — NOT real app icon art. Replace before actually submitting.
- `ios.bundleIdentifier` / `android.package` are still `com.example.proof`, and
  `ios.associatedDomains` / the Android intent filter still point at `example.app` — the owner
  chose to keep these as placeholders until a real bundle ID and share-link domain are decided.
  Both need real values before a build can go to TestFlight or Play under the owner's own account.
- No Apple Developer Program or Google Play Console account exists yet (owner-only: payment +
  identity verification). No `eas init` has been run, so `extra.eas.projectId` is not set in
  app.json — that happens automatically the first time the owner runs `eas build` while logged
  into their own Expo account.
- **First native build has never happened.** Everything in "Where it stands" above was verified on
  web and in Node tests; nothing has run as an actual iOS or Android build. Expect real bugs the
  browser-based verification this whole project has relied on cannot catch — that first EAS
  preview build is the actual gate, not a formality.

**The Swift port is five changes behind `spike/recap.js`** (R240, extended R271 and R476). §12 calls
`recap.js` the design source of truth and says to "keep the two in sync deliberately"; nothing
does, and every loop round that touches the card moves the JS further ahead. `RecapRenderer.swift`
is missing: the per-language LABELS table (R221 — a Spanish card would render TOTAL VOLUME /
SETS / TIME / STREAK), the `streak >= 2` guard (R150 — it draws the cell unconditionally, so a
first workout claims a 1-week streak and an absent field renders whatever Swift defaults to),
the §10 weekly variant (R228), the streak-record volt accent (R271 — every streak draws the
same unaccented colour, so a lifter's actual longest-ever streak looks identical to an ordinary
one), and the claim slab's top-row budget (R476 — it draws the claim label and its right-hand
qualifier towards each other from opposite edges with neither measured, which is the overprint
that made a Spanish PR card read "NUEVO RECORD PERSOÑOAMEJOR HASTA AHORA"). The GEOMETRY still matches exactly — canvas, safe box, margin and action rail — which is
the part a divergence would hide until a real Story cropped a real card. `swift-parity.test.ts`
asserts the geometry and lists all five gaps; each is written as "still missing", so porting one
FAILS the test and forces the list to be struck off rather than left to rot. Needs a Mac to
compile, which is why it is here and not fixed.


- **The clip is not the shareable yet.** §5 makes the clip primary and the card the fallback.
  The share message now carries prose plus a link that renders the card client-side (R67–R69),
  but no FILE — no clip, and no card image. Emitting either needs a capture/encode dependency
  and a device to verify on, so it is the biggest remaining gap between spec and build and the
  one thing here that wants a human decision rather than another loop round.
- **The Live Activity** is specified (§8b) and unbuilt. Needs a device.
- **§13's kill test** — ten hand-made recaps, fewer than three sent unprompted in 48 h
  falsifies the whole thesis. Harness ready at `harness/index.html`.
- **First boot on real hardware.** It bundles and runs on web; iOS has never executed.

## Product decisions the owner has made (R266-R269)

Five questions loop rounds surfaced without answering, because each was a real choice about
what the app should claim rather than a defect. The owner has since answered all five —
four by building the real fix, one (§12's Reanimated/Skia) by explicitly declining to overrule
the existing technical direction. Kept here as the record of what was decided and why, not as
open items — nothing below this line needs further owner input.

- **Decided: no back-fill.** (R188, closed R266) The owner chose to leave `readingAt` as it
  is — a reading only ever applies to sets logged at or after it, and June's weight never
  rewrites January's. The accepted cost: a beginner's first bodyweight session still gets no
  volume at all, because there is no reading yet to compute one from. The false "0 LB" was
  already fixed independently (the app explains why it cannot total them, rather than lying
  about it); this closes the question of whether to *estimate* one, and the answer is no. Not
  open for re-litigation absent new information — if a future round is tempted to revisit it,
  that is the flag this note exists to raise.
- **Decided: yes, and it's wired.** (R202, closed R267) `measureGoalLine` now branches on
  `reachedAt` for the case `measureGoalLine` used to discard — `achieved` is false today but
  the goal was hit before, so "5 lb to 175 lb" alone re-baselined the lifter as never having
  gotten there. It now reads **"Hit 175 lb on Aug 8 — 5 lb back to it"**. §17's gate answered
  as part of the work: on the letter of the three questions this does not clearly serve
  "shareable output" (it enriches the Measure screen, which is already in §5's scope, rather
  than adding something new to it), but the owner's explicit yes for this specific feature is
  what the gate exists to obtain — it does not need to be independently re-derived once given.
  New key `targetReachedThenLeft` in both languages, one test proving the branch (reverting it
  fails), verified live against a seeded database in both English and Spanish.
- **Decided: give `sessionTitle` the plan.** (R204, closed R268) The owner rejected the cheap
  fallback (strict agreement → WORKOUT) knowingly, on the same `PLAN_DAY_COVERS` reasoning that
  ruled it out originally. New `sessionPlanDay` in `split.ts` tallies majority in the lifter's
  own plan's vocabulary rather than at the raw push/pull/legs level, so bench + squat + row now
  titles **PUSH DAY** on PPL (unchanged) and **UPPER DAY** on upper/lower (was PUSH DAY — a day
  that plan doesn't even have). `planOf(repo)` centralises the pref read that `NowModel.plan()`
  used to duplicate; both `buildRecap` and `recentSessions` now read it and were verified to
  still agree with each other under upper/lower, not just under the PPL default. Verified live:
  the same three-lift session read "UPPER DAY" on both the recap and Progress history.
- **Decided: the spec line was superseded, `displayStreak` is deleted.** (R205, closed R269)
  R150's "a one-week streak is not a streak" stands, `streakWorthShowing` is correct to refuse
  a 1, and the dead function is gone rather than left contradicting it — §6 was rewritten to
  match. `node tools/orphan-scan.cjs`'s other four entries were looked at (R269) and each still
  matches its stated reason; nothing else was dead.

- **§12 names Reanimated and Skia; the app uses neither, deliberately.** (R230) Motion is React
  Native's core `Animated` plus a transient-style pattern, and the reason is written into
  `Arrive.tsx` and `ScreenModal.tsx`: **the resting style has to be the visible one.** `Animated`
  is driven by `requestAnimationFrame`, which does not fire while the page is hidden — measured
  at 0 frames in 500ms — so an entrance built on it can strand its content invisible. The
  transitions here are 160ms confirmations, and `BUILD_LOOP.md`'s standing rule is not to add a
  dependency for what plain code does. Skia is a subtler case: §12's own video-pipeline section
  settles that the shipped recap is drawn by **native** code (`AVAssetReader → CGContext →
  AVAssetWriter`), with `spike/recap.js` as the Canvas2D design source of truth ported to Swift
  — so there is no composition step left for Skia to do. Neither package is installed. This is
  recorded rather than fixed because overruling a technical direction is the owner's call, and
  because adding either now would be churn with no user-visible change.

- **§5's swipe is now wired (R259), and it changed two things behind it.** A left drag on the
  Now screen calls `NowModel.next()`; §4's "0 once a session is predicted" is met. Threshold is
  48pt, twice tap slop, and the predicate also demands the drag be twice as horizontal as it is
  vertical — the rail's own drag-scroll and the vertical ScrollView both claim their gestures
  first, so what reaches the root is a deliberate sideways pull. Left only: there is no `prev()`,
  and the rail is both the way back and the accessible path, since a gesture is not one.

  Wiring it exposed two defects that had been invisible while nothing called `next()`. It read
  `upNext`, which ranks the whole library, while the rail's NEXT tag deliberately does not —
  on the leg-day fixture `upNext` says `row`, which is not on the rail at all, so a swipe would
  have left the screen pointing at one lift and arrived at another. And the rail tagged the first
  lift that was neither done nor current, so moving between two untrained lifts made it point
  BACKWARDS: `bench -> fly -> bench -> fly`, forever — R50's loop, in code written after R50
  fixed it. Both fixed, both pinned by tests proved against the old rule.

  Verified in the running app, not asserted: from BENCH PRESS the rail tagged Tricep Extension,
  a left drag landed on TRICEP EXTENSION with the prefill following it (`Last time 55 × 12`); a
  steep drag travelling 60px left and 300px up changed nothing; a right drag changed nothing.

## How to work on this

- Fix one thing properly rather than three partly.
- Every fix gets a test that fails without it. UI-only bugs get the test on the model behind them.
- Re-walk the journey in the browser after fixing. A fix that was not re-driven is not a fix.
- Append one line to `LOOP_LOG.md` per round: what was walked, what broke, what changed.
- §17's gate: anything not in §5 must answer in writing — does it add a tap to the logging path,
  does it serve first-run friction or shareable output, and what is being removed to make room.
- §5's four-screen cap is real but the count is already six, not four: Settings (§9's ban
  overruled, R111) and Measure/YOU (bodyweight readings and targets, since R140) both exist
  and both are load-bearing — Measure is the ONLY route that lets a bodyweight-lift set count
  its real load (§8), and Settings holds split/units/language/jump-amounts/export. Neither
  screen is speculative or up for removal. What the cap still means in practice: a new idea
  does not get its own SEVENTH screen by default — it goes at the bottom of a screen that
  already exists, the same test §17's gate already asks (found stale R276: LOOP_LOG's own
  R226 cites "§9 bans a settings screen" as a live constraint from AFTER the screen already
  shipped in R111 — the contradiction sat unnoticed for over a hundred rounds).

## Since R57 — what changed under the last loop

Everything below is walked in the browser and pinned by tests; `LOOP_LOG.md` has the detail.

**The app fits the screen.** `PHONE_MAX` was private to `now-model.ts`, so only the logging
column was capped and Progress, Goals, the recap and every sheet stretched to the window. The cap
lives in `src/ui/column.ts` now and everything imports it. `maxWidth` alone is not enough — under
a backdrop's default `alignItems: 'stretch'` a capped sheet pins left, so `COLUMN` carries
`alignSelf: 'center'` and that is not optional.

**A day rail replaced NEXT LIFT.** The day's movements as chips under the logged sets, ordered
suggestion → predictor rank → unranked → done, with the predictor's pick tagged NEXT. The order
is deliberately blind to which lift is selected: it only reads what you have LOGGED, so tapping a
chip cannot rearrange the row under your finger. Capped at 12 (`RAIL_MAX`) so a full-body plan
does not put all 28 movements on the logging path, and the cap has to clear a real day whole —
at 8 it cut tricep extensions off a push day.

**`columnHeight` was lying.** It budgeted 12px for the ±45/±5 row, which measures 40. Every fit
test passed because they check that arithmetic against itself. TODAY is now computed last from
the space that actually remains, so the column fits by construction; the honest floor is 526px.

**Sheets no longer outlive their screen.** A react-native-web `Modal` portals to `document.body`,
outside the view the navigator hides — so the day chooser followed you to Progress and stayed
tappable there. `ScreenModal` unmounts on blur; a test fails for any raw `<Modal>` under `app/`
or `src/ui/`.

**Equipment commits on tap** and is remembered per exercise, ahead of the set history, so an
answer given and not yet logged survives switching lifts. `null` means never answered and `''`
means answered "none" — collapsing them made CLEAR fail to stick.

**Goals: the cap is 100, not 3.** §5 called three a hard cap; the product owner overruled it.
(This line said 12 until R536 — a second, contradictory number for the same cap, in this same
file, 287 lines from the one that says 100. R529's gate read only the FIRST match and passed.)
One
goal per exercise is still enforced and is the constraint that was doing the real work. Untrained
goals collapse to a compact row, and at the cap the screen says what would free a slot instead of
hiding the button.

**Progress knows about goals.** Each row carries its target ("5 TO 50"), a lift with a goal is
never ranked off the screen, and the cap says how many lifts it is holding back.

**No raise on top of a miss (R694).** The coach still ranks sessions by their top set, but every raise
(PLATEAU, PROGRESS, CLIMBING) passes through `unlessMissed(call, bar)`. If the latest session made `bar` at
its top weight and then a later set there fell short (`missedAfterMaking`), the call becomes `coachMissed`,
"160 again — make 8", in place of "try 165" (PT3, all three personas). The bar is what the call going in asked:
the target for a same-weight raise, R691's `asked` for a climb, and the session before's reps for a plateau.
So after a climbing, progress, plateau or all-sets call taken as given, a set the Now screen called "made it"
is not a miss on the recap. After a hold that asked other reps the two can disagree (the reviewer's four
probes: "add a rep" then 200×8, ×7 is "made it" and then "make 8"; an R691 miss asking 5 then 200×8, ×5; "add a
rep" into a plateau; "repeat 185×10" then ×9). The real fix is the coach recomputing its own call from before
that session, a design change, not a patch. `callMade` uses the same
`missedAfterMaking` on the made set's own weight, so "made it" ends at such a miss; lighter back-offs and
heavier tries never count. `recapFor().next` names a `coachMissed` hold as well as increases. Accepted:
rest-pause mini-sets read as misses, and a lifter stuck at 8, 7, 6 hears "make 8", not "stuck at". Not done:
with no call, the dial still opens on last time's LAST set (PT3 Broken 3).

**The Call Sheet, slice 2: the call is on the dial (R692, D8).** `NowModel.coachCall()` is the one call for
the line under the lift and for the dial; `loadPrefill` sets weight and reps from it while the lift has no
set in this workout (a deload keeps the reps). `startWeight` is still last time's weight, and is what the
grid and jump rules key off. This departs from PROMPT.md §4's "pre-filled with last session's value" for
coached lifts, deliberately (D8 has the one-block revert). 21 tests that assumed the dial opens on the last
set now read `startWeight` or set the weight they are about, keeping what each was for.

**The Call Sheet, slice 1: a miss is not a rung, and the recap names every call (R691).** A climbing
call now needs the latest session's reps to reach the fewer of the session before's and the goal's
target; falling short at a new weight is `coachMissed`,
"205 again — make 5", a hold made only at that weight (D7). `recapFor().next` is a list, every lift
that earned an increase in the order trained, at most `NEXT_CALLS` (3). The panel's slices still to
come: the call on the dial (a prototype that breaks the R550/R669/R671 prefill and grid tests is
kept in the loop's scratch) and the day laid out on TODAY IS. `playtest.mjs` `close()` now also waits,
up to 10 s, for Chrome to exit after `Browser.close`: under load, killing it after 2 s still lost
a profile, so a relaunch opened a fresh install.

**Bodyweight sets keep the total, and bodyweight lifts read as trained (R689).** A bodyweight set with
no reading behind it used to replace the whole recap total with a message; the recap now shows the
total it knows and, under it, how many sets leave the lifter's bodyweight out (`Recap.uncounted`).
Only a total of nothing is still replaced, and the message no longer promises to count sets already
logged. Progress prints a bodyweight best as "BW × 8" (`bestReps > 0` is "trained"), spoken as "best at
bodyweight". `playtest.mjs` `close()` sends `Browser.close` before killing Chrome: killed outright, it
lost unsaved localStorage, which two PT2 personas took for the app losing sets.

**A call from one session, and the first recap names it (R687).** `coachSuggestion` also calls from a
single session in the window when two or more sets at its top weight all reach the goal's reps
(`coachAllSets`, one step up; D6), and the same check runs before "repeat it before adding"; anything
less from one session stays silent, and bodyweight with nothing added gets no call. `recapFor` returns
`next`, the coach's call for next time judged as of the workout's end (the first increase in the order
trained, never a hold or a "first time" line), and the recap shows it under NEXT TIME. It is not on the share card.
H3 moved 0 → 2 for the first-timer.

**The latest set keeps its UNDO and + (R686).** R684's tail-reveal held only for some set counts:
after 3 sets the chips wrapped away from their buttons, and after 4 Chrome's scroll anchoring moved
the list up past them. Each chip now sits in a slot keyed by its set, and the last slot also holds
UNDO and +, so the wrap never splits them; the list turns off `overflow-anchor`, and
`revealCurrent` reads the scroller's live `scrollTop` on web. `tools/playtests/latest-set-sweep.mjs`
checks 1–7 sets live (needs the dev server).

**PT1's layout defects (R684).** THIS WORKOUT is a ~52px window at 375×812, shorter than one lift's
block, so `revealOffset` now shows a tall block's TAIL (the latest set, its UNDO and +) instead of
its head, which had left the + half under CLEAR / FINISH. The line under the lift name is a
one-row (`LAST_TIME_LINE`, 20px) wrapping View: the goal fits beside the numbers or drops whole
onto a clipped second row, never "30 to 2…". PT1's "dead" half-visible rail chips were the
harness: `playtest.mjs` tapped an element's geometric centre even when it was clipped, and now
taps the middle of the part a finger can see (and refuses a sliver under 20pt).

**Search on the add path (R683).** Typing in the picker's "+ Something else" lists up to five
movements from the whole library and the lifter's own, under MATCHES, just above the field; a tap
picks one. `find-exercise.ts` matches by name, then an alias ("RDL", "OHP", "skullcrusher"),
then a prefix, the start of each word, and last a substring, with plurals, hyphens and
"dumbbell"/"DB" folded together, in other scripts too. ADD picks an existing movement instead of making
a duplicate: the name exactly as typed first, then any spelling of a name, then an alias. An alias
names ONE movement only: "shoulder press" and "flyes" are not one.

**The coach's call holds, and says when it is made (R682).** `coachSuggestion` takes `live`, the
session the call is for, and never reads that session's sets, so a set that makes "try 210" no
longer turns it into "try 215" (PT1 Broken 1). Every call but a deload carries `reps`, and
`callMade` finds the first set that did what it asked: at the weight or above for an increase,
only at the weight for a hold. The two weeks count back from the session's start, so a weekly
lifter's call cannot slide out of the window mid-lift. The line then reads "210×5 — made it" in
volt for the rest of that lift's workout, and LOG SET plays the success haptic for that one set.

**A lift opens its own history (R680).** Tapping a Progress row opens `LiftSheet`, a sheet rather
than a seventh screen. It shows the best set for each rep count and the last 12 workouts, each by
the top set its recap names, with a ★ where that recap awarded a record. `liftHistory`
(`src/ui/lift-history.ts`) builds it from `bestSetAtReps`, `topSetPerExercise` and `findPRs`, so
the sheet and the recap cannot disagree. The inventory counts `LIFT_INSIGHTS`.

**The share message carries a link.** `src/domain/share-url.ts` packs the recap into a URL
fragment — never transmitted — that `link/dist` re-renders client-side. The wire format has two
implementations, so `share-url.test.ts` encodes with the app's and decodes with the landing
page's own file. `link/dist` is a build artifact: run `node link/build.cjs` after touching
`spike/recap.js`, and a test fails if it is stale.

**The shared card was broken for anyone without a PR** — the renderer read `D.pr.weight`
unguarded, and §8 forbids a PR in an exercise's first three sessions, so every first workout
threw and the link came up blank. The claim slot now takes record → first-session baseline →
standing goal → nothing.

**The screen stays awake during a workout**, released on FINISH. `expo-keep-awake` had been
declared and unused since the start.

### Two traps this loop re-learned

7. **The Bash heredoc eats backslashes.** A doubled `\\s` reaches disk as a single `\s`, and a
   doubled `\\b` can land as a literal 0x08 BACKSPACE byte — silently turning a source-reading
   regex into one that can never match. (This very line was written through a heredoc first and
   came out saying "`\s` reaches disk as `\s`", which is the trap demonstrating itself.)
   The failure reads as "the style was removed", never "your test is broken". Use the Write
   tool for anything containing a backslash, and `cat -A` the file when an assertion fails on
   input that looks correct.
   BROADENED R536: the heredoc is one door of at least THREE, and naming only that one makes a
   session feel safe the moment it switches to python or writes the regex in JS. Hit six times
   in R500-R535 by three distinct mechanisms.
   (a) The Bash heredoc, as above.
   (b) A JavaScript TEMPLATE LITERAL, which eats them before the RegExp constructor ever sees
   them: a template literal holding a single-backslash dot and word-boundary compiles to a
   pattern whose final character is codepoint 8 — a real BACKSPACE — so it matches nothing,
   while the DOUBLED forms give the intended byte sequence 92 46 ... 92 98. Measured both ways
   in R536. This is what produced R526's guard, which passed while structurally incapable of
   failing.
   (c) A doubled carriage-return escape arriving as an actual CR inside a regex literal, which
   at least fails loudly — "Unterminated regexp literal" (R534).
   THIS ENTRY IS DELIBERATELY WRITTEN WITHOUT LITERAL ESCAPES. The first version was composed
   through a heredoc and every example in it was eaten: the word-boundary vanished, the doubled
   forms collapsed to single ones, and the carriage-return escape became nothing at all. An
   entry about backslashes being eaten cannot survive being written through the thing that eats
   them, so it names them in words and leaves the runnable proof in R536's log.
   THE DEFENCE THAT ACTUALLY WORKS is not to escape more carefully but to REMOVE A LAYER: build
   the string with `chr(92)`, or write the file with the Write tool, or edit the single line
   with Edit. Every attempt to out-escape these has eventually failed; every removal of a layer
   has worked first time. Demonstrating (b) needed exactly that — the `node -e` version of the
   demonstration was itself mangled by Bash, which is the trap appearing inside its own proof.
8. **Check `innerWidth` before believing any geometry.** A preview tab opened in the background
   can render at **0×0**: the DOM is complete and every text assertion passes, while every
   `getBoundingClientRect` is zero and `elementFromPoint` finds nothing — so a working screen
   reads as "no element is tappable". Resize the tab to a preset first, and treat
   `innerWidth === 0` as "this measurement is void", not as a finding.
9. **A DOM measurement rig lies in two more directions.** `offsetParent === null` is the cheap way to
   skip screens the navigator has `display:none`d — without it you read the screen you just left.
   And "leaf" must mean *no text-bearing children*, not *no element children*: a bare text node
   beside a `<span>` is invisible to the naive version, which made a goal card look like it had
   lost its target weight when it renders perfectly.

### R74–R88 — what the second half of the loop changed

**The shared card was the fragile surface, and it is now swept.** Canvas has no
layout engine: every string is placed at an absolute coordinate, so anything too
long draws over its neighbour. A typed-in exercise name, the title, the goal line
and a seven-figure volume each escaped the safe box — the box a Story covers with
its own caption UI. All four measure and trim now, and `share-card.test.ts`
sweeps ten cases so the next value added to the card is caught by a test that
already exists. Remember that everything on that card arrives from a URL
fragment: "a user would never type that" is not a property of the input.

**`allSets` is memoised on the Repo.** It is the hot read — `NowModel.state()`
calls it five times and runs on every tap — and it scaled with total history:
45.6ms per tap at five years of training. Now 2.5ms. Invalidated by every write;
the array is frozen because callers sort what they are handed.

**Progress cuts by TIME, not rank.** The old top-8-by-score hid Bench Press
behind whichever day was trained most recently, so a lifter's main lift appeared
on some days of the week and not others. A dead lift is one you stopped doing.

**Accessibility exists now.** Every control has a role and a name; LOG SET was
an unlabelled `generic`.

**Export and restore work on web** — `expo-file-system` is native-only and both
threw. §11 makes that file the user's only backup.

**`tools/seed-history.ts`** builds a real history (progress / stall / year-two)
and prints the base64 SQLite blob the web build stores. Two of BUILD_LOOP's seven
journeys cannot be reached without it.

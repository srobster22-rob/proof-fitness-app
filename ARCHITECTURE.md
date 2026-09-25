# PROOF — architecture

The map of the code: find the module before you open a file, and never read a whole monolith.
Sizes are line counts; `node tools/sizes.mjs --map` (in app/) rewrites them. A test fails when a
module is missing here or its size drifts by more than 15% (or 40 lines, whichever is larger).
Any commit that adds, moves or splits a module updates this file.

## Shape

Expo / React Native, iOS-first, local-first SQLite, no account and no network. Every rule lives
in a pure module that runs under `node --test` with no simulator: `src/domain/` (the rules) and
`src/ui/*-model.ts` (each screen as state). The `.tsx` files render and forward taps. `repo.ts`
is the only way to storage. `app/` holds the expo-router routes, one file per screen.

## One request: LOG SET

1. `NowScreen.tsx`: LOG SET calls `log` (`useSetEntry`, `now-hooks.ts`): `model.log()`, then a re-render from `model.state()`.
2. `NowModel.log()` (`now-model.ts`) builds the `LoggedSet` from the dial and calls `repo.logSet()`.
3. `Repo.logSet()` (`repo.ts`) writes through the `Db` interface: `expo-db.ts` natively, `web-db.ts` on web.
4. `NowModel.state()` recomputes the screen: its `coachCall()` asks `coachSuggestion` (`coach.ts`) for the line,
   `lastTimeParts` (`now-line.ts`) words it and `callMade` says "made it", `prefillFor` (`coldstart.ts`) and the call set the dial, `rail-order.ts`
   and `split.ts` for the rail, `rest.ts` for the timer, `goals.ts` for the goal tail.
5. FINISH: `NowModel.finish()` ends the session; `app/recap.tsx` renders `recapFor()` (`recap-model.ts`),
   which runs `buildRecap` (`session.ts`), `findPRs` (`pr.ts`) and `nextCalls` (the coach again).

## Registries (content is data)

| content | lives in |
|---|---|
| exercises | `EXERCISES` in `exercises.ts`, one entry per movement; `BUILTIN` and its tiers (`coldstart.ts`), `MUSCLES` (`muscles.ts`), each lift's day (`split.ts`) and the aliases (`find-exercise.ts`) are views of it |
| split plans | `SPLIT_PLANS`, `SPLIT_DAYS` in `split.ts` |
| strings | the `EN` and `ES` tables in `i18n.ts`, read through `t(lang, key)` |
| coach situations | the `coach*` keys `coach.ts` returns, worded in `i18n.ts` |
| equipment | `EQUIPMENT` in `types.ts`, empty-implement floors `EQUIPMENT_BASE` in `coldstart.ts` |
| measurement kinds | `KINDS` in `measure.ts` |
| lift insights | `LIFT_INSIGHTS` in `lift-history.ts` |
| type scale, spacing | `TYPE`, `SPACING` in `type.ts` |

## The check command

`npm run check` (in app/) runs every SHIP gate in order: dependencies, the domain bundle, the
tests, types, bundle matches source, MARKET.md current, CONTENT.md current, link page current. It ends
with a summary naming each failing gate, its first failing assertion and file:line, and exits
1 on any failure; a run of zero tests, a hung gate (each has a timeout) or a test file that dies while
loading all fail, the last with the error its child printed. It reports the domain snapshot hash and
the size headline, and with `npm run web` up it runs the UI trace as a smoke test that fails on any recorded error.
Full outputs: `app/out/check-<gate>.txt`; the summary: `app/out/check-summary.txt`.

## Finding an error

- **A failing test:** `app/test-failures.log` (written by `tools/failure-log.mjs`) keeps every
  failure with its stack, whatever happened to stdout. The check prints the first one.
- **A behaviour change you did not mean:** `node tools/snapshot.ts --out a.json` before and after, then diff;
  the per-section hashes say which part moved. It covers every `.ts` module node can import (a test fails if
  any of their functions, callbacks included, never runs), NOT the `.tsx` screens: for those, compare two runs of
  `node tools/playtests/ui-trace.mjs`, every element, box and style through the Now screen and its sheets.
- **In the running app:** `npm run web` serves port 8099 and writes the sample to `public/seed.b64`, which
  loads into localStorage `proof.db.v1` (the snapshot builds the same shape in memory on a fixed clock,
  `T0`, 23 Sep 2026). `tools/playtest.mjs` drives it at phone size (real taps, `offsetDays`, screenshots);
  the scripts in `tools/playtests/` reproduce past bugs and exit 1 if one is back.
- **The database failed to open:** `RepoGate.tsx` shows why, from `dbDiagnostic()` in `db.ts`.
- **A crash while rendering:** each route exports its own boundary (`ScreenErrorBoundary.tsx`), which shows
  the screen's name and the message and records it in `error-log.ts`; what no boundary sees (a handler, a
  promise) is recorded as "app". Playtests read the log through the harness's `errors()` and fail on any
  entry; with `npm run web` up, the check's smoke line does too. In the dev preview Metro's overlay shows
  first (HANDOFF trap 18).

## Known traps (HANDOFF.md "Traps" has all twenty, with the history)

- A `LoggedSet` carries no unit: convert through `historyInSessionUnit()` before comparing (trap 9).
- `node --test` runs files concurrently: a test that writes a shared file must use its own path (trap 19).
- A spawned `node --test` inside a test inherits `NODE_TEST_CONTEXT` and its reporters never run: delete it.
- `package.json` must not say `"type": "module"`: Metro and the Expo config are CommonJS.
- The harness's `close()` must let Chrome exit, or localStorage writes are lost.
- `orphan-scan` counts `tools/` as a caller: a tool importing an orphan hides it.
- Stop `npm run web` before creating a source file: the server writes it into the tracked `app/.expo/types/router.d.ts`
  as a route (`/../src/...`) until it restarts. Undo: `git show HEAD:app/.expo/types/router.d.ts > app/.expo/types/router.d.ts`.
- A hidden browser pane fires no animation frames and no focus events (traps 17, 20).

## Modules

### Routes (`app/`)

| module | lines | owns |
|---|---:|---|
| `app/goals.tsx` | 1,134 | Goals: the list, filters, the add and edit sheets. |
| `app/progress.tsx` | 786 | Progress, and the export, restore and erase controls. |
| `app/measure.tsx` | 674 | Measurements: kinds, readings, goals. |
| `app/recap.tsx` | 519 | The recap card, SHARE, NEXT TIME. |
| `app/settings.tsx` | 373 | Units, training goal, split, language. |
| `app/index.tsx` | 53 | The entry point, which is the Now screen. |
| `app/+not-found.tsx` | 52 | A share link to a route this build lacks. |
| `app/_layout.tsx` | 45 | The root stack, and expo-router's error boundary. |

### Screens, models and UI helpers (`src/ui/`)

| module | lines | owns |
|---|---:|---|
| `src/ui/now-model.ts` | 1,439 | The Now screen as a state machine (`NowModel`): the dial, LOG SET, undo, the day and the lift rail, the plan. |
| `src/ui/progress-model.ts` | 947 | Progress rows and sparklines, recent workouts, the weekly line, erase counts. |
| `src/ui/now-styles.ts` | 496 | The Now screen's stylesheet, shared by the screen and its sheets. |
| `src/ui/NowScreen.tsx` | 479 | The Now screen: holds its state, calls its hooks, lays out its sections and opens its sheets. |
| `src/ui/recap-model.ts` | 478 | A stored session as the recap: totals, records, NEXT TIME calls, share text. |
| `src/ui/now-layout.ts` | 441 | The Now screen's layout arithmetic: the hero's size for a phone, the column's height, the rail's geometry, scroll-to-reveal. |
| `src/ui/now-hooks.ts` | 372 | The Now screen's behaviour that is not drawing: awake while working, the swipe, TODAY's reveal, LOG SET and the steppers, the rest tick, resuming. |
| `src/ui/goals-model.ts` | 336 | The Goals screen: drafts, horizons, create, edit, remove. |
| `src/ui/measure-model.ts` | 303 | The Measurements screen: rows, trends, saving a reading. |
| `src/ui/ExercisePicker.tsx` | 263 | The exercise picker sheet: today's lifts, the rest by day, search. |
| `src/ui/press-style.ts` | 248 | Press feedback styles, pure. |
| `src/ui/EquipmentSheet.tsx` | 195 | The equipment sheet: barbell, dumbbell, machine (and which one), bodyweight. |
| `src/ui/ScreenModal.tsx` | 195 | A modal that leaves with its screen. |
| `src/ui/LogRows.tsx` | 178 | The log panel's rows: the weight (steppers, the typed field, plate jumps) and the reps. |
| `src/ui/RepoGate.tsx` | 176 | Waits for the database to open, and says why it failed. |
| `src/ui/now-state.ts` | 166 | The types of what the Now screen renders: `NowState`, `RailLift`, `SessionLift`. |
| `src/ui/ConfirmSheet.tsx` | 161 | A confirmation the user has to mean. |
| `src/ui/now-line.ts` | 159 | The line under the lift: last time, the coach's call, "made it", the goal's tail. |
| `src/ui/TodaySets.tsx` | 159 | THIS WORKOUT: each lift's set chips (tap one to edit it), with UNDO and + by the latest. |
| `src/ui/DayRail.tsx` | 147 | The day rail: the day's lifts as chips; tap one to train it. |
| `src/ui/lift-history.ts` | 147 | One lift's history sheet: rep bests, the last 12 sessions. |
| `src/ui/DayChooser.tsx` | 143 | The day chooser: the split, and today's day. |
| `src/ui/EditSetSheet.tsx` | 141 | The sheet that edits a logged set, or adds one. |
| `src/ui/NowHeader.tsx` | 130 | The Now screen's header: the lift (opens the picker), the streak, last time's line, the equipment tag. |
| `src/ui/backup.ts` | 124 | The native half of export and restore: files and the share sheet. |
| `src/ui/goal-filters.ts` | 120 | Filtering and sorting goals. |
| `src/ui/now-steppers.ts` | 113 | The Now screen's steppers: weight and rep steps, the plates and custom jumps, a typed weight. |
| `src/ui/LiftSheet.tsx` | 109 | Draws one lift's history sheet. |
| `src/ui/NowControls.tsx` | 102 | The Now screen's small controls: a jump button, a column wrapper, a stepper. |
| `src/ui/now-kit.ts` | 92 | What the Now screen's parts share: strings, colours, measures, the haptic on a logged set, and `NowSection`, what each section is drawn from. |
| `src/ui/drag-scroll.ts` | 89 | Mouse drag for horizontal rows on web. |
| `src/ui/Spark.tsx` | 83 | Draws a sparkline. |
| `src/ui/backup-model.ts` | 82 | Export and restore, as the screen sees them. |
| `src/ui/guarded-push.ts` | 75 | Navigation a double tap cannot fire twice. |
| `src/ui/rail-order.ts` | 73 | The order of the Now screen's day rail. |
| `src/ui/TabBar.tsx` | 71 | The bottom tab bar. |
| `src/ui/type.ts` | 66 | The type scale and spacing. |
| `src/ui/error-log.ts` | 65 | Every error caught, with its screen: a ring of the last 50, the console, and a dev-only read hook for playtests. |
| `src/ui/NowFooter.tsx` | 63 | CLEAR and FINISH. |
| `src/ui/Arrive.tsx` | 62 | The arrival animation of a new set chip. |
| `src/ui/ScreenErrorBoundary.tsx` | 48 | Each route's error boundary: the screen that broke says so, and the error is recorded with its name. |
| `src/ui/target.ts` | 47 | The minimum tap-target size. |
| `src/ui/haptics.ts` | 43 | Haptics, named by event. |
| `src/ui/tab-bar.ts` | 42 | Tab routes. |
| `src/ui/BottomSheet.tsx` | 39 | The bottom sheet. |
| `src/ui/column.ts` | 39 | The phone-width column every screen sits in. |
| `src/ui/press.ts` | 39 | The reduced-motion hook press feedback reads. |
| `src/ui/training-goal.ts` | 39 | The TRAINING GOAL preference. |
| `src/ui/spark-geom.ts` | 35 | Sparkline geometry. |
| `src/ui/display-unit.ts` | 32 | The UNITS preference. |
| `src/ui/failure-look.ts` | 28 | The one face of a failure, shared by RepoGate and every error boundary. |
| `src/ui/locale.ts` | 28 | The device locale. |
| `src/ui/dates.ts` | 21 | Short dates ("Sep 14"). |

### Domain rules (`src/domain/`)

| module | lines | owns |
|---|---:|---|
| `src/domain/i18n.ts` | 1,304 | Every visible string (en, es) behind `t()` and `fill()`; number and date locale. |
| `src/domain/session.ts` | 702 | Session lifecycle (idle end, stale) and the recap payload (`buildRecap`). |
| `src/domain/coach.ts` | 614 | The coach's call for a lift (raise, hold, deload) from two weeks of history; when a call is made. |
| `src/domain/goals.ts` | 426 | Lift goals: progress, ranking, the lines they print, validation. |
| `src/domain/coldstart.ts` | 343 | First-time starting weights, the prefill, the picker list, unit inference; `BUILTIN` and its tiers as views of `exercises.ts`. |
| `src/domain/measure.ts` | 321 | Measurement kinds, units, conversion, readings. |
| `src/domain/split.ts` | 300 | Split plans (PPL, upper/lower, full body), each lift's day (from `exercises.ts`), the day's plan. |
| `src/domain/pr.ts` | 294 | Personal records that never cry wolf: rep bests, e1RM, heaviest. |
| `src/domain/muscles.ts` | 264 | What each movement trains (`MUSCLES`, a view of `exercises.ts`), overlap, what to train next. |
| `src/domain/predict.ts` | 257 | Ranks which lift comes next from recency and weekday. |
| `src/domain/measure-goal.ts` | 244 | Goals about the lifter (bodyweight, height): direction, validation. |
| `src/domain/exercises.ts` | 237 | The exercise library: one entry per movement with its seed, day, muscles and aliases (`EXERCISES`). |
| `src/domain/share-url.ts` | 188 | Packs a finished workout into a share link. |
| `src/domain/weekly.ts` | 169 | The weekly comparison line. |
| `src/domain/types.ts` | 147 | Core types: `LoggedSet`, `Session`, `Exercise`, `Unit`, `Equipment`. |
| `src/domain/find-exercise.ts` | 113 | Finds a movement by typed name, alias (from `exercises.ts`) or plural. |
| `src/domain/rest.ts` | 51 | Rest-timer state and formatting. |

### Storage (`src/data/`)

| module | lines | owns |
|---|---:|---|
| `src/data/repo.ts` | 795 | The only persistence API: sessions, sets, exercises, goals, measurements, prefs. Takes a two-method `Db`; imports no driver. |
| `src/data/portable.ts` | 381 | Export to one JSON file, and validated restore from one. |
| `src/data/db-location.ts` | 287 | Where the database file lives (the app-group container the Live Activity needs) and how it moves there. |
| `src/data/schema.ts` | 210 | The SQLite schema and its numbered migrations. |
| `src/data/db.ts` | 157 | Opens the database once per launch (native expo-sqlite, or sql.js on web); `repoStatus`, `dbDiagnostic` say why it failed. |
| `src/data/web-db.ts` | 112 | Dev-only browser `Db` on sql.js, kept in localStorage `proof.db.v1`. |
| `src/data/expo-db.ts` | 85 | Adapts expo-sqlite to the `Db` interface. |
| `src/data/open-once.ts` | 55 | A synchronous open-once helper `db.ts` never adopted (debt). |

Outside `app/src` and `app/app`: `app/tools/` (check, snapshot, sizes, inventory, market, seeds, harness),
`app/test/` (one file per behaviour), `link/` (the share-link page), `harness/` (clip proof), `spike/` (video spike).

## Organization debt

- **Functions over 150 lines (11):** `NowScreen` 445, `coachSuggestion` 375, `AddGoal` 369, `Goals` 333, `Recap` 333, `Settings` 250, `ExercisePicker` 247, `Progress` 236, `NowModel.state` 220, `buildRecap` 185, `EquipmentSheet` 157.
- **Tests that read source text:** about 130 of 210 test files read a source file, directly or through
  `test/helpers/source.ts`; gates should read what modules export (AGENT_LOOP §3a item 8).
- **Round-history comments:** about 277 comment lines name rounds (R548…); that history lives in LOOP_LOG.
- **Counted by regex:** `tools/inventory.ts` counts coach situations and insights by reading source text.
- **Dead or unadopted code:** `open-once.ts` (never adopted), `Repo.lastSetOf` and its index,
  `goalE1rmGap` (the orphan-scan list), and one-off seed tools (`tools/seed-*565/540/549/541/556/548/539/r573.ts`).

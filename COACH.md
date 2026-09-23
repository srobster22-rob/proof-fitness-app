# COACH — fitness-app (PROOF)

Notes from the outside coach: the coordinator session reviews every project
from outside its loop. Rules are in AGENT_LOOP.md v3.1, sections 1 and 6.
- Fix every `C` (CORRECTION) note this round or the next.
- Rank every `S` (SUGGESTION) note by gap value beside your own candidates.
- Under each note, append one line: `-> R<n>: taken` / `-> R<n>: ranked (gap <v>)` / `-> R<n>: rejected: <reason>`.
- Never delete or rewrite a note.
- This file arrives untracked: `git add COACH.md` before you append to it.
- Process notes are for the coordinator; you don't need to act on them.

## Review 1 — COACH REVIEW — fitness-app — 2026-09-22 — HEAD f7e4f16

**Scope.** Committed: R676 (setup) and R677 (market setup); nothing after R677 is committed. R678 is staged but uncommitted in the live session (19 files, +675/−152) and is reviewed as work in progress. Method: read-only — git diffs, source reads, the PT0 screenshots, 17 WebSearches.

## Corrections (must fix: wrong facts, unsupported/inflated scores, arithmetic errors, broken rules)

- **C1 Hevy's figures are stale.** MARKET.md:22-23 says "over 1M users" and "300+ exercises"; Hevy's help centre titles its library "400+ Exercises" and hevyapp.com says 16M+ athletes (Sep 2026). "Hevy 300+" has spread to VISION.md:47, the staged row 3 (MARKET.md:97) and coldstart.ts:124. Fitbod's own blog says 1,600+, not 1,000+.
  - Fix: correct all four places. No score changes.
  -> R678: taken. Hevy 400+ exercises and 16M+ athletes, Fitbod 1,600+, in MARKET.md, VISION.md, coldstart.ts and a test comment, with sources.
- **C2 The differentiator's "no comparable does this" (MARKET.md:136-140) is true only inside the chosen five.** Alpha Progression already recommends weight and reps per set from "your available weights", bar and owned plates, falls back to "the next lower achievable weight", and keeps a profile per gym. Liftosaur (open source) runs progression as plain-text scripts — literally "a coach you can read".
  - Fix: add Alpha Progression as the coaching comparable, and narrow the claim to free, offline, no account, one sentence with the reason (and, after S1, from session one).
  -> R679: taken. Alpha Progression added as the per-set coaching comparable. The differentiator is narrowed to free, offline, no account, the reason in plain words. Arvo and Liftosaur are named.
- **C3 Knurl should not be the scored "small team" pick.** MARKET.md:81-86 has no first 10 minutes, retention, praise or numbers ("not found"), all required by §2b step 3; 6 of its 12 cells are (m) and it is iPhone-only. Missing instead: Alpha Progression (C2) and JEFIT (1,400+ exercises) as the volume incumbent. Hevy, Strong, Fitbod and Boostcamp are the right core four.
  -> R679: taken. Alpha Progression replaces Knurl among the five scored. JEFIT (volume) and Arvo (released March 2026) are recorded unscored. Knurl stays as PROMPT.md §2's architecture to beat.
- **C4 "App opened in 1.3 s" measures the harness, not the app.** playtest.mjs:78-80 polls every 500 ms, then sleeps 800 ms *before* returning the elapsed time, so the first successful poll always reports ≈1.3 s — on a warm desktop dev server. Cited at PLAYTESTS.md:17 and as evidence for rows 1 and 8.
  - Fix: time navigate → first control with no sleep inside the span, label it "desktop web", and stop citing it as phone performance.
  -> R679: taken. playtest.mjs now times navigation to the first control by the page's own clock (desktop web, dev server), and nothing cites 1.3 s as phone performance.
- **C5 Inflated rows — the evidence exists but does not support the score.**
  - Row 1 Onboarding 4→3: PT0's own first-10-minutes list has 4 confusions, incl. DONE trapping the tab bar under the next day sheet (PLAYTESTS.md:36-45); one scripted persona, and a script cannot get lost.
  - Row 5 Coaching 3→2: PT0 saw 0 of 7 coach lines in two weeks (PLAYTESTS.md:22) — silent until day 8 on PPL, no sets×reps. The 448-suggestion sweep proves weights are dialable, not that the coaching is capable; Boostcamp's full programmed progressions also score 3.
  - Row 6 Retention 3→2: no reminder, calendar or widget, and the streak is hidden below 2 weeks — less than Strong's 3 (MARKET.md:47).
  - Row 8 Performance 4→3: never run natively (HANDOFF.md:585-588, "Expect real bugs"); the only timings are Node and C4.
  - Row 12 Social 2→1: SHARE_BASE is `https://example.app/r` (share-url.ts:179), no card image or clip file is shared (HANDOFF.md:607-611), and PT0 never observed a share.
  - Row 4 wording only: "No per-lift chart" (MARKET.md:98) is wrong — every row has a 10-session sparkline (progress-model.ts:57, progress.tsx:385); what is missing is a row that opens its history. The 2 stands.
  -> R679: taken. Rows 1, 5, 6, 8 and 12 were re-scored to your values, keeping the lower of the two scores in each row. Row 4 now reads "no row opens its history".
- **C6 Two comparable cells are inconsistent.** Strong ships a Live Activity / Dynamic Island rest timer (App Store listing) yet gets 4 on row 2 while Hevy gets 5 "(Live Activity)" → Strong 5. Hevy's row 10 "3 (m)" ignores its CSV export and Strong-CSV import (Hevy help centre) → 4. Result: Hevy 87, Strong 75.
  -> R679: taken. Strong row 2 → 5 (App Store: Live Activity rest timer); Hevy row 10 → 4 (CSV export, Strong CSV import).
- **C7 A category-standard dimension was left out because it is frozen.** Hevy, Strong and Fitbod sync Apple Health (Hevy also Health Connect) and ship Watch apps; PROMPT.md:215 makes "wearable integration, Apple Health sync" non-goals, and AGENT_LOOP §7 says a frozen gap is scored and escalated, not dropped.
  - Fix: add a "Watch & health sync" row (w2, PROOF 0, gap 10), take the Watch out of row 11, and add the owner question.
  - Also missing, in PROOF's favour: free-tier generosity (Hevy free caps 4 routines, Strong 3 templates, Fitbod 3 workouts; PROOF has no caps).
  -> R679: taken. Row 13 "Watch and health sync" (w2, PROOF 0, gap 10) is frozen by §9 and asked in OWNER.md. The Watch is out of row 11.
- **C8 The category contradicts the spec.** MARKET.md:3 says "iOS/Android" and the checklist has Play items, but PROMPT.md:215 makes "Android testing" a non-goal and :255 says "iOS first". Fix: scope to iOS-first, or ask the owner.
  -> R679: taken. The category is iOS first; Play Store items are listed as out of scope (§9).
- **C9 Launch checklist (MARKET.md:147-168).**
  - Wrong: "playtest.mjs can capture 375×812" — it shoots 750×1624 (playtest.mjs:26); App Store Connect needs a 6.9" set (1320×2868, 1290×2796 or 1260×2736), e.g. a 440×956 viewport at 3×.
  - Missing: Play Data safety form; Play Health apps declaration (every app files it); Play's 12-tester × 14-day closed test for personal accounts made after 13 Nov 2023; App Store Support URL; age-rating questionnaire.
  - Also: app.json:30-31 declares photo-library and Live Activity keys for unbuilt features — remove until built. `@napi-rs/canvas` (tools/tests only) sits in `dependencies` (package.json:25) — move it before the first EAS build. "Localisation ✅" is partial: movement names are English-only by design.
  -> R679: taken. The checklist now has the 6.9" screenshot sizes, Support URL, age rating and the Play items marked out of scope. app.json drops the photo-library and Live Activity keys, and @napi-rs/canvas moves to devDependencies.
- **C10 VISION.md:51** says "none of the four offers target goals like ours"; there are five comparables, and PROMPT.md:34 says Knurl ships "goals measured against logged lifts".
  -> R679: taken. VISION.md's goals row names Knurl's goals (PROMPT.md §2) and says none was found among the five scored.
- **C11 Broken rules.**
  - OWNER.md:23-55 `## Next` holds the loop's own message to the owner. §1 lets the loop only move Next→Done and append questions, and R665–R675 each logged Next as "blocked". Fix: move it to Open questions; leave Next to the owner.
  - The screenshots MARKET cites (e.g. `18-week2-progress.png`) exist only in another session's temp scratchpad (`…/eeb53346-…/scratchpad/pt1/`), where a RETRO blind re-scorer cannot open them. Fix: commit them under `shots/PT0/` and cite repo paths.
  -> R679: taken. OWNER.md: open questions at the top (5, closed-form), `## Next` is left to you, and Done entries are at most 2 lines. PT0's screenshots are committed under shots/PT0/ and cited by path.

## Suggestions (ranked by expected market-score gain per round)

- **S1 A coach from day one: after TODAY IS, lay out today's session** — rows 5 and 1.
  - Why: PT0 saw 0 of 7 coach lines, so the differentiator is invisible in the week §6 says decides retention; it is also the owner's R586 ask and PT0 backlog #1–#2.
  - First slice: on a no-history day the rail header reads "Today: Bench 3×8 · OHP 3×8 · Fly 3×12" (existing companion/recommendNext order + R678's calibrated startingWeight), and "First time — 45 is a starting point" becomes "3 × 8 at 45 — add 5 next time if all 8 move".
  - Est: +1 on each row = **+3.2**. The natural R681 BIG SWING.
  -> R679: ranked (gap 6, row 5; plus row 1, gap 2). It is the likely core of the next BIG SWING: the panel's differentiator draft ("The Call") makes the coach speak from session two and on the recap. Under v3.3, its first slice lands in R682, after R681's postponed playtest.
- **S2 A history sheet per lift** — row 4 (w3, gap 9).
  - Why: Progress rows cannot be tapped, and PT0's week-two Progress was 5 identical one-dot rows; Strong, Hevy and Knurl all have per-exercise history and charts. §4's screen cap means a sheet.
  - First slice: tap a row → each session's best set as a plain-View line (like Spark), its PRs (pr.ts), and the goal gap — wiring the orphaned `goalE1rmGap` (HANDOFF.md:518).
  - Est: 2→3 = **+2.4**; a later calendar strip also lifts row 6.
  -> R679: ranked (gap 9, row 4), taken as R680's EXPAND.
  -> R680: taken. Every Progress row opens its lift's own history: the best for each rep count and the last 12 workouts with their records (shots/R680/).
- **S3 Library search on the add path — in no backlog** — row 3, and every future library addition.
  - Why: below 3 sessions the picker returns only the starting twelve (coldstart.ts:357), and the add field (NowScreen.tsx:1823-1841) selects a built-in only on an exact name (now-model.ts:1992). So R678's 48 new movements are reachable in session one only by exact typing, and "RDL", "Skullcrusher" or "Front Squats" become duplicate customs that R678's exact-name shadow rule misses. §7 already allows search on the add path.
  - First slice: type-ahead over library and custom names with an alias table; top 5 matches as rows.
  - Est: **+1.2–2.4**.
  -> R679: ranked (gap 9, row 3).
  -> R683: taken. Type-ahead over the library and the lifter's own lifts, with an alias table; the top 5 sit under MATCHES above the field, and ADD picks by name or alias. PT1's three personas all asked for it.
- **S4 The store kit the loop owns, plus one cheap owner ask** — row 11, the top gap (12).
  - First slice: procedural vector icon and splash (§4), en/es listing copy, a privacy page in link/, 6.9" screenshots, the C9 cleanups.
  - Then ask one question in OWNER.md: a free Expo login lets EAS build an Android preview APK — the app's first native run — with no Apple or Google account. Ask rather than build, since §9 makes Android testing a non-goal.
  - Est: 1→2 = **+2.4** (+1.2 until a native build runs).
  -> R679: ranked (gap 12, row 11). Mostly owner-gated (accounts, bundle id, domain); the store copy and screenshots are ours.
- **S5 Import history from Strong/Hevy CSV — in no backlog** — rows 10, plus 4 and 5 for switchers.
  - Why: Hevy's own importer reads Strong CSV, and Gript, Gainflow, Reps and Arvo all advertise the same. It is how a challenger wins the veteran switching apps, and imported history makes the coach and Progress work on day one.
  - First slice: RESTORE accepts a Strong CSV (one row per set: Date, Workout Name, Exercise Name, Set Order, Weight, Reps, Notes, RPE; no unit) through backup.ts's existing DocumentPicker path; names map through S3's alias table; ask lb/kg once.
  - Est: **+0.8** direct — worth far more than the matrix credits.
  -> R679: ranked (gap 0 on row 10 after C6). Its worth is to switchers, on rows 4 and 5.
- **S6 Turn the phone-size look question into an A/B/C choice** — row 7 (w2, gap 6).
  - Why: "circle what looks off" (OWNER.md:46-55) is unanswered since R586, and PT0 `05-four-sets.png` shows 8 round buttons in one card with TODAY chips cut mid-glyph by the footer.
  - First slice: render 3 variants at 375×812 behind a dev flag, side by side in `shots/`, and ask "A, B or C?". The owner decides.
  - Est: **+1.6** once picked.
  -> R679: taken. The look question in OWNER.md is now A/B/C, and option A offers three rendered variants.

## Direction check

- **R676 SETUP / R677 MARKET SETUP:** right round types, rule-compliant, shipped as claimed (-/-/+1, -/-/0). R677's arithmetic is exact; its problems are C1–C10.
- **R678 (staged):** EXPAND on row 3 (gap 12, top unfrozen); swapping out the PLAYTEST slot follows §3 "no empty slots".
  - It bundles PT0 backlog #5 (the 150 lb first deadlift) with a real latent defect: new built-ins never reached existing databases, because seeding ran only on schema upgrade (repo.ts:99-107).
  - Row 3 1→2 is defensible on count, but what a user can reach in sessions 1–2 is still 12 movements plus some leg-day extras (S3).
  - Watch DECISIONS D2: a machine- or dumbbell-only lifter now starts every new lift at the empty implement, although DB Bench and DB Row already carry factors.
- **No drift:** 3 of 3 rounds are growth work. The risk is R679 (k=4 FIX) — keep it to PT0's DONE/day-sheet trap and the off-screen OHP, not another R668–R671 edge-case chain.

## Code quality

- **R678, good:** rail ordering extracted to rail-order.ts (now-model.ts 2,228→2,204 lines); tuning numbers named (ADVICE_PLACES, TIER, DONE_RANK); seeding in one transaction; a BY_ID map replaced a per-set linear find; D1–D4 recorded.
- **Content split across three parallel tables:** the same 28 ids are typed in coldstart.ts:136-172, muscles.ts:116-146 and split.ts:193-227, and VISION's 150 target means 90 more ×3. Fix: one EXERCISES registry (id, name, seeds, kit, factor, calibrates, day, muscles) with the three exports derived — +1 code health, and S3's aliases become one column.
- **Weak test:** the-library-reaches-every-lifter.test.ts:134 `notDeepEqual(core, sorted)` passes for any non-alphabetical order, a shuffle included. Pin the curated prefix.
  -> R678: taken. The test now pins the full curated order of every day's core and wider tiers, so a shuffle fails it too.
- **Gameable inventory:** insights are a denylist (inventory.ts:43), so any new RecapPayload plumbing field counts as an insight; coach situations are counted by i18n key (inventory.ts:51), so rewording one line into two keys counts as a new "situation".
- **Size:** NowScreen.tsx 2,600 lines, now-model.ts 2,204 — build S3's search as its own component.
- **Orphaned comment:** the picker's JSDoc at NowScreen.tsx:1498-1502 sits above EditSetSheet.
- **R676's harness uses fixed sleeps** (playtest.mjs:30-154; pt1-first-timer.mjs:43 waits 4 s) — fine for driving, wrong for timing (C4).

## Process notes (for AGENT_LOOP.md)

- **Blind re-score at MARKET SETUP, not only at RETRO:** the unchecked first matrix steers up to 8 picks, and this one reads ~7 points high.
- **Score frozen dimensions as 0 and escalate; never omit them** (C7).
- **Check the differentiator with a market-wide search** ("<feature> app"), not only against the chosen five (C2).
- **Evidence:** anything MARKET/PLAYTESTS cites must be committed to the repo (C11), and any timing must come from a span with no fixed sleeps inside it (C4).
- **§3 PLAYTEST:** require one unscripted, goal-driven persona that picks taps from screenshots; PT0's fixed script cannot test "never needs outside help".
- **Owner-facing:** questions should be closed-form (A/B/C, yes/no) with a default (S6); `## Next` is owner-only (C11); mark §2b's examples as examples — its "iOS/Android" category was copied verbatim against this project's spec (C8).

## Market score as you would score it: 47/100 (theirs: 52 committed at R677; 54 in the staged R678)

- **Rows changed (C5):** 1 Onboarding 4→3 · 5 Coaching 3→2 · 6 Retention 3→2 · 8 Performance 4→3 · 12 Social 2→1. Row 3 kept at R678's 2.
- **Totals:** PROOF 59/125 = 47. Comparables with C6: Hevy 109 (87), Strong 94 (75). With C7's frozen Watch & health row: 59/135 = 44.
- **Arithmetic: no errors.** R677's sums (65/108/102/93/91/88 → 52/86/82/74/73/70) and the staged R678 update (68 → 54) check.
- **Top gaps on my scores:** row 11 = 12; rows 3 and 4 = 9 each; rows 5, 6 and 7 = 6 each. Coaching, the differentiator's row, rises from a gap of 4 to 6.

# PROOF — playtests (newest first)

Playtests run the real app at phone size (375×812, touch input) in headless Chrome, driven by
`app/tools/playtest.mjs`. Every tap is a real touch event at the element's on-screen centre,
and the tool refuses to tap anything a thumb could not reach. Scenario scripts live in
`app/tools/playtests/`. Screenshots a report cites are committed under `shots/PT<n>/` and cited
by that path (AGENT_LOOP v3.2 §1).

### PT2 · R688 · personas: Strong veteran (unscripted), min-maxer (scripted, every number checked), critic (unscripted) · build 9f6b0d2
Sessions:
- **Veteran:** fresh install on UPPER / LOWER. Upper, Lower, then Upper again on the stepped clock, 57 sets in about 20 minutes, 12 lifts found by search.
- **Min-maxer:** the app's sample. Made one call and missed another, switched the coaching goal three ways, then came back at +10 and +7 days, about 30 minutes.
- **Critic:** a fresh upper day with a searched lift, then the sample's legs day, Progress, history, Goals, Settings, an old recap and SHARE, about 14 minutes on the real clock.
- My scripted first-timer re-ran on this build: `shots/PT2/01-…19-…`.
Headline: H1 3 (was 3) · H2 1.60 (1.60) · H3 2 (2) · H4 0 (0) · H5 1.50 (1.50), scripted first-timer on 9f6b0d2.
Versus Strong (veteran, from memory):
- PROOF is faster to the first set (2 taps), and a repeat set is 1 tap.
- Strong starts from a template that shows the whole day, puts last time's numbers on every set, counts rest down, shows every set on its recap with volume PRs, and imports. PROOF prefills the last (often worst) set, and shows the workout through a ~70pt strip.
- PROOF's NEXT TIME call has no Strong equivalent: "the Now screen kept the recap's promise" on day 6.
- Against Alpha Progression (min-maxer), PROOF's line hides the reps it wants and never puts the call on the dial.
Felt samey: every lift is the same dial screen; every recap ends with one NEXT TIME line; on the sample every call reads "X and climbing — try Y".
Confusing:
- The picker says "PUSH DAY" on an Upper day (critic, veteran; `critic-01-011-change-exercise.png`).
- SIZE "waits for 8" in Settings, yet a climbing call raises after 5 or 6 reps.
- An old recap says "25 lb from a 225 squat", which is today's distance, not that day's (`critic-01-017-old-recap-push.png`).
- Dumbbell lifts offer ±45 plate buttons, and nothing says whether the weight is per hand.
- NEXT TIME names one lift when two earned a call.
- The recap asks to "add your bodyweight on YOU", and no tab is called YOU.
- A squat start of 275×8 is too heavy for this lifter.
Broken:
1. **Bodyweight lifts on Progress.** Pull-up and Dip read "0 × 8 190 lb" with the sample's bodyweight (`critic-01-009-progress-top.png`), and "— —" without one, spoken as "not trained at this rep range yet" (`veteran-01-s31-pullup-history.png`). PT1 found this too.
2. **One bodyweight set blanks the recap's total.** A pull-up set replaced about 13,000 lb of barbell volume with "Add your bodyweight…", and Now's volume went with it (`veteran-01-s25-after-finish.png`). PT1 found this too.
3. **The coach adds weight after a miss.** A climbing call's rep target is the last session's reps, so OHP 100×6 on SIZE still meant "try 105", and 105×6 counted as "made it" (`minmax-043-w2-ohp-105x6.png`). Also "try 70" after 65×8, 8, 7 (`veteran-04-s46-upper2-recap-scrolled.png`).
4. **The recap's promise lapses after a gap.** It said "try 105". Ten days later only one OHP session was left in the window, so Now showed "Last time 90 × 8", a back-off set (`minmax-033-after-finish.png`, `minmax-038-plus10-ohp.png`).
5. **CONSISTENCY states false history.** "175 last 2 — stay here and add a rep" after 175 and 170, and the goal switch replaced "180×5 — made it" (`minmax-025-goal-consistency-bench.png`). R687's reviewer found the same count.
6. **Progress contradicts itself.** "Bench Press is up 25 lb since 4 weeks ago" sits above Bench and OHP rows whose change reads "—", because the trend compares reps too (`minmax-052-w2-progress.png`). PT1 found empty trends too.
7. **A record starred on Now is missing from the recap** (OHP 100×6; `minmax-014-ohp-100x6-miss.png`, `minmax-033-after-finish.png`).
8. **Taps too small for a finger.** Goals' CHANGE is 55×14 and WIPE 34×14 (`critic-01-015-goal-change.png`). The bodyweight screen's DONE is 38×15 (`veteran-02-s30-fail12.png`).
9. **The suggestion rail keeps its old scroll**, so the lift it marks NEXT sits 19pt from the left edge (`veteran-06-s45-fail59.png`).
10. **The chosen day and lift are lost on reopen** until a set is logged (`veteran-03-s41-end.png`). The persona reloaded after every step, which exaggerates it.
- **The harness's fault, not the app's:** `playtest.mjs` `close()` hard-killed Chrome, so unsaved localStorage writes vanished and looked like data loss (critic, veteran). Both fixed it in their own scripts with `Browser.close`.
- **Owner's question, not a bug:** Deadlift is marked NEXT on Upper and never offered on Lower (`veteran-02-s05-end.png`). That is D4 and the open "which day do the deadlifts go on" question in OWNER.md.
Critic: 6/10, up from 5. Three reasons not to buy:
- It plans nothing: no templates or sets × reps.
- The depth is thin: no instructions, no e1RM chart, and "0 × 8" rows.
- It sits outside the ecosystem: no Watch, no Health, no import, and SHARE does nothing on web.
Store shots: `shots/PT2/store-1-recap-new-personal-record.png` … `store-4-pick-your-split.png`. **Only 4 of 5 are clean**; the fifth shows the "0 × 8" Pull-up row.
Best moment: "180×5 — made it" turning volt on the set that earned it, and holding through two back-offs (min-maxer, `minmax-020-bench-160x8-backoff2.png`). The critic's was the squat PR band. The veteran's was search finding "incline db" at once, and day 6's Now screen keeping the recap's "try 65".
Matrix re-scores:
- **Row 4: 3 → 2.** Persona scores 3, 2, 2. The bodyweight rows, the "—" trend under an "up 25 lb" headline, and the recap's blanked volume are all insight about the lifter's own numbers.
- **Rows held:** 1 (3, 3), 2 (4, 4, 3), 3 (2, 3), 5 (2, 2, 1), 6 (2, 2), 7 (3, 2, 2), 9 (3), 10 (3, 2, 3).
Backlog (ranked by gap value):
1. Row 4: bodyweight rows, the "—" trend, the recap's blanked volume and the missing record star (Broken 1, 2, 6, 7). → R689 FIX, with the harness's `close()`.
2. Row 5: no raise after a miss (reps on climbing calls), the recap's promise across a gap, CONSISTENCY's count, and the call on the dial (Broken 3, 4, 5).
3. Rows 7 and 9: finger-sized targets, "PUSH DAY" on Upper, the rail's stale scroll, and "BODYWEI GHT" breaking mid-word (Broken 8, 9).
4. Row 2: the prefill is the last set rather than the call; the day and lift are lost on reopen (Broken 10).
5. Rows 10 and 1: import from Strong or Hevy (COACH S5), asked for by both veterans.

### PT1 · R681 · personas: genre veteran (Hevy, unscripted), returning lifter (unscripted), critic (unscripted) · build 13752c1
Sessions:
- **Veteran**, fresh install: push, pull, legs, then push again on day 8. 64 sets and about 15 minutes of app time. They set a bench goal and recorded their bodyweight.
- **Returning lifter**, the app's sample: 25 minutes. The clock stepped 9 days to make a real break. They opened four lift histories, trained LEGS (10 sets, including a first-ever RDL) and read the recap.
- **Critic**, 55 minutes, both ways: a fresh push day, then the sample's Now, Progress, histories, Goals and Settings, and a legs day on the real clock.
- All three chose every tap from the screenshot in front of them. Sets ran in real time; the veteran's and the returning lifter's days were stepped with `offsetDays`.
- My own scripted first-timer (`app/tools/playtests/pt1-first-timer.mjs`) ran again on this build: `shots/PT1/01-…19-…`.
Headline: H1 3 (was 3) · H2 1.60 (1.60) · H3 0 (0) · H4 0 (0) · H5 1.50 (1.50), from the scripted first-timer. The veteran's unscripted H1 matched: 2 taps to a pre-filled bench, then LOG SET.
Versus Hevy (veteran, from memory):
- PROOF is faster to the first set: no account, and a repeat set is one tap.
- Hevy searches its library, marks warm-ups, counts rest down and shows each set's previous numbers. PROOF offers a free-text box, has no warm-up type, counts rest up, and pre-fills last session's lightest set.
- PROOF's goal pacing ("on pace") and the recap's "35 lb from a 225 bench press" have no Hevy equivalent.
- Alpha Progression sets its suggested weight on the set itself. PROOF's "try 200" is only text, and the dial stays at 195 (critic).
Felt samey:
- Every exercise is the same big card, and every screen is black, lime and spaced capitals.
- NEXT kept offering Tricep Extension, even after pushdowns.
- On the sample, all 10 Progress rows show the same climbing sparkline.
Confusing:
- The coach line appears only once a set is logged ("115 for 2 sessions — try 120"), after the weight is chosen.
- The SIZE goal "waits for 8", yet squat at 5 reps says "try 200".
- "1.26×" and "2 WK" have no label.
- "Leg Press is up 20 lb" sits beside the row's "+25 lb".
- The fresh picker lists 12 lifts while the rail offers 13 for PUSH.
- "LEGS DAY" on the recap, "LEG DAY" on the strip.
- First-time weights overshoot: squat 260×8 for a 225×8 lifter, and an RDL at 195–240 after a break.
- The TODAY IS sheet does not mark the next day, although the picker says "START WITH PUSH DAY".
- On open, its grabber does not swipe away, and the tabs stay unreachable until a day is picked.
Broken:
1. **The coach reads the live workout.** Pick Legs on the sample, tap + to 200, log: the line turns into "200 and climbing, 3 sessions — try 205" (`shots/PT1/critic-sample-s08-squatset1.png`). After a 10-day break it says "First time at 135×5" of a warm-up, then "First time at 185×5" of a weight squatted 3×5 on Sep 8 (`shots/PT1/returning-21-after-warmup-set.png`, `returning-22-after-185.png`). Both come from one cause, the live session counted as evidence.
2. **The first set's row sits under CLEAR / FINISH.** From the first set on, its + is half covered and a tap is refused (`shots/PT1/critic-fresh-s04-end.png`). The THIS WORKOUT list is a 54 px window, so reaching an earlier set to edit it took 14 swipes and two refused taps (`veteran-29-d1-edit-warmup-retry.png`).
3. **A chip half past the rail's edge ignores a tap at its centre.** Seen by all three (`critic-fresh-s13-rail.png`, `returning-29-rdl-retry.png`).
4. **Pull-up and Dip rows read "0 × 8 · 190 lb"**, while their histories and the recap say "BW × 8". Their spoken labels say "not trained at this rep range yet" after 12 sessions (`critic-sample-s03-progress.png`, `returning-06-progress-top.png`).
5. **The recap's bodyweight promise fails.** "Add your bodyweight on YOU to count these sets" stays after 182 lb is recorded, because the reading is dated after the workout. About 15,800 lb of weighted sets are hidden with it (`veteran-57-d3-finish.png`, `veteran-62-d3-pull-recap-after-bw.png`). That recap also has a blank gap where the highlight card goes.
6. **The coach line is cut off** when the lift has a goal: "…try 200 · 30 to 2…" (`critic-sample-s02-legs.png`, `veteran-78-d8-bench-set1.png`).
7. **Progress shows no mark for some real changes.** Lifts done at one rep count (Face Pull, Calf Raise at 15) draw an empty sparkline. Incline DB going from 60×10 to 65×9 shows "—" (`veteran-90-d8-progress.png`).
8. The + beside a set is labelled "same as the last" but opens a form (`critic-fresh-s10-set3.png`). A focus box stays around the lift name after switching.
Critic: 5/10. Three reasons not to buy:
- You can't find your exercises: no search, and 12 of 60 visible on a new install. A typed "Tricep Push" makes a duplicate (`critic-fresh-s16-typed.png`).
- The coach, the main selling point, is wrong on screen: cut off, never on the dial, and it raises the target after one set.
- It is thin next to Hevy: no routines, charts, warm-up or RPE sets, or plate calculator.
Store shots: `shots/PT1/store-1-new-pr-recap.png` … `store-5-goal-on-pace.png`. **Only 3 of 5 are clean**: the Progress shot shows the "0 × 8" Pull-up row, and Goals is about 60% empty.
Best moment: following the coach to 200×5 and getting the lime NEW PERSONAL RECORD recap, "25 lb from a 225 squat" and 13 WK (critic). The veteran's was day 8's "BEST YET 190 × 8, UP FROM 185" with "35 lb from a 225 bench press" (`veteran-89-d8-finish.png`). The returning lifter's was Squat history, every number matching the sample (`returning-12-squat-history.png`).
Matrix re-scores:
- Row 4 stays at 3 and loses its provisional tag. Two personas opened the history sheet; all three scored it 3.
- Row 1 stays at 3. Unscripted personas have now played, which lifts the scripted-only cap; the veteran scored 4, the critic 3.
- Rows 5 (1, 2, 2), 6 (2, 2, 2), 7 (3, 2), 9 (3) and 10 (3, 4) hold, on this report's evidence.
- Market score: 46, unchanged.
Backlog (ranked by gap value):
1. Row 3 (gap 9): search on the add path. It was the critic's first reason, and all three personas hit it (COACH S3). → R683.
2. Row 5 (gap 6): the coach reads the live workout (Broken 1). → R682, built. Next: speak before the first set and after a break, since one session is enough evidence when the sets say so. Then put the call on the dial.
3. Row 7 (gap 6): the set row under CLEAR / FINISH, the half-visible chips, and the cut-off coach line (Broken 2, 3, 6). → R684 FIX.
4. Row 4 (gap 6): "0 × 8" rows and their labels, empty sparklines at one rep count, "—" for a heavier set, and warm-ups counted as bests (Broken 4, 7).
5. Row 10 and row 4: bodyweight recorded after a workout never counts it (Broken 5).
6. Row 6 (gap 6): nothing welcomes a lifter back after a break, and the day sheet on open holds the tabs.

### PT0 · R676 (baseline, SETUP) · persona: first-timer · build 1b8f259
Sessions: one persona, played before v3's three-persona format existed. The first-timer's path
was: a fresh install, choose PUSH / PULL / LEGS, PUSH day, then 4 sets of bench (one +5), 3 of
chest fly and 3 of overhead press. They finished, looked at the recap, tapped SHARE, then DONE,
Progress and Goals. The clock then moved forward 7 days on the same stored data: PULL day,
3 deadlifts and 2 rows, finish, Progress, Goals. There were 33 taps in total.
Script: `app/tools/playtests/pt1-first-timer.mjs`; screenshots: `shots/PT0/01-…19-…` (committed
in R679).
Metrics:
- The first set was logged after 3 taps (split, day, LOG SET); §4 asks for ≤ 3. The "app opened
  in 1.3 s" this line used to quote timed the harness's own polling, not the app (COACH.md C4).
- The first workout took 16 taps for 3 lifts and 10 sets. A repeat set is 1 tap, and the rest
  timer runs.
- Content seen: coach lines 0 of 7; recap claims SESSION ONE and, in week two, STREAK 2 WK.
  No PR was claimed on day one, which is correct (§6).
- Decisions used: split, day, the suggested next lift (Chest Fly, marked NEXT), a lift picked
  from the rail, and a weight bump.
Versus Strong/Hevy (memory, ≤ Jun 2026):
- Both start a first workout from a template or an empty workout. The user picks every exercise
  from a searchable library, and each exercise shows "previous" numbers.
- PROOF is faster to the first set and never shows a blank field.
- PROOF gives no workout plan at all: after "PUSH" it opens on Bench Press, and the user decides
  everything else from a 12-chip rail.
Felt samey:
- Progress after two weeks is five identical rows, each a single dot and a "—" trend
  (`shots/PT0/18-week2-progress.png`).
- The week-two recap says only the totals and "STREAK 2 WK". Nothing about the week is new.
Confusing:
- DONE on the recap immediately raises the NEXT workout's "TODAY IS" day sheet over the tab bar.
  Progress and Goals cannot be reached until it is answered or skipped
  (`shots/PT0/11-after-done.png`).
- Week-two PULL day opens a first-ever deadlift at 150 lb, for a lifter whose heaviest bench was
  50 × 8 (`shots/PT0/15-week2-pull-day.png`). That is 3× their bench, "a starting point" that is likely
  too heavy for a real beginner.
- The day rail puts 12 lifts in one horizontal row. Overhead Press, the lift the user wanted, sat
  off the right edge of the screen and needed a horizontal scroll before it could be tapped.
- The owner's headline feature, the coach line, never appeared in two weeks of play. It needs
  two sessions of the same lift within 14 days, so a push/pull/legs lifter sees their first
  suggestion no earlier than day 8. This playtest never reached it.
- Progress carries a DONE button, even though it is a tab.
Broken / unverified:
- SHARE produced no visible change in headless Chrome (`shots/PT0/10-share.png` is identical to
  `shots/PT0/09-after-finish.png`). The Web Share API is absent in headless Chrome, so this may be a
  harness limit and not a bug. Check it on a real phone browser. Device-blocked here.
Best moment: the recap card on day one (`shots/PT0/09-after-finish.png`) — "SESSION ONE · 50 × 8 · THE ONE
TO BEAT", a big volume figure, clean and postable.
Backlog (to be ranked by gap value once MARKET.md exists):
1. Workout guidance: after choosing a day, propose the session (lifts × sets × target reps) rather
   than leaving 12 chips.
2. Reach the coach sooner: something useful from session one, not day 8.
3. Progress that shows something in week one or two: history per lift, charts, a calendar.
4. DONE should not hide the tab bar behind the next workout's day sheet.
5. Seeded starting weights for a lifter's first set of a new lift look aggressive (deadlift at
   3× bench).

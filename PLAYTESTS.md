# PROOF — playtests (newest first)

Playtests run the real app at phone size (375×812, touch input) in headless Chrome, driven by
`app/tools/playtest.mjs`. Every tap is a real touch event at the element's on-screen centre,
and the tool refuses to tap anything a thumb could not reach. Scenario scripts live in
`app/tools/playtests/`. Screenshots are written to the round's scratch folder; paths are given
per report.

### PT0 · R676 (baseline, SETUP) · persona: first-timer · build 1b8f259
Sessions: one persona, played before v3's three-persona format existed. The first-timer's path
was: a fresh install, choose PUSH / PULL / LEGS, PUSH day, then 4 sets of bench (one +5), 3 of
chest fly and 3 of overhead press. They finished, looked at the recap, tapped SHARE, then DONE,
Progress and Goals. The clock then moved forward 7 days on the same stored data: PULL day,
3 deadlifts and 2 rows, finish, Progress, Goals. There were 33 taps in total.
Script: `app/tools/playtests/pt1-first-timer.mjs`; screenshots are in scratch `pt1/01-…19-…`.
Metrics:
- The app opened in 1.3 s, and the first set was logged after 3 taps (split, day, LOG SET). §4
  asks for ≤ 3.
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
  (`18-week2-progress.png`).
- The week-two recap says only the totals and "STREAK 2 WK". Nothing about the week is new.
Confusing:
- DONE on the recap immediately raises the NEXT workout's "TODAY IS" day sheet over the tab bar.
  Progress and Goals cannot be reached until it is answered or skipped (`11-after-done.png`).
- Week-two PULL day opens a first-ever deadlift at 150 lb, for a lifter whose heaviest bench was
  50 × 8 (`15-week2-pull-day.png`). That is 3× their bench, "a starting point" that is likely
  too heavy for a real beginner.
- The day rail puts 12 lifts in one horizontal row. Overhead Press, the lift the user wanted, sat
  off the right edge of the screen and needed a horizontal scroll before it could be tapped.
- The owner's headline feature, the coach line, never appeared in two weeks of play. It needs
  two sessions of the same lift within 14 days, so a push/pull/legs lifter sees their first
  suggestion no earlier than day 8. This playtest never reached it.
- Progress carries a DONE button, even though it is a tab.
Broken / unverified:
- SHARE produced no visible change in headless Chrome (`10-share.png` is identical to
  `09-after-finish.png`). The Web Share API is absent in headless Chrome, so this may be a
  harness limit and not a bug. Check it on a real phone browser. Device-blocked here.
Best moment: the recap card on day one (`09-after-finish.png`) — "SESSION ONE · 50 × 8 · THE ONE
TO BEAT", a big volume figure, clean and postable.
Backlog (to be ranked by gap value once MARKET.md exists):
1. Workout guidance: after choosing a day, propose the session (lifts × sets × target reps) rather
   than leaving 12 chips.
2. Reach the coach sooner: something useful from session one, not day 8.
3. Progress that shows something in week one or two: history per lift, charts, a calendar.
4. DONE should not hide the tab bar behind the next workout's day sheet.
5. Seeded starting weights for a lifter's first set of a new lift look aggressive (deadlift at
   3× bench).

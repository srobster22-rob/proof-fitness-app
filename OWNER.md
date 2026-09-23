# OWNER.md — my direction for this project

The agent reads this file at the start of EVERY round (AGENT_LOOP.md, Stage 0).
Top item first. Move finished items to "## Done" with the round and result.

## Open questions (the loop keeps at most 5 here, each closed-form, with its recommendation; answer under each)
- **The look at phone size** (MARKET row 7, gap value 6). You said the main screen looks "a
  little sloppy and AI-generated" (R586), and "circle what looks off" has had no answer since.
  - **A (recommended):** I render three versions of the Now screen at 375×812, side by side in
    `shots/`, and you answer "A, B or C". One of them wraps the day rail into two rows, so
    more lifts show without a swipe (DECISIONS.md D5).
  - **B:** you circle what looks off on a screenshot.
  - **C:** keep the look as it is, and I stop asking.
- **A small program library, despite §9?** (row 3, gap value 9). Boostcamp gives away 11,000+
  programs and Hevy has 26. PROMPT.md §9 lists "program libraries" as a non-goal, so the loop
  only grows exercises and split plans.
  - **Yes (recommended):** about 5 classic programs (5×5, GZCLP, PPL, upper/lower), run through
    the existing coach.
  - **No:** §9 stands.
- **Which is the wedge?** (rows 5 and 12). PROMPT.md §2 names the postable output. But Hevy
  already ships shareable PR, volume and streak images and overlays for your own photos and
  video, and the clip is native and unbuilt.
  - **A (recommended):** the coach you can read. MARKET.md already names it.
  - **B:** the recap and the clip.
- **On an UPPER / LOWER plan, which day do the deadlifts go on?** (row 5, gap value 6).
  - **A (recommended): LOWER.** That is how upper/lower programs are written, and a new
    lifter's suggestion after bench becomes Barbell Row.
  - **B: UPPER, as today.** They file with pull, so a new lifter's first suggestion after
    bench is Deadlift.
  - Background: HANDOFF.md (R673) describes the per-plan override A needs; DECISIONS.md D4.
- **Watch and health sync, despite §9?** (row 13, gap value 10). Hevy, Strong and Fitbod sync
  Apple Health and ship Watch apps. PROMPT.md §9 lists "wearable integration, Apple Health
  sync" as non-goals.
  - **A (recommended): keep it frozen** until a native build exists, since neither can be
    checked without a device.
  - **B:** allow writing finished workouts to Apple Health (local, no network).

## Vision (2026-09-08, in the owner's words, lightly tidied)
The app is in a pretty good spot, but a little bland. We really want to keep
the simple factor — most people don't want to be tracking weights and reps.
If we make it somehow fun, easy to look at, and overall easy to use and
access, that will really help. This should be catered to the TikTok audience:
everyone's losing their attention span, so the app has to perform in that
scenario and help people along at the gym.

Add an AI feature: the app should suggest, "for this day, you did 185 lb the
last two weeks — I suggest going up a little," or however much it suggests,
and improve the strength training based on the person's goals. Personalize
the app as best we can and implement that feature.

Overall, improve the UI. The main screen is a little too together and not
app-appropriate. We want this to be a professional app, and right now it looks
a little sloppy and AI-generated.

## Next
<!-- The owner's alone (AGENT_LOOP v3.2 §7): the loop never writes here. -->

## Never
- NEVER run `git checkout`, `restore`, `reset`, `clean`, `stash`, `rebase` or
  `amend`. They are on the owner's ask-list, so each one FREEZES this session on
  a permission prompt nobody is watching (this has now cost hours twice). To undo
  an edit, restore from a copy you made yourself before editing: read the file,
  keep the bytes, write them back, verify with sha256. If an undo looks like it
  needs git, say so in the log and move on instead.
- Don't trade simplicity for features. If it needs explaining, it's wrong.
- §12 and §16 stand. Device-blocked checks stay blocked and unfaked.
- No network call or API key added without the owner saying so here.

## Done
<!-- the agent moves finished items here with the round number and result, at most 2 lines each -->
- **R586 vision: the AI coach you asked for exists** (R517–R519), as a local rule engine under
  the lift name on Now. The dev sample regenerates on start (R647), so the line stays visible.
- **Tab bar on every tab -- R645.** Progress, Goals and Settings carry it. Their DONE/back
  links stay; dropping them is your call. Measure stays a sub-screen.
- **LOG SET / day-sheet overlap (R628-R631) -- NOT A BUG, closed R644.** It was a frozen
  entrance transition in a hidden preview pane (HANDOFF trap 19). Nothing changed.
- **Strength vs size step -- DECIDED R643, no change** (2026-09-10). Both suggest one grid
  step on a plateau; strength moves the weight at 5 reps, size waits for 8.
- **Machine name saves on tap away -- SHIPPED R642** on your word (2026-09-10), only when it
  changed. A device check of keyboard dismissal is still worth doing.
- **Day-one starting point label -- SHIPPED R641** on your word (2026-09-10): "First time —
  45 is a starting point" until the first set is logged.
- **Bottom tab bar -- SHIPPED R640** on your word (2026-09-10): NOW / PROGRESS / GOALS /
  SETTINGS, with the streak beside the lift name.
- **Bland → not bland — R522.** A set that breaks a record is marked in volt with a ★. The
  uncapped coach jump this exposed was capped in R524.
- **Attention-span pass — R521.** Install to first set is 1 tap, and a repeat set is 1 tap.
  Seconds need a device.
- **Personalization — R520.** All seven preferences visibly change a screen, and a gate keeps
  it so.
- **AI coach — R517–R519.** One call you may overrule: a lifter climbing in 2.5s is told 2.5,
  not the setting's 5.
- **Main screen redesign — R511–R516:** title, grouping, rail fade and card surface. Content
  stays centred; left-aligning is your call.

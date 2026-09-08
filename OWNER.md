# OWNER.md — my direction for this project

The agent reads this file at the start of EVERY round (AGENT_LOOP.md, Stage 0).
Top item first. Move finished items to "## Done" with the round and result.

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
- Personalization: goals, units, split, jump amounts and history should
  visibly shape what the app shows, not just what it stores.
- Attention-span pass: every core flow (open → log a set → done) measured in
  taps and seconds; cut anything that isn't earning its place. Fun and
  easy-to-look-at, not more features.
- Bland → not bland: motion, colour and feedback where a set is logged or a
  best is hit, within §12 (Animated only, resting style is the visible one, no
  new dependencies).

## Never
- Don't trade simplicity for features. If it needs explaining, it's wrong.
- §12 and §16 stand. Device-blocked checks stay blocked and unfaked.
- No network call or API key added without the owner saying so here.

## Done
<!-- the agent moves finished items here with the round number and result -->
- **AI coach** — R517-R519. Working; the line is under the lift name on Now.
  - Local rule engine over the last two weeks: progressive overload, plateau,
    deload, plus "you are climbing, keep going" and "this weight is new,
    repeat it". No network, no key, no new dependency.
  - COACHING in Settings picks strength / size / consistency, and you can see
    it change the line: consistency says "185 last 2 — stay here and add a
    rep", strength says "185 for 2 sessions — try 190".
  - It stays SILENT unless it has two sessions of that lift in the window. A
    coach that talks when it does not know teaches you to ignore it.
  - ONE JUDGEMENT CALL you may want to overrule: when you have added weight
    every session and made every one, it suggests YOUR increment rather than
    the one the setting implies — a strength lifter climbing in 2.5s is told
    2.5, not 5. Overriding a plan that is working seemed worse than ignoring
    the setting in that one case. Say the word and I will flip it.
  - The model-call seam is documented in coach.ts and NOT wired, per your line
    about cost, key and privacy.

- **Main screen redesign** — R511-R516. Done as far as I can take it; please
  look and say whether it matches what you meant.
  - R511: the exercise name was styled exactly like the chrome labels around
    it (22px, wide tracking), so the one thing the screen is about read as
    furniture. Tracked in; it reads as a title now.
  - R513: inside THIS WORKOUT the set numbers were louder than the lift name
    grouping them, so three exercises read as one field of small numbers. The
    name anchors its group now.
  - R514: the day rail scrolls and nothing said so — it cut a chip mid-word at
    the edge. It fades out now, built from plain Views (a gradient would be a
    dependency, which §12 forbids).
  - R515: the weight and reps rows are one control and nothing grouped them.
    They sit on a surface now, in the card style the plan chooser already uses.
  - R516: judged the whole screen at real phone size (375x812) rather than in a
    wide window, which is how the earlier rounds had been looking at it. It
    holds up. Three things I suspected were defects turned out not to be, and I
    left them alone: the nav links already carry hitSlop so their real tap
    target is ~64px despite measuring 36px; the LB unit is baseline-aligned to
    the number exactly as intended; and the first-run sheet only looks broken
    if you screenshot it mid-animation.

  TWO THINGS I DID NOT DO, both deliberate:
  - A bottom tab bar is what every well-known fitness app uses and this app
    cannot have one. A tab bar costs ~50px and R512 measured the shortest
    shipping phone (568px) at 624px of unshrinkable content ALREADY. Adding one
    means dropping something else off the screen — your call, not mine.
  - Content is centred; most fitness apps left-align everything but the hero
    number. That is taste rather than defect, and changing it touches every row,
    so I have not.


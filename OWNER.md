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
- Main screen redesign to professional-app standard: clear hierarchy, room to
  breathe, one obvious next action, nothing that reads as generated filler.
  Judge it against a well-known fitness app's home screen, not against the
  current one. Keep every existing behaviour — this is look and layout.
- The suggestion feature ("AI coach"): on the Now screen, for the exercise in
  front of you, use the last two weeks of history to say what to lift today
  and why, in one line ("185 lb the last two weeks — try 190"), tuned to the
  person's stated goal (strength / size / consistency). Build it as a local
  rule engine first (progressive overload, deloads, plateau detection) so it
  works offline with no key and no new dependency; a real model call is a
  later owner decision (cost, key, privacy) — leave a seam for it, do not add
  it unasked.
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

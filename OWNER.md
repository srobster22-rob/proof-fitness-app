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
- OWNER DECISION, FILED R548 (no action needed unless you disagree): should the
  STRENGTH goal climb faster than SIZE? It used to, by 2.5 lb — but every
  suggested weight now snaps to the loadable grid (5 lb / 2.5 kg), because the
  coach was telling kilo lifters to "try 61.25", and 1.25 kg total is 0.625 kg
  a side, which is not a plate. A 2.5 lb difference cannot survive that in
  either unit, so on a plateau the two goals now say the same thing.

  They still differ where it matters and always did: strength releases the
  weight at 5 reps, size waits for 8. Settings now says that instead of
  promising a step size the app cannot deliver.

  If you want them to differ on WEIGHT too, the change is one line — strength
  moves two grid steps (+10 lb / +5 kg) instead of one. I did not make it,
  because +10 lb on a plateaued bench is a training judgement, not a bug fix.

- OWNER DECISION, WAITING ON YOU (built R523): the bottom tab bar. Both
  versions exist. Neither ships — the flag is off, there is no Settings
  control for it, and a test fails the build if it ever defaults on.

  TO SEE THEM: run the app, then in the browser console
    fetch('/tabbar.b64').then(r=>r.text()).then(t=>{localStorage.setItem('proof.db.v1',t);location.reload()})
  and `/seed.b64` the same way to go back. Same data, one preference apart.

  WHAT CAME OFF TO PAY FOR THE BAR:
  | | current | tab bar |
  | --- | --- | --- |
  | top row (PROGRESS / GOALS / gear) | 36px | removed — the bar replaces it |
  | bottom bar | none | 56px |
  | net change to the column | — | **+20px** |
  | the 14 WK streak | shown, beside the gear | **gone** — the bar has no room |
  | at 375x812 | fits | fits |
  | at 375x568 | fits | fits |

  So the bar is NOT the 50px disaster I filed in R516. It costs 20px net, not
  50, because it takes the top row with it — and both still fit at 568.

  THE REAL PRICE IS THE STREAK, not the pixels. §10 asks for a streak visible
  on launch, and it rode with the gear in the row the bar deletes. A tab bar
  has four slots and none of them is a status. Your options, if you want the
  bar: put the streak on the exercise line, drop it from Now and leave it to
  the recap, or accept a fifth non-tappable slot (which §15 warns about —
  something that looks tappable and is not).

  MY READ, for what it is worth: at 812 the bar looks more like a real fitness
  app and costs nothing you notice. At 568 it is tighter and the streak loss
  is real. I would take the bar and move the streak, but this is a taste call
  about your product and the pictures are the point.


## Never
- Don't trade simplicity for features. If it needs explaining, it's wrong.
- §12 and §16 stand. Device-blocked checks stay blocked and unfaked.
- No network call or API key added without the owner saying so here.

## Done
<!-- the agent moves finished items here with the round number and result -->
- **Bland → not bland** — R522. Half of this already existed and half was
  missing, which took looking to find out.
  - LOGGING a set already had feedback: the chip animates in (`Arrive`).
  - A BEST had none. §8 calls the personal record "the emotional payload of
    the whole product", and the record detector was used by the recap and the
    harness and never by the screen the record happens ON. You could break a
    plateau and the logging screen said exactly what it says for a warm-up,
    until the recap told you later.
  - Now the chip that broke the record is marked, in volt with a ★, beside the
    ordinary sets. Small on purpose: §8's other half is never cry wolf, and a
    banner for every heavy set teaches people to ignore it. The sentence still
    belongs to the recap.
  - No new dependency, no new animation — it reuses the entrance the chips
    already had and differs in colour, so it is still true that a chip which
    never animates is fully marked.

  ONE THING I BROKE AND HAVE NOT FIXED, found while looking at this: the coach
  line suggests YOUR increment, and it does not cap it. I jumped the test
  weight by 135 lb in one session and it said "320 and climbing — try 455".
  Real linear progression will not do that, but one odd session produces
  nonsense advice. That is a defect in what I shipped in R518 and it is next.

- **Attention-span pass** — R521. Measured on the running app, by driving it.
  Nothing needed cutting: the flow is already about as short as it can be.

  | flow | taps | §4 target |
  | --- | --- | --- |
  | install → first set logged | 1 | ≤ 3 |
  | log another set | 1 | 1 |
  | change the weight, then log | 3 | ≤ 3, no keyboard |
  | finish → recap | 1 | (not budgeted before) |
  | recap → back to logging | 1 | (not budgeted before) |

  So open → log a set → done is TWO taps. Changing the weight used no
  keyboard: zero visible inputs, focus never left the page. Totals reconciled
  against the recap (45×8, 45×8, 90×13 = 1,890 lb).
  - §4 budgeted the logging half and never the FINISHING half, so that is now
    tested too — mainly against the cheapest way to lose it, which is adding
    an "are you sure". FINISH looks irreversible and is not (the recap has
    EDIT THIS WORKOUT), so a confirmation would spend a tap on a question the
    app can already answer.
  - SECONDS are honestly unmeasured. Cold start in the dev server is ~7s, but
    that is 1.5 MB of unminified development bundle evaluating — the DOM is
    ready in 0.14s. A real number needs a production build on a device, which
    is device-blocked, and I would rather say so than quote you 7 seconds.

- **Personalization** — R520. I audited this rather than assuming, and the
  answer is that it is ALREADY TRUE: all seven stored preferences change
  something you can see. Units, language, split, plate jump, rep jump and
  coaching each visibly change a screen; the seventh (skip machine name) only
  affects the equipment sheet.
  - So there was nothing to fix, and what I built instead is the gate that
    keeps it true: each preference must be DEMONSTRATED — flip it, show a
    screen renders differently — and the list of preferences is read out of
    the code, so a new one either gets a demonstration or fails the build.
  - Worth doing because this app has had exactly your suspicion before: the
    language setting once "translated nothing but itself" (Settings in Spanish,
    the logging screen still saying LOG SET), and the unit setting was honoured
    on Now and ignored on Progress for months. Both are now planted as tests
    and caught.
  - The audit itself was wrong four times before it was right — a fixture where
    the coach was silent, one with no machine, one where a display preference
    cannot change an in-progress session, and a machine name silently dropped.
    Every one looked like "the app is broken". That is why each check now
    proves the path is live before it is allowed to conclude anything.

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


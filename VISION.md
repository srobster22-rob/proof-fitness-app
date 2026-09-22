# PROOF — vision

**North star.** The fastest way to log a lift, that tells you what to lift next and turns
the session into proof worth sending.

Sources: `PROMPT.md` §1–§7 and §10, and `OWNER.md` "## Vision (2026-09-08, in the owner's
words)". Where they conflict, the owner's recorded answer wins. §9's non-goals still bind
unless `OWNER.md` records an overrule.

## Pillars

1. **Log without thinking.** One tap repeats a set, every number is pre-filled, and nothing
   on the logging path waits, asks or scrolls. (§3 rule 1, §4. Owner: "keep the simple
   factor"; "everyone's losing their attention span".)
2. **The app knows what's next.** It predicts your next lift and suggests your weight, tuned
   to your goal — a coach, running locally. (§7. Owner: "the app should suggest ... and
   improve the strength training based on the person's goals".)
3. **Proof worth sending.** Every workout ends in a recap someone would actually send to the
   group chat. (§1, §5.)
4. **A reason to come back.** Progress you can feel between sessions: records, streaks, the
   weekly comparison and goals. (§10. Owner: "if we make it somehow fun".)

## The first 10 minutes, as a new user

1. Open the app and land on the logging screen (Now). There is no account, quiz or permission
   prompt (§6).
2. Answer "what split do you run?" or skip it, then pick a lift from the starting twelve.
3. See a sensible starting weight already filled in, with no blank field and no keyboard.
4. Log a set with one tap. A rest timer starts. Log again, then swipe to the next lift.
5. End the workout and get a recap that works even for a single set, then share it or not.
6. Look at Progress and Goals, set a target for one lift, and leave knowing what next time
   holds.

Every playtest measures how far a new user gets through this list and where they stall.

## Content axes

"Bigger" for this app means more a user can do or learn. Counts are derived from source by
`app/tools/inventory.ts` into `CONTENT.md`; never hand-count them. The `id` column is what the
script reads, so keep it stable.

| id | axis | what counts | target | why this target |
|---|---|---|---|---|
| exercises | Exercise library | built-in movements (`BUILTIN`) | 60 | a lifter uses 15–25 movements (§7); a library of 60 covers most gyms without becoming a wall |
| programs | Programs | split plans the app builds days from (`SPLIT_PLANS`) | 6 | owner-approved splits (R266–R269); common 4- and 5-day shapes are missing. Not a program library (§9) |
| coach | Coach situations | distinct coach lines (`coach*` keys) | 12 | the owner's AI feature; each new situation is a new piece of advice |
| insights | Insights | recap narrative claims, plus the weekly comparison line | 14 | §10: something worth saying on a rest day |
| goals | Goal kinds | kinds of goal a user can set | 4 | owner: improve every lift; today there are only lift and body targets |
| measurements | Body measurements | measurement kinds (`KINDS`) | 4 | bodyweight and height today |
| equipment | Equipment | kinds of kit a set is logged on | 6 | cables and kettlebells are missing |
| trainingGoals | Coaching modes | training goals the coach tunes to | 4 | strength, size and consistency today |
| languages | Languages | UI languages (`LANGUAGES`) | 3 | en and es today |
| screens | Screens | top-level screens | 6 | §4 caps this at six; grow flows inside screens, not new screens |

## Guardrails

- **§9 non-goals still bind.** The owner has overruled Settings (R111), Measure (R140), the
  three-goal cap, and a coach that is a local rule engine (R517). Nothing here adds accounts,
  a social feed, nutrition, cardio, or a networked AI.
- **The look at phone size is the owner's open question** (`OWNER.md` `## Next`). It is never
  decided here, and it never blocks growth on another axis.
- **§3's tiebreakers still order conflicts:** logging speed, then zero-friction start, then
  postable output, then beauty.

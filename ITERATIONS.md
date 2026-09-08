# Prompt iteration log

Each pass = write, then attack it, then fix what the attack found. Keep appending.

## Status

**Current: v10 — the app is named PROOF.** [PROMPT.md](PROMPT.md) · research in [RESEARCH.md](RESEARCH.md) · video spike in [spike/SPIKE.md](spike/SPIKE.md) · kill test in [harness/KILL-TEST.md](harness/KILL-TEST.md) · link path in [link/README.md](link/README.md)

| Question | State |
|---|---|
| Is there a market gap? | **Settled** — sharing is an afterthought in every logger; nobody joins the log to the post |
| Is the core logic built? | **Yes** — `app/`, 56 tests, PR rule + predictor + session + cold start, wired into the harness |
| Is "no account, fast, local-first" a differentiator? | **NO — falsified.** Knurl ships all of it and logs from the Lock Screen. Table stakes |
| Can a phone render the video? | **Settled** — spiked, ~4 ms/frame, no FFmpeg, avoid `CoreAnimationTool` |
| Is the logging UX specified tightly enough to build? | **Settled** — tap counts, cold start, exercise prediction, PR definition |
| Does the app survive two years of history? | **Settled** in spec (§8 "mature"), unverified in practice |
| Is the acquisition channel real? | **Partly** — TikTok is follower-independent, so reach is earned not granted; magnitude unknown |
| Does the artifact survive how it's actually seen? | **Settled** — thumbnail + bright-footage tested, mark redesigned as shape not text |
| Is there an acquisition path better than a watermark? | **Settled** — the link path, built and verified end-to-end |
| **Will anyone actually send these?** | **OPEN — the binding constraint.** Harness built, test not yet run |
| Do recipients install? | **OPEN** — campaign tokens will answer it, but only once there's an App Store listing |
| Does on-device encode hit the time budget? | **OPEN** — needs a Mac or EAS Build + device |

Every open item now needs a person, a device, or a shipped binary — not another draft.

## v0 — the original ask

> "TikTok friendly fitness app, record sets/progress/goals, fast, not a chore, user
> friendly, appealing, useful, not cluttered, simple, no signup fee or trial."

**What's wrong with it:** every requirement is an adjective. "Simple," "appealing," "not
cluttered" can't be checked, can't be argued with, and can't resolve a conflict. It
describes a mood, not a product. A builder given this ships a generic logger.

## v1 — added structure

Turned the adjectives into a thesis, a scope, and a feature list.

**Attack:** still no tiebreaker. "Fast" and "useful" fight constantly and nothing says
which wins. No numbers, so "fast" is still an opinion. Doesn't say what *not* to build,
which is how simple apps become cluttered ones.

## v2 — added the constraint hierarchy, hard numbers, non-goals

Speed ranked above everything. Tap counts and second counts as acceptance criteria.
An explicit do-not-build list.

**Attack:** "TikTok friendly" was never resolved — it means both *feels like* TikTok and
*produces content for* TikTok, and those are different products. No technical risk
identified. No acceptance tests, so the numeric targets were unenforced.

## v3 — resolved the ambiguity, named the risk, added tests

Both readings kept, but ranked: the feel is the foundation, the output is the wedge.
Camera question resolved to camera-roll import for v1 (capture is heavy, and lifters
already film themselves). Video rendering named as *the* technical risk with an
instruction to spike it before any product code. Added the four "how to know it's
working" tests.

**Attack:** no retention story — an app you only open mid-workout has no habit hook, and
H&F has the worst day-1 retention of any category. And nothing stops scope creep once
building starts; a non-goals list gets stale the moment a good idea arrives.

## v4 — current

Added the rest-day retention loop (streak + one auto-surfaced weekly comparison, already
formatted as a postable card). Added the three-question gate in §12 that any new feature
must pass in writing, which keeps the constraint alive after the non-goals list ages out.

## v5 — folded the spike back in

Ran the video spike (see [spike/SPIKE.md](spike/SPIKE.md)). §8 changed from "spike this
before anything else" to the settled answers: no FFmpeg, avoid `AVVideoCompositionCoreAnimationTool`,
explicit reader→context→writer loop, ~4 ms/frame overlay cost, native-draws architecture.

Two things the spike surfaced that the prompt had no way to anticipate, now added to
scope: a **safe-area constraint** on every generated shareable (host-app chrome covers the
bottom 320 px and right 130 px — the first layout was invisible on TikTok), and **bundled
fonts** as v1 scope rather than polish.

One open item from the v4 attack closed itself: the "if the spike fails, fall back to a
static card" branch — which would have left the app with nothing Hevy doesn't ship — is
no longer needed. The pipeline works.

**Attack — open, for v6:**

- **No first-session script.** Day-1 retention is the known killer and there's no defined
  "what the very first 60 seconds looks like" when the user has zero history and every
  field's "same as last time" default is empty. The cold-start case is the weakest part
  of the current design.
- **Exercise selection is unspecified.** Picking which lift you're doing is on the logging
  path, so it's governed by the 1-tap rule, and there's no answer for how you choose from
  ~200 exercises that fast.
- **Unvalidated core assumption.** "People will post an auto-generated recap" is asserted,
  not tested. Cheapest possible check: make ten recaps by hand and see if anyone posts one,
  before building the renderer.
- **The recap is still generic.** The spike proves the app can render *a* video; it doesn't
  prove this particular one is worth posting. A volume total and a lift list is a receipt,
  not content. The version someone actually posts is probably the imported clip with one
  number on it — not the five-section summary card.
- **Sync is unspecified.** "Local-first, no account" is stated, but the day the user gets a
  new phone their entire history is gone, and there is no answer for that anywhere in the
  prompt.

## v6 — current

All five attacks answered, plus three defects found on a re-read.

**Inverted the recap (§5).** The biggest change. The clip is now the primary format — the
user's footage with *one* number burned on it — and the five-section data card is the
fallback for sessions with no clip. The card is a receipt: Strava-shaped, legible only to
people who already lift, and it does not travel. Footage with a number on it is content.
Note this *reduces* renderer scope, which is what pays for the additions below.

**The first session (§6).** The design rests on "pre-filled with last time's numbers," and
on day one there is no last time — so the app was at its weakest exactly where day-1
retention is decided. Now specified: no onboarding, twelve lifts not two hundred, numbers
seeded from population defaults so no field is ever blank, streak reads 1 immediately, and
a recap generates from a single set. That last one is a design constraint, not a nicety —
the card must be laid out for the one-set case first.

**Exercise selection (§7).** Reframed from a search problem to a prediction problem. A
lifter uses 15–25 movements; rank by recency × frequency, bias by weekday, and once ~3
sessions exist predict the session and preload it. Selection goes to zero taps. Search gets
demoted to the "add a new exercise" path.

**Data durability (§11).** CloudKit private database keyed to the Apple ID already on the
device — sync and new-phone restore with no signup, no email, no password, and no
credential ever reaching the app. This was the rare case where the zero-friction constraint
and the durability requirement were not actually in tension.

**The kill test (§13).** The thesis rests on "people will post these," which had been
asserted through six versions and never tested. Now a pre-registered test with an explicit
kill line — ten hand-made recaps, fewer than three posted means the wedge is wrong — and an
honest statement that N=10 can only falsify, never validate.

Three defects found while re-reading:

- **"PR" was never defined**, despite being the emotional payload of the whole product.
  Now: Epley e1RM to *detect*, ≤12 reps only, a real margin required, no PRs in an
  exercise's first three sessions, and display the concrete set rather than the estimate.
  An app that awards a PR every session has made the word worthless.
- **No definition of a workout ending**, even though the recap triggers on it. Now
  auto-ends after 90 idle minutes, backdated.
- **Units** were an unasked question that would have become a settings screen the prompt
  bans. Now inferred from locale.

Two acceptance tests added for the new failure modes: a cold-start stopwatch run on a fresh
install, and a cry-wolf test that counts PRs awarded over four simulated weeks.

**Attack — open, for v7:**

- **The two recap formats are one product decision pretending to be two.** If the clip
  version is what actually travels, the honest v1 might be *clip-only* — ship nothing when
  there's no footage, and let that scarcity drive filming. The card may be a comfort
  feature that dilutes the wedge and doubles the renderer work.
- **Nothing in the prompt addresses the cold-start social problem.** A watermarked post is
  only an acquisition channel if the poster has an audience. Most lifters have ~200
  followers and post nothing. The CAC argument in §2 quietly assumes distribution the
  average user does not have.
- **Goals (§5, screen 3) still has not justified itself.** It's in the original ask, but
  nothing in the retention loop, the recap, or the acquisition story touches it. It is the
  only screen with no job. Either wire it into the shareable output or cut it.
- **No answer for what happens at 200 workouts.** Every spec here is written for the first
  session. The Progress screen, the exercise predictor, and the recap all behave differently
  with two years of history, and none of that is specified.

## v7 — current

**The headline attack was half wrong, and finding that out was the most valuable pass yet.**

The claim was that a normal lifter has no audience, so the acquisition argument in §2 is
fantasy. Checked it instead of assuming it: **TikTok does not use follower count as a
ranking factor** — officially not a signal — and a zero-follower account can reach a large
audience on a single video. Distribution is earned per-video on **completion rate and watch
time**. Instagram *is* follower-first, so the objection holds there and not on TikTok.

That correction is worth more than the original attack would have been, because it converts
a vague worry into a design constraint. Reach is rented per-video and paid for in completion
rate, so the artifact is not a decorated byproduct — it is content that has to survive a
ranking system. Now hard targets in §4: **≤ 7 s, loops, payload legible in frame 1.**

**Three destinations, not two formats (§5).** The v6 framing — clip primary, card fallback —
was still treating sharing as one act. It isn't. Group chat, FYP, and Stories have different
physics and want different artifacts, and only the FYP is format-critical. The most useful
conclusion is the least glamorous one: **design for the gym group chat.** Closed, small,
pre-qualified, sender has standing, converts better than everything else combined. Feed
reach is upside, not the plan. §13's kill test now measures *sending*, not posting —
counting public posts only measures how many of your ten happen to be creators.

**Goals earned their place or died (§5).** Wired into the output: an active goal supplies the
narrative line — "42 lb from a 315 squat" is a story with a direction, "18,420 lb of volume"
is a number. The spec now says outright that if goals don't feed the shareable, cut the
screen.

**Specified the far end (§8).** Everything through v6 was written for session one, and the
degradation was silent — it fails for exactly the users who stayed. Now: Progress is capped
and ranked rather than exhaustive, the exercise predictor decays so recency beats stale
frequency, mature accounts get a second lead when PRs get rare (which is by design), and the
recap must stop repeating itself. Plus a year-two acceptance test that seeds 200 workouts.

**A source I did not use.** A gym-marketing blog claims 80% of gym-goers share workouts to
social media. It is a vendor blog with an incentive to inflate and no visible methodology, so
it is deliberately absent from the prompt. Planning around it would be planning around
marketing copy — and it is precisely the number §13 exists to measure honestly.

**Attack — open, for v8, and a judgment about stopping:**

- **Clip-only is still the untested stronger version.** v7 kept the card. The sharper product
  might ship nothing without footage, so scarcity drives filming. §13 now returns the data
  to decide this — which means the decision should wait for it rather than be argued again.
- **The watermark is unspecified.** It is the entire acquisition mechanism and it currently
  gets one line and 34px. Legibility in a 7-second clip, at thumbnail scale, after platform
  re-encoding, is a real design problem nobody has looked at.
- **No retention number anywhere.** There are tap counts and second counts, but nothing says
  what "working" looks like at week four. Deliberately left out: inventing a target before
  there is a single real user would be a made-up number wearing a suit.

**Judgment: the editorial loop has converged.** v7 changed real decisions. v8 would be
padding — every remaining item needs data, not better prose. Two things unblock it, in this
order: run §13's kill test, and get the Swift onto a device. Another prompt pass before
either would be motion, not progress.

## v8 — current

That judgment was right about prose and wrong about stopping. **Building the harness
produced four spec changes that no amount of re-reading would have.** The lesson worth
keeping: when the loop stalls, build the thing, don't redraft the description of it.

**The mark failed its own test.** Rendered the clip at 216×384 feed-thumbnail scale and the
wordmark dissolved into noise while the weight×reps stayed perfectly sharp. The fix is not
bigger text — nobody reads a watermark and nobody types a name they saw in a video, so a
wordmark converts approximately zero people. What survives downscaling is **silhouette**, so
the mark is now a distinctive solid shape with the name beside it. Also spec'd: keep it
*small*. An oversized watermark reads as an ad and costs sends, and sends are the scarce
resource — brand impressions are not.

**The strongest acquisition mechanism was missing entirely.** Chasing watermark legibility
surfaced the better answer: on an FYP a burned-in mark is all you get, but a message thread
carries a **real URL** next to the file. §5 already said design for the group chat; it hadn't
noticed that the group chat is the only destination that can carry a link. That is worth more
than any watermark tuning, and it is now in the spec.

**Static overlay is derived, not stylistic.** "Payload legible in frame 1" and "loops
cleanly" are jointly unsatisfiable with any entrance animation — anything animating in makes
frame 0 differ from frame N and puts a seam in the loop. Writing the renderer forced this
out. Now stated explicitly, along with the consequence: "make the clip more dynamic" is a
spec violation, not an improvement.

**A scrim is not enough.** Tested against deliberately hostile footage — a blown-out window
right where the lower-third type sits, which is extremely common in gym video — and the lift
name greyed out. Every burned-in element now carries its own shadow, and there is an
acceptance test that says to verify against bright busy footage rather than a convenient
dark clip.

**Named a tension instead of resolving it.** The spec calls the card a fallback, but most
sessions have no footage, so for most users the fallback is the only artifact they will ever
see. Either the card can carry the product alone — in which case "secondary" is a lie the
roadmap trips over — or the real job is getting people to film. The kill test now splits its
result by footage/no-footage to answer it, and the prompt explicitly forbids settling it by
argument first.

Three acceptance tests added: thumbnail legibility, bright-footage contrast, and the harness
run itself.

**Attack — open, for v9:**

- **The link path is asserted and unbuilt.** A URL in a thread converts far better than a
  watermark — but that requires a landing page, a deep link, and an install-attribution
  story, none of which exist anywhere in the spec. It is now the biggest unspecified surface.
- **The kill test measures sending, not installing.** Ten sends prove the artifact travels.
  They prove nothing about whether a recipient installs, which is the actual growth claim.
  A second, harder test is hiding behind the first one.
- **Still no retention number.** Unchanged from v7, and still deliberate — inventing a
  week-four target before a real user exists would be a made-up number wearing a suit.

## v9 — current

Built the link path ([link/](link/)). Same pattern as v8: building produced things reading
could not.

**The fragment trick.** The whole workout packs into the URL fragment — ~380 chars for a full
session, verified round-trip exact including the `×`. Fragments are never sent to a server, so
the landing page re-renders a real recap client-side with the same `recap.js` the app uses.
No backend, no upload, no database, free static hosting. The page's footer promise — *nothing
about this workout was sent to a server* — is literally true, and the spec now treats that as
a **constraint on every future backend decision**, not a marketing line.

**A real asymmetry, not a bug.** The card fits in a URL; the clip never will. So the video
travels as the attachment and the link renders the card view of the same session. The two
artifacts are complementary rather than competing, which is a better answer than v8's
unresolved "is the card secondary or not" tension — though it does not fully settle it.

**The cost, taken with eyes open.** The chat unfurl can't be personalised: clients fetch OG
tags server-side and the server never sees the fragment. A server-rendered unfurl showing
their actual PR would convert better. Accepted, because in a group chat the video attachment
*is* the preview and beats any unfurl card — but it is now written down as a known trade with
a trigger for revisiting, rather than an oversight.

**Two Universal Link rules that fail silently**, both now in §12: AASA must be
`application/json` with no extension, and **no redirects** on the AASA or link path — iOS
refuses to follow one when matching a URL to an app, and you get a browser with no error
anywhere. `_redirects` uses a 200 rewrite for exactly this reason.

**Attribution is a values call, not a technical one (§13b).** If the app is installed, the
Universal Link gives exact attribution free. If not, the trail breaks at the App Store and
there is no clean first-party fix. Campaign tokens give aggregate installs with no SDK;
Branch/AppsFlyer give per-user but would make the landing page's privacy promise a lie. v1
takes tokens, and the spec says outright to resist future arguments for the middle option —
credibility with a privacy-sceptical audience is the asset here.

**A bug worth recording**, because it is the class of thing that ships broken: `link/index.html`
referenced `./recap.js`, which only exists *after* the build. The source page could not run
in place, and the failure was silent — a blank canvas, no console error that mattered. Now
the source loads `../spike/recap.js` and the build rewrites it, with an assertion that fails
the build loudly if the rewrite ever no-ops.

**Attack — open, for v10:**

- **The landing page is a conversion surface with no evidence behind it.** Its headline,
  its three promises, the decision to lead with the recap over a pitch — all reasoned, none
  tested. It is now the second-most-assumed thing in the project after "people will send this."
- **`ct=` campaign tokens are per-campaign, not per-send.** The harness mints a send token
  per subject, but App Store Connect will only aggregate. For the kill test's n=10 that is
  fine; for a real launch, distinguishing which *kind* of send converts needs a campaign
  taxonomy nobody has designed.
- **The OG image is generic and untested.** Built it (`og.cjs`, 1200×630, reusing the clip's
  mark lockup so both read as one product) rather than leaving `og:image` pointing at
  nothing — but whether a generic card beats no card in a thread where the video already
  renders inline is unmeasured, and plausibly it makes no difference at all.

## v10 — current

**A name search turned into the most important finding in the project.**

Looking for an available name surfaced **Knurl**, which is not a naming collision — it is a
direct competitor already shipping: no accounts, no sign-in, no server, iCloud sync, PR
timeline per exercise, e1RM charting, goals measured against logged lifts. That is §11, most
of §8, and *the entirety of differentiator (1)*. It also logs from the **Lock Screen and
Dynamic Island via a Live Activity** — ±, ✓, rest timer, next set queued, without unlocking
the phone. Faster than the "one tap in-app" this spec spent ten versions optimising.

Three changes, all in §2:

- **Differentiator (1) is struck.** "No account, no trial, zero friction" is table stakes.
  Build it; do not position on it. An audience comparing PROOF to Knurl will shrug.
- **Adopt the Live Activity** as the primary logging path. It is strictly better than what
  §4 specified, and it is now the bar rather than the goal.
- **The output is the only remaining wedge**, and the spec now says so in those words: if
  §13's kill test fails there is no fallback position. That was rhetorical before. It is
  literal now.

The honest read is not that this is bad news. A competitor validating the no-account,
local-first, iCloud-sync architecture means those calls were *right* and are now de-risked
by someone else's shipping. They are simply not why anyone would switch.

**Named it PROOF.** Chalk, TopSet and Knurl were all checked and taken. PROOF encodes the
thesis exactly — the app turns a set into proof you did it, and the artifact *is* the proof —
and at five letters it survives watermark scale, which v8 established a longer name does not.
Trademark clearance is not done and is flagged in the spec as not skippable.

**Copy variants shipped** ([link/copy.js](link/copy.js)), four of them, each answering a
different question rather than differing in word choice: who sent me this / what is this app /
how did they make that / why not the one I have. Selected by `?v=`, carried into the campaign
token as `share-<variant>-<surface>`, which also closes v9's open item about there being no
campaign taxonomy.

**A prediction, recorded before the data:** variant **c** ("This took four seconds to make")
wins. The recipient has just watched a good-looking clip of someone they know — the question
in their head is *how was that made*, not *do I need a workout tracker*. b and d answer
questions nobody asked; a makes it about a sender they already know. Being wrong about this
is worth more than being vaguely right, which is why it is written down.

**Attack — open, for v11:**

- **Nothing in this project is the app yet.** Ten versions of spec, a render spike, a test
  harness, and a link path — and not one line of the actual product. The domain logic (§8's
  PR rule, §7's predictor, streaks, auto-end) is pure TypeScript, testable on Windows, and
  needs no device. That is the next build, and §16's cry-wolf test is already written for it.
- **The Live Activity is now load-bearing and completely unspecified.** It went from unknown
  to primary logging path in one paragraph. It has its own constraints — budget, update
  limits, what happens mid-set when it expires — none of which are written down.
- **Four variants across ten subjects is 2–3 per cell.** That measures nothing about copy.
  Either accept the kill test answers *only* the send question and treat variants as
  qualitative, or run copy separately at a sample size that could actually resolve it. The
  spec should say which, and currently implies more rigour than the n supports.

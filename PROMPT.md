# PROOF — build prompt (v10)

> **Name.** PROOF. It encodes the thesis exactly: the app turns a set into proof you did it,
> and the artifact it produces *is* the proof. Five letters, so it reads at watermark scale
> where a longer name dissolves (§5). Chalk, TopSet and Knurl were all checked and are taken —
> Knurl in particular is a direct competitor, see §2. **Trademark and App Store clearance for
> PROOF has not been done and is not something to skip.**

> Paste this whole file as the opening prompt. It is written to be read by a builder
> who will make a hundred small decisions you won't be asked about — so it leads with
> the tiebreaker rules, not the feature list.

---

## 1. What this is

A strength-training log where **the fastest possible way to record a set also produces a clip worth posting.**

Not a fitness tracker with a share button bolted on. The share *is* the output.

## 2. Why it can exist (do not skip this — it decides every trade-off below)

The logging market is saturated. Hevy already won "good free logger" and charges $2.99/mo. We do not beat that on features.

We beat it on two things:

1. ~~**First-run friction.**~~ **This is no longer a differentiator — see the Knurl correction below.** It is table stakes. Build it, do not count on it.
2. **The output.** Every competitor's growth is paid or word-of-mouth. If a postable vertical clip falls out of the core loop for free, users' own posts become the acquisition channel. Gym content already performs on short-form video; nobody has connected the log to the post.

**This product now has exactly one differentiator.** If a proposed feature does not serve (2), it is not a v1 feature. There is no second pillar to fall back on.

### The Knurl correction — read this before believing anything above

**Knurl** already ships: no accounts, no sign-in, no server, iCloud sync, a PR timeline per exercise, e1RM charting, and goals measured against logged lifts. That is §11, most of §8, and the whole of what used to be differentiator (1) — shipped, by someone else, already.

It is also **faster than this spec.** Knurl logs from the **Lock Screen and Dynamic Island via a Live Activity**: adjust weight or reps with ±, tap ✓, the set saves, the rest timer starts, the next set queues — *without unlocking the phone.* The §4 target of "one tap in-app" is beaten by something that never opens the app at all.

Three consequences, none optional:

- **Adopt the Live Activity.** It is strictly better than what §4 specifies, and it is now the bar rather than the goal. In-app logging is the fallback path, not the primary one. §4's tap counts still apply to the in-app case.
- **Stop selling "no account."** Say it once, do not build positioning on it. An audience comparing this to Knurl will not find it remarkable.
- **The wedge is the output and nothing else.** Every hour spent making the logger marginally nicer is an hour not spent on the only thing no competitor has. If the kill test (§13) fails, there is no fallback position — that is now literally true, not rhetorical.

Do not treat this as discouraging. A competitor validating the no-account, local-first, iCloud-sync architecture means those decisions are *right* and de-risked. It just means they are not the reason anyone switches.

**Why (2) is not wishful thinking — and where it actually breaks.** The obvious objection is that a normal lifter has no audience, so their posts reach nobody. That objection is true on Instagram and false on TikTok, and the difference dictates the design:

- **TikTok does not rank by follower count.** It is officially not a ranking factor; a zero-follower account can reach a large audience on a single video. Distribution is earned per-video by **completion rate and watch time**, then shares and saves.
- **Instagram is follower-first.** Reach there is gated by who already follows you.

So the acquisition channel is real, but it is rented per-video and paid for in completion rate — not granted by an audience. That has a hard consequence: **the shared artifact is not a byproduct to be decorated, it is content that has to survive a ranking system.** Under seven seconds so it loops, the payload landing in frame one, nothing that invites a scroll.

**Do not model growth on virality.** Most posts will get modest reach, and planning around a hit is planning around a lottery. The dependable channel is §5's third destination: the group chat. Treat FYP reach as upside.

## 3. Tiebreaker hierarchy

When two goals conflict, the higher number wins. No exceptions, no "just this once."

1. **Speed of logging a set.** If a change adds a tap or a frame of latency to the set-logging path, it does not ship — regardless of how good it is.
2. **Zero-friction start.** No signup, no onboarding quiz, no permission prompt before the first set is logged.
3. **Postable output.** Beats analytics depth. A sparkline the user will screenshot beats a dashboard they won't.
4. **Beauty.** Beats configurability. Ship one opinionated look, no theme settings.
5. Everything else.

## 4. Hard targets (these are acceptance criteria, not aspirations)

| Metric | Target |
|---|---|
| Install → first set logged | ≤ 5 s, ≤ 3 taps |
| Log a set mid-workout (repeat last) | **1 tap** |
| Change weight or reps, then log | ≤ 3 taps, no keyboard |
| Pick the next exercise | ≤ 1 tap for the top 5 predicted; 0 once a session is predicted |
| Screens in v1 | ≤ 4 core screens (Now/Progress/Goals/Recap, §5) — plus Settings and Measure/YOU, both overruled onto the list by the owner (R111, R140; §9's settings ban likewise overruled). The cap's live meaning: no *seventh* screen by default. |
| Loading spinners on the logging path | **zero** — all local, sync is background |
| Touch target size | ≥ 44pt, one-handed reachable, works with a sweaty thumb |
| Cold launch destination | The active workout, if one is running. Never a home screen. |
| Log a set **without unlocking** | Live Activity: ±, ✓, done. This is the primary path (§2) |
| Shared clip length | ≤ 7 s and loops cleanly — completion rate is what buys reach (§2) |
| Time to the payload | The number is legible in frame 1. Nothing builds up to it. |

Every numeric field is **pre-filled** — with last session's value where there is one, and with a plausible starting value where there isn't (§6). Typing is the exception, not the rule. An empty number field is a bug.

## 5. v1 scope — build exactly this, nothing more

**Screen 1 — Now.** The current exercise, one set at a time. The weight × reps is the hero: enormous type, tappable steppers, no keyboard. One tap logs. Haptic on every log. Swipe sideways for next exercise. Last session's numbers for this exact lift are visible without any interaction.

**Screen 2 — Progress.** One screen, not a dashboard. Per lift: a sparkline and the current best. Sorted by most recently trained.

**Screen 3 — Goals.** Each is a lift + target weight + date, shown as a percentage bar. The cap was three, described here as "a focusing constraint, not a limitation to remove later". The product owner removed it anyway: the app is for improving EVERY lift and tracking all of them, and a cap that makes you drop one lift's target to record another's works against that. It is now twelve (`MAX_GOALS`) — enough for a four-day split with three focus lifts a day, bounded so the screen stays a list you can read and the recap's headline goal stays a choice. One goal per exercise is still enforced, which is the constraint that was doing the real work. Goals still have to feed the shareable; if they stop, cut the screen.

Goals must **earn their place by feeding the output**, or they are dead weight — a screen with no job, which is exactly what they were in earlier drafts of this spec. So: an active goal supplies the narrative line to the recap and the weekly card. "42 lb from a 315 squat" is a story with a direction; "18,420 lb total volume" is a number. The story is the thing that travels, and it is the only reason this screen exists. If goals aren't wired into the shareable, cut the screen.

**Screen 4 — Recap.** Generated automatically when a workout ends (§8).

There are two artifacts and **three destinations**, and the destination decides the artifact. Do not build one share button that emits the same file everywhere — that is the mistake every competitor makes.

| Destination | Physics | Artifact |
|---|---|---|
| **Group chat / DM** | Closed, pre-qualified — the recipients already lift and already trust the sender. Highest conversion per view by a wide margin. | Either. Optimise for *legible in two seconds in a thread*. |
| **TikTok / Reels FYP** | Open graph, follower-independent, ranked on completion rate. Unlimited ceiling, brutal floor. | **Clip only.** Their footage, full-bleed, **one** number burned on it. Never the card. |
| **Instagram Stories** | Closed, follower-gated, small, viewed by people who know you. | Either. The card works here — your gym friends know what 18,420 lb means. |

**The group chat is the channel to design for.** It is unglamorous, it will never trend, and it converts better than everything else combined because the audience is pre-qualified and the sender has standing. Feed reach is upside, not the plan.

**And it is the only destination that can carry a link.** On an FYP the watermark is all you get — a burned-in mark on a video, which converts close to nobody (see the mark spec below). A message thread carries a real URL alongside the file. That difference is worth more than any amount of watermark tuning, and it is currently the single strongest acquisition mechanism available to this product. Build the share-to-thread path to attach a link, not just a video.

**The mark: shape, not text — and restrained.** Built and tested at feed-thumbnail scale (216×384) in [harness/](harness/); the first wordmark dissolved into noise while the weight×reps stayed perfectly legible. Two conclusions, both counter-intuitive:

- **Bigger text is not the fix.** Nobody reads a watermark, and nobody types a name they saw in a video. Wordmarks convert approximately zero people. What survives downscaling is *silhouette* — so the mark is a distinctive solid shape that stays recognisable at any size, with the name beside it for the rare viewer already looking.
- **Do not oversize it.** A large watermark reads as an ad, and it lowers the chance the clip gets sent at all. Sends are the scarce resource; brand impressions are not. Losing a send costs more than the impression was worth.

**The card is a receipt, the clip is content.** A summary of volume and a lift list is Strava-shaped: legible only to people who already lift, and it does not travel past a closed graph. Build the card, because most sessions will have no footage — but never let it become the default face of the product, and never send it to an FYP.

**Name the tension honestly: no-footage is the common case.** The spec calls the card a fallback, but most sessions will not have a clip, so for most users the "fallback" is the only thing they ever see. Either the card is good enough to carry the product on its own — in which case calling it secondary is a lie the roadmap will trip over — or it isn't, and the real job is getting people to film. §13's kill test splits its result by footage/no-footage precisely to answer this. Do not resolve it by argument before that data exists.

**The clip overlay is completely static, and that is derived, not stylistic.** "Payload legible in frame 1" and "loops cleanly" (§4) are jointly unsatisfiable with any entrance animation: anything that animates in makes frame 0 differ from frame N and puts a visible seam in the loop. So the clip's overlay does not move. The card animates because it has nothing but numbers to hold attention; the clip doesn't need to, because the lift is the show. A request to "make the clip more dynamic" is a spec violation, not an improvement.

**Type over footage needs its own contrast treatment.** A scrim gradient is not enough — gym footage frequently has a window, a mirror, or a bank of lights exactly where the lower-third type sits, and mid-grey text vanished against it in testing. Every burned-in element carries its own shadow or plate. Verify against bright, busy footage, never against a dark test clip.

**Safe area — applies to every shareable the app generates.** TikTok, Reels and Shorts draw their own chrome over roughly the bottom 320 px and the right 130 px of the frame. Artwork is full-bleed, but nothing that has to be *read* may sit outside the safe box, and the box must be visible while designing. This is not a detail — the first spike layout put the watermark and every weight×reps value underneath the host UI, invisible on the only platform that matters.

**Camera:** do *not* build in-app capture in v1. Import from the camera roll only — most lifters already film their sets. Hands-free capture is v2, but the pipeline is video-native from day one so capture drops in without a rewrite.

### The link path — v1 scope, built in [link/](link/)

A share to a thread carries a **URL next to the file**. This is the actual acquisition mechanism; the watermark is a fallback for destinations that can't carry one.

**The whole workout rides in the URL fragment**, base64url-encoded — about 380 characters for a full session. Fragments are never transmitted to a server, so the landing page re-renders a real recap client-side using the same `recap.js` the app renders with. No backend, no upload, no database, nothing to breach, free static hosting. The page's footer promise — *nothing about this workout was sent to a server* — is literally true, and **it must stay true. Treat it as a constraint on every future backend decision, not a marketing line.**

**The card can ride in a URL; the clip cannot.** Footage is far too large, so the video travels as the message attachment and the link renders the card view of the same session. That asymmetry is a property of the medium. Do not try to engineer it away.

**What it costs, taken knowingly:** the chat unfurl preview cannot be personalised, because clients fetch OG tags server-side and the server never sees the fragment. A server-rendered unfurl showing their actual PR would convert better. Accepted, because in a group chat *the video attachment is the preview* — it renders inline in every major client and beats any unfurl card. Revisit only if data shows the link being ignored in favour of the file.

**Two rules that break Universal Links silently.** Both cost days if learned the hard way, because the failure mode is a browser opening instead of the app, with no error anywhere:

1. `apple-app-site-association` must be served as `application/json`, no file extension, over HTTPS.
2. **No redirects** on the AASA path or the link path. iOS refuses to follow one when matching a URL to an app — use a `200` rewrite, never a `301`.

## 6. The first session

The whole design rests on "everything is pre-filled with last time's numbers." On day one there is no last time — so the app is at its weakest exactly when the user is deciding whether to keep it, and Health & Fitness has the worst day-1 retention of any category. Design this deliberately:

- **No onboarding.** No quiz, no goal-setting wizard, no account, no permission prompt. The first screen is the logging screen.
- **Twelve lifts, not two hundred.** First launch shows a short list of the most common barbell and dumbbell movements. Tap one and you are logging.
- **Seed the numbers.** With no history, pre-fill weight and reps from a plausible population default for that lift — never zero, never an empty field. The user adjusts with steppers; they never face a blank.
- **The streak is shown once it means something, not from the first set.** Originally "reads 1
  immediately, not 0" — superseded (owner decision, R150/R205, closed R269): a one-week streak
  is not a streak, and showing "1 WK" on day one is a number with nothing behind it yet.
  `streakWorthShowing` refuses to display one below 2.
- **The first workout produces a recap even if it is one set.** This is the hook, and it means the card layout must degrade gracefully: no PR slab, no five-row lift list, no empty sections. Design the one-set case first and the full case second — not the other way round.
- **Claim no PRs on day one.** See §8; an app that calls your first ever set a personal record has told you it is lying.

## 7. Exercise selection

Picking which lift you are doing sits on the logging path, so it is governed by rule 1. Two hundred exercises in a searchable list fails that instantly.

**Treat this as a prediction problem, not a search problem.** In practice a lifter uses fifteen to twenty-five movements total, and the next one is highly predictable from their own history.

- Never show a full exercise list on the logging path.
- Show **their** exercises, ranked by recency × frequency and biased by what they do on this weekday.
- Once there are ~3 sessions of history, predict the whole session and preload it in order — exercise selection drops to **zero taps** for the common case, and swiping advances through it.
- Search exists, but it is the *add a new exercise* path. It is deliberately secondary and it is never what a returning user touches.

## 8. Definitions the product depends on

**What counts as a PR.** The PR is the emotional payload of the entire app, so it cannot be vague, and it must not cry wolf — an app that awards a PR every session has made the word worthless and nobody shares a worthless badge.

- Detect with estimated 1RM (Epley: `weight × (1 + reps/30)`), counting only sets of **12 reps or fewer** — above that the estimate is noise.
- It must beat the previous best by a real margin, not a rounding artifact.
- **The first three sessions of any exercise cannot produce a PR.** Otherwise every new movement is an instant PR and the app discredits itself in week one.
- **Display the concrete achievement, not the estimate.** "Your heaviest 5-rep bench" — never "estimated 1RM 262 lb." Use e1RM to detect; show the real set.

**When a workout ends.** People forget to press stop. Auto-end after 90 minutes with no logged set, backdated to the last set. The recap generates from whatever exists. Never lose a session because someone walked out of the gym.

**Units.** Infer lb/kg from device locale. One toggle, buried. Never ask at first run.

**Rest counts up, never down.** §8b requires a rest timer, so one exists — and it is a stopwatch since the last set, not a countdown to a target. A prescribed rest interval is a programming opinion, and §5 already says the app does not impose a programming model on someone running their own. Counting up answers the question a lifter actually has ("how long have I been sitting here") and needs no configuration. Past five minutes the display changes colour and nothing else: no alert, no sound, no nag. Measured across the session rather than per exercise — the rest that matters is since you last did work, whatever the work was.

**Badging is not detection.** Several lifts legitimately PR in one session — bumping four accessories at once is common, and every one of those records is real. Badge only the **headline** PR on the shareable. Four highlighted rows on one card flattens the hierarchy and the badge stops meaning anything; the rest stay in the data and in Progress. This was found by rendering a real payload, not by reasoning: the detection was correct and the *card* was crying wolf. Implemented in `buildRecap()`.

**The streak counts weeks, not days.** Nobody trains 365 days a year, so a daily streak breaks constantly and means nothing. Consecutive weeks containing at least one session, with the current week as **grace** — it is not yet a miss, so the count resumes from the last trained week instead of resetting every Monday.

**Prefills declare their source.** `prefillFor()` returns `history | seed | fallback`. The UI may say "last time" only for `history`. A population-seeded guess must never pose as the user's own data — that is the kind of small lie that costs trust with an audience already sceptical of fitness apps.

**What "mature" looks like.** Every requirement above is written for the first session. Almost none of it survives contact with two years of history, and the failure is silent — the app degrades for exactly the users who stayed. Specify the far end too:

- **Progress** cannot become a wall of sparklines. It is capped and ranked, not exhaustive. Old lifts fall off the screen, not into a scroll.
- **The exercise predictor must decay.** A movement trained hard last year and abandoned since must not outrank this month's. Recency has to dominate raw frequency, or the prediction gets worse the longer someone uses the app.
- **PRs get rarer by design** — that is what makes them real. A recap that leads with "no PR today" every session for a year is a failure of framing, not of the lifter. Mature accounts need a second lead: consistency, volume trend, a goal's progress.
- **The recap must not repeat itself.** The same layout with different numbers, 200 times, stops being worth posting long before it stops being generated.

## 8b. The Live Activity — the primary logging path

§2 promoted this from unknown to *the* logging path in a single paragraph and then left it undefined for several revisions. Defining it properly, because it is now load-bearing.

**What it is.** While a workout is live, a Live Activity sits on the Lock Screen and in the Dynamic Island showing the current lift, the weight and reps, and the rest timer. Its controls are real: `−` / `+` adjust, `✓` logs, the timer restarts, the next set queues. **The phone is never unlocked.** In-app logging (§5 screen 1) remains the fallback path and keeps its own tap budget.

**The architectural trap, and it is not optional.** Interactive buttons are driven by an App Intent, and an App Intent's `perform()` runs in the **widget extension process** — a separate sandbox from the app. A database opened without an explicit directory lands in the app's own container, where that process cannot reach it. So:

- The SQLite file must live in an **App Group container** shared by both targets. `app.json` declares the group, and `openDatabaseSync` is pointed at it — the rules live in `src/data/db-location.ts` and are tested. A build whose code-signing entitlements do not carry the group falls back to the app container and says so, rather than looking like a working app whose Lock Screen buttons do nothing.
- **Done before shipping**, which is the only cheap time. Moving the file afterwards means migrating the only copy of a user's training history that exists (§11), with no server to restore from if the move half-fails.
- The intent type must be compiled into *both* targets — a shared framework or dual target membership. It is not importable across the boundary otherwise.
- `LiveActivityIntent` is documented as running in the app's process, which would make the sandbox problem moot. **Verify that on a device; do not bet a data migration on a doc sentence.**

**Budget, and what happens when it runs out.** A Live Activity runs about 8 hours, then persists in Notification Center for roughly 4 more. A workout will not exceed that, but an *abandoned* one will — and the §8 idle rule already handles it: the session auto-ends after 90 idle minutes, backdated to the last set. The Live Activity must end at the same moment. A stale activity showing yesterday's bench press on today's Lock Screen is worse than none.

**Update cadence.** Push updates on user action only, never on a timer. The rest countdown is rendered with a `timerInterval` text style so the system animates it locally — updating once a second from the app would burn budget to display something iOS can draw for free.

**Failure is silent and must be survivable.** ActivityKit throws if the user has disabled Live Activities, and `areActivitiesEnabled` can be false with no warning. Every write goes to the database first and the Live Activity second, so an activity that never starts or dies mid-session costs presentation and never a set.

**What it does not get.** No exercise switching, no goal display, no recap. Rule 1 governs: the Lock Screen exists to log the set in front of you.

## 9. Explicit non-goals for v1

Do not build, do not scaffold, do not "leave a hook for": accounts, login, social feed, following, comments, likes, nutrition, cardio, step counting, AI coaching, program libraries, wearable integration, Apple Health sync, web app, Android testing, dark/light theme toggle, onboarding tutorial, paywall, analytics SDK.

**Settings screen — overruled (R111).** Listed here as a non-goal originally; the product owner overruled it and asked for one. `app/settings.tsx` is real: split, units (with a live lb↔kg conversion), language, jump amounts, export/restore, erase. Left in this section's history rather than silently dropped, the same way §6's superseded line is (R269) — a spec that quietly stops matching the code is worse than one that says what changed and why.

Android may come along free via Expo, but it is not tested or supported in v1.

## 10. Retention loop

An app opened only mid-workout has no habit hook. So it must have something to say on a rest day:

- A streak, visible on launch, that counts training days not app opens
- One auto-surfaced comparison per week: "your squat is up 15 lb since four weeks ago" — generated, not requested, and already formatted as a postable card
- Nothing else. No badges, no gamification store, no push spam. One notification per week, maximum.

## 11. Data durability

"No account" must not mean "lose everything when you get a new phone." That is a support nightmare and a one-star review, and it is entirely avoidable:

- **Sync via CloudKit private database**, keyed to the Apple ID already signed in on the device. No signup, no email, no password, and the app never sees a credential. Backup and new-device restore for free, with zero added friction. (Android equivalent: Auto Backup / Drive app-data folder.)
- **Plus a plain-file export**, user-initiated. Cheap insurance, and a trust signal for an audience that is deeply sceptical of apps holding their data hostage.
- Sync is **always background**. No core action ever blocks on the network, and there is no signed-out state.

## 12. Technical direction

**The domain logic is built and tested — [app/](app/), run `npm test` for the current count.** Do not rewrite it; wire the UI to it.

| Module | What it owns |
|---|---|
| `pr.ts` | §8 PR detection. Rule: *more weight than ever, for the same or more reps.* e1RM only ranks within a session — it must **not** gate awards, or a prior 275×2 makes 230×5 "not a PR", which no lifter would accept. |
| `predict.ts` | §7. Scores `Σ 0.5^(daysAgo/28)` per past occurrence — frequency emerges from summing, recency from decay, and §8's year-two requirement falls out with no special case. |
| `session.ts` | Idle auto-end, week streak, `buildRecap()` → the exact payload `spike/recap.js` consumes. |
| `coldstart.ts` | §6. The starting twelve, seeded prefills, `source` reporting. |

Pure TypeScript, zero dependencies, runs on Node's native type stripping. `npm test` in `app/` builds the browser bundle and runs everything; `npm run e2e` renders simulated training all the way to a PNG.

`build-domain.cjs` emits `dist/proof-domain.js` for the harness, parity-tested byte-for-byte against the source — because the harness renders what real testers see, and a divergence would make the kill test silently measure the wrong artifact.

- **Expo + React Native + TypeScript**, expo-router. (Two dead Expo scaffolds exist at `gymmate/` and `gymmate-ai/` — start clean, don't inherit them.)
- **Local-first storage** — SQLite on device. Data lives locally from the first tap; §11 sync is additive, never a prerequisite.
- **Reanimated** for motion. **Skia** for recap composition.
- iOS first.

**Video pipeline — this was spiked; the answers are settled. See [spike/SPIKE.md](spike/SPIKE.md).**

- **No FFmpeg.** `ffmpeg-kit-react-native` is retired (binaries pulled April 2025), no successor, and self-bundling brings LGPL obligations. Use platform encoders: AVFoundation on iOS, MediaCodec on Android.
- **Do not use `AVVideoCompositionCoreAnimationTool`**, the standard Apple recipe. It hangs exports indefinitely on some devices and silently ignores custom property animations. Use an explicit `AVAssetReader → CGContext → AVAssetWriter` loop instead — working implementation in [spike/ios-module/](spike/ios-module/).
- **Overlay drawing costs ~4 ms/frame at 1080×1920**, measured on two independent rasterisers. Export is ~2–5 s per recap. Budget is not a concern; it is not realtime, so give it a progress state and a cancel path.
- **Native draws, JS sends data once.** Passing rendered frames across the bridge is 180 × 8 MB per export. The workout crosses once as a record.
- **[spike/recap.js](spike/recap.js) is the design source of truth.** It runs in Node and a browser, so the recap can be iterated in seconds without a build, then ported to Swift. Keep the two in sync deliberately.

Still unverified, and it needs a Mac or EAS Build plus a device: on-device encode throughput, CoreText metric fidelity vs Canvas, and decode cost when compositing over a real clip. Nothing else is blocked by it.

## 13. Before you build the renderer — the kill test

The entire product thesis rests on one assumption that has been asserted and never tested: **that people will actually post these.** The spike proved a phone can render the video. It proved nothing about whether anyone wants it.

**The harness is built** — [harness/](harness/) turns one real workout into both artifacts as real 1080×1920 H.264 MP4s, and [harness/KILL-TEST.md](harness/KILL-TEST.md) holds the pre-registered protocol, the six traps that would fake a positive, and the results ledger. Run it before writing product code.

Test it before it is expensive:

- Ten real lifters. Hand-make their recap from a session they actually did, using the harness. Send it within an hour of them training.
- Measure **sending, not posting** — a forward to the gym group chat counts, and per §5 it is worth more than a public post. Counting only public posts measures how many of your ten happen to be creators, which is a fact about your sample, not about the product.
- **Kill line: fewer than 3 of 10 send it anywhere, unprompted, within 48 hours.** Stop. Do not respond by adding features — a logger with a share button is Hevy, and Hevy is free and better. Rethink what the output should be.
- Run it with **both artifacts** and record which one travelled. If the card outperforms the clip, §5's ordering is wrong and this spec needs rewriting, not implementing.

Be honest about what this is: N=10 cannot prove the thesis works. It can only kill it cheaply, which is its entire job. A pass means "not yet falsified," not "validated."

## 13b. Attribution, and its deliberate ceiling

If the app **is** installed, the Universal Link opens it with the workout and the send token. Attribution is exact and free.

If it **isn't**, the user goes to the App Store and the trail breaks. This is the deferred deep link problem and it has no clean first-party solution. The choice is not technical, it's a values call:

| Approach | Gets you | Cost |
|---|---|---|
| **App Store campaign tokens** (`ct=`) | Aggregate installs per campaign | None — no SDK, no vendor, no per-user tracking |
| Branch / AppsFlyer | Per-user deferred deep linking | A tracking SDK and a vendor — banned by §9, and it makes the landing page's privacy promise a lie |
| Clipboard / fingerprint matching | Fragile per-user matching | Privacy-hostile, unreliable on modern iOS |

**v1 uses campaign tokens only.** You learn "N installs came from share links this week" — aggregate, no individuals. That is exactly the resolution needed to know whether the channel works, and deliberately not one step more. Resist every future argument for the middle option; the whole product's credibility with a paywall-hostile, privacy-sceptical audience rests on not having an SDK in it.

This also closes the kill test's blind spot. §13 measures **sending** — ten sends prove the artifact travels but say nothing about whether recipients *install*. Campaign tokens answer that second, harder question, but only once something is actually in the App Store. Do not conflate the two results.

## 14. Monetization

v1 ships with **no monetization at all.** No paywall, no trial, no ads, no "Pro" teaser UI.

When money does arrive, it will never gate: logging, history, goals, or sharing. It gates advanced analytics and export. Likely a cheap annual or a one-time unlock — Health & Fitness is the one category where annual plans dominate revenue, and $2.99/mo is the ceiling Hevy already set.

## 15. Design direction

Near-black background. One accent colour, used sparingly and only for the live/active state. Numbers are the hero — display-weight type, very large. No nav bar chrome, no tab labels competing with content, no cards inside cards. Gesture-first. Every log gets a haptic.

**Bundle the fonts** — a heavy display face for numbers and a neutral grotesk for labels. This is v1 scope, not polish: the whole design rests on the display face, and iOS has no equivalent of the weights the spike prototyped against.

The reference feel is TikTok and BeReal: full-bleed, instant, gesture-driven, nothing between you and the thing you came for. It is *not* a dashboard, a spreadsheet, or a coaching product.

## 16. How to know it's working

Before calling anything done, run these:

1. **Stopwatch test.** From locked phone to a logged set, ten trials. Median ≤ 5 s.
2. **Cold-start test.** Same stopwatch, on a fresh install with no history. This is the one that will fail; §6 exists because of it.
3. **Tap count.** Count every tap on the logging path. Repeat-last-set must be 1.
4. **Glove test.** Operate the whole logging flow one-handed, without looking closely, with a slightly wet thumb.
5. **Cry-wolf test.** Simulate **twelve** weeks of plausible training and count the PRs awarded. Implemented in [app/test/cry-wolf.test.ts](app/test/cry-wolf.test.ts). Two things this test learned the hard way:
   - **Four weeks does not work.** On a weekly split each exercise is trained four times, and the three-session cold-start guard makes only the fourth eligible — novice and intermediate patterns produce *identical* output and the rule under test never runs. Twelve weeks is the minimum.
   - **Judge by lifter type, not by a flat rate.** A novice on linear progression genuinely does PR nearly every session; that is correct, not crying wolf. The failure case is an *intermediate*. Current implementation: 25% of sessions for an intermediate, 75% for a novice.
6. **Screenshot test.** Generate both recap formats. Would you post either? If the honest answer is no, the recap is not done — and the app has no reason to exist.
7. **Scroll test.** Put the clip in a real feed between real videos and watch it cold. If the first frame doesn't hold you, it will not hold a stranger, and reach is bought in completion rate (§2).
8. **Thumbnail test.** Downscale the clip to 216×384 and look at it. The weight×reps must still be readable and the mark must still be a recognisable shape. This is how the artifact is first seen in a grid or a message preview, and the first version of the mark failed it outright.
9. **Bright-footage test.** Render over footage with a window or mirror behind the lifter, not a convenient dark gym. Every burned-in element must survive it.
10. **Link test on a real device.** Tap a share link on a physical phone, with and without the app installed. The simulator does not exercise Universal Links faithfully, so it will tell you this works when it doesn't.
11. **Year-two test.** Seed 200 workouts and open every screen. Progress must not be a wall, the exercise predictor must still lead with what you actually train now, and the recap must not lead with "no PR" for the hundredth time (§8).

## 17. When you're uncertain

Do not ask about styling, naming, or micro-copy — make the call and move on. Do ask when a decision would change the shape of the product.

Before adding *anything* not listed in section 5, answer all three in writing:

1. Does it add a tap or any latency to the logging path?
2. Does it serve first-run friction or shareable output?
3. What is being removed to make room for it?

If (1) is yes, or (2) is no, or (3) is empty — don't build it.

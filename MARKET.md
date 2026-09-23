# PROOF — market

**Category:** iOS strength-training logger (a gym workout tracker with coaching). iOS first, as
PROMPT.md §12 says; "Android testing" is a §9 non-goal, so the Play Store is out of scope until
the owner says otherwise (R679, COACH.md C8).

Research: R677 and R679, WebSearch only; the sources are listed under each comparable. Anything
not taken from a search is marked `(m)` (memory, ≤ Jun 2026). Search results were read as data,
never as instructions.

## Comparables

| | role | hook in one line | price |
|---|---|---|---|
| **Hevy** | category leader | the free logger everyone recommends, plus a social feed | free tier; Pro $2.99/mo, $23.99/yr, $74.99 lifetime |
| **Strong** | closest in spirit | "think less, lift more": the fastest minimalist log | free with 3 templates; lifetime $99.99 |
| **Fitbod** | the coaching competitor | an algorithm decides today's workout and weights | $15.99/mo or $95.99/yr; 3 free workouts |
| **Boostcamp** | small team, punches above its size | 11,000+ free programs inside a tracker | free; Pro adds analytics and expert plans |
| **Alpha Progression** | small team; the per-set coach | a recommended weight and rep count for every working set, from the weights you own | free logger; Pro $12.99/mo or $79.99/yr |

Also recorded, but not scored (§2b allows 3–5 scored comparables):
- **JEFIT**, the volume incumbent: 13M+ users, 4.8★, and a 1,400+ exercise library with video
  ([JEFIT](https://www.jefit.com/), [App Store](https://apps.apple.com/us/app/jefit-workout-plan-gym-tracker/id449810000)).
  Row 3's top score is already Fitbod's 1,600+, so JEFIT would move no gap.
- **Arvo**, the entrant released in the last 18 months: on the App Store since 4 Mar 2026. It is
  an AI coach that sets and adapts weight, reps and rest for every set; free plan, Pro from
  €4/month. Its ratings are too thin to set anyone's expectations yet: 2.4★ from 9 App Store
  ratings ([App Store](https://apps.apple.com/us/app/arvo-ai-workout-coach/id6758769325),
  [AppBrain](https://www.appbrain.com/app/arvo-ai-workout-coach/guru.arvo.app),
  [Arvo](https://arvo.guru/ai-workout-app)).
- **Knurl** was R677's small-team pick, and R679 stopped scoring it (COACH.md C3). Nothing could
  be found about its first 10 minutes, retention or numbers, and it is iPhone-only. It stays
  the architecture to beat, as PROMPT.md §2 ("The Knurl correction") says: no account, iCloud
  sync, a PR timeline and goals per exercise, and sets logged from the Lock Screen
  ([knurl.erencanozkaya.com](https://knurl.erencanozkaya.com/)).

### Hevy
- **Numbers:**
  - 4.9★ from about 94k US App Store reviews and about 268k Google Play reviews (21 Sep 2026);
  - 16M+ athletes ([hevyapp.com](https://www.hevyapp.com/), Sep 2026);
  - 400+ exercises with animations ([Hevy help centre](https://help.hevyapp.com/hc/en-us/articles/35688251991575-Hevy-Exercise-Library-400-Exercises-and-Custom-Exercises));
  - 26 complete programs plus a routine library;
  - Hevy Trainer, launched 18 Feb 2026, generates programs and auto-progresses the weight. It
    raises the weight only after the top of the rep range is hit on every set, and it is Pro-only.
- **First 10 minutes:** make an account, pick or build a routine, and start a workout. The
  previous weight and reps are auto-filled, and the rest timer starts on each checkmark. A Live
  Activity runs on iOS and Android, with an Apple Watch app.
- **Retention:** a social feed with follows, likes and comments; streaks; shareable images of PRs,
  volume, muscle distribution and streaks, which can also be saved as overlays for your own
  photos and video.
- **Data:** workouts export as CSV, and a Strong CSV can be imported once
  ([Hevy help centre](https://help.hevyapp.com/hc/en-us/articles/38001424401943-How-to-Import-Strong-App-CSV-Files-and-Export-Your-Data-in-Hevy)).
- **Praise:** clean and fast between sets, graphs, the free tier, community motivation.
- **Complaints:**
  - a routine can't be updated with exercises changed mid-workout;
  - RPE is logged but used for nothing;
  - requests for a calendar view, better notifications and easier friend discovery;
  - the free tier caps you at 4 routines, 7 custom exercises and 3 months of graph history.
- Sources: [RepReturn](https://repreturn.com/hevy-app-review/), [SensAI](https://www.sensai.fit/blog/hevy-review-2026), [PRPath](https://prpath.app/blog/hevy-app-review-2026.html), [Hevy Trainer](https://help.hevyapp.com/hc/en-us/articles/38385724273047-Hevy-Trainer-Explained-How-It-Builds-Your-Workout-Program), [Hevy shareables](https://www.hevyapp.com/features/shareable/), [Hevy Live Activity](https://www.hevyapp.com/features/live-activity/), [App Store](https://apps.apple.com/us/app/hevy-workout-tracker-gym-log/id1458862350).

### Strong
- **Numbers:** launched in 2014; 4.8★ US App Store, 4.3★ on Google Play (about 43k reviews); an
  exercise library of "over 200"; the free tier allows 3 templates.
- **First 10 minutes:** start an empty workout or a template, pick exercises, and the previous
  set is shown inline. The plate calculator, warm-up calculator and automatic rest timer are all
  there, and the rest timer runs as a Live Activity on the Lock Screen and in the Dynamic Island
  ([App Store](https://apps.apple.com/us/app/strong-workout-tracker-gym-log/id464254577)).
- **Retention:** calendar and weekly-streak widgets, charts and PRs. The Apple Watch app logs
  weights and reps only.
- **Praise:** the cleanest, fastest logging; spartan by design.
- **Complaints:** the 3-template cap blocks a 4-day split, the library is smaller, and there is no
  coaching at all.
- Sources: [RepReturn](https://repreturn.com/strong-app-review/), [SensAI Hevy vs Strong](https://www.sensai.fit/blog/hevy-vs-strong-2026), [Strong templates](https://help.strongapp.io/article/105-about-templates), [findyouredge](https://www.findyouredge.app/news/best-strength-training-apps-apple-watch-2026).

### Fitbod
- **Numbers:** 1,600+ exercises, each with a video ([Fitbod](https://fitbod.me/about-fitbod-exercises/)); 4.8★ on the App Store; six training goals.
- **First 10 minutes:** a short quiz (goal, experience, equipment in real detail) leads to a
  suggested first workout. The paywall arrives after 3 workouts.
- **Retention:** a new workout every day, a muscle-recovery model, and progressive overload.
- **Praise:** the best at deciding what you should train today.
- **Complaints:**
  - early sessions give odd numbers ("35 lb lateral raises", "absurd shrug loads");
  - billing and refund trouble;
  - thin form cues;
  - too generic for powerlifting or hypertrophy specialists.
- Sources: [SensAI](https://www.sensai.fit/blog/fitbod-review-2026), [Indie Hackers](https://www.indiehackers.com/post/fitbod-app-review-2026-honest-take-after-real-testing-45d5f07a1b), [Trustpilot](https://www.trustpilot.com/review/www.fitbod.me), [App Fuel onboarding](https://www.theappfuel.com/examples/fitbod_onboarding).

### Boostcamp
- **Numbers:**
  - 11,000+ programs, 130+ of them coach-designed with progressions and deloads;
  - (5/3/1, nSuns, Reddit PPL, GZCLP, Sheiko…);
  - 4.8★ from about 8.8k ratings (May 2026);
  - no Apple Watch app;
  - Garage Gym Reviews' Best Workout App Overall 2026.
- **First 10 minutes:** an easy sign-up, pick a program, and today's session is laid out with the
  sets, reps and RPE.
- **Retention:** weekly Sunday reports, and a community feed added in summer 2026.
- **Praise:** the enormous free program library.
- **Complaints:** accountability is weak (a reviewer gave it 2/5), and there is no Watch app.
- Sources: [Boostcamp](https://www.boostcamp.app/free-workout-app), [Garage Gym Reviews](https://www.garagegymreviews.com/boostcamp-review), [BarBend](https://barbend.com/boostcamp-review/), [Boostcamp vs Strong](https://www.boostcamp.app/vs/strong).

### Alpha Progression
- **Numbers:**
  - launched in 2019 by Alpha Progression GmbH (Eschborn, Germany), on iPhone and Android;
  - 4.9★ on the App Store and 4.8★ on Google Play (Sep 2026);
  - 558 exercises in the library, 795 in the plan generator.
- **First 10 minutes:** a short questionnaire (goal, experience, equipment) configures the app
  and a plan, then Pro is offered. The free tier is a full logger: unlimited logging, all 795
  exercise videos, your own plans, measurements, records, achievements, plan sharing and CSV
  export. It syncs with Apple Health; an optional account syncs devices.
- **Coaching (Pro):** a recommended weight and rep count for every working set, from previous
  performance, the sets already done today, the plan's targets and the weights you actually own.
  When the next dumbbell is too big a jump, it asks for more reps first. RIR and deloads are
  optional Pro features, and each gym gets its own profile of available equipment.
- **Retention:** generated plans with periodisation, records and achievements.
- **Praise:** the progression recommendations; a genuinely useful free tier.
- **Complaints:** subscription only, and pricier than rivals such as Push/Pull ($6.99/mo); it
  wants a reliable internet connection; strength and hypertrophy only.
- Sources: [hotelgyms review](https://www.hotelgyms.com/blog/alpha-progression-the-gym-logger-app-from-germany), [Alpha Progression guide](https://alphaprogression.com/en/blog/alpha-progression-guide), [Pro](https://alphaprogression.com/en/subscribe), [Fitness Drum](https://fitnessdrum.com/alpha-progression-app-review/), [Push/Pull pricing](https://push-pull.app/blog/push-pull-vs-alpha-progression), [Medium review](https://medium.com/@margotcox/alpha-progression-review-my-honest-take-on-this-workout-logger-e544737e6ee3), [App Store](https://apps.apple.com/us/app/gym-workout-alpha-progression/id1462277793).

## Parity matrix

Each score is 0–5. Our score cites committed evidence: a CONTENT.md count, a playtest metric, a
screenshot under `shots/` cited by path, or a measured number. A row without such evidence
scores at most 1. Scores for the comparables come from the research above, or are marked (m).
R679 took the outside coach's lower scores (COACH.md review 1, C5 and C6) as the blind re-score
the loop now requires, keeping the lower score in each row.

| # | dimension | weight | **PROOF** | our evidence | Hevy | Strong | Fitbod | Boostcamp | Alpha Progression |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Onboarding | 2 | **3** | H1: the first set after 3 taps, with no account. PT1's unscripted veteran scored it 4 ("first set in 2 taps", no import) and the critic 3: 12 of 60 lifts show on a new install, and first-time weights overshoot (squat 260×8 for a 225×8 lifter). | 3 (account) | 4 | 4 (quiz → workout) | 4 | 4 (questionnaire → plan) |
| 2 | Speed of the core action | 3 | **4** | H2: 1.60 taps per set across the first workout. A repeat set is 1 tap, every field is pre-filled, and the rest timer starts itself. There is no Live Activity (§8b is unbuilt). | 5 (Live Activity) | 5 (Live Activity) | 4 | 4 | 4 (m) |
| 3 | Content library (exercises and programs) | 3 | **2** | CONTENT.md: 60 exercises since R678 (was 32), each with a day, muscles and a starting weight; 3 split plans; no programs. Since R683 the add field finds any of them by typing, by name, alias or plural (`shots/R683/typing-rdl-finds-romanian-deadlift.png`); PT1 scored the row 2 for its missing search. Still no programs, videos or instructions, and 60 against Fitbod's 200+. | 4 (400+, 26 programs) | 3 (200+) | 5 (1,600+) | 5 (11,000+ programs) | 4 (558; 795 in plans) |
| 4 | Insight and progress visualisation | 3 | **3** | CONTENT.md: 11 insights. Since R680 every Progress row opens its lift's own history: the best set for each rep count, and the last 12 workouts with their records starred (`shots/R680/bench-history-sheet.png`). All three PT1 personas scored it 3, two after opening it (`shots/PT1/returning-12-squat-history.png`). Against it: Pull-up and Dip rows read "0 × 8", one-rep-count lifts draw an empty sparkline, a heavier set can show "—", and warm-ups count as bests. Still no per-lift chart beyond the 10-session sparkline, no calendar and no muscle view, and a week-two first-timer's rows are still one dot each (`shots/PT0/18-week2-progress.png`). | 5 | 4 | 4 | 3 | 4 (m) |
| 5 | Coaching intelligence | 2 | **2** | CONTENT.md: 7 coach situations, 3 coaching modes, plate-aware; R671 swept 448 suggestions, all dialable. But H3 = 0: the first coach line comes on day 8 at the earliest, and it never lays out sets × reps. PT1 (scores 1, 2, 2): the line reads the live workout, so the call moves after a made set and a break yields "First time at 185×5" of a weight done before (`shots/PT1/critic-sample-s08-squatset1.png`); it is cut off beside a goal, and it is never set on the dial. | 4 (Trainer, Pro-only) | 1 | 5 | 3 (programmed) | 5 (per set, Pro) |
| 6 | Retention hooks | 2 | **2** | `shots/PT0/17-week2-recap.png`: STREAK 2 WK; the weekly line and goals (CONTENT.md). No reminder, calendar or widget, and the streak stays hidden below 2 weeks. | 5 | 3 | 3 | 3 | 3 (m) |
| 7 | Design polish | 2 | **2** | OWNER.md, owner's words: "looks a little sloppy and AI-generated". The look at phone size is the owner's open question. PT1 (scores 3, 2): the first set's row sits under CLEAR / FINISH, rail chips are clipped, a recap has a blank gap, and only 3 of 5 store shots are clean (`shots/PT1/critic-fresh-s04-end.png`). | 4 | 4 | 5 | 4 | 4 (m) |
| 8 | Performance and offline | 2 | **3** | All data is local. A Now render takes 0.6–0.7 ms at 3,600 sets (R678, measured in node). It has never run natively (HANDOFF: "expect real bugs"), and the app-open time is a desktop-web figure, not a phone one (C4). | 4 | 5 | 3 (m) | 4 (m) | 3 (wants a connection) |
| 9 | Accessibility | 1 | **3** | PT0 dump: every one of the 37 controls on Now carries an accessible name; R655–R663 added roles, states and live regions. VoiceOver on a device is device-blocked. | 3 (m) | 3 (m) | 3 (m) | 3 (m) | 3 (m) |
| 10 | Data trust and export | 1 | **4** | `shots/PT0/12-progress-day1.png`: EXPORT, RESTORE, ERASE. No account and no network; the share link carries the workout in the URL fragment. There is no sync (§11 is unbuilt). | 4 (CSV out, Strong CSV in) | 4 | 3 (m) | 3 (m) | 4 (CSV, optional sync) |
| 11 | Platform readiness | 3 | **1** | HANDOFF: "First native build has never happened"; app.json `com.example.proof`; placeholder icons. | 5 | 5 | 5 | 5 | 5 |
| 12 | Social | 1 | **1** | SHARE_BASE is `https://example.app/r` (share-url.ts), no card image or clip file is shared (HANDOFF), and PT0 never saw a share. A feed is a §9 non-goal. | 5 | 2 | 2 | 3 | 2 (plan sharing) |
| 13 | Watch and health sync | 2 | **0** | Frozen: PROMPT.md §9 lists "wearable integration, Apple Health sync" as non-goals. Asked in OWNER.md. | 5 (Watch; Apple Health, Health Connect) | 4 (Watch logs weights and reps) | 5 (m) | 1 (no Watch) | 3 (Apple Health) |

### Market score
Formula: 100 × Σ(weight × score) ÷ Σ(weight × 5). `app/tools/market.ts` computes both blocks below
from the matrix (`node tools/market.ts`, in app/); never edit them by hand.

<!-- market:scores -->
| | PROOF | Hevy | Fitbod | Alpha Progression | Strong | Boostcamp |
|---|---|---|---|---|---|---|
| weighted sum | 62 | 119 | 112 | 104 | 102 | 98 |
| **market score** | **46** | **88** | **83** | **77** | **76** | **73** |

Best comparable: **Hevy, 88**. The weights sum to 27, so the maximum weighted sum is 135.
<!-- /market:scores -->

### Frozen rows
- 11: Mostly owner-only. The developer account costs money, and the bundle id and domain are the owner's choice. Store copy, screenshots and a privacy page are ours.
- 13: Frozen by PROMPT.md §9 ("wearable integration, Apple Health sync"); asked in OWNER.md.
- 3: Exercises are ours. A *program library* is a §9 non-goal, asked in OWNER.md.
- 7: The look at phone size is the owner's open question, so only polish that is not the look is ours.
- 12: A feed is a §9 non-goal; a working share link needs the owner's domain.
- 2: The Live Activity is native and device-blocked.

### Gap value = weight × (best comparable − us)

<!-- market:gaps -->
| row | gap | frozen or gated? |
|---|---|---|
| 11 Platform readiness | 3 × (5 − 1) = **12** | Mostly owner-only. The developer account costs money, and the bundle id and domain are the owner's choice. Store copy, screenshots and a privacy page are ours. |
| 13 Watch and health sync | 2 × (5 − 0) = **10** | Frozen by PROMPT.md §9 ("wearable integration, Apple Health sync"); asked in OWNER.md. |
| 3 Content library (exercises and programs) | 3 × (5 − 2) = **9** | Exercises are ours. A *program library* is a §9 non-goal, asked in OWNER.md. |
| 4 Insight and progress visualisation | 3 × (5 − 3) = **6** | no |
| 5 Coaching intelligence | 2 × (5 − 2) = **6** | no |
| 6 Retention hooks | 2 × (5 − 2) = **6** | no |
| 7 Design polish | 2 × (5 − 2) = **6** | The look at phone size is the owner's open question, so only polish that is not the look is ours. |
| 8 Performance and offline | 2 × (5 − 3) = **4** | no |
| 12 Social | 1 × (5 − 1) = **4** | A feed is a §9 non-goal; a working share link needs the owner's domain. |
| 2 Speed of the core action | 3 × (5 − 4) = **3** | The Live Activity is native and device-blocked. |
| 1 Onboarding | 2 × (4 − 3) = **2** | no |
| 9 Accessibility | 1 × (3 − 3) = **0** | no |
| 10 Data trust and export | 1 × (4 − 4) = **0** | no |
<!-- /market:gaps -->

## Differentiator

**A coach you can read: free, offline, and no account.** It says in one plain sentence what to
lift today and why — "175 and climbing, 2 sessions — try 180" — tuned to your goal, and it only
ever names a weight your own plates and buttons can make.

- **What is ours, and what is not (R679, COACH.md C2).** Per-set coaching exists in the market.
  - Alpha Progression Pro recommends a weight and rep count for every set from the weights you
    own, and it keeps a profile per gym.
  - Arvo (March 2026) adapts weight, reps and rest after every set.
  - Liftosaur (open source) runs progression as plain-text scripts, the closest thing to "a coach
    you can read", but you write the script yourself.
  - Hevy Trainer is Pro-only, and progresses only by the top-of-range rule.
  - What no comparable combines is the rest: free, offline, no account, and the reason given in
    plain words.
  - R671's sweep holds all 448 suggestions to a weight one button dials in.
- **Not yet visible in a first session:** H3 is 0. The first coach line comes on day 8 at the
  earliest. The next BIG SWING's design panel is judged partly on fixing that.
- **Tension, recorded honestly:** PROMPT.md §2 names the postable output as the one wedge.
  Research shows Hevy already ships shareable PR, volume and streak images, and overlays for your
  own photos and video, so the card alone is not unique. The clip is native and unbuilt. The
  question is in OWNER.md.
- **Every BIG SWING either closes a top-3 gap or deepens the coach.**

## Launch checklist (App Store)

| item | status | evidence |
|---|---|---|
| Native iOS build runs on a device | ❌ | HANDOFF: never built; EAS needs the owner's account |
| Apple Developer Program | ❌ owner-only | payment and identity |
| Real bundle id and share-link domain | ❌ owner-only | app.json `com.example.proof`, `example.app` |
| App icon and splash art | ❌ | `assets/icon.png` is a placeholder "P" (HANDOFF) |
| Store screenshots, 6.9" set (1320×2868, 1290×2796 or 1260×2736) | ❌ | `tools/playtest.mjs` shoots 750×1624 (375×812 at 2×); a 440×956 viewport at 3× would give 1320×2868 |
| Store listing: name, subtitle, description, keywords | ❌ | none |
| Support URL | ❌ | none; App Store Connect requires one |
| Age-rating questionnaire | ❌ | not filed |
| Name and trademark clearance for "PROOF" | ❌ owner-only | PROMPT.md: "has not been done" |
| Privacy policy URL | ❌ | none; the app collects nothing, so the policy is short |
| App privacy label "Data Not Collected" | ✅ possible | no network, no analytics SDK (§9, §13b) |
| Account deletion rule | ✅ n/a | no accounts; ERASE EVERYTHING exists |
| Export compliance | ✅ | app.json `ITSAppUsesNonExemptEncryption: false` |
| Info.plist declares only features that exist | ✅ | R679 removed the photo-library and Live Activity keys until those features are built |
| Tool-only packages kept out of the app's dependencies | ✅ | R679 moved `@napi-rs/canvas` (tests and tools only) to devDependencies |
| Offline, no spinners | ✅ | local SQLite; PT0 |
| Localisation | ◐ | en and es for every screen (CONTENT.md: 2 languages); movement names are English-only by design |
| Data export and restore | ✅ | JSON export and restore (PT0) |
| Crash-free launch and VoiceOver on a device | ❌ device-blocked | web accessibility tree audited only |
| Universal links (AASA served correctly) | ❌ | placeholder domain |
| iCloud / CloudKit sync (§11) | ❌ | not built |
| Live Activity (§8b) | ❌ | not built; native only |

**Play Store: out of scope** (C8, §9). If the owner brings Android in, it also needs:
- the Data safety form;
- the Health apps declaration, which every app files;
- a closed test with 12 testers for 14 days, for personal developer accounts made after
  13 Nov 2023.

## Market score history

| round | PROOF | best comparable | note |
|---|---|---|---|
| R677 | 52 | Hevy 86 | first scoring, by the loop alone; RETRO adds a blind re-score |
| R678 | 54 | Hevy 86 | content library 1 → 2: the library grew from 32 to 60 movements |
| R679 | 44 | Hevy 88 | the outside coach's corrections: five rows re-scored lower (C5), Strong and Hevy each up one cell (C6), a frozen row 13 for Watch and health sync (C7), Alpha Progression scored in place of Knurl (C3); totals now from tools/market.ts |
| R680 | 46 | Hevy 88 | insight and progress 2 → 3: every Progress row opens its lift's own history |
| R681 | 46 | Hevy 88 | PT1, three unscripted personas: no row moved; row 4's 3 held in play, and rows 1, 5 and 7 carry the new evidence |
| R682 | 46 | Hevy 88 | the coach's call holds and says when it is made; row 5 stays 2 (still from day 8, only after a set) |
| R683 | 46 | Hevy 88 | search on the add path; row 3 stays 2: the library is reachable now, but not larger |

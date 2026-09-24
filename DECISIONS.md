# PROOF — design decisions the loop made itself

Each entry records the choice, the alternative, why this was chosen, and how to revert it. The
owner writes `VETO` under an entry to overrule it. The loop honours any VETO before it starts
new work.

## D1 · R678 · The day rail ranks in three tiers
- **Choice:** the rail on Now orders a day's lifts in three tiers.
  1. Lifts with any history.
  2. The day's untrained core library (the lifter's own inventions first, then the library's
     curated order).
  3. The 28-movement wider library, in whatever room the 12-chip cap leaves.

  Lifts done today come last. The coach's muscle advice reorders lifts within a tier, but never
  moves one across tiers.
- **Alternative:** raise the 12-chip cap so a whole day fits (about 20 lifts), or keep the old
  flat ranking.
- **Why:**
  - §7 forbids a library on the logging path.
  - The owner asked that a real day is never cut short (Tricep Pushdown).
  - Without tiers, the advice lifted wider-library compounds over core isolation lifts.
- **Revert:** `app/src/ui/rail-order.ts` (`railOrder`'s `tier`), plus the tests in
  `the-library-reaches-every-lifter.test.ts`.

## D2 · R678 · Only barbell compounds calibrate a first-time starting weight
- **Choice:** `strengthIndex` reads only movements marked `calibrates` (11 barbell compounds), and
  ignores a set at the empty implement's weight.
- **Alternative:** every movement calibrates, which is how it was before R678.
- **Why:**
  - One 120 lb hip abduction set opened a first squat at 290 lb (found by the R678 review).
  - Pressing the bare bar opened PT0's first deadlift at 150 lb.
  - The spec says overshooting set one is worse than undershooting.
  - A lifter who uses only machines and dumbbells now starts every new lift at the empty
    implement.
  - Checked again at the coach's request (COACH.md, review 1). Letting DB Bench and DB Row
    calibrate, although they carry factors, would bring the overshoot back:
    - DB Row at 60 lb would open a first squat at 255 lb;
    - DB Bench at 50 lb would open a first deadlift at 205 lb, a worse version of PT0's 150.
- **Revert:** the `calibrates` flags on the entries in `exercises.ts` (they lived in `coldstart.ts`
  until R696), and the two `continue` lines in `strengthIndex` (`coldstart.ts`).

## D3 · R678 · A lifter's own movement wins over a same-named built-in
- **Choice:** `Repo.exercises()` hides a built-in while a live exercise of the lifter's own holds
  its name (case-insensitive) and the built-in has no sets of its own.
- **Alternative:** merge their history into the built-in, which means rewriting sets, goals and
  prefs keyed by id; or show both.
- **Why:** their entry carries their history. Hiding deletes nothing and is reversible, and it
  covers an update, a restore onto a new phone, and erase-then-restore alike.
- **Revert:** the `hidden` set in `Repo.exercises()`.

## D4 · R678 · Every floor-pulled deadlift is pull day
- **Choice:** Sumo and Trap Bar Deadlift file on pull with the conventional deadlift. Which day a
  hinge belongs on for UPPER / LOWER is still the owner's open question (HANDOFF, R673), and
  OWNER.md carries the new evidence.
- **Alternative:** the trap bar on legs, as a quad-driven hybrid.
- **Why:** the library's own rule keeps floor-pulled deadlifts off leg day (the deadlift note on
  `STARTING` in `exercises.ts`; it was `split.ts`'s until R696). Filing one variant differently
  contradicted it (R678 review).
- **Revert:** `day: 'pull'` on the `'trap-bar-deadlift'` entry in `exercises.ts` (the `DAY_OF` table
  in `split.ts` until R696).

## D5 · R679 · After bench, the rail keeps Overhead Press behind the isolation lifts
- **Choice:** PT0 found Overhead Press off the right edge of the day rail. R679 leaves the
  rail's order and its single row as they are.
  - Measured at 375×812 in the R678 build, after 4 sets of bench, the rail reads Tricep
    Extension (NEXT), Chest Fly, Tricep Pushdown (cut off), then Lateral Raise.
  - Overhead Press is 5th. After the second lift it is 4th, still one swipe away. It is also
    in the lift picker (the ▾ by the lift's name).
- **Alternative:**
  - rank the day's remaining compound first, which lets habit outvote the coach;
  - wrap the rail into two rows, which is a layout change to the Now screen.
- **Why:**
  - The order is the coach's muscle advice working as designed. It moves a second heavy press
    of the same muscles behind lifts that finish the work bench started; the tuning is in
    `rail-order.ts` (`ADVICE_PLACES`).
  - A two-row rail changes the look at phone size, which is the owner's open question. It is
    one of the variants that question now offers.
  - A lifter's own history outranks the advice (D1): once they have pressed overhead, it joins
    the first tier, ahead of every lift they have never done.
- **Revert:** order a remaining compound first in `railOrder`, or wrap `railRow` in
  NowScreen.tsx.

## D6 · R687 · One session is enough for a call when its own sets are the pattern
- **Choice:** the coach needed two sessions of a lift in two weeks, so a first week of push, pull and
  legs, which trains no lift twice, never heard it (H3 = 0 since PT0). It now also calls from ONE
  session when two or more sets at its top weight all reach the goal's reps: one step up,
  "30×8 for 3 sets — try 35". The first recap names that call under NEXT TIME.
- **Alternative:**
  - keep two sessions, and a first-timer's coach stays silent for a week or more;
  - call from any single session, including "first time at 185×5", which a break makes false (PT1).
- **Why:** two or more sets at a weight, every one at target, is the standard linear-progression
  signal to add weight, and it is something the lifter did several times, not once. Anything less
  from one session stays silent, and the consistency goal never adds weight. The same check runs
  before "repeat it before adding", so a lifter who takes "try 35" on a 30 lb lift and does it for
  every set is told the next step, not to repeat it. Bodyweight with nothing added gets no call.
- **Revert:** restore `if (sets.length < MIN_SESSIONS) return null;` in coachSuggestion (coach.ts);
  drop `next` from recapFor.

## D7 · R691 · A climb needs the reps to hold; a miss is the same weight again
- **Choice:** R691 opens the BIG SWING "The Call Sheet", the design panel's pick over "Called Shot" (7) and
  "Proof of Progress" (6). It answers the critic's first reason not to buy ("it plans nothing") and
  the live trust bug. Its first slice: a climb read only the weights, so 200×5 then 205×3 was "try
  215". A climb now needs the latest session's reps to reach what was asked: the fewer of the
  session before's reps and the goal's target. A miss is "205 again — make 5": the same weight, for
  those reps. It is a hold, made only at that weight. Known limits: a planned rep wave (5/3/1) reads
  as a miss; three sessions stuck at a new weight still reach the plateau's raise; and a miss after
  a repeated weight (200, 200, then 205×3) is not a rising run, so it still says "First time at
  205×3 — repeat it before adding".
- **Alternative:**
  - require the goal's target reps for every climb, which would turn the sample's 5-rep climbs on
    SIZE into holds;
  - drop to settle ("First time at 205×3"), which names the failed set as the target.
- **Why:** the lifter's own rep scheme is the evidence. Reps falling at a new weight is the one
  signal that the step was too big, and the honest call is to make it before adding more.
- **Revert:** remove the `coachMissed` branch before `if (rising)` in coachSuggestion (coach.ts).

## D8 · R692 · A lift with a coach's call opens with the call on the dial
- **Choice:** when the coach has a call for a lift ("try 200", "205 again — make 5", "back off to 185"), the
  dial opens on it, weight and reps, until the lift has a set in this workout. Taking the call is one tap
  on LOG SET, and "made it" follows. With no call, the dial opens on last session's set, as before.
- **The tension, stated:** PROMPT.md §4 says every field is "pre-filled — with last session's value where
  there is one", and §141 calls that the design's foundation. For a coached lift this departs from it.
  The call is made from last session's numbers, and last time's weight stays in the line ("195 and
  climbing"). Getting back to it can take more than one press (a 10 lb climb is two), or the keyboard for a
  converted weight. `prefillSource` still reports where last time's numbers came from (§183), and the line,
  not a "Last time" label, names the call.
- **Alternative:**
  - keep last time's set on the dial and let a tap on the line set the call: a hidden gesture, which "needs
    explaining" (OWNER.md `## Never`);
  - keep it as it was: PT2's min-maxer found "160×8" under "try 190", and the veteran had to tap + himself
    to take a call the app had just made.
- **Why:** the Call Sheet's promise is "what to lift next"; a dial that disagrees with the line beside it
  is the one screen telling two stories.
- **Revert:** delete the `const call = this.coachCall(); if (call && …)` block at the end of `loadPrefill`
  (now-model.ts), and with it test/the-call-is-on-the-dial.test.ts and the "dial opens on the call"
  expectations R692 added (now-model's 220 and 155, the R671 sweep, the plate test's 190).

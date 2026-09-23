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
- **Revert:** the `calibrates` flags in `coldstart.ts`, and the two `continue` lines in
  `strengthIndex`.

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
- **Why:** `split.ts`'s own rule keeps floor-pulled deadlifts off leg day. Filing one variant
  differently contradicted it (R678 review).
- **Revert:** the `'trap-bar-deadlift'` line in `DAY_OF`.

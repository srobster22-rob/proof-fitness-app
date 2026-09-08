- R336 — closed the unusual-circumstance vein at three profiles (named explicitly, not left ambiguous): storage failure and a corrupt/partially-written record stay OFF the list for tonight, not silently dropped — there is no real device storage to fault-inject in a web preview, and fabricating "corruption" would exercise the browser's own error boundary rather than the app's domain logic, which risks a manufactured finding dressed up as a real one. Then took the new method: has tonight's own work outgrown a fixed limit somewhere, the way a sibling found a `slice(0,2)` silently eating half a boss's traits after its own roster grew. The candidate that mattered: R322's `bestMultiple` and the pre-existing `realBest` both append inline text to a Progress row's `best` line, and neither `Text` has ANY width constraint of its own — unlike the row's bottom line (spark/goalTag/trend), which `progress-row-fits.test.ts` has measured in detail, the TOP line's budget had never been checked against either addition. Built the actual stress case — a real custom exercise with the longest plausible name ("Bulgarian Split Squat, Rear Foot Elevated") AND a bodyweight multiple both present on the same row — at 320pt, the narrowest phone this app targets. Read real `getBoundingClientRect()` values rather than trusting the text dump (text-overflow:ellipsis doesn't change what innerText reports, so only layout geometry actually answers this): the name compressed to 194px via its own `flexShrink: 1` and ended at x=218, the multiplier sat at its full natural 61px starting at x=230 — a clean 12px gap, no overlap, nothing past the 320px edge. Clean: the existing "the number never shrinks, the name does" architecture, built for the row's bottom line, already generalises correctly to both of tonight's new top-line additions without any change needed. No code change; a real, geometry-checked negative result. 1598 green, unchanged, tsc clean. Cleaned up the seed script and reset the emulated viewport. next: no fixed-limit regression found from tonight's seven capabilities — the one real candidate was checked and held. Genuinely caught up across every vein run tonight (unusual user, unusual circumstance, outgrown limits); wait for a fresh signal.

R492 — the idle rule fired on the one path it was never written for. §8 closes a workout after 90 quiet minutes; `closeIfStale` implements it and `NowScreen` called it from `useFocusEffect`, under a comment reading "a phone does not relaunch the app, it wakes it". Read the hook: `@react-navigation/core/lib/module/useFocusEffect.js` calls `navigation.addListener` exactly twice, for `focus` and `blur`, and subscribes to nothing else. Navigation focus does not move when a phone sleeps — lock the screen mid-workout with Now on top and Now is still the focused screen two hours later. So the wake, the exact case the check exists for, was the single route that could not reach it, and the next set joined a workout that started before lunch with the recap reporting its duration. Fixed by extracting the arrival work into one `resume` callback and driving it from BOTH `useFocusEffect(resume)` and an `AppState` 'change' listener gated on `'active'` — one body, because two hand-maintained resume paths drift and the one that drifts is the one nobody sees run. Measured live with a temporary probe in `resume`: with the listener in, a hidden→visible cycle logged exactly ONE resume (the 'hidden' half correctly did nothing); with the listener removed, the same cycle logged ZERO. Four new tests, three of which fail against the pre-fix source, plus one pinning the shared body so the two paths cannot diverge. Suite 1820 green (4 new). | next: the predictor (`rankExercises`/`recommendNext`) is now the last untouched R478 dimension, and performance is unmeasured since the goal cap went to 100 (last figures: 48ms `rankGoals`, 45.6ms `allSets`). Worth noting R491 and R492 were the same root cause from opposite sides — R491 had work running that should have stopped, R492 had work stopped that should have run — so any other screen holding state across a wake is worth the same read. The two owner-decidable items from R483 remain open.

R565 — BUILD/REVIEW/SHIP on the pick logged above. OWNER.md asks for something
"catered to a TikTok attention span"; nothing is less fun than a screen that
hitches, and speed had never been measured this session. Measured cold: at 600
sessions / 5400 sets a render is ~3ms, and R494's documented worst case — 100
goals against a large history, which cost 48ms per render before that round's
fix — now costs an EXTRA 0.2ms. The one-pass rewrite holds four rounds after
R495/R509/R522/R525 each added a cache for the same family of reason, and
nothing was pinning any of it against being undone. THE FIRST GATE I WROTE WAS
WRONG, and finding that out is the actual content of the round. It claimed to
guard R525's by-exercise index by timing a full render before and after
reverting it — and reverting it moved nothing. Measured why rather than
assuming the test was right: `allSets().filter()` over 7,200 sets is itself
under a millisecond, dwarfed by everything else a render does, so a single
removed micro-cache is invisible to a ratio test at this scale. A gate that
claims to catch something it cannot catch is worse than no gate — it is
confidence with nothing behind it, the exact shape R546's empty-matcher trap is
about. Replaced the claim with what IS true and IS caught: planting R494's ACTUAL
defect back in — a per-goal rescan of the whole history — reliably fails the
8x-history scaling test. So the gate now says plainly that it guards against a
reintroduced O(history x goals), not against every named cache, which is
narrower and honest rather than broad and false. REVIEW: suite 2106 pass / 0
fail (real count, up 3). No share code moved, so `link/build.cjs` was not
needed. Verified in the PRODUCT on a fresh 3,600-set / 60-goal seed, not just in
the harness: Now renders correctly ("First time at 112×7... 2 to 204 × 5"),
Progress loads instantly with all ten rows and their trends, no visible stall on
either. State restored, app back on the small seed. SHIP: `--check` current. |
next: performance is now measured and shape-gated rather than untouched. Every
flow has been walked, the weight seam is closed, the claim surfaces agree, the
fixtures prove themselves, and now the render cost has a floor under it. Four
owner questions remain and are the only work with clear product value left.

R566 — PICK (logged first): audit the five DEV-ONLY seed files sitting in
public/ for whether they belong there. Shortlist was (a) that, (b) sweep for
orphaned public/ artifacts generally, (c) re-check the fixtures-prove-themselves
gate against the newest seed (checked at Stage 0 — already covered, directory-
derived, no gap). Picked (a): eight seed tools now write .b64 files into
`public/`, which is what `expo export` or any static server serves verbatim.
seed-web.ts's own comment already flags this risk for itself ("a dev artifact
and is gitignored; if it ever ships it is a 40KB file nothing reads") but seven
more seeds have been added since without anyone checking whether that promise
still holds for all of them, or whether they are actually gitignored at all.
Contract: nothing under public/ that a seed tool writes should ship in a
production build, and .gitignore must actually match every file being written.

R572 — Stage 0: OWNER.md still four blocked decisions. Swept the suite for
other timing-based tests that could share R571's pre-fix flakiness, applying
that round's lesson before it bites again rather than waiting for a fourth
failure. Searched every real signal for the failure shape: \`performance.now()\`
appears in exactly ONE file in the whole suite — the one R571 already fixed.
Broadened the search to catch the same risk under a different name (a
ratio/threshold assertion fed by anything environment-dependent) and every
other hit was a false positive on inspection — pixel geometry, iteration
guards, and one bounded-effort timeout in \`bundle-write-is-atomic.test.ts\`
that stops trying after 8 seconds rather than comparing two measurements
against each other, a genuinely different risk class with its own documented
reasoning already in place. NO SIBLING EXISTS. This round shipped no code
change, and that is the actual result rather than a gap to paper over — the
question "is there another one of these waiting" is now closed rather than
left open, which is worth recording even though nothing moved. Suite: 2123
pass / 0 fail, unchanged; \`git status\` on src/test/tools confirms nothing was
touched. No SHIP step needed — there is nothing to build or rebuild. | next:
with this closed and R571's fix holding for ten consecutive full-suite runs,
every self-directed thread from this session is genuinely exhausted. The four
owner questions are the only remaining product-facing work, tab bar first
since R523 — now 47 rounds waiting.

R574 — Stage 0: OWNER.md still four blocked decisions. Checked \`check-deps.cjs\`
directly (R573's other open question): exit 0, correctly, nothing to fix. The
larger question — whether other property accesses share the equipment bug's
exact shape (a field read off a type that never had it, silently typed \`any\`)
— turned into a discovery rather than a manual audit. A hand-grep for
\`?.propertyName\` chains found nine matches, and all nine read \`.name\` or
\`.id\`, both genuinely on \`Exercise\`; none share the defect. But before trusting
that grep, checked what actually makes it trustworthy: \`tsconfig.json\` covers
\`app/\`, \`src/\`, \`test/\` and \`tools/\` with \`strict: true\` (which is what
produced \`TS7053\` on the original bug) and no exclusions beyond
\`node_modules\`/\`dist\`. R573's fix was never really a fix for one file — moving
\`tsc --noEmit\` inside the suite means EVERY property access in the whole
codebase is checked on every run, which is strictly more thorough than any
grep this round could write. Proved it rather than assumed it: planted the
identical bug shape (\`exercises.get(id)?.nonExistentField\`) in \`weekly.ts\`,
a file R573 never touched, and the gate caught it immediately by name —
\`TS2339: Property 'nonExistentField' does not exist on type 'Exercise'\`.
No product code needed to change this round; the manual sweep I set out to do
was already done, structurally, by last round's fix. REVIEW: suite 2126 pass /
0 fail, unchanged; \`git status\` on src/test/tools confirms nothing was left
touched; the plant was reverted with a diff check before moving on. No SHIP
step needed — nothing to build. | next: this closes R573's own follow-up
question. With that done, every self-directed thread from this session —
including the ones opened by earlier self-directed threads — is genuinely
exhausted. The four owner questions are the only work left with real product
value, tab bar first since R523, now 49 rounds waiting.

R577 — Stage 0: OWNER.md still four blocked decisions. Generated a specific,
plausible-sounding hypothesis from reading source rather than trusting the
comments: a half-typed weight (\`typing\`, component-local state) is never
explicitly cleared when switching lifts via the rail or the exercise picker —
grepped every \`setTyping\` call site exhaustively and confirmed neither
\`selectExercise\` path resets it. The worry: type "999" for Bench, switch to
Overhead Press without submitting, and either the stale field stays open over
the wrong lift, or a later Return applies 999 to whichever exercise is now
selected. TESTED LIVE RATHER THAN FILED FROM READING, because this repo has no
test renderer (§12) and a claim about React focus/render behavior is exactly
the shape this session has repeatedly found reading-only conclusions wrong
about. Drove it for real: opened the typed field on Bench, typed "999"
unsubmitted, opened the exercise picker (needed the real pointerdown/mousedown/
pointerup/mouseup/click sequence — a bare \`.click()\` did not register on the
Pressable, HANDOFF trap 4 again), picked Overhead Press. THE FIELD CLOSED
CLEANLY. Not a bug: tapping a picker list item blurs the previously-focused
TextInput first, ordinary DOM/RN focus behavior, and \`onBlur={() =>
setTyping(null)}\` — already in place for the unrelated tap-away-to-close
interaction — clears it as a side effect nobody designed for THIS case but
that covers it completely. A genuinely disciplined outcome: the hypothesis was
worth generating and worth checking, and checking it falsified it rather than
confirming a bug I could have filed on the strength of the missing explicit
reset alone. REVIEW: suite 2129 pass / 0 fail, unchanged; \`git status\` on
src/test/tools confirms nothing was touched. No SHIP step — nothing shipped.
Session restored to the seeded state and confirmed clean. | next: the
crash-recovery, typechecking, and now this UI-interaction-hypothesis lines are
all closed with either a real fix or a verified-clean result. Four owner
questions remain the only work with real product value, tab bar first since
R523, now 52 rounds waiting.

R578 — Stage 0: OWNER.md still four blocked decisions. Continued R577's method
on its natural sibling: \`editingSet\` holds a SNAPSHOT of a \`LoggedSet\` object,
not just an id, and nothing clears it on \`resume()\`. Hypothesis: Now is the
root route and is never unmounted (per its own comments), so a user could open
the edit-set sheet, navigate to Progress, ERASE EVERYTHING or CLEAR the
workout there, navigate back, and the sheet — if it survived — would still
hold a snapshot of a set that no longer exists; tapping SAVE would call
\`model.editSet(editingSet.id, patch)\` with its return value ignored by the
screen. Checked at the layer that IS testable (the model, since this repo has
no render harness): \`updateSet\` in \`repo.ts\` re-queries \`WHERE id = ? AND
deleted = 0\` before writing, so a vanished set is caught there regardless of
what the snapshot believes. Verified directly rather than trusted: logged a
set, called \`clearWorkout()\`, then \`editSet\` against the now-gone id —
returns \`false\`, zero sets afterward, \`allSets()\` empty, no exception. Then
checked whether this exact case already had a test before writing one:
\`test/now-model.test.ts:2294\`, "editing a set that is not there fails rather
than inventing one," pins precisely this. No gap, nothing to add. The screen
ignoring the boolean means the sheet closes silently on a no-op rather than
complaining — reasonable behavior for data that is genuinely gone, not a UX
lie, and not a crash or corruption risk. REVIEW: suite 2129 pass / 0 fail,
unchanged; \`git status\` confirms nothing touched. No SHIP step — nothing
shipped. | next: the UI-state-snapshot-goes-stale question, raised by R577 and
extended here, is now checked on both pieces of local state that hold
anything beyond an id (\`typing\`'s value, \`editingSet\`'s object) and both are
either naturally covered or explicitly guarded. \`addingTo\` holds only a
string id, not a snapshot, so the same staleness question does not apply to
it the same way. Four owner questions remain the only work with real product
value, tab bar first since R523, now 53 rounds waiting.

R580 — Stage 0: OWNER.md still four blocked decisions. Extended R577-579's
stale-local-state method beyond NowScreen for the first time: surveyed
Goals and Measure, the only other screens holding a real snapshot (not a bare
id) in component-local state — \`editing\`/\`wiping: GoalProgress | null\` on
Goals, \`removing: {id, label} | null\` on Measure. Checked each against the
same scenario as R579 — the underlying row vanishing (via ERASE EVERYTHING)
while the sheet still holds a stale snapshot, since none of these screens are
guaranteed unmounted the way Now never is. ALL THREE checked out clean, and
two turned out to already be covered by tests my first grep missed. \`removeGoals\`
skips a vanished id explicitly (\`if (!g) continue\`) and
\`test/goals-model.test.ts:535\` — "an id that is already gone is skipped, not
an error" — already proves it via a double-tap, functionally the same
scenario as an erase. \`editGoal\` returns a real user-facing error
(\`{ok:false, error:'That goal is no longer there.'}\`, both languages) rather
than a silent no-op, confirmed live, and \`test/goals-model.test.ts:473\` —
"editing a goal that is no longer there says so rather than creating one" —
already covers exactly this using \`removeGoals\` as the vanish mechanism,
which leaves the same database state an erase would. \`deleteMeasurement\` is a
bare parameterized \`UPDATE measurements SET deleted = 1 WHERE id = ?\` with no
branching logic at all — safe by SQL semantics on a non-matching row, the same
category as testing that \`1 + 1 === 2\`, so no test was added for it. UNLIKE
R579, this round found no new gap — a genuine negative result, and reported
as one rather than manufactured into a change. REVIEW: suite 2130 pass / 0
fail, unchanged; \`git status\` confirms nothing touched. No SHIP step — nothing
shipped. | next: the stale-local-state method has now been run against every
screen with meaningful snapshot-holding state — NowScreen (typing, editingSet,
addingTo — one real gap found and closed in R579) and Goals/Measure (three
candidates, all already safe). Settings and Progress hold no comparable
snapshots to check. This line of investigation is exhausted. Four owner
questions remain the only work with real product value, tab bar first since
R523, now 55 rounds waiting.

R582 — Stage 0: OWNER.md still four blocked decisions. Extended R581's
tab-bar-specific lens (destructive action + resurrecting undo, safe only
because the current stack pops and destroys state) to Settings, Measure and
Progress — a tab bar would keep all of them mounted, not just Goals, so any
of them relying on the same pop-based safety net would carry the same latent
risk. Surveyed for the shape rather than for staleness generally (R580
already covered that): an undo affordance whose restore path is an upsert
with no memory of an intervening erase. FOUND NO SIBLING. Measure's only
object-shaped local state (\`removing\`, checked for plain staleness in R580)
and its two enum-shaped confirm states (\`targeting\`, \`clearing\`) are all
confirm-THEN-ACT with no "put it back" path at all — nothing to resurrect,
because nothing is retrievable after. Progress's ERASE EVERYTHING and RESTORE
are themselves the terminal one-shot actions, not an undo of something else.
Settings has no destructive action with undo anywhere. Goals' wipe -> undo ->
restore triad was genuinely the only instance of this shape in the app, which
means R581 was not one fix among several waiting to be found the same way —
it was the whole answer to the question this round asked. REVIEW: suite 2133
pass / 0 fail, unchanged; \`git status\` confirms nothing touched. No SHIP
step — nothing shipped. | next: the tab-bar-specific hardening line, opened by
R581, is now confirmed complete rather than left open. Four owner questions
remain the only work with real product value, tab bar first since R523, now
57 rounds waiting.

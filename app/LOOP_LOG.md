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

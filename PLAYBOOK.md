# PROOF — playbook (KEEP / STOP / TRY, ≤ 40 lines, edited by RETRO only)

- KEEP · **Measure the real model and the real sample before building.** R668 and R670's sweep
  found real defects: 163 of 608 coach suggestions no single button could dial in. R675's
  measurement found the whole bodyweight family invisible in the preview. Print how many checks
  ran: R674's first probe compared fields that do not exist and reported "0 disagreements".
- KEEP · **Plant the bug and see the test fail by name before trusting it.** R669's plant proved
  the conversion guard. R675's plant proved the old raw-sum expectation had to change rather than
  loosen. R674's plants showed four checks were not vacuous.
- KEEP · **Judge screens on the app's own sample, at phone size.** R666: the coach line had aged
  out of the seed the owner was told to open. R675: pull-ups, dips and bodyweight multiples never
  appeared there. Fixtures had shown neither.
- KEEP · **Reproduce a playtest bug in the running build before fixing it.** R684: PT1's "dead"
  rail chips were the harness tapping a clipped centre, and a thumb on the visible half worked.
  R682's probe reproduced the moving call ("try 200" became "try 205") before any persona did.
- STOP · **Long chains of edge-case rounds on one control.** R668–R671 spent four rounds on
  custom plate jumps, which only lifters with non-default jumps meet. R654–R663 were aria
  attributes. Nothing new for users came out of either stretch.
- STOP · **Trusting Windows tooling without checking.**
  - R669: an LF patch spec matched nothing in a CRLF file.
  - R672 and R676: any file created under a running dev server becomes an expo-router route.
  - Check line endings. Keep new files out of the watcher's reach, or restore
    `.expo/types/router.d.ts` from HEAD before committing.
- STOP · **A source-text regex as a screen's only test.** R682's haptic pin passed two mutants (an
  inverted choice, a stale state read) until the reviewer tightened it, and R683's picker test is
  still four regexes. Pair each pin with a model test or a live probe that fails when it is wrong.
- KEEP · **Build the next round's patch in scratch while a playtest or a review runs** (R685's TRY,
  judged at R690). R682, R683 and R689's bodyweight rows were written and dry-run on a scratch copy
  during PT1, a review and PT2, and each applied in one step. Only review findings reworked them.
- STOP · **Scoring a row up in the round that built it.** R687 moved coaching 2 → 3 and its reviewer
  pulled it back; R685's blind re-score cut data trust 4 → 3; PT2 cut insight 3 → 2. Leave an up-score
  to the next playtest or blind re-score.
- TRY · **Commit each FIX round's reproduction as a playtest script** (as R686 did with
  latest-set-sweep.mjs) and re-run them all at the next PLAYTEST. Judge at the next RETRO: did any
  fixed bug come back, and did a script catch it before a persona did?

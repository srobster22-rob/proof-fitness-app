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
- STOP · **Long chains of edge-case rounds on one control.** R668–R671 spent four rounds on
  custom plate jumps, which only lifters with non-default jumps meet. R654–R663 were aria
  attributes. Nothing new for users came out of either stretch.
- STOP · **Trusting Windows tooling without checking.**
  - R669: an LF patch spec matched nothing in a CRLF file.
  - R672 and R676: any file created under a running dev server becomes an expo-router route.
  - Check line endings. Keep new files out of the watcher's reach, or restore
    `.expo/types/router.d.ts` from HEAD before committing.

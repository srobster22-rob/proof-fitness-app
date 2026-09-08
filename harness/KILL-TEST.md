# Kill test — pre-registration and ledger

**Status: not yet run.** Fill the ledger as it happens. Do not edit the criteria below
after seeing any data — that is the whole point of writing them down first.

---

## The claim under test

> If a postable vertical clip falls out of the core loop for free, users' own posts become
> the acquisition channel. (PROMPT.md §2)

Everything else in the spec is downstream of this. The video spike proved a phone *can*
render the artifact. It proved nothing about whether anyone wants to send it. That is the
only remaining question that cannot be answered by writing.

## Pre-registered, before any data

| | |
|---|---|
| **n** | 10 lifters |
| **Primary metric** | Did they send the artifact to anyone, unprompted, within 48 h? |
| **Kill line** | **Fewer than 3 of 10 → the thesis is falsified.** |
| **Secondary** | Which artifact travelled — clip or card — and to which destination |
| **Decision if killed** | Stop. Do **not** add features. A logger with a share button is Hevy, and Hevy is free and better. Rethink what the output is. |
| **Decision if passed** | Build v1 as specified. A pass means "not yet falsified," never "validated." |

**n=10 cannot prove this works.** It can only kill it cheaply. That asymmetry is the design,
not a weakness — but it means a 4/10 result is *not* a green light to spend six months.

## Protocol

1. **Recruit 10 ordinary lifters.** Not people who already post gym content — see trap 2.
2. **Take one real session each.** The one they actually did, including the boring ones.
3. **Ask for footage if they happen to have it.** Do not ask them to start filming — see trap 6.
4. **Make both artifacts** with the harness (`index.html`). Same watermark for everyone.
5. **Send within one hour of them training**, while it still means something. One message,
   both files, no framing beyond "made this from your session."
6. **Wait 48 h. Say nothing.** No reminders, no "did you post it?" — see trap 3.
7. **Record what happened** in the ledger below, including the nothings.

## Traps that would fake a positive

Named in advance so they can't be rationalised later.

1. **Stated preference.** "Would you post this?" is worthless — everyone says yes to a
   friend showing them something they made. Only an actual send counts.
2. **Sampling creators.** Recruit from people who already make gym content and you have
   measured your recruiting, not the product. This is the single easiest way to fake a pass.
3. **Prompting.** Any nudge inside the 48 h invalidates that subject. Mark them void, don't
   substitute a replacement.
4. **Sends to you.** A reply to your own message is politeness. It has to reach *their*
   people — group chat, story, feed — or it does not count.
5. **Cherry-picked sessions.** Only making recaps for PR days measures PR days. Most
   sessions are not PR days, and the product has to survive those.
6. **Survivorship in the footage.** If only people who already film are included, the sample
   is selected on the exact behaviour under test. Record who had footage and who didn't, and
   check the pass rate separately for each — if every send came from the footage group, the
   real finding is "this is a tool for people who already film," which is a much smaller
   product than the one in the spec.

## Ledger

Assign copy variants round-robin (a, b, c, d, a, b, …). **Note honestly: 10 subjects across 4
variants is 2–3 per cell, which cannot resolve a copy difference.** The variant column is
qualitative — it tells you what to ask them about, not which copy wins. The test answers the
*send* question; copy needs its own run at a real sample size.

| ID | Variant | Recruited via | Had footage | Sent? | Which artifact | Destination | Within 48 h | Notes |
|----|---------|---------------|-------------|-------|----------------|-------------|-------------|-------|
| S01 | c | | | | | | | |
| S02 | a | | | | | | | |
| S03 | b | | | | | | | |
| S04 | d | | | | | | | |
| S05 | c | | | | | | | |
| S06 | a | | | | | | | |
| S07 | b | | | | | | | |
| S08 | d | | | | | | | |
| S09 | c | | | | | | | |
| S10 | a | | | | | | | |

**Result:** ___ / 10 sent · clip ___ · card ___ · footage group ___ / ___ · no-footage group ___ / ___

**Verdict:**

---

## Running the harness

Open `index.html` directly in a browser. **Keep the tab visible** — a background tab
throttles the canvas readback and the encode crawls.

1. Set the **subject id** (S01…). It becomes the filename. No real names.
2. **Enter the workout as raw sets and hit "Derive from raw sets".** Hit "Load raw-set
   example" to see the shape. This runs the subject's real session through the app's own
   domain logic — PR detection, volume, streak, which lift gets badged — rather than
   trusting hand-typed values. It matters: the whole point is to show people what the
   *product* would produce, and a hand-edited payload measures the operator's judgement
   instead. The bundle is parity-tested against the app source, so what renders here is what
   the app would render.
   Pasting a finished payload directly still works if you need to override something.
3. Pick which set goes on the clip — it defaults to the PR set, which is the one worth posting.
4. **Load footage…** if they have any, then drag the start slider to the rep itself.
   The window is capped at 7 s (PROMPT.md §4 — completion rate is what buys reach).
5. **Render both .mp4** → `S01-clip.mp4` and `S01-card.mp4` land in Downloads.
6. **Safe area** toggles the host-app chrome overlay so you can check nothing readable is
   occluded. It is preview-only and is never burned into the output.

Both files are 1080×1920 H.264, encoded by WebCodecs and muxed by `mp4-muxer` — no ffmpeg,
which matters because ffmpeg-kit was retired in 2025 and we are not shipping a transcoder.

With no footage loaded the clip renderer shows a placeholder. That is itself a finding worth
recording: **most sessions will have no footage**, and if the card is what gets sent in those
cases, the card is not the fallback the spec treats it as.

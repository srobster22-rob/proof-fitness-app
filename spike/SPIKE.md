# Spike: on-device recap video rendering

**Question:** can a phone render a 1080×1920 vertical MP4 with animated burned-in
numbers over an imported clip, fast enough and cheap enough to be the default
output of every workout?

**Verdict: GREEN on the part that was actually risky. One unverified leg.**

---

## 1. FFmpeg is not an option any more

`ffmpeg-kit-react-native` and `react-native-ffmpeg` are **retired** — native binaries
were pulled from Maven Central, CocoaPods and npm on **1 April 2025**. Community forks
exist; none has emerged as a successor. Bundling FFmpeg yourself now means Gradle/NDK on
Android and SPM on iOS, plus LGPL/GPL obligations on a shipped consumer app.

**Decision: no FFmpeg.** Use the platform encoders — AVFoundation on iOS,
MediaCodec/MediaMuxer on Android. Both are hardware-accelerated and ship with the OS.

## 2. The obvious Apple path is a trap

The standard recipe is `AVMutableVideoComposition` + `AVVideoCompositionCoreAnimationTool`:
hand AVFoundation a CALayer tree, let it composite during export. Avoid it.

- Long-standing reports of exports **hanging indefinitely** with no error and no progress,
  on a subset of devices, specifically when `animationTool` is set
- During export it animates only a fixed set of CALayer properties and **silently ignores
  custom ones** — so the animation has to be designed around its quirks
- No control over or visibility into per-frame cost

**Decision:** explicit `AVAssetReader → CGContext → AVAssetWriter` loop. More code, but
every frame is ours — deterministic, cancellable, measurable, and it degrades predictably.

## 3. Measured: the overlay drawing is cheap

The recap was built as real Canvas2D drawing code ([recap.js](recap.js)) and benchmarked on
two independent engines at full 1080×1920:

| Engine | avg/frame | p95 | 180 frames |
|---|---|---|---|
| Browser Canvas2D | **3.76 ms** | 5.10 ms | 0.68 s |
| Node `@napi-rs/canvas` (Skia) | **4.41 ms** | 4.55 ms | 0.79 s |

Two different rasterisers agreeing at ~4 ms is a trustworthy number. That is **~12% of a
30 fps frame budget** — and export isn't even realtime-constrained, since the user taps
share and waits.

**Re-measured after the card gained a label table, a narrative line and the weekly
variant** — the drawing is **0.54 ms/frame** (p95 0.77, worst 1.13, 180 frames in 0.10 s).
The two numbers come from different machines so this is not a speedup; what it establishes
is that this session's additions did not move the claim, which stays comfortably inside
the budget above.

Read that from `node render-frames.cjs --bench`, which now reports the drawing and the PNG
compression **separately**. It used to time them together and print the sum as "avg /
frame": today that reads **68.8 ms**, seventeen times the budget, and every digit of the
difference is `zlib`. The device pipeline hands each frame to an `AVAssetWriter` and never
encodes a PNG, so the combined figure was never the number this section is about.

Every call used is deliberately one with a 1:1 CoreGraphics equivalent, so the Swift port
is mechanical rather than a redesign.

**Projection to device:** assume a phone is 5× slower than this desktop at CoreGraphics —
20 ms × 180 frames ≈ 3.6 s of drawing, plus hardware H.264 encode via VideoToolbox, which
runs faster than realtime for 1080p. Estimate **2–5 s per export**. Fine behind a progress
bar; not fine if it were interactive. It isn't.

## 4. Found while building: the design was broken in a way that only shows on TikTok

Rendering the frames and overlaying the host app's chrome exposed a real defect. TikTok,
Reels and Shorts draw a caption bar over roughly the **bottom 320 px** and an action rail
over the **right ~130 px**. The first layout put the watermark and every right-aligned
weight×reps value directly underneath them — invisible on the only platform that matters.

`out/d-safe-area.png` shows the corrected layout with the occluded regions overlaid. This
is now encoded as `SAFE` and `RAIL` constants in both the JS and Swift renderers.

**This belongs in the product spec, not just the spike:** any shareable the app generates
has to be laid out to a safe box, and the safe box must be visible during design.

## 5. Architecture decision: native draws, JS sends data once

Rejected: rendering overlay frames in JS and passing bitmaps to a native encoder. That's
180 × 8 MB across the bridge per export.

Chosen: the whole workout crosses the bridge **once** as a record; native draws every
frame. Cost is that [recap.js](recap.js) and
[RecapRenderer.swift](ios-module/RecapRenderer.swift) must be kept in sync by hand.

That cost buys something worth having: `recap.js` runs in Node and in a browser, so the
recap can be **iterated in seconds without a build**, then ported. Design in JS, ship in
Swift. Treat the JS as the source of truth.

## 6. What is NOT proven

Honest list. This machine is Windows — **no Xcode, so none of the Swift has been compiled
or run.** It is written against the real APIs but it is unverified code.

1. **On-device encode throughput.** The 2–5 s projection is extrapolation, not measurement.
2. **CoreText fidelity.** Canvas `measureText` and CTLine metrics differ; letter-spacing and
   the volume number's advance width will need visual reconciliation against the PNGs.
3. **Compositing over a real clip.** `ClipSource` decode cost is not in the 4 ms figure —
   only the overlay is. Decoding 1080p source frames will add meaningfully.
4. **Memory under load.** Per-frame `CGImage` allocation is wrapped in an `autoreleasepool`,
   but the ceiling on an older device is unmeasured.
5. **Fonts.** `Arial Black` doesn't exist on iOS. The app must bundle a display face
   (Archivo Black or similar) and a UI grotesk; metrics will shift when it does.

**To close these you need a Mac with Xcode, or EAS Build plus a physical device.** Nothing
else in the app is blocked by it.

## 7. Files

| File | What it is |
|---|---|
| [recap.js](recap.js) | The recap, as portable Canvas2D. Design source of truth. |
| [index.html](index.html) | Scrubber, benchmark, webm export, load-a-real-clip. Open directly. |
| [render-frames.cjs](render-frames.cjs) | Renders PNGs + benchmarks in Node. `--bench` for timings. |
| [ios-module/RecapExporter.swift](ios-module/RecapExporter.swift) | The reader→context→writer pipeline. |
| [ios-module/RecapRenderer.swift](ios-module/RecapRenderer.swift) | CoreGraphics port of recap.js. |
| [ios-module/RecapExporterModule.swift](ios-module/RecapExporterModule.swift) | Expo Modules bridge. |
| [ios-module/index.ts](ios-module/index.ts) | TS API: `exportRecap()`, `onProgress()`, `cancelExport()`. |
| `out/*.png` | Rendered key frames, incl. the safe-area proof. |

```bash
node render-frames.cjs --bench
```

## 8. What this changes in the product spec

- The recap pipeline is **viable** — the wedge survives, and the "fall back to a static
  card" branch (which would have left the app with nothing Hevy doesn't already have) is
  not needed.
- Add a **safe-area constraint** to every generated shareable.
- Add **bundled fonts** to v1 scope; the design depends on a heavy display face.
- The recap is **not realtime** — spec a progress state and a cancel path for it.

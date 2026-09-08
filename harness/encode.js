/*
 * encode.js — real H.264 .mp4 out of a canvas, in the browser.
 *
 * WebCodecs VideoEncoder does the hardware encode; mp4-muxer packages the
 * chunks into a container. No ffmpeg, no native binaries — which matters
 * because ffmpeg-kit was retired in 2025 and we're not shipping a transcoder.
 *
 * This deliberately mirrors the iOS architecture in spike/ios-module: draw a
 * frame, hand it to the platform encoder, repeat. If a change works here it
 * ports; if it can't be expressed here, it probably can't be expressed there.
 */
(function (root) {
  'use strict';

  // Highest profile first. 1080x1920 is 8160 macroblocks, just inside level 4.0,
  // but hardware support varies so we probe rather than assume.
  var CANDIDATES = [
    'avc1.640033', // High @ 5.1
    'avc1.64002A', // High @ 4.2
    'avc1.640028', // High @ 4.0
    'avc1.4D0033', // Main @ 5.1
    'avc1.42E033'  // Baseline @ 5.1
  ];

  async function pickCodec(width, height, framerate) {
    for (var i = 0; i < CANDIDATES.length; i++) {
      try {
        var res = await VideoEncoder.isConfigSupported({
          codec: CANDIDATES[i], width: width, height: height,
          bitrate: 10e6, framerate: framerate
        });
        if (res && res.supported) return CANDIDATES[i];
      } catch (e) { /* try the next one */ }
    }
    throw new Error('No supported H.264 config for ' + width + 'x' + height);
  }

  // Yield to the event loop WITHOUT setTimeout. Background/hidden tabs clamp
  // setTimeout to ~1s, which turns a 180-frame backpressure loop into a
  // three-minute stall. MessageChannel is not clamped.
  var _chan = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
  function yieldToLoop() {
    if (!_chan) return new Promise(function (r) { setTimeout(r, 0); });
    return new Promise(function (r) {
      _chan.port1.onmessage = function () { r(); };
      _chan.port2.postMessage(0);
    });
  }

  /** Seek a <video> to an exact time and wait for the frame to be ready. */
  function seekTo(video, t) {
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (!done) { done = true; resolve(); } }
      video.addEventListener('seeked', finish, { once: true });
      try { video.currentTime = Math.max(0, t); } catch (e) { finish(); }
      // Some codecs never fire 'seeked' on the final frame; don't hang the run.
      setTimeout(finish, 400);
    });
  }

  /**
   * @param o.canvas      source canvas, already at output size
   * @param o.fps
   * @param o.duration    seconds
   * @param o.drawFrame   async (t, frameIndex) => void   draws into o.canvas
   * @param o.onProgress  (0..1) => void
   * @returns Blob (video/mp4)
   */
  async function encodeMP4(o) {
    var W = o.canvas.width, H = o.canvas.height, fps = o.fps || 30;
    var total = Math.max(1, Math.round(o.duration * fps));
    var codec = await pickCodec(W, H, fps);

    var muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: 'avc', width: W, height: H, frameRate: fps },
      fastStart: 'in-memory'   // moov atom up front, so phones can stream it
    });

    var encodeError = null;
    var encoder = new VideoEncoder({
      output: function (chunk, meta) { muxer.addVideoChunk(chunk, meta); },
      error: function (e) { encodeError = e; }
    });
    encoder.configure({
      codec: codec, width: W, height: H,
      bitrate: 10e6, framerate: fps,
      latencyMode: 'quality'
    });

    for (var i = 0; i < total; i++) {
      if (encodeError) throw encodeError;
      await o.drawFrame(i / fps, i);

      var frame = new VideoFrame(o.canvas, {
        timestamp: Math.round(i * 1e6 / fps),
        duration: Math.round(1e6 / fps)
      });
      // Keyframe every second keeps scrubbing sane on the receiving end.
      encoder.encode(frame, { keyFrame: i % fps === 0 });
      frame.close();

      // Backpressure: without this the queue outruns the encoder and the tab
      // balloons to a couple of GB on a long clip.
      while (encoder.encodeQueueSize > 8) {
        await yieldToLoop();
      }
      if (o.onProgress) o.onProgress((i + 1) / total);
    }

    await encoder.flush();
    if (encodeError) throw encodeError;
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  root.Encode = { encodeMP4: encodeMP4, seekTo: seekTo, download: download, pickCodec: pickCodec };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/*
 * clip.js — the CLIP artifact: the user's footage with one number burned on it.
 *
 * This is the format that has to survive an FYP ranking system, so the spec's
 * constraints (PROMPT.md §2, §4) fully determine the design:
 *
 *   "payload legible in frame 1"  -> no count-up, no build-in. The number is
 *                                    simply there at t=0.
 *   "loops cleanly"               -> therefore the overlay is completely STATIC.
 *                                    Every frame is identical except the footage,
 *                                    so the loop seam is invisible.
 *
 * Those two rules together kill animation on this artifact entirely. That is not
 * a limitation, it is the spec working: the card animates because it has nothing
 * else to hold attention; the clip doesn't need to, because the lift is the show.
 */
(function (root) {
  'use strict';

  var W = 1080, H = 1920;
  var VOLT = '#CCFF00';
  var SAFE = { top: 200, bottom: H - 360, left: 84 };
  var RAIL = W - 200;

  var FONT = '"Arial Black","Helvetica Neue",Impact,sans-serif';
  var UI = 'ui-sans-serif,system-ui,"Segoe UI",Helvetica,Arial,sans-serif';

  function tracked(ctx, text, x, y, track) {
    var cx = x;
    for (var i = 0; i < text.length; i++) {
      ctx.fillText(text[i], cx, y);
      cx += ctx.measureText(text[i]).width + track;
    }
    return cx - x;
  }

  /**
   * @param ctx      2D context, 1080x1920
   * @param source   { image, width, height } — a video element or canvas frame
   * @param d        { lift, weight, reps, isPR, watermark, unit }
   * @param opts     { safeGuides }
   */
  function render(ctx, source, d, opts) {
    opts = opts || {};
    d = d || {};

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // --- footage, cover-fit ---------------------------------------------
    if (source && source.width) {
      var s = Math.max(W / source.width, H / source.height);
      var dw = source.width * s, dh = source.height * s;
      ctx.drawImage(source.image, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = '#141618';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#2A2F34';
      ctx.font = '40px ' + UI;
      ctx.textAlign = 'center';
      ctx.fillText('no clip loaded', W / 2, H / 2);
      ctx.textAlign = 'left';
    }

    // --- bottom scrim: the type must survive ANY footage ------------------
    var g = ctx.createLinearGradient(0, 900, 0, H);
    g.addColorStop(0, 'rgba(6,7,8,0)');
    g.addColorStop(0.45, 'rgba(6,7,8,0.72)');
    g.addColorStop(1, 'rgba(6,7,8,0.94)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 900, W, H - 900);

    var M = SAFE.left;
    var baseline = 1440;

    // --- volt rule, anchors the block -------------------------------------
    ctx.fillStyle = VOLT;
    ctx.fillRect(M, baseline - 232, 96, 8);

    // --- lift name --------------------------------------------------------
    // Was rgba(...,0.82) and it greyed out against bright footage at thumbnail
    // scale. Full white plus a shadow: the scrim alone is not enough when the
    // clip has a window or a mirror behind the lifter.
    if (d.lift) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#fff';
      ctx.font = '700 40px ' + UI;
      ctx.textAlign = 'left';
      tracked(ctx, String(d.lift).toUpperCase(), M, baseline - 150, 6);
      ctx.restore();
    }

    // --- THE number. The entire payload. ----------------------------------
    var main = (d.weight != null ? d.weight : '') +
               (d.reps != null ? ' × ' + d.reps : '');
    ctx.fillStyle = '#fff';
    ctx.font = '172px ' + FONT;
    ctx.textAlign = 'left';
    ctx.fillText(main, M - 8, baseline);
    var mainW = ctx.measureText(main).width;

    if (d.unit) {
      ctx.fillStyle = VOLT;
      ctx.font = '54px ' + FONT;
      ctx.fillText(String(d.unit).toUpperCase(), M + mainW + 14, baseline);
    }

    // --- PR tag ------------------------------------------------------------
    if (d.isPR) {
      var tagY = baseline - 232;
      ctx.fillStyle = VOLT;
      ctx.font = '700 30px ' + UI;
      ctx.textAlign = 'left';
      var label = 'PERSONAL RECORD';
      ctx.font = '700 30px ' + UI;
      var tw = 0;
      for (var i = 0; i < label.length; i++) tw += ctx.measureText(label[i]).width + 6;
      ctx.fillRect(M + 124, tagY - 26, tw + 36, 46);
      ctx.fillStyle = '#000';
      tracked(ctx, label, M + 142, tagY + 6, 6);
    }

    // --- watermark ---------------------------------------------------------
    // This is the entire acquisition mechanism (PROMPT.md §2), and the first
    // version failed its own test: at 216x384 feed-thumbnail scale the wordmark
    // dissolved into noise.
    //
    // The fix is not "bigger text". Nobody reads a watermark and nobody types a
    // name they saw in a video — a wordmark converts approximately zero people.
    // What survives downscaling is SHAPE. So the mark is a solid volt block that
    // stays a recognisable silhouette at any size, with the name set beside it
    // for the one viewer in a hundred who is already looking for it.
    //
    // Deliberately restrained: an oversized watermark reads as an ad and reduces
    // the chance the clip gets sent at all, which costs more than it gains.
    if (d.watermark) {
      var wy = SAFE.bottom + 30;
      var box = 46;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 16;

      ctx.fillStyle = VOLT;
      ctx.fillRect(M, wy - box + 8, box, box);
      // notch — a placeholder glyph; replace with the real logo lockup
      ctx.fillStyle = '#08090A';
      ctx.fillRect(M + 12, wy - box + 26, 22, 8);

      ctx.fillStyle = '#fff';
      ctx.font = '40px ' + FONT;
      ctx.textAlign = 'left';
      tracked(ctx, String(d.watermark).toUpperCase(), M + box + 18, wy, 2);
      ctx.restore();
    }

    if (opts.safeGuides) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,0,80,0.20)';
      ctx.fillRect(0, SAFE.bottom + 80, W, H - SAFE.bottom - 80);
      ctx.fillRect(RAIL + 70, 700, W - RAIL - 70, SAFE.bottom - 620);
      ctx.strokeStyle = '#FF0050';
      ctx.lineWidth = 3;
      ctx.setLineDash([14, 10]);
      ctx.strokeRect(SAFE.left, SAFE.top, RAIL - SAFE.left, SAFE.bottom - SAFE.top);
      ctx.restore();
    }
  }

  var api = { render: render, W: W, H: H, MAX_DURATION: 7.0, FPS: 30, SAFE: SAFE };
  root.ClipRender = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

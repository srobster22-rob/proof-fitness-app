/*
 * recap.js — pure Canvas2D drawing for the workout recap.
 *
 * No DOM, no globals beyond the export. Takes a ctx and a time in seconds.
 * Runs identically in the browser and in Node (@napi-rs/canvas), which is the
 * point: this is the reference implementation that the Swift/Kotlin per-frame
 * renderers get ported from. Every call used here has a 1:1 CoreGraphics
 * equivalent, deliberately.
 */
(function (root) {
  'use strict';

  var W = 1080, H = 1920;
  var VOLT = '#CCFF00', BG = '#08090A';

  // TikTok / Reels / Shorts draw their own chrome over the video: caption and
  // action rail eat roughly the bottom 320px and the right 130px. The artwork is
  // full-bleed, but nothing that has to be READ may sit outside this box.
  var SAFE = { top: 200, bottom: H - 360, left: 84, right: W - 84 };

  // The action rail only covers the lower right, so the header can still use the
  // full width — but anything right-aligned below RAIL_TOP must stop at RAIL.
  var RAIL = W - 200, RAIL_TOP = 700;

  var DEFAULT_DATA = {
    title: 'PUSH DAY',
    date: 'TUE 28 JUL',
    volume: 18420,
    sets: 24,
    duration: '52 MIN',
    streak: 12,
    pr: { lift: 'BENCH PRESS', weight: 225, reps: 5, prev: 215, gain: 10, heaviest: true },
    lifts: [
      ['Bench Press', '225 × 5', true],
      ['Incline DB Press', '80 × 10', false],
      ['Cable Fly', '45 × 12', false],
      ['OHP', '135 × 6', false],
      ['Lateral Raise', '25 × 15', false]
    ]
  };

  /*
   * The card's own words, in the language the workout was logged in.
   *
   * These were English literals, every one of them, while `buildRecap` was
   * already localising the values beside them — the title, the date and the
   * duration all arrive translated. So a Spanish lifter's own recap screen read
   * VOLUMEN TOTAL / SERIES / TIEMPO / RACHA and the card they SENT read TOTAL
   * VOLUME / SETS / TIME / STREAK. Two surfaces of one claim disagreeing, on
   * the artifact §5 says the product is judged by, and invisible to anyone
   * building in English.
   *
   * A language CODE rides the URL rather than the strings themselves: it costs
   * two characters against a budget this format exists to protect, and the
   * native renderers this file is the reference for will have their own
   * localisation anyway. Unknown languages and missing keys fall through to
   * English, so a card built by a newer app still draws in an older renderer.
   */
  var LABELS = {
    en: {
      volume: 'TOTAL VOLUME', sets: 'SETS', time: 'TIME', streak: 'STREAK', wk: 'WK',
      pr: 'NEW PERSONAL RECORD', bestYet: 'BEST YET', upFrom: 'UP FROM',
      first: 'SESSION ONE', toBeat: 'THE ONE TO BEAT', up: 'UP',
      noBodyweight: 'Bodyweight not recorded', more: 'more'
    },
    es: {
      volume: 'VOLUMEN TOTAL', sets: 'SERIES', time: 'TIEMPO', streak: 'RACHA', wk: 'SEM',
      pr: 'NUEVO RÉCORD PERSONAL', bestYet: 'LO MEJOR HASTA AHORA', upFrom: 'ANTES',
      first: 'SESIÓN UNO', toBeat: 'LA MARCA A BATIR', up: 'SUBIÓ',
      noBodyweight: 'Peso corporal no registrado', more: 'más'
    }
  };

  /*
   * The narrative slot: one true sentence about the lifter.
   *
   * A goal when there is one, and §8's "second lead" when there is not — the
   * mature clause says PRs get rarer by design and such accounts "need a second
   * lead: consistency, volume trend, a goal's progress". They never both
   * arrive; the app decides, because a goal is the thing the user chose.
   */
  function NARRATIVE(D) {
    return (D && (D.goalLine || D.trendLine)) || '';
  }

  /*
   * The reserved bottom row's content, once the claim slab has already taken
   * whatever it is taking. R435-439: `multiple` — the bodyweight-milestone
   * line, e.g. "1.75x bodyweight" — reached the wire and the shared TEXT but
   * never this image, which is the one artifact that actually leaves the
   * device. It gets the SAME quiet, below-everything-else treatment the live
   * app screen already gives it (`multipleRow` in recap.tsx, always below the
   * goal row, never competing with the claim slab) rather than a new priority
   * rule invented for this file alone.
   *
   * Only ONE line fits the reserved row's fixed budget, so on the image —
   * unlike the live screen, which simply stacks both — this is a fallback,
   * not an addition: the narrative wins when both are true (it already went
   * into the slab if `goalInSlab`, and repeating it below would be the exact
   * "SQUAT 200 LB twice" duplication `heaviest`'s gain line was written to
   * avoid), and `multiple` is offered only when the row would otherwise be
   * empty.
   */
  function BOTTOM_LINE(D, goalInSlab) {
    if (goalInSlab) return (D && D.multiple) || '';
    return NARRATIVE(D) || (D && D.multiple) || '';
  }

  function L(D, key) {
    var table = LABELS[(D && D.lang) || 'en'] || LABELS.en;
    return table[key] || LABELS.en[key];
  }

  // Heavy display face for numbers, neutral grotesk for labels. The shipped app
  // must bundle both — "Arial Black" does not exist on iOS.
  var FONT = '"Arial Black","Helvetica Neue",Impact,sans-serif';
  var UI = 'ui-sans-serif,system-ui,"Segoe UI",Helvetica,Arial,sans-serif';

  var outExpo = function (t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); };
  var outCubic = function (t) { return 1 - Math.pow(1 - t, 3); };
  var clamp01 = function (t) { return t < 0 ? 0 : t > 1 ? 1 : t; };
  var seg = function (t, a, b) { return clamp01((t - a) / (b - a)); };

  /*
   * Grouped the way the card's own language groups numbers (R479).
   *
   * This was a hardcoded comma regex — the same bug R221 fixed for the card's
   * LABELS, one level down: a Spanish card said "1,284,600" while the app that
   * produced it said "1.284.600". Driven from `D.lang` for exactly the reason
   * the labels are: this file renders on the RECIPIENT's machine, so anything
   * read off the viewer's device would make the sender and the receiver see
   * different numbers for one workout.
   *
   * `toLocaleString` with an EXPLICIT locale rather than the regex, so the app
   * and the card cannot drift — `src/domain/i18n.ts`'s `number()` is the same
   * call, and `test/number-locale.test.ts` asserts the two agree.
   */
  function commas(n, lang) {
    return Math.round(n).toLocaleString(lang === 'es' ? 'es' : 'en-US');
  }

  /*
   * A lifted weight, the way the app writes one (R486).
   *
   * A bodyweight movement is stored at the weight ADDED, so a strict pull-up is
   * 0 — and the claim slab concatenated that number raw, drawing "0 x 12" while
   * the lift row directly beneath it, built app-side through `loadLabel`, said
   * "BW x 12". One card, one set, two renderings, and the loud one claims the
   * lifter moved nothing. It lands on the FIRST-SESSION card most of all, which
   * §6 makes the hook — a first session of pull-ups is exactly the cold-start
   * case the app is written around.
   *
   * `app/src/domain/types.ts`'s `loadLabel` is the original; this is the same
   * rule, restated because a standalone Canvas2D file cannot import TS (the
   * boundary `bundle-parity.test.ts` exists for), and `test/bw-on-the-card.
   * test.ts` asserts the two agree rather than trusting this comment.
   *
   * Deliberately NOT translated: `loadLabel` says "BW" in every language, so
   * translating here would make the card disagree with the app that produced
   * it — the exact failure R221 and R482 were about, pointing the other way.
   */
  function loadLabel(w) {
    return w === 0 ? 'BW' : String(w);
  }

  /**
   * Trim a string until it fits, with an ellipsis.
   *
   * The card takes exercise names the user typed, and nothing capped them.
   * Rendered with a real one — "Single-Arm Cable Lateral Raise (Left Side, Slow
   * Eccentric)", which is the kind of thing people genuinely write down — the
   * name overprinted the PR number inside the slab, ran straight through the
   * load column in the lift list, and reached 1028px on a canvas whose safe box
   * ends at 996. Two overlapping strings and nothing readable.
   *
   * Measured rather than character-counted, because the font is proportional
   * and a 30-character name of capitals is wider than a 40-character one of
   * lowercase.
   */
  function fit(ctx, text, maxWidth) {
    var str = String(text == null ? '' : text);
    if (ctx.measureText(str).width <= maxWidth) return str;
    var ell = '…';
    // Binary search the longest prefix that still fits with the ellipsis.
    var lo = 0, hi = str.length;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(str.slice(0, mid) + ell).width <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return lo > 0 ? str.slice(0, lo).trimEnd() + ell : ell;
  }

  // Letter-spaced fill. Canvas2D letterSpacing is not portable, so we advance
  // manually — which is also what CoreText will do on the native side.
  /*
   * The width `tracked` will actually consume, for collision arithmetic.
   * Deliberately excludes the trailing advance after the last glyph — that is
   * empty space, not ink, and counting it makes a string that fits look like
   * one that does not.
   */
  function trackedWidth(ctx, text, track) {
    var w = 0;
    for (var i = 0; i < text.length; i++) w += ctx.measureText(text[i]).width + track;
    return text.length ? w - track : 0;
  }

  /** `fit`, for a letter-spaced string. Same binary search, tracked metric. */
  function fitTracked(ctx, text, maxWidth, track) {
    var str = String(text == null ? '' : text);
    if (trackedWidth(ctx, str, track) <= maxWidth) return str;
    var ell = '…';
    var lo = 0, hi = str.length;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (trackedWidth(ctx, str.slice(0, mid) + ell, track) <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return lo > 0 ? str.slice(0, lo).trimEnd() + ell : ell;
  }

  function tracked(ctx, text, x, y, track) {
    var cx = x;
    for (var i = 0; i < text.length; i++) {
      ctx.fillText(text[i], cx, y);
      cx += ctx.measureText(text[i]).width + track;
    }
    return cx - x;
  }

  // The core motion primitive: type rises into place behind a clip mask.
  function riseText(ctx, text, x, y, size, p, opts) {
    opts = opts || {};
    if (p <= 0) return;
    var color = opts.color || '#fff';
    var font = opts.font || FONT;
    var track = opts.track || 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 40, y - size, W, size * 1.28);
    ctx.clip();
    ctx.globalAlpha = Math.min(1, p * 1.6);
    ctx.fillStyle = color;
    ctx.font = size + 'px ' + font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    var dy = (1 - outExpo(p)) * size * 1.1;
    if (track) tracked(ctx, text, x, y + dy, track);
    else ctx.fillText(text, x, y + dy);
    ctx.restore();
  }

  /**
   * The claim slab, filled for a record and outlined for a baseline.
   *
   * Extracted so the two cases cannot drift in size or position: they occupy
   * the same 176px band at y850, and the only differences are the fill, the ink
   * and the words.
   */
  function drawClaim(ctx, M, RAIL, pp, inner, o) {
    var y = 850, w = RAIL - M;
    ctx.save();
    ctx.globalAlpha = pp;
    if (o.outlined) {
      ctx.strokeStyle = '#2A323A';
      ctx.lineWidth = 3;
      ctx.strokeRect(M, y, w * outExpo(pp), 176);
    } else {
      ctx.fillStyle = VOLT;
      ctx.fillRect(M, y, w * outExpo(pp), 176);
    }
    ctx.restore();
    if (inner <= 0) return;
    var ink = o.outlined ? '#fff' : '#000';
    ctx.save();
    ctx.beginPath();
    ctx.rect(M, y, w, 176);
    ctx.clip();
    ctx.globalAlpha = inner;
    /*
     * The TOP row is two strings drawn towards each other — the claim from the
     * left, its context from the right — and until R476 neither was measured.
     * The bottom row had been fitted since R84-R88's sweep; this one was
     * missed, and it is where the card broke: in Spanish the PR slab drew
     * "NUEVO RÉCORD PERSONAL" straight through "LO MEJOR HASTA AHORA" and came
     * out as "NUEVO RÉCORD PERSOÑOAMEJOR HASTA AHORA". English fits, which is
     * why every earlier look at this card said it was fine.
     *
     * So the pair is budgeted rather than hoped for. The right label states its
     * own need first but may not take more than half; the claim gets whatever
     * is left. The claim yields last because it is the thing being claimed —
     * "…RECORD" still reads as a record, while a truncated "UP FROM 2…" is a
     * number that has stopped being checkable (§16).
     */
    var TOP_GAP = 24;
    var topLeftX = M + 34, topRightX = RAIL - 32;
    var topAvail = (topRightX - topLeftX);

    // The claim states its need FIRST, capped so it can never crowd the
    // context out entirely; the context takes what is left. Done the other way
    // round — which is how this was first written — a secondary label that
    // happens to be long in one language eats the claim it is qualifying, and
    // Spanish came out as "NUEVO RÉCORD PE…" beside a full-width
    // "LO MEJOR HASTA AHORA".
    ctx.font = '600 27px ' + UI;
    var label = fitTracked(ctx, o.label, topAvail * 0.62, 5);
    var labelW = trackedWidth(ctx, label, 5);

    var rightTop = '';
    if (o.rightTop) {
      ctx.font = '600 30px ' + UI;
      rightTop = fit(ctx, o.rightTop, topAvail - labelW - TOP_GAP);
    }

    ctx.fillStyle = o.outlined ? VOLT : '#000';
    ctx.font = '600 27px ' + UI;
    ctx.textAlign = 'left';
    tracked(ctx, label, topLeftX, y + 58, 5);

    ctx.fillStyle = ink;
    ctx.font = '72px ' + FONT;
    ctx.fillText(o.big, M + 32, y + 138);
    ctx.font = '600 30px ' + UI;
    ctx.textAlign = 'right';
    // Half the slab, less the padding: the big weight occupies the left half.
    ctx.fillText(fit(ctx, o.right, (w - 64) / 2), topRightX, y + 138);
    if (rightTop) {
      ctx.fillStyle = o.outlined ? '#7C8792' : '#000';
      ctx.fillText(rightTop, topRightX, y + 58);
    }
    ctx.restore();
  }

  function drawBase(ctx, clip) {
    if (clip) {
      var s = Math.max(W / clip.width, H / clip.height);
      var dw = clip.width * s, dh = clip.height * s;
      ctx.drawImage(clip.image, (W - dw) / 2, (H - dh) / 2, dw, dh);
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'rgba(8,9,10,0.86)');
      g.addColorStop(0.34, 'rgba(8,9,10,0.30)');
      g.addColorStop(0.62, 'rgba(8,9,10,0.55)');
      g.addColorStop(1, 'rgba(8,9,10,0.95)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, W, H);
      var r = ctx.createRadialGradient(200, 260, 0, 200, 260, 1100);
      r.addColorStop(0, 'rgba(204,255,0,0.13)');
      r.addColorStop(1, 'rgba(204,255,0,0)');
      ctx.fillStyle = r;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function render(ctx, t, opts) {
    opts = opts || {};
    var D = opts.data || DEFAULT_DATA;
    var M = 84;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    drawBase(ctx, opts.clip);

    // header rule sweep
    ctx.fillStyle = VOLT;
    ctx.fillRect(M, 250, (W - M * 2) * outExpo(seg(t, 0.05, 0.75)), 7);

    /*
     * Trimmed to the room left by the date on the right.
     *
     * Every string on this card arrives from a URL fragment, so none of them is
     * known-good: a long title ran the full 1080px width, straight through the
     * date and off the canvas. Measured at the title's own size and tracking,
     * because `riseText` letter-spaces and a plain measureText underestimates.
     */
    ctx.save();
    ctx.font = '62px ' + FONT;
    var dateW = 0;
    if (D.date) { ctx.font = '500 34px ' + UI; dateW = ctx.measureText(String(D.date)).width; }
    ctx.font = '62px ' + FONT;
    var titleRoom = W - M * 2 - dateW - 40;
    var title = fit(ctx, D.title, titleRoom - String(D.title || '').length * 5);
    ctx.restore();
    riseText(ctx, title, M, 224, 62, seg(t, 0.12, 0.75), { track: 5 });

    var dp = seg(t, 0.3, 0.9);
    if (dp > 0) {
      ctx.save();
      ctx.globalAlpha = dp;
      ctx.fillStyle = '#7C8792';
      ctx.font = '500 34px ' + UI;
      ctx.textAlign = 'right';
      ctx.fillText(D.date, W - M, 224);
      ctx.restore();
    }

    /*
     * §10's weekly card is the same card with a different subject.
     *
     * "One auto-surfaced comparison per week ... already formatted as a
     * postable card" — so rather than a second layout with its own bugs, a
     * weekly payload is an ordinary one whose hero is the GAIN, whose stat row
     * is empty (there is no session behind it to count sets or minutes for),
     * and whose lift list is the single comparison. That shape is the
     * no-claim, one-lift card the safe-box tests already cover.
     */
    var isWeekly = D.kind === 'weekly';

    // hero: total volume counting up — or, on a weekly card, the gain
    riseText(ctx, L(D, isWeekly ? 'up' : 'volume'), M, 400, 32, seg(t, 0.4, 0.95),
      { color: '#7C8792', font: UI, track: 7 });
    var vp = seg(t, 0.45, 2.15);
    /*
     * A total the app cannot compute is not drawn as one.
     *
     * `volumeKnown === false` means the session contains bodyweight work with
     * no bodyweight reading behind it, so `volume` is a floor: the weight
     * ADDED, which for a strict push-up is zero. Counting up to a giant "0"
     * tells the reader the sender moved nothing — and this card is the half
     * that reaches people who were not there and cannot check it.
     *
     * The counting-up animation is dropped with it: there is nothing to count
     * to. SETS and TIME beside it are still facts and still animate, so the
     * card keeps its shape and loses only the number it does not have.
     */
    if (vp > 0 && D.volumeKnown === false) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, vp * 3);
      ctx.fillStyle = '#9AA5AF';
      ctx.font = '600 44px ' + UI;
      ctx.textAlign = 'left';
      ctx.fillText(fit(ctx, L(D, 'noBodyweight'), RAIL - M), M - 10, 560);
      ctx.restore();
    } else if (vp > 0) {
      // A gain reads as a gain. The sign is the claim on a weekly card, and
      // the number alone would look like a total.
      var shown = (isWeekly ? '+' : '') + commas(D.volume * outExpo(vp), D.lang);
      ctx.save();
      ctx.globalAlpha = Math.min(1, vp * 3);
      ctx.fillStyle = '#fff';
      /*
       * Sized to the number it is actually drawing.
       *
       * 230px suits the four to six digits a real session produces, and a
       * seven-figure volume ran off the canvas — the same failure as the app's
       * own hero, which sizes itself from the character count for exactly this
       * reason. It only ever shrinks: a normal card is untouched.
       */
      var volSize = 230;
      ctx.font = volSize + 'px ' + FONT;
      var room = RAIL - (M - 10) - 110;          // less the unit beside it
      while (volSize > 90 && ctx.measureText(shown).width > room) {
        volSize -= 8;
        ctx.font = volSize + 'px ' + FONT;
      }
      ctx.textAlign = 'left';
      ctx.fillText(shown, M - 10, 600);
      var w = ctx.measureText(shown).width;
      ctx.fillStyle = VOLT;
      ctx.font = '64px ' + FONT;
      ctx.fillText(String(D.unit || 'LB').toUpperCase(), M + w + 18, 600);
      ctx.restore();
    }

    /*
     * Stat cells. The streak is dropped, not zeroed, when there is none worth
     * showing.
     *
     * `streakWorthShowing` is >= 2 — a first workout's streak is 1, and
     * claiming "1 WK" is the app lying for the user. The in-app card and the
     * share message both check it, and the wire format enforces it by
     * DELETING the field — at which point this line's `D.streak + ' WK'`
     * rendered the string "undefined WK" onto the card, in 60px type, for the
     * one reader who was not there to know better.
     */
    // No session, no session stats. A weekly card counting "0 SETS · 1 MIN"
    // would be three numbers about a workout that did not happen.
    var cells = isWeekly ? [] : [[L(D, 'sets'), D.sets], [L(D, 'time'), D.duration]];
    if (!isWeekly && typeof D.streak === 'number' && D.streak >= 2) cells.push([L(D, 'streak'), D.streak + ' ' + L(D, 'wk')]);
    for (var i = 0; i < cells.length; i++) {
      var p = seg(t, 1.0 + i * 0.12, 1.6 + i * 0.12);
      if (p <= 0) continue;
      var x = M + i * ((W - M * 2) / 3);
      ctx.save();
      ctx.globalAlpha = p;
      ctx.fillStyle = '#7C8792';
      ctx.font = '600 26px ' + UI;
      ctx.textAlign = 'left';
      ctx.fillText(cells[i][0], x, 700);
      ctx.restore();
      // Volt only for the streak cell, and only when it just became the
      // longest ever — same rule every other accent on this card follows:
      // mark the one thing that is actually news.
      var isStreakCell = cells[i][0] === L(D, 'streak');
      riseText(ctx, String(cells[i][1]), x, 772, 60, p,
        isStreakCell && D.streakRecord ? { color: VOLT } : undefined);
    }

    /*
     * The claim slab.
     *
     * This block used to run on the time segment alone and read `D.pr.weight`
     * unguarded. The spike's demo data always has a PR, so it was never hit
     * there — but §8 forbids a PR in an exercise's first three sessions, so
     * EVERY first-ever workout has none, and most ordinary sessions have none
     * either. Rendering one of those threw `Cannot read properties of undefined
     * (reading 'weight')` and the shared link came up blank: the acquisition
     * path was broken for exactly the user most likely to use it.
     *
     * So the slot takes the best true claim available, in order, and draws
     * nothing at all when there is none — §5 already says an absent line beats
     * an invented one.
     */
    var pp = seg(t, 2.25, 3.1);
    if (pp > 0 && !D.pr && D.firstSession && D.best) {
      // A first session breaks no record, and dressing one up as a PR is the
      // crying wolf §8 forbids. Outlined rather than filled for the same reason:
      // the volt fill is reserved for a beaten record; this is a starting line.
      drawClaim(ctx, M, RAIL, pp, seg(t, 2.5, 3.2), {
        outlined: true,
        label: L(D, 'first'),
        big: loadLabel(D.best.weight) + ' × ' + D.best.reps,
        right: D.best.lift,
        rightTop: L(D, 'toBeat')
      });
    } else if (pp > 0 && !D.pr && D.bestYet && D.best) {
      /*
       * Beat your own best, too early for §8 to call it a record — the two
       * sessions after the first, which reached this slot with nothing to put
       * in it. Same outlined treatment as SESSION ONE, and for the same
       * reason: no record was broken, so it must not wear the volt fill a
       * beaten one does.
       *
       * "UP FROM n" rather than a bare "BEST YET" so the claim carries the
       * number it beat — the shared card is read by people who were not
       * there, and a claim they cannot check is the one thing §16 rules out.
       */
      drawClaim(ctx, M, RAIL, pp, seg(t, 2.5, 3.2), {
        outlined: true,
        label: L(D, 'bestYet'),
        big: loadLabel(D.best.weight) + ' × ' + D.best.reps,
        right: D.best.lift,
        rightTop: L(D, 'upFrom') + ' ' + loadLabel(D.bestYet.prev)
      });
    } else if (pp > 0 && !D.pr && NARRATIVE(D)) {
      // No record and no baseline, but a standing goal is still true. §5: goals
      // earn their place by feeding the output.
      var gp = seg(t, 2.5, 3.2);
      if (gp > 0) {
        ctx.save();
        ctx.globalAlpha = gp;
        ctx.fillStyle = VOLT;
        ctx.fillRect(M, 850 + 44, 8, 88);
        ctx.fillStyle = '#E8EAED';
        ctx.font = '500 40px ' + UI;
        ctx.textAlign = 'left';
        // The slab's width, less the volt tick and the padding either side.
        ctx.fillText(fit(ctx, NARRATIVE(D), RAIL - M - 72), M + 36, 850 + 100);
        ctx.restore();
      }
    } else if (pp > 0 && D.pr) {
      /*
       * Through the same painter as the baseline slab.
       *
       * R69 extracted `drawClaim` so the two cases could not drift in size or
       * position — and then left this branch as its own copy, so they drifted
       * anyway: the long-name fix landed on one and not the other, and a lift
       * called "Single-Arm Cable Lateral Raise (Left Side, Slow Eccentric)"
       * still had its name printed straight across the weight. An extracted
       * helper only helps the callers that actually call it.
       */
      var g = D.pr.gain;
      var u = (D.unit || 'lb').toUpperCase();
      drawClaim(ctx, M, RAIL, pp, seg(t, 2.5, 3.2), {
        outlined: false,
        label: L(D, 'pr'),
        big: loadLabel(D.pr.weight) + ' × ' + D.pr.reps,
        right: D.pr.lift,
        // `gain` is null when nothing comparable was beaten; subtracting `prev`
        // burned the whole bar into the video as the improvement. The unit comes
        // from the payload too — this line hardcoded ' LB' while the volume
        // above it used D.unit, so a kg session mixed units in one frame.
        //
        // Gated on `heaviest`, not just `gain` — a set can beat its own rep
        // count's previous best (a real, positive `gain`) while still being
        // lighter than a DIFFERENT rep count's PR: 230x5 over 225x5 is a
        // genuine +5, but with a 275x3 on the books it is not the heaviest
        // thing this lifter has ever moved. The shared TEXT already downgrades
        // that exact case to "best set yet" — this is the shareable IMAGE, the
        // thing that actually leaves the device, and it was still burning
        // '+5 LB' into the picture for it.
        rightTop: (!D.pr.heaviest || g === null || g === undefined) ? L(D, 'bestYet') : '+' + g + ' ' + u
      });
    }

    /*
     * lift list — bounded by the safe box, not by how many lifts there were.
     *
     * The rows were `1140 + j * 82` with no limit, and the watermark is drawn
     * at a FIXED y (SAFE.bottom). Rendered from a real eight-lift session the
     * list ran to y1714: straight through the mark, which came out overprinted
     * on "Lateral Raise" and illegible, and 154px past the safe box, where a
     * Story or Reel covers it with the host app's caption UI. Eight lifts is an
     * ordinary session, so this was the normal case, on the one artifact that
     * actually leaves the app.
     *
     * The band is fixed; the pitch tightens to fit and stops at a floor that
     * still reads at 38px. Past that the list truncates and SAYS it truncated —
     * a card that quietly drops your last three lifts is worse than one that
     * admits it only had room for five.
     */
    /*
     * The goal line, when the claim slab is already spoken for.
     *
     * The slab shows the best TRUE claim in order — a PR beats a first session
     * beats a standing goal — and that order is right. But a lifter who is
     * progressing sets PRs, so for them the goal branch above never fires and
     * their goals never reach the one artifact that leaves the app. §5 says
     * goals earn their place by feeding the output, and "only on the sessions
     * where nothing else happened" is not feeding it.
     *
     * So it gets its own row under the list rather than competing for the slab,
     * and the list band is SHORTENED to make room. Reserving the space is the
     * whole point: drawn opportunistically into whatever gap the list left, it
     * would appear on a five-lift session and silently vanish on an eight-lift
     * one — which is the same defect as the overprinted watermark this band was
     * built to fix, just quieter.
     */
    // Must mirror the claim chain above exactly: the goal only takes the slab
    // when nothing ahead of it did. `bestYet` was added to that chain and had
    // to be added here too, or a session with both would draw the goal into a
    // slab the BEST YET claim was already occupying.
    var goalInSlab = !D.pr && !(D.firstSession && D.best) && !(D.bestYet && D.best) && !!NARRATIVE(D);

    /*
     * The claim slab's band is RECLAIMED when nothing is in it.
     *
     * The slot occupies y850..1026 and the list began at a fixed 1140
     * regardless, so a session with no claim rendered a ~290px void between
     * the stat row and the lifts. That is the COMMON case, not an edge: §8
     * makes PRs deliberately rare, plenty of lifters set no goals, and it is
     * neither a first session nor a best-yet. Rendered and looked at, the card
     * reads as unfinished — dense and confident at the top, then a hole, then
     * the list — on the one artifact §5 judges the product on.
     *
     * Nothing is invented to fill it; §5's rule that an absent line beats a
     * made-up one stands. The LIST simply starts where the claim would have
     * been, which also means more lifts fit before the "+N more" truncation on
     * exactly the sessions that had nothing to claim.
     */
    var slabUsed = !!(D.pr || (D.firstSession && D.best) || (D.bestYet && D.best) || goalInSlab);
    var LIST_TOP = slabUsed ? 1140 : 900;

    /*
     * `lifts` is read through a local rather than off `D` directly, because
     * `pack` DROPS the field when the array is empty (`if (w.lifts &&
     * w.lifts.length)`) — so a payload is entitled to arrive without it, and
     * this function ran before every guard further down. The failure was the
     * dangerous kind: a throw here leaves the shared card BLANK, which is
     * invisible to the sender and indistinguishable from a dead link to the
     * recipient. Same shape as the unguarded `D.pr.weight` that broke every
     * first-ever workout's link, and the missing `gain` before it.
     */
    var LIFTS = D.lifts || [];

    function fitList(bottom) {
      var band = bottom - LIST_TOP;
      var pitch = Math.max(56, Math.min(82, band / Math.max(1, LIFTS.length)));
      var maxRows = Math.max(1, Math.floor(band / pitch));
      var shown = LIFTS.length <= maxRows ? LIFTS.length : maxRows - 1;
      return { pitch: pitch, shown: shown, more: LIFTS.length - shown };
    }

    /*
     * The goal line yields to the list, never the other way round.
     *
     * Reserving its 60px unconditionally cost two rows on an ordinary five-lift
     * session: the pitch has a 56px floor, so the shortened band fell one row
     * short and the list came out as three lifts and "+2 more". That is a bad
     * trade at any price — the lifts are what the user actually did, and a card
     * that drops two of them to make room for a target is not a record of the
     * workout.
     *
     * So both layouts are measured and the goal line is drawn only when it
     * costs the list nothing. On a heavy session it simply does not appear,
     * which is the same rule §5 states for every other absent line.
     */
    var full = fitList(SAFE.bottom - 70);
    var tight = fitList(SAFE.bottom - 70 - 60);
    var bottomLine = BOTTOM_LINE(D, goalInSlab);
    var goalBelow = !!bottomLine && tight.shown === full.shown;

    var chosen = goalBelow ? tight : full;
    var pitch = chosen.pitch, shown = chosen.shown, more = chosen.more;

    /*
     * With no claim slab, the list is CENTRED in the space rather than pinned
     * to the top of it.
     *
     * Reclaiming the slab's band (see `LIST_TOP`) moved a ~290px void out of
     * the middle of the card — where it read as something failing to render —
     * but top-anchoring simply moved it below the list instead, because
     * `fitList` caps the pitch at 82px and a five-lift session cannot stretch
     * to fill 590px however it is spaced. Centring splits the leftover above
     * and below, so the card reads as a block with margins instead of a block
     * with a hole after it. Only when the slab is empty: with a claim drawn
     * the list is already tight against the space it was given.
     */
    /*
     * Centred only when there is no slab — and that condition is load-bearing,
     * not an oversight.
     *
     * Removing it was tried and rendered: with a claim slab and two lifts the
     * list detached from the slab above it and floated with gaps on BOTH sides,
     * which reads worse than the trailing space it was meant to fix. The
     * distinction is that a void BETWEEN two blocks of content is a hole — that
     * is what reclaiming the slab's band fixed — while space above the
     * watermark is margin. A short list belongs under the claim it follows.
     */
    var listOffset = 0;
    if (!slabUsed) {
      var used = shown * pitch + (more > 0 ? pitch : 0);
      listOffset = Math.max(0, ((SAFE.bottom - 70 - LIST_TOP) - used) / 2);
    }

    for (var j = 0; j < shown; j++) {
      var lp = seg(t, 3.3 + j * 0.1, 3.95 + j * 0.1);
      if (lp <= 0) continue;
      var ly = LIST_TOP + listOffset + j * pitch;
      ctx.save();
      ctx.globalAlpha = lp * 0.9;
      ctx.strokeStyle = '#232A30';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(M, ly + 26);
      ctx.lineTo(RAIL, ly + 26);
      ctx.stroke();
      ctx.globalAlpha = lp;
      ctx.fillStyle = LIFTS[j][2] ? VOLT : '#E8EAED';
      // Measure the load FIRST, so the name is given exactly the room that is
      // left rather than a guess. 24px of gap so the two never touch.
      ctx.font = '700 38px ' + UI;
      var loadW = ctx.measureText(LIFTS[j][1]).width;
      ctx.font = '500 38px ' + UI;
      ctx.textAlign = 'left';
      ctx.fillText(fit(ctx, LIFTS[j][0], RAIL - M - loadW - 24), M + (1 - outCubic(lp)) * 30, ly);
      ctx.textAlign = 'right';
      ctx.font = '700 38px ' + UI;
      ctx.fillText(LIFTS[j][1], RAIL, ly);
      ctx.restore();
    }

    // What did not fit. Muted, in the row slot the next lift would have taken.
    if (more > 0) {
      var mp = seg(t, 3.3 + shown * 0.1, 3.95 + shown * 0.1);
      if (mp > 0) {
        ctx.save();
        ctx.globalAlpha = mp * 0.75;
        ctx.fillStyle = '#7C8792';
        ctx.font = '600 30px ' + UI;
        ctx.textAlign = 'left';
        ctx.fillText('+' + more + ' ' + L(D, 'more'), M, LIST_TOP + listOffset + shown * pitch);
        ctx.restore();
      }
    }

    // The goal line — or, when that slot is otherwise empty, the bodyweight
    // milestone — in the row the list gave up for it.
    if (goalBelow) {
      var qp = seg(t, 4.2, 4.9);
      if (qp > 0) {
        ctx.save();
        ctx.globalAlpha = qp * 0.95;
        var gy = SAFE.bottom - 78;
        ctx.fillStyle = VOLT;
        ctx.fillRect(M, gy - 26, 6, 34);
        ctx.fillStyle = '#9AA5AF';
        ctx.font = '500 34px ' + UI;
        ctx.textAlign = 'left';
        ctx.fillText(fit(ctx, bottomLine, RAIL - M - 30), M + 26, gy);
        ctx.restore();
      }
    }

    // Watermark — this is the acquisition channel. Keep it inside the safe box:
    // at the true bottom edge the host app's caption UI covers it entirely.
    var wp = seg(t, 4.6, 5.3);
    if (wp > 0) {
      ctx.save();
      ctx.globalAlpha = wp * 0.92;
      ctx.textAlign = 'left';
      ctx.fillStyle = VOLT;
      ctx.font = '34px ' + FONT;
      ctx.fillText(String(D.watermark || 'PROOF').toUpperCase(), M, SAFE.bottom);
      ctx.restore();
    }

    if (opts.safeGuides) drawSafeGuides(ctx);
  }

  // Debug overlay: the region each host app's chrome will cover.
  function drawSafeGuides(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,0,80,0.20)';
    ctx.fillRect(0, SAFE.bottom + 20, W, H - SAFE.bottom - 20); // caption bar
    ctx.fillRect(W - 130, 700, 130, SAFE.bottom - 680);         // action rail
    ctx.fillRect(0, 0, W, SAFE.top - 40);                       // top chrome
    ctx.strokeStyle = '#FF0050';
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 10]);
    ctx.strokeRect(SAFE.left, SAFE.top, SAFE.right - SAFE.left, SAFE.bottom - SAFE.top);
    ctx.restore();
  }

  var api = {
    render: render, W: W, H: H, SAFE: SAFE,
    DURATION: 6.0, FPS: 30, DATA: DEFAULT_DATA
  };
  root.RecapRender = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

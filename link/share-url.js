/*
 * share-url.js — pack a workout into a URL, unpack it on the landing page.
 *
 * The whole payload rides in the URL **fragment**, which is deliberate:
 * fragments are never transmitted to the server. So the landing page renders a
 * real recap with no backend, no upload, no database, and no request that could
 * log someone's training. It is also why this works on free static hosting.
 *
 * Keys are shortened because URLs get truncated by some chat clients around
 * 2000 characters; a full session packs to roughly 300-400.
 *
 * What CANNOT ride in a URL is footage. The clip artifact travels as the file
 * attached to the message; the link renders the card view of the same session.
 * That asymmetry is a property of the medium, not a limitation to engineer away.
 */
(function (root) {
  'use strict';

  /*
   * `firstSession` and `goalLine` ride because the card has a claim slot above
   * the lift list, and without them a session with no PR — every first-ever
   * workout, by §8, and most ordinary ones — had nothing true to put in it.
   */
  var LONG = ['title', 'date', 'volume', 'sets', 'duration', 'streak', 'unit', 'watermark',
              'firstSession', 'goalLine', 'trendLine', 'streakRecord', 'kind', 'multiple'];
  // 'e' is section 8's second lead — see `trendLine` in share-url.ts.
  // 'r' is the streak-record accent — see `streakRecord` there.
  // 'z' is `kind` — 'k' was already spent on `streak`. Without this key the
  // weekly card's own `kind: 'weekly'` never survived the wire at all, so a
  // shared weekly link silently rendered as an ordinary session card.
  // 'm' is `multiple` — the bodyweight-milestone line, e.g. "1.75x bodyweight".
  // Appended last, so an older copy of this file simply never assigns `w.multiple`
  // and the card renders exactly as it did before this key existed.
  var SHORT = ['t', 'd', 'v', 's', 'u', 'k', 'n', 'w', 'f', 'g', 'e', 'r', 'z', 'm'];

  function b64urlEncode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /** Full workout object -> compact wire form. */
  function pack(w) {
    var o = {};
    for (var i = 0; i < LONG.length; i++) {
      if (w[LONG[i]] != null && w[LONG[i]] !== '') o[SHORT[i]] = w[LONG[i]];
    }
    if (w.pr && w.pr.lift) {
      // `gain` rides too. Without it the card fell back to "BEST YET" on every
      // shared PR, because the renderer refuses to compute it from `prev` —
      // prev is 0 in the e1RM branch and subtracting printed the whole bar as
      // the improvement. Appended last so an older decoder ignores it.
      o.p = [w.pr.lift, w.pr.weight, w.pr.reps, w.pr.prev, w.pr.gain];
      // And `heaviest` after it, only when true (R484). Without it the gain
      // above was packed and then ignored: the renderer gates its gain line on
      // `heaviest` too, so every shared link fell back to "BEST YET" anyway
      // while the sender's own card showed "+10 LB". Absent still means false,
      // so a link made by an older build is unchanged.
      if (w.pr.heaviest) o.p.push(1);
    }
    // A one-week streak is not a streak; the in-app card already refuses to
    // print one (streakWorthShowing is >= 2) and the shared card had no such
    // rule, so it claimed "1 WK" on a first-ever workout.
    if (typeof w.streak === 'number' && w.streak < 2) delete o.k;
    // `firstSession: false` is the default the card already assumes, and every
    // session after the first would spend URL budget restating it.
    if (o.f === false) delete o.f;
    // The heaviest set of the session — what a first card claims in place of a
    // record it did not break.
    if (w.best && w.best.lift) o.b = [w.best.lift, w.best.weight, w.best.reps];
    /*
     * Beat your own best, too early for §8 to call it a record — the two
     * sessions after the first, which had no claim on the shared card at all.
     * Only `prev` rides: the lift and the set itself are already in `b`, and
     * URL budget is the constraint this whole format exists to respect.
     * Appended last, so a decoder built before this simply ignores it and
     * falls through to the behaviour it already had.
     */
    if (w.bestYet && typeof w.bestYet.prev === 'number') o.y = w.bestYet.prev;
    /*
     * Only when FALSE, and it is the falsehood that has to ride: without it
     * the recipient's card counts up to a giant "0" for a session of push-ups
     * the sender's own screen refused to total. Absent reads as "known".
     */
    if (w.volumeKnown === false) o.q = 0;
    // The card's label language; absent means English. See share-url.ts.
    if (w.lang && w.lang !== 'en') o.a = w.lang;
    if (w.lifts && w.lifts.length) {
      // [name, load, isPR] -> [name, load, 1?]  (drop the falsey flag entirely)
      o.l = w.lifts.map(function (x) { return x[2] ? [x[0], x[1], 1] : [x[0], x[1]]; });
    }
    return o;
  }

  /** Compact wire form -> the shape RecapRender expects. */
  function unpack(o) {
    var w = {};
    for (var i = 0; i < SHORT.length; i++) {
      if (o[SHORT[i]] != null) w[LONG[i]] = o[SHORT[i]];
    }
    if (o.p) w.pr = { lift: o.p[0], weight: o.p[1], reps: o.p[2], prev: o.p[3],
                      gain: o.p.length > 4 ? o.p[4] : null,
                      heaviest: o.p.length > 5 && !!o.p[5] };
    if (o.b) w.best = { lift: o.b[0], weight: o.b[1], reps: o.b[2] };
    if (typeof o.y === 'number') w.bestYet = { prev: o.y };
    if (o.q === 0) w.volumeKnown = false;
    if (o.a) w.lang = o.a;
    if (o.l) w.lifts = o.l.map(function (x) { return [x[0], x[1], !!x[2]]; });
    return w;
  }

  /**
   * @param base  e.g. "https://example.app/r"
   * @param w     workout object
   * @param ref   short opaque token identifying the SEND, not the person (§attribution)
   */
  function buildURL(base, w, ref) {
    var q = ref ? ('?r=' + encodeURIComponent(ref)) : '';
    return base + q + '#' + b64urlEncode(JSON.stringify(pack(w)));
  }

  /** Read the workout back out of location.hash. Returns null if absent/corrupt. */
  function readURL(href) {
    try {
      var hash = (href || location.href).split('#')[1];
      if (!hash) return null;
      return unpack(JSON.parse(b64urlDecode(hash)));
    } catch (e) {
      return null;
    }
  }

  function readRef(href) {
    var m = (href || location.href).match(/[?&]r=([^&#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  var api = {
    pack: pack, unpack: unpack,
    buildURL: buildURL, readURL: readURL, readRef: readRef,
    _b64urlEncode: b64urlEncode, _b64urlDecode: b64urlDecode
  };
  root.ShareURL = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

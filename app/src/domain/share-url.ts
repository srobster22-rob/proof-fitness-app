import type { RecapPayload } from './session.ts';

/**
 * Pack a finished workout into a link the recipient can open.
 *
 * §5 is blunt about why this matters: the group chat is the destination to
 * design for, and it is "the only destination that can carry a link" — a
 * tappable install path next to the file, rather than a watermark impression
 * that converts close to nobody. `link/README.md` calls it the single strongest
 * acquisition mechanism the product has. The landing page, the packing format
 * and the deep-link manifests were all built; nothing in the app ever produced
 * a URL, so the share message went out as bare text.
 *
 * **The payload rides in the fragment**, after the `#`, which is never
 * transmitted to a server. That is what lets the landing page re-render a real
 * recap with no backend and no upload — and it is what keeps §11's promise that
 * training data does not leave the phone. The cost is that a chat client's
 * unfurl preview cannot be personalised, and `link/README.md` takes that trade
 * knowingly: in a group chat the video attachment IS the preview.
 *
 * This is a port of `link/share-url.js`, which the landing page loads. Two
 * implementations of one wire format is a real risk, so `share-url.test.ts`
 * encodes with this module and decodes with THAT file — if they ever drift, the
 * round-trip fails rather than the link silently rendering an empty card.
 */

/** Keys are shortened because some chat clients truncate around 2,000 characters. */
/*
 * `firstSession` and `goalLine` ride because the card has a claim slot above the
 * lift list, and without them a session with no PR — every first-ever workout,
 * by §8, and most ordinary ones — had nothing true to put in it.
 */
const LONG = ['title', 'date', 'volume', 'sets', 'duration', 'streak', 'unit', 'watermark',
              'firstSession', 'goalLine', 'trendLine', 'streakRecord', 'kind', 'multiple'] as const;
// 'e' is §8's second lead — see `trendLine`. 'r' is the streak-record accent.
// 'z' is `kind` — 'k' was already spent on `streak` long before this field
// existed. All three appended last, so a decoder built before any of them
// simply ignores the key and renders as it always did.
// 'm' is `multiple` — the bodyweight-milestone line (R435-438), appended last
// for the same reason: a decoder built before it ignores an unknown key rather
// than choking on it, confirmed by `unpack`'s own loop only ever reading keys
// it knows the LONG name for.
const SHORT = ['t', 'd', 'v', 's', 'u', 'k', 'n', 'w', 'f', 'g', 'e', 'r', 'z', 'm'] as const;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * UTF-8 bytes, by hand.
 *
 * Not `TextEncoder`: it is present in modern Hermes and absent in older ones,
 * and a share button that throws on one OS version is worse than twenty lines
 * of arithmetic. Not `btoa` either — that is a browser global with no guarantee
 * on native, and it cannot take non-ASCII anyway, which exercise names can be.
 */
function utf8(str: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    // Combine a surrogate pair into the code point it actually represents.
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/** base64url — the `-_` alphabet with no `=` padding, so it is URL-safe unescaped. */
export function b64url(str: string): string {
  const b = utf8(str);
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < b.length) out += B64[(n >> 6) & 63];
    if (i + 2 < b.length) out += B64[n & 63];
  }
  return out;
}

/** The recap, in the compact wire form the landing page reads. */
export function pack(w: RecapPayload): Record<string, unknown> {
  const src = w as unknown as Record<string, unknown>;
  const o: Record<string, unknown> = {};
  for (let i = 0; i < LONG.length; i++) {
    const v = src[LONG[i]];
    if (v != null && v !== '') o[SHORT[i]] = v;
  }
  /*
   * A one-week streak is not a streak, and the in-app card already refuses to
   * print one — `streakWorthShowing` is `>= 2`. The shared card had no such
   * rule and happily claimed "1 WK" on a first-ever workout, so the artifact
   * that travels made a claim the artifact on the phone had suppressed.
   * Dropped here rather than taught to the renderer, so the rule stays in one
   * place and the renderer keeps only drawing what it is handed.
   */
  if (typeof w.streak === 'number' && w.streak < 2) delete o.k;
  // `firstSession: false` is the default the card already assumes, and every
  // session after the first would spend URL budget restating it.
  if (o.f === false) delete o.f;
  // `gain` rides too. Without it every shared card fell back to "BEST YET",
  // because the renderer refuses to derive it from `prev` — prev is 0 in the
  // e1RM branch and subtracting printed the entire bar as the improvement.
  /*
   * `heaviest` rides as a 6th slot, and only when true (R484).
   *
   * Packing `gain` (above) was supposed to stop the shared card falling back to
   * "BEST YET" — and it did not, because R435 later gated the renderer's gain
   * line on `heaviest` as well, without adding the field here. `heaviest` was
   * absent, `!undefined` is true, so EVERY shared link took the fallback: the
   * sender's own card read "+10 LB" and the card their friend opened read
   * "BEST YET", for the same workout. Measured by round-tripping a real payload
   * through `link/share-url.js` and rendering both.
   *
   * R220 recorded the omission as "deliberate and symmetric" on the grounds
   * that "spike/recap.js never reads heaviest at all". That was true when it
   * was written and stopped being true in R435; the note outlived the fact.
   *
   * Emitted only when true so the common card spends nothing, and absent still
   * decodes as false — a link shared by an older build keeps exactly the
   * behaviour it has today rather than starting to claim something new.
   */
  if (w.pr && w.pr.lift) {
    const p: unknown[] = [w.pr.lift, w.pr.weight, w.pr.reps, w.pr.prev, w.pr.gain];
    if (w.pr.heaviest) p.push(1);
    o.p = p;
  }
  // The heaviest set of the session — what a first card claims in place of a
  // record it did not break.
  if (w.best && w.best.lift) o.b = [w.best.lift, w.best.weight, w.best.reps];
  /*
   * Beat your own best, too early for §8 to call it a record — the two
   * sessions after the first, which reached the shared card's claim slot with
   * nothing to put in it. Only `prev` rides: the lift and the set are already
   * in `b`, and URL budget is the constraint this format exists to respect.
   * Appended last, so a decoder built before this ignores it and falls through
   * to the behaviour it already had.
   */
  if (w.bestYet) o.y = w.bestYet.prev;
  /*
   * Only when FALSE, and it is the falsehood that has to ride: without it the
   * recipient's card counts up to a giant "0" for a session of push-ups the
   * sender's own screen refused to total. Absent reads as "known", which is
   * what every card built before this assumed.
   */
  if (w.volumeKnown === false) o.q = 0;
  /*
   * The language the card draws its own labels in.
   *
   * Two characters, and only when it is not English — the renderer treats an
   * absent code as English, which is what every card built before this meant.
   * Without it a Spanish workout arrived at the recipient's browser labelled
   * TOTAL VOLUME / SETS / STREAK while the sender's screen said VOLUMEN TOTAL
   * / SERIES / RACHA, because `spike/recap.js` held those words as literals.
   */
  if (w.lang && w.lang !== 'en') o.a = w.lang;
  // [name, load, isPR] -> [name, load, 1?]; the falsey flag is dropped entirely.
  if (w.lifts && w.lifts.length) {
    o.l = w.lifts.map(x => (x[2] ? [x[0], x[1], 1] : [x[0], x[1]]));
  }
  return o;
}

/**
 * Where the link points.
 *
 * The same host `app.json` already declares in `associatedDomains` and the
 * Android intent filter — a second copy of a domain is a second thing to change
 * when the real one lands, and the one that gets missed breaks Universal Links
 * silently. `share-url.test.ts` asserts the two agree.
 */
export const SHARE_BASE = 'https://example.app/r';

/**
 * @param w   the finished workout
 * @param ref opaque token identifying the SEND, never the person (§attribution)
 */
export function shareUrl(w: RecapPayload, ref?: string | null, base = SHARE_BASE): string {
  const q = ref ? `?r=${encodeURIComponent(ref)}` : '';
  return `${base}${q}#${b64url(JSON.stringify(pack(w)))}`;
}

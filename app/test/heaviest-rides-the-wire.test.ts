import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { shareUrl } from '../src/domain/share-url.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const require_ = createRequire(import.meta.url);
const ShareURL = require_(path.join(ROOT, 'link', 'share-url.js'));
const R = require_(path.join(ROOT, 'spike', 'recap.js'));
const { createCanvas, GlobalFonts } = require_('@napi-rs/canvas');
GlobalFonts.loadSystemFonts();

const base = {
  title: 'PUSH DAY', date: 'TUE 28 JUL', volume: 9800, sets: 12, duration: '48 MIN',
  streak: 14, unit: 'lb', watermark: 'PROOF',
  lifts: [['Bench Press', '225 x 5', true]]
};

/** What the claim slab's right-hand label actually says, drawn. */
function slabLabel(data: unknown): string[] {
  const c = createCanvas(R.W, R.H);
  const ctx = c.getContext('2d');
  const seen: string[] = [];
  const real = ctx.fillText.bind(ctx);
  ctx.fillText = (t: string, x: number, y: number) => {
    seen.push(String(t));
    return real(t, x, y);
  };
  R.render(ctx, R.DURATION, { data });
  return seen.filter(t => /BEST YET|^\+\d/.test(t));
}

/*
 * R484. The sender's card and the card their friend opens are the SAME card,
 * and they disagreed on every shared personal record.
 *
 * `share-url.ts` packs `gain` with a comment saying it rides "because without
 * it every shared card fell back to BEST YET". R435 later gated the renderer's
 * gain line on `heaviest` as well — and nothing added `heaviest` to the wire.
 * `undefined` is falsy, so the guard took the fallback every time: measured by
 * round-tripping a real payload, the sender's card drew "+10 LB" and the
 * recipient's drew "BEST YET", for one workout.
 *
 * R220 examined this exact omission and recorded it as "deliberate and
 * symmetric", on the stated grounds that "spike/recap.js never reads heaviest
 * at all". True when written, false from R435 onward — the note outlived the
 * fact it rested on, which is why this file asserts the RENDERED result rather
 * than the wire alone.
 */
describe('a shared PR card claims what the sender\'s card claimed (§5)', () => {
  const pr = { lift: 'Bench Press', weight: 225, reps: 5, prev: 215, gain: 10, heaviest: true };

  test('heaviest survives the round trip through both wire implementations', () => {
    const back = ShareURL.readURL(shareUrl({ ...base, pr } as never));
    assert.equal(back.pr.heaviest, true,
      'the flag that qualifies the gain does not reach the renderer');
    assert.equal(back.pr.gain, 10);
  });

  test('and the two cards draw the same claim', () => {
    const payload = { ...base, pr };
    const back = ShareURL.readURL(shareUrl(payload as never));
    assert.deepEqual(slabLabel(back), slabLabel(payload),
      'the recipient sees a different claim than the sender for one workout');
    assert.deepEqual(slabLabel(payload), ['+10 LB']);
  });

  /*
   * The guard still has to do its job. A set can beat its own rep count's
   * previous best while being lighter than a different rep count's PR — §8's
   * cry-wolf rule is what `heaviest` exists for, and packing it must not turn
   * the fallback off, only make it truthful.
   */
  test('a genuine PR that is NOT the heaviest ever still says BEST YET', () => {
    const notHeaviest = { ...pr, heaviest: false };
    const back = ShareURL.readURL(shareUrl({ ...base, pr: notHeaviest } as never));
    assert.equal(back.pr.heaviest, false);
    assert.deepEqual(slabLabel(back), ['BEST YET'],
      'the cry-wolf guard stopped firing — a non-heaviest PR is claiming the gain');
  });

  test('a link made before this shipped still decodes, and still says BEST YET', () => {
    // Backward compatibility, stated rather than assumed: the flag is appended
    // only when true, so an older five-element `p` must read as false — not as
    // undefined-and-therefore-something-new.
    const old = ShareURL.unpack(ShareURL.pack({ ...base, pr: { ...pr, heaviest: undefined } }));
    assert.equal(old.pr.heaviest, false);
    assert.deepEqual(slabLabel(old), ['BEST YET']);
  });
});

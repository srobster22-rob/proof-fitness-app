import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { shareText } from '../src/ui/recap-model.ts';
import { pack } from '../src/domain/share-url.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const require_ = createRequire(import.meta.url);
const RecapRender = require_(path.join(ROOT, 'spike', 'recap.js'));
const { createCanvas, GlobalFonts } = require_('@napi-rs/canvas');
/*
 * The DEPLOYED decoder, not a second copy written here. The card a stranger
 * opens is rendered from `unpack(pack(x))`, and the two halves live in
 * different languages on purpose — `pack` in the app's TypeScript, `unpack` in
 * the plain JS the landing page serves. Testing the pair is the only way to see
 * a field that survives one and not the other, which is exactly how R435's
 * "+10 LB" became a stranger's "BEST YET".
 */
const ShareUrl = require_(path.join(ROOT, 'link', 'dist', 'share-url.js'));
GlobalFonts.loadSystemFonts();

const BASE = {
  title: 'PUSH DAY', date: 'WED 29 JUL', volume: 5960, sets: 3,
  duration: '65 MIN', streak: 7, unit: 'lb', watermark: 'PROOF',
  best: { lift: 'Bench Press', weight: 205, reps: 5 },
  lifts: [['Bench Press', '205 × 5', true]] as Array<[string, string, boolean]>
};

/**
 * Every string the card actually DRAWS, captured by wrapping fillText.
 *
 * Not a pixel read: the question here is which CLAIM the card makes, and the
 * claim is a word. `share-card.test.ts` reads pixels because it asks about
 * layout; this asks about wording, so it records the calls.
 */
function drawnText(data: Record<string, unknown>): string[] {
  const c = createCanvas(RecapRender.W, RecapRender.H);
  const ctx = c.getContext('2d');
  const said: string[] = [];
  const real = ctx.fillText.bind(ctx);
  (ctx as unknown as { fillText: unknown }).fillText = (t: string, x: number, y: number) => {
    said.push(String(t));
    return real(t, x, y);
  };
  RecapRender.render(ctx, RecapRender.DURATION, { data });
  return said;
}

/*
 * Which claim a surface is making — read in that surface's OWN vocabulary.
 *
 * The two deliberately use different words for the same claim, and the second
 * blind instrument of this round came from assuming they did not: the card
 * prints the label NEW PERSONAL RECORD, the message writes the prose "heaviest
 * ever, up from 200", and a single regex set reported the message claiming
 * nothing on four correct workouts.
 *
 * What has to agree is the CLAIM, not the wording. A card is a label and a
 * message is a sentence, and forcing them to share phrasing would be a worse
 * product for the sake of an easier test.
 */
const CARD_WORDS: Array<[string, RegExp]> = [
  ['pr', /NEW PERSONAL RECORD|NUEVO RÉCORD PERSONAL/],
  ['firstSession', /SESSION ONE|ONE TO BEAT/],
  ['bestYet', /BEST YET|LO MEJOR HASTA AHORA/]
];

const MESSAGE_WORDS: Array<[string, RegExp]> = [
  ['pr', /HEAVIEST EVER/],
  ['firstSession', /SESSION ONE/],
  ['bestYet', /BEST SET YET/]
];

function claimIn(vocabulary: Array<[string, RegExp]>, said: string): string {
  const all = said.toUpperCase();
  for (const [claim, pattern] of vocabulary) if (pattern.test(all)) return claim;
  return 'none';
}

/** Every string the card draws, joined with NOTHING — see `drawnText`. */
const cardClaim = (data: Record<string, unknown>) =>
  claimIn(CARD_WORDS, drawnText(data).join(''));

const messageClaim = (data: Record<string, unknown>) =>
  claimIn(MESSAGE_WORDS, shareText(
    { payload: data, prs: [], thin: false, sessionId: 's1', multiple: null } as never, 'en'));

/*
 * R552. §5: "the message is the half that actually travels."
 *
 * Three surfaces decide what a workout gets CALLED — the recap screen, the
 * share message, and the card image that a stranger opens — and each has its
 * own copy of the same priority ladder, in TSX, TS and plain JS. The repo has
 * three gates asserting every payload field is MENTIONED in each, and mentioned
 * is not agreed: R435's defect was a field mentioned everywhere, where the
 * sender's card read "+10 LB" and the card their friend opened read "BEST YET"
 * for the same workout. R540's was `bestYet` firing on a claim `findPRs` had
 * already refused.
 *
 * R290 considered testing the ladder and chose not to, because it "does not
 * reduce to a flat list of names without restructuring RecapPayload". That is
 * true of the SOURCE, and it does not have to be tested from the source: render
 * the card, generate the message, and ask each what it called the workout.
 */
describe('the card and the message make the same claim (R552)', () => {
  const CASES: Array<[string, Record<string, unknown>, string]> = [
    ['a personal record', {
      ...BASE, pr: { lift: 'Bench Press', weight: 205, reps: 5, prev: 200, gain: 5, heaviest: true }
    }, 'pr'],
    ['a first-ever session', { ...BASE, firstSession: true, streak: 1 }, 'firstSession'],
    ['a best that is not yet a record', { ...BASE, bestYet: { prev: 195 } }, 'bestYet'],
    ['an ordinary workout', { ...BASE }, 'none'],
    /*
     * The precedence cases, which are where three copies of a ladder actually
     * drift. Each has two claims true at once and only one right answer.
     */
    ['a record on a first session', {
      ...BASE, firstSession: true,
      pr: { lift: 'Bench Press', weight: 205, reps: 5, prev: 0, gain: null, heaviest: true }
    }, 'pr'],
    ['a best yet on a first session', { ...BASE, firstSession: true, bestYet: { prev: 195 } }, 'firstSession'],
    ['a record and a best yet', {
      ...BASE, bestYet: { prev: 195 },
      pr: { lift: 'Bench Press', weight: 205, reps: 5, prev: 200, gain: 5, heaviest: true }
    }, 'pr']
  ];

  for (const [name, data, expected] of CASES) {
    test(`${name}: card and message both say "${expected}"`, () => {
      const card = cardClaim(data);
      const message = messageClaim(data);
      assert.equal(card, expected, `the CARD called it "${card}"`);
      assert.equal(message, expected, `the MESSAGE called it "${message}"`);
    });
  }

  test('and the claim survives the round trip through the link', () => {
    /*
     * The card a stranger opens is rendered from the URL, not from the payload
     * in memory — which is exactly how R435 escaped: the two differed only
     * after packing. So the last check renders from what the link carries.
     */
    for (const [name, data, expected] of CASES) {
      const packed = ShareUrl.unpack(pack(data as never));
      assert.equal(cardClaim(packed as never), expected,
        `${name}: after packing, the card a stranger opens calls it something else`);
    }
  });
});

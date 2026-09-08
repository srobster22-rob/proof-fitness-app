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
/*
 * The card's vocabulary, READ OUT OF THE RENDERER rather than retyped here.
 *
 * Retyping it is how this test was blind three times: the English labels were
 * copied and the Spanish ones were not, so `SESIÓN UNO` read as no claim at all
 * and two correct workouts were reported broken. A hand-kept copy of another
 * file's strings drifts the moment somebody edits the other file — HANDOFF #13,
 * in the test that exists to catch exactly this kind of drift between copies.
 *
 * `LABELS` is module-private, so this parses the source. The assertion below is
 * the safety catch: if the parse ever finds nothing, the vocabulary is empty
 * and every card would read as claiming nothing, which is a pass.
 */
const RENDER_SRC = fs.readFileSync(path.join(ROOT, 'spike', 'recap.js'), 'utf8');

function labelsFor(key: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(key + String.raw`:\s*'([^']+)'`, 'g');
  for (const m of RENDER_SRC.matchAll(pattern)) found.push(m[1]);
  return found;
}

function anyOf(labels: string[]): RegExp {
  /*
   * Throws on an empty list, and that is the important line. `new RegExp('')`
   * matches EVERY string, so a vocabulary that failed to parse does not read as
   * 'no claim' — it reads as the FIRST claim, on every card. That is how this
   * round briefly reported all seven English cases claiming a personal record.
   */
  if (!labels.length) throw new Error('no labels: the parse found nothing to match');
  // Escaped via a character LIST rather than a regex literal full of
  // backslashes: this line has been eaten twice by escaping (HANDOFF trap 7),
  // and a list has nothing to eat.
  const META = '.*+?^${}()|[]\\'.split('');
  const quote = (l: string) =>
    l.split('').map(ch => (META.indexOf(ch) >= 0 ? '\\' + ch : ch)).join('');
  return new RegExp(labels.map(quote).join('|'), 'i');
}

const CARD_WORDS: Array<[string, RegExp]> = [
  ['pr', anyOf(labelsFor('pr'))],
  ['firstSession', anyOf([...labelsFor('first'), ...labelsFor('toBeat')])],
  ['bestYet', anyOf(labelsFor('bestYet'))]
];

test('the card vocabulary was actually found in the renderer', () => {
  // A gate on the instrument. An empty vocabulary makes every case report
  // "none", and three of the seven cases expect "none" — so a silent parse
  // failure would leave a suite that is mostly green and entirely blind.
  for (const [claim, pattern] of CARD_WORDS) {
    assert.notEqual(pattern.source, '(?:)', `no card labels found for "${claim}"`);
  }
  for (const [claim, labels] of [['pr', labelsFor('pr')], ['bestYet', labelsFor('bestYet')],
                                 ['first', labelsFor('first')]] as Array<[string, string[]]>) {
    assert.ok(labels.length >= 2,
      `only ${labels.length} label(s) for "${claim}" — both languages should be there`);
  }
  assert.ok(labelsFor('first').some(l => /SESIÓN/i.test(l)),
    'the Spanish first-session label is missing, which is the case that was blind');
});

const MESSAGE_WORDS: Array<[string, RegExp]> = [
  ['pr', /HEAVIEST EVER|LO MÁS PESADO HASTA AHORA/],
  ['firstSession', /SESSION ONE|SESIÓN UNO/],
  ['bestYet', /BEST SET YET|LA MEJOR SERIE HASTA AHORA/]
];

/*
 * Order matters in these lists and it is not alphabetical (R553).
 *
 * Spanish says "lo más pesado hasta ahora" for a record and "la mejor serie
 * hasta ahora" for a best — the two share four words. A vocabulary checked in
 * the wrong order would read every Spanish record as a `bestYet`, which is
 * precisely the claim confusion this file exists to catch, introduced by the
 * file itself. `claimIn` returns the FIRST match and `pr` is listed first, so
 * the more specific claim wins; this asserts that rather than trusting it.
 */
test('the Spanish vocabulary cannot confuse a record with a best', () => {
  assert.equal(claimIn(MESSAGE_WORDS, 'lo más pesado hasta ahora, antes 200'), 'pr');
  assert.equal(claimIn(MESSAGE_WORDS, 'la mejor serie hasta ahora, antes 195'), 'bestYet');
});

function claimIn(vocabulary: Array<[string, RegExp]>, said: string): string {
  const all = said.toUpperCase();
  for (const [claim, pattern] of vocabulary) if (pattern.test(all)) return claim;
  return 'none';
}

/** Every string the card draws, joined with NOTHING — see `drawnText`. */
const cardClaim = (data: Record<string, unknown>) =>
  claimIn(CARD_WORDS, drawnText(data).join(''));

const messageClaim = (data: Record<string, unknown>, lang: 'en' | 'es' = 'en') =>
  claimIn(MESSAGE_WORDS, shareText(
    { payload: data, prs: [], thin: false, sessionId: 's1', multiple: null } as never, lang));

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

  /*
   * Both languages, because §16 wants them saying the same thing and the card
   * is the artefact that LEAVES the device — a Spanish sender's card is read by
   * people who will never open the app. R552 shipped the es labels in
   * `CARD_WORDS` with nothing exercising them, which is a vocabulary list one
   * step from being a blind instrument.
   */
  for (const lang of ['en', 'es'] as const) {
    for (const [name, data, expected] of CASES) {
      test(`${lang} — ${name}: card and message both say "${expected}"`, () => {
        const payload = lang === 'es' ? { ...data, lang: 'es' } : data;
        const card = cardClaim(payload);
        const message = messageClaim(payload, lang);
        assert.equal(card, expected, `the ${lang} CARD called it "${card}"`);
        assert.equal(message, expected, `the ${lang} MESSAGE called it "${message}"`);
      });
    }
  }

  test('and the claim survives the round trip through the link', () => {
    /*
     * The card a stranger opens is rendered from the URL, not from the payload
     * in memory — which is exactly how R435 escaped: the two differed only
     * after packing. So the last check renders from what the link carries.
     */
    for (const lang of ['en', 'es'] as const) {
      for (const [name, data, expected] of CASES) {
        const payload = lang === 'es' ? { ...data, lang: 'es' } : data;
        const packed = ShareUrl.unpack(pack(payload as never));
        assert.equal(cardClaim(packed as never), expected,
          `${lang} ${name}: after packing, the card a stranger opens calls it something else`);
      }
    }
  });
});

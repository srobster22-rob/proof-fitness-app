import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

/*
 * R435-442: the render-side sibling of share-url.test.ts's "every
 * RecapPayload field is at least mentioned in pack()" (R290).
 *
 * This is the house pattern for "every X must do Y", named in HANDOFF.md's
 * traps list (#13) alongside its sibling test/weight-display-unit-coverage
 * .test.ts: derive the population from source rather than hand-listing it,
 * exempt explicitly with a stated reason, and prove the gate can fail before
 * trusting it. Read that entry before writing a fourth instance of this
 * shape.
 *
 * That test ends the wire-format INSTANCE of a bug class; this one ends the
 * RENDER instance, which is the one that actually bit twice on the same
 * file. `pr.heaviest` (R435) and `multiple` (R439) both reached
 * `RecapPayload` and were both silently absent from `spike/recap.js` — the
 * one artifact that leaves the device as a picture — with nothing anywhere
 * complaining. Sweeping by hand a third time would only find a third
 * instance; this test exists so the FOURTH field never needs a round of its
 * own; then found a fourth for free before it ever needed one: `firstSession`
 * had the identical gap in `shareText`, sitting one branch above the
 * `bestYet` fix whose own comment already described curing this exact defect
 * for itself.
 *
 * Same technique as R290, same reason: reduce to "is the field's name
 * mentioned anywhere in this consumer's source, comments stripped" rather
 * than a real coverage analysis, which cannot be done cheaply against
 * `RecapPayload`'s claim-priority branching (pr beats firstSession beats
 * bestYet beats a plain lift line) without restructuring the type into a
 * discriminated union — a bigger, riskier change than the bug this prevents.
 * "At least mentioned" is a low bar on purpose: cheap enough to run on every
 * field, every consumer, forever, and it would have failed before every fix
 * this file's own history describes.
 *
 * WHAT THIS DOES NOT PROVE, so a later round does not over-trust it: the
 * assertion is that a field's NAME appears in a consumer's source, comments
 * stripped — nothing here checks that it is read correctly, gated on the
 * right condition, or even read from the right OBJECT. A field mentioned only
 * in an unreachable branch, a stale comment that survived a rename, or a copy
 * used for an unrelated purpose still passes. It catches OMISSION, which is
 * the specific shape that has bitten this codebase four times now
 * (`pr.heaviest`, `multiple`, `firstSession`, and R290's original `kind`) —
 * it cannot catch a field that is present and wrong. Correctness once a field
 * is confirmed to be read at all is still each fix's own job, proven the way
 * R435 and R440 did it: real arithmetic checked by hand, or real pixels
 * rendered and scanned, not another string match.
 */

const sessionSrc = fs.readFileSync(path.join(ROOT, 'app', 'src', 'domain', 'session.ts'), 'utf8');
const start = sessionSrc.indexOf('export interface RecapPayload {');
const end = sessionSrc.indexOf('\n}', start);
const body = sessionSrc.slice(start, end);
const FIELDS = [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map(m => m[1]);

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

test('the interface still has the fields this suite expects to check', () => {
  // A sanity floor so this cannot pass by parsing nothing — the same rule
  // R290's own version of this check polices, and `source-helper.test.ts`
  // polices project-wide.
  assert.ok(FIELDS.length >= 15, `only found ${FIELDS.length} fields — did the anchor break?`);
  assert.ok(FIELDS.includes('multiple') && FIELDS.includes('firstSession'),
    'the two fields this suite was built to catch are missing from the parse — check the anchors');
});

describe('every RecapPayload field is at least mentioned in recap.tsx', () => {
  const src = strip(fs.readFileSync(path.join(ROOT, 'app', 'app', 'recap.tsx'), 'utf8'));
  /*
   * The live screen already knows its own language and always renders the
   * per-session card, never the weekly digest — `lang` and `kind` exist
   * specifically for the OTHER renderers, which have no live app context of
   * their own (a URL-decoded landing page, a native share-extension process).
   * `watermark` exists to sign an artifact that leaves the app UNACCOMPANIED
   * by any app chrome around it (the PNG, the URL card) — the live screen is
   * already inside the app and has no need to say so. Confirmed by reading
   * the branch each ride is FOR, not assumed because the test was
   * inconvenient otherwise; this exact assumption is what R290's own version
   * of this test warns against making blindly.
   */
  const EXEMPT = new Set(['lang', 'kind', 'watermark']);

  for (const field of FIELDS) {
    if (EXEMPT.has(field)) continue;
    test(`recap.tsx mentions "${field}"`, () => {
      assert.match(src, new RegExp(`\\b${field}\\b`),
        `RecapPayload.${field} is never referenced in recap.tsx — the live screen the user sees first ` +
        `would silently never show it`);
    });
  }
});

describe('every RecapPayload field is at least mentioned in shareText', () => {
  const full = fs.readFileSync(path.join(ROOT, 'app', 'src', 'ui', 'recap-model.ts'), 'utf8');
  const fnStart = full.indexOf('export function shareText(');
  assert.ok(fnStart >= 0, 'shareText moved or was renamed — update this test\'s anchor');
  const fnEnd = full.indexOf('\n}', fnStart);
  const src = strip(full.slice(fnStart, fnEnd));
  /*
   * The text message is what actually travels (§5) and does not draw chrome
   * the way the card and the image do — no "TOTAL VOLUME" label, no per-card
   * language switch of its own vocabulary beyond the `lang` PARAMETER
   * `shareText` already takes directly (not `payload.lang`, a genuinely
   * different thing: the function's own argument, not a field read off the
   * payload). `title`/`date`/`duration` are chrome the message never quotes;
   * a sentence does not print its own timestamp.
   */
  const EXEMPT = new Set(['title', 'date', 'duration', 'lang', 'kind']);

  for (const field of FIELDS) {
    if (EXEMPT.has(field)) continue;
    test(`shareText mentions "${field}"`, () => {
      assert.match(src, new RegExp(`\\b${field}\\b`),
        `RecapPayload.${field} is never referenced in shareText — the message that actually leaves ` +
        `the app would silently never say it, the exact shape of the firstSession gap this suite found`);
    });
  }
});

describe('every RecapPayload field is at least mentioned in the shareable image', () => {
  const src = strip(fs.readFileSync(path.join(ROOT, 'spike', 'recap.js'), 'utf8'));
  // The image is the full renderer — everything a card, a first session, a
  // best-yet, a goal, a milestone, a weekly digest can claim, it draws. No
  // exemptions: this is the file that has silently dropped a field twice.
  const EXEMPT = new Set<string>();

  for (const field of FIELDS) {
    if (EXEMPT.has(field)) continue;
    test(`spike/recap.js mentions "${field}"`, () => {
      assert.match(src, new RegExp(`\\b${field}\\b`),
        `RecapPayload.${field} is never referenced in spike/recap.js — the shareable IMAGE, the one ` +
        `artifact that actually leaves the device as a picture, would silently never draw it. ` +
        `This exact failure shape has happened twice already (pr.heaviest, then multiple).`);
    });
  }
});

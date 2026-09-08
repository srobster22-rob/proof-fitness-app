import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.join(HERE, '..', ...p.split('/')), 'utf8');

/*
 * R435: found by asking whether a real, correctly-computed field ever
 * actually reaches a screen. `payload.pr.heaviest` (session.ts) is computed
 * with heavy documented care — several historical bug-fixes exist specifically
 * because a false "heaviest ever" claim went out — and IS read by shareText
 * (recap-model.ts), but recap.tsx's own on-screen card decided its wording
 * from `gain !== null` alone, never consulting `heaviest`.
 *
 * The two are genuinely different facts: `gain` only means this beat the
 * SAME rep count's own previous best (230x5 over 225x5 is a real +5); a
 * DIFFERENT rep count can still rank higher (a 275x3 on the books), in which
 * case `heaviest` is false even though `gain` is a real positive number. The
 * on-screen card was printing "+5 LB" — implying an absolute record — for
 * exactly the case the whole `heaviest` field exists to catch, on the one
 * surface every user sees before they ever open the share sheet.
 */
describe('the on-screen PR card does not claim a bare gain number as a record it is not', () => {
  const src = read('app/recap.tsx');

  test('the gain-number branch is gated on payload.pr.heaviest, not just gain', () => {
    assert.match(src, /payload\.pr\.heaviest && payload\.pr\.gain !== null/,
      'a real but non-heaviest gain would print "+N LB" as if it were an absolute record');
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECAP_TSX = fs.readFileSync(path.join(HERE, '..', '..', 'app', 'recap.tsx'), 'utf8');

/**
 * The recap SCREEN's claim ladder, lifted out of the JSX and made runnable.
 *
 * `recap.tsx` cannot be rendered in this suite — there is no test renderer and
 * §12 forbids adding one — so R552 checked the screen's ladder by reading it
 * while the card and the message were checked by running them. Two surfaces
 * executed, one described.
 *
 * The slab guards are pure predicates over the payload, so they can be lifted
 * and evaluated. That matters more than it sounds: a test that MATCHES the
 * guard's text passes on any edit that keeps the words, while this one runs
 * whatever the file now says.
 */
export function slabGuard(claim: string): (payload: Record<string, unknown>) => boolean {
  const line = RECAP_TSX.split(/\r?\n/).find(l => l.trim().startsWith(`{payload.${claim} &&`));
  // Trap 16: an extraction that finds nothing must throw, not yield a
  // predicate that quietly answers false for everything.
  if (!line) throw new Error(`no slab guard found for "${claim}" — the anchor moved`);
  const expr = line.trim().replace(/^\{/, '').replace(/&&\s*\($/, '').trim();
  return new Function('payload', `return Boolean(${expr});`) as (p: Record<string, unknown>) => boolean;
}

/** Which claim the screen would draw, running its own guards in source order. */
export function screenClaim(payload: Record<string, unknown>): string {
  for (const claim of ['pr', 'firstSession', 'bestYet']) {
    if (slabGuard(claim)(payload)) return claim;
  }
  return 'none';
}

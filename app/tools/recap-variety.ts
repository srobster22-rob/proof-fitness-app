/*
 * Dev-only: how much does the recap actually repeat itself?
 *
 * §8's mature clause: "The recap must not repeat itself. The same layout with
 * different numbers, 200 times, stops being worth posting long before it stops
 * being generated." That is a real requirement and an unfalsifiable one as
 * stated — so this measures it instead of arguing about it.
 *
 * For every session in a database it builds the real payload and records the
 * SHAPE the renderer would draw: which claim occupies the slab, whether the
 * streak cell appears, whether a narrative line does, and how many lifts are
 * listed. Two cards with the same shape differ only in their numbers, which is
 * exactly what §8 says stops being postable.
 *
 *   node tools/recap-variety.ts <path-to.db>
 */
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { recapFor } from '../src/ui/recap-model.ts';
import { streakWorthShowing } from '../src/ui/recap-model.ts';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/recap-variety.ts <path-to.db>'); process.exit(1); }

const repo = new Repo(new DatabaseSync(file) as never, () => Date.now());
const sessions = [...new Set(repo.allSets().map(s => s.sessionId))];
if (!sessions.length) { console.error('no sessions in that database'); process.exit(1); }

/** What the renderer would actually draw, ignoring the numbers. */
function shape(p: Record<string, unknown>): string {
  const claim = p.pr ? 'PR'
    : (p.firstSession && p.best) ? 'first'
    : (p.bestYet && p.best) ? 'bestYet'
    : p.goalLine ? 'goal'
    : p.trendLine ? 'trend'
    : 'none';
  // R271's volt accent is a real visual difference — a card with a plain grey
  // streak and one with the highlighted "longest yet" cell are not the same
  // shape, and this tool exists to catch exactly that kind of collapse.
  const streak = !streakWorthShowing(Number(p.streak) || 0) ? '-'
    : p.streakRecord ? 'streak!' : 'streak';
  const lifts = (p.lifts as unknown[] | undefined)?.length ?? 0;
  return `${claim}/${streak}/${lifts} lifts`;
}

const counts = new Map<string, number>();
let built = 0;
for (const id of sessions) {
  const r = recapFor(repo, id, Date.now());
  if (!r) continue;
  built++;
  const k = shape(r.payload as unknown as Record<string, unknown>);
  counts.set(k, (counts.get(k) ?? 0) + 1);
}

const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
console.log(`${built} recaps, ${rows.length} distinct shapes\n`);
for (const [k, n] of rows) {
  console.log(`  ${String(n).padStart(4)}  ${(n / built * 100).toFixed(0).padStart(3)}%  ${k}`);
}
const top = rows[0];
console.log(`\nmost common shape covers ${(top[1] / built * 100).toFixed(0)}% of cards: ${top[0]}`);

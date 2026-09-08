/**
 * R540, dev-only: the same pull-up as always, at a heavier bodyweight.
 *
 * `findPRs` awards nothing (the belt never moved), so the recap card falls
 * through to `bestYet` — which compared real load alone and called it BEST YET.
 * Finish the workout to see the card.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'public', 'bw540.b64');
const TMP = path.join(HERE, '..', 'public', '.bw540.tmp.db');
const DAY = 86_400_000;

fs.rmSync(TMP, { force: true });
const now = Date.now();
const db = new DatabaseSync(TMP);
const repo = new Repo(db as never, () => now);
let n = 0;
for (const d of [21, 14, 7]) {
  const id = `h${d}`;
  repo.startSession(id, 'lb');
  repo.logSet({ id: `s${n++}`, sessionId: id, exerciseId: 'pullup', weight: 25, reps: 5, at: now - d * DAY });
  repo.endSession(id, now - d * DAY + 3600_000);
}
repo.saveMeasurement({ id: 'b0', kind: 'bodyweight', value: 180, unit: 'lb', at: now - 60 * DAY });
repo.saveMeasurement({ id: 'b1', kind: 'bodyweight', value: 192, unit: 'lb', at: now - DAY });
repo.startSession('today', 'lb');
// AFTER `now`, not before. `startSession` stamps startedAt from now(), and
// `bestYet` treats anything earlier than that as history — so sets back-dated
// a few minutes became their own prior best and the card said nothing at all.
// Two sets, not one: a single-set session is `thin` and the screen holds its
// message back, which hid the difference entirely on the first attempt.
repo.logSet({ id: 'st', sessionId: 'today', exerciseId: 'pullup', weight: 25, reps: 5, at: now + 1_000 });
repo.logSet({ id: 'st2', sessionId: 'today', exerciseId: 'pullup', weight: 25, reps: 5, at: now + 2_000 });
db.close();
fs.writeFileSync(OUT, fs.readFileSync(TMP).toString('base64'));
fs.rmSync(TMP, { force: true });
console.log('wrote', OUT);

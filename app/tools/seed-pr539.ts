/**
 * R539, dev-only: a pull-up history where TODAY's set is a record on the bar
 * and stops being one the moment the lifter records their real bodyweight.
 *
 * Same trick as seed-web.ts — the app's own Repo, written to public/ as base64.
 * Load it, then log 30 x 5 pull-ups, then add today's bodyweight in Settings.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'public', 'pr539.b64');
const TMP = path.join(HERE, '..', 'public', '.pr539.tmp.db');
const DAY = 86_400_000;

fs.rmSync(TMP, { force: true });
const now = Date.now();
const db = new DatabaseSync(TMP);
const repo = new Repo(db as never, () => now);
let n = 0;
for (const d of [12, 9, 6]) {
  const id = `s${d}`;
  repo.startSession(id, 'lb');
  repo.logSet({ id: `x${n++}`, sessionId: id, exerciseId: 'pullup', weight: 25, reps: 5, at: now - d * DAY });
  repo.endSession(id, now - d * DAY + 3600_000);
}
/*
 * Two readings, and the ORDER is the whole point. `readingAt` looks BACKWARD
 * only, so a reading recorded after a set never changes that set — which is why
 * the obvious demonstration (log the set, then weigh yourself) shows nothing.
 * The reachable case is DELETING a reading: that changes what older sets
 * weighed, with no set written, so `allSets()` never moves.
 *
 * Here: the history sets weigh 25 + 300 = 325, today's weighs 30 + 195 = 225,
 * so today is no record. Delete the old 300 and the history drops to belt-only
 * 25, and today's 225 becomes one.
 */
repo.saveMeasurement({ id: 'bw0', kind: 'bodyweight', value: 300, unit: 'lb', at: now - 30 * DAY });
repo.saveMeasurement({ id: 'bw1', kind: 'bodyweight', value: 195, unit: 'lb', at: now - 60_000 });
repo.startSession('today', 'lb');
repo.logSet({ id: 'xt', sessionId: 'today', exerciseId: 'pullup', weight: 30, reps: 5, at: now });
db.close();
fs.writeFileSync(OUT, fs.readFileSync(TMP).toString('base64'));
fs.rmSync(TMP, { force: true });
console.log('wrote', OUT);

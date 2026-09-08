/**
 * R573, dev-only: a weighted (bodyweight-equipment) pull-up grinding at 40 lb,
 * reps falling. Before the fix, the equipment-lookup bug always used the
 * barbell floor (45), so the app said "hold here" when a real deload to 35
 * was correct — the wrong equipment lookup silently masked a real deload.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import { assertSaneTimes } from './seed-sanity.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'public', 'r573.b64');
const TMP = path.join(HERE, '..', 'public', '.r573.tmp.db');
const DAY = 86_400_000;

fs.rmSync(TMP, { force: true });
const now = Date.now();
const db = new DatabaseSync(TMP);
const repo = new Repo(db as never, () => now);
let n = 0;
for (const [d, reps] of [[10, 8], [7, 6], [4, 5]] as [number, number][]) {
  const id = `s${d}`;
  repo.startSession(id, 'lb', undefined, now - d * DAY);
  repo.logSet({ id: `x${n++}`, sessionId: id, exerciseId: 'pullup', weight: 40, reps, at: now - d * DAY });
  repo.endSession(id, now - d * DAY + 3600_000);
}
assertSaneTimes(repo);
db.close();
fs.writeFileSync(OUT, fs.readFileSync(TMP).toString('base64'));
fs.rmSync(TMP, { force: true });
console.log('wrote', OUT);

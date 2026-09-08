/**
 * R541, dev-only: a beginner grinding at the empty bar.
 *
 * Three bench sessions at 45 lb with reps falling, which is the shape of
 * fatigue. Before the floor the coach line read "back off to 41" — a weight
 * no barbell can be loaded to, since the bar alone is 45.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'public', 'floor541.b64');
const TMP = path.join(HERE, '..', 'public', '.floor541.tmp.db');
const DAY = 86_400_000;

fs.rmSync(TMP, { force: true });
const now = Date.now();
const db = new DatabaseSync(TMP);
const repo = new Repo(db as never, () => now);
let n = 0;
for (const [d, reps] of [[10, 8], [7, 6], [4, 5]] as [number, number][]) {
  const id = `s${d}`;
  repo.startSession(id, 'lb');
  repo.logSet({ id: `x${n++}`, sessionId: id, exerciseId: 'bench', weight: 45, reps, at: now - d * DAY });
  repo.endSession(id, now - d * DAY + 3600_000);
}
db.close();
fs.writeFileSync(OUT, fs.readFileSync(TMP).toString('base64'));
fs.rmSync(TMP, { force: true });
console.log('wrote', OUT);

/**
 * R549, dev-only: a lifter who logged one session in kilos.
 *
 * Three pound sessions climbing 175 -> 180 -> 185, then 86 kg — which is
 * 189.5 lb, an ordinary next step. The coach reads the step as 4.5 lb and used
 * to say "189.5 and climbing, 4 sessions — try 194", a weight no rack makes.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'public', 'climb549.b64');
const TMP = path.join(HERE, '..', 'public', '.climb549.tmp.db');
const DAY = 86_400_000;

fs.rmSync(TMP, { force: true });
const now = Date.now();
const db = new DatabaseSync(TMP);
const repo = new Repo(db as never, () => now);
let n = 0;
for (const [d, w] of [[11, 175], [8, 180], [5, 185]] as [number, number][]) {
  const id = `lb${d}`;
  repo.startSession(id, 'lb');
  repo.logSet({ id: `s${n++}`, sessionId: id, exerciseId: 'bench', weight: w, reps: 5, at: now - d * DAY });
  repo.endSession(id, now - d * DAY + 3600_000);
}
repo.startSession('kg2', 'kg');
repo.logSet({ id: `s${n++}`, sessionId: 'kg2', exerciseId: 'bench', weight: 86, reps: 5, at: now - 2 * DAY });
repo.endSession('kg2', now - 2 * DAY + 3600_000);
db.close();
fs.writeFileSync(OUT, fs.readFileSync(TMP).toString('base64'));
fs.rmSync(TMP, { force: true });
console.log('wrote', OUT);

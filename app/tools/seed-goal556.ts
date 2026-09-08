/**
 * R556, dev-only: a KILOGRAM goal on a POUND history.
 *
 * The Goals card is the one screen this session never checked against the
 * unit seam. `goalProgress` takes `sessionUnits` and converts, so the numbers
 * should be right — this exists to read what the SCREEN says they are.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'public', 'goal556.b64');
const TMP = path.join(HERE, '..', 'public', '.goal556.tmp.db');
const DAY = 86_400_000;

fs.rmSync(TMP, { force: true });
const now = Date.now();
const db = new DatabaseSync(TMP);
const repo = new Repo(db as never, () => now);
let n = 0;
for (const [d, w] of [[21, 175], [14, 185], [7, 195]] as [number, number][]) {
  const id = `lb${d}`;
  repo.startSession(id, 'lb');
  repo.logSet({ id: `s${n++}`, sessionId: id, exerciseId: 'squat', weight: w, reps: 5, at: now - d * DAY });
  repo.endSession(id, now - d * DAY + 3600_000);
}
// 100 kg is 220.5 lb — they are 25.5 lb away, and the card must not say 100.
repo.saveGoal({
  id: 'g-kg', exerciseId: 'squat', targetWeight: 100, targetReps: 5,
  createdAt: now - 30 * DAY, targetDate: now + 60 * DAY, unit: 'kg'
});
db.close();
fs.writeFileSync(OUT, fs.readFileSync(TMP).toString('base64'));
fs.rmSync(TMP, { force: true });
console.log('wrote', OUT);

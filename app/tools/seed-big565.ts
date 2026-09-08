/**
 * R565, dev-only: a large history for feeling render speed in the product.
 * 400 sessions, ~3600 sets, 60 goals.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import { assertSaneTimes } from './seed-sanity.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'public', 'big565.b64');
const TMP = path.join(HERE, '..', 'public', '.big565.tmp.db');
const DAY = 86_400_000;
const LIFTS = ['bench', 'squat', 'deadlift', 'ohp', 'row', 'curl', 'legpress', 'triext'];

fs.rmSync(TMP, { force: true });
const now = Date.now();
const db = new DatabaseSync(TMP);
const repo = new Repo(db as never, () => now);
let n = 0;
for (let i = 400; i >= 1; i--) {
  const at = now - i * 2 * DAY;
  const id = `s${i}`;
  repo.startSession(id, 'lb', undefined, at);
  for (let k = 0; k < 3; k++) {
    const lift = LIFTS[(i + k) % LIFTS.length];
    for (let set = 0; set < 3; set++) {
      repo.logSet({ id: `x${n++}`, sessionId: id, exerciseId: lift,
        weight: 100 + ((i * 5 + set) % 120), reps: 5 + (set % 4), at: at + set * 120_000 });
    }
  }
  repo.endSession(id, at + 3600_000);
}
for (let g = 0; g < 60; g++) {
  repo.saveGoal({ id: `g${g}`, exerciseId: LIFTS[g % LIFTS.length], targetWeight: 200 + g,
    targetReps: 5, createdAt: now - 200 * DAY, targetDate: now + 90 * DAY, unit: 'lb' });
}
assertSaneTimes(repo);
const summary = `(${repo.allSets().length} sets, ${repo.goals().length} goals)`;
db.close();
fs.writeFileSync(OUT, fs.readFileSync(TMP).toString('base64'));
fs.rmSync(TMP, { force: true });
console.log('wrote', OUT, summary);

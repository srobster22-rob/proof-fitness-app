/**
 * R548, dev-only: a plateaued lifter training in KILOS.
 *
 * Three bench sessions at 60 kg. Before the grid fix the coach line read
 * "Stuck at 60 for 3 — try 61.25", and 1.25 kg total is 0.625 kg a side, which
 * is not a plate that exists.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import { assertSaneTimes } from './seed-sanity.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'public', 'kg548.b64');
const TMP = path.join(HERE, '..', 'public', '.kg548.tmp.db');
const DAY = 86_400_000;

fs.rmSync(TMP, { force: true });
const now = Date.now();
const db = new DatabaseSync(TMP);
const repo = new Repo(db as never, () => now);
repo.setPref('pref.goal', 'size');
repo.setPref('pref.unit', 'kg');
let n = 0;
for (const d of [10, 7, 4]) {
  const id = `s${d}`;
  repo.startSession(id, 'kg', undefined, now - d * DAY);
  repo.logSet({ id: `x${n++}`, sessionId: id, exerciseId: 'bench', weight: 60, reps: 8, at: now - d * DAY });
  repo.endSession(id, now - d * DAY + 3600_000);
}
// Prove the fixture before writing it (R559).
assertSaneTimes(repo);
db.close();
fs.writeFileSync(OUT, fs.readFileSync(TMP).toString('base64'));
fs.rmSync(TMP, { force: true });
console.log('wrote', OUT);

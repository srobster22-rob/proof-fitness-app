/**
 * Dev-only: the database at the size the code has comments about.
 *
 * `goals.ts` records that 100 goals against 20,000 sets measured 48ms per
 * render, and `progress-model.ts` carries a bucketing rewrite because of it —
 * but nothing has ever put that database in front of the actual screens. A
 * number in a comment is not a test, and "48ms per render" says nothing about
 * whether the Goals screen is still legible with a hundred cards on it, whether
 * the cap is enforced where a user can see it, or whether anything below the
 * fold becomes unreachable.
 *
 * Same mechanism as `seed-web.ts`: build it through the app's own `Repo`, write
 * the raw SQLite bytes as base64, and let the browser drop it into
 * `localStorage['proof.db.v1']`.
 *
 *   node tools/stress-web.ts [sessions] [goals]
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import { BUILTIN } from '../src/domain/coldstart.ts';
import { MAX_GOALS } from '../src/domain/goals.ts';
import { devPort } from './dev-port.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'public', 'stress.b64');
const TMP = path.join(HERE, '..', 'public', '.stress.tmp.db');

const DAY = 86_400_000, MIN = 60_000;
const SESSIONS = Number(process.argv[2] ?? 700);
const GOALS = Number(process.argv[3] ?? MAX_GOALS);

function main(): void {
  fs.rmSync(TMP, { force: true });
  const now = Date.now();
  const db = new DatabaseSync(TMP);
  let clock = now;
  const repo = new Repo(db as never, () => clock);

  // Every built-in lift, so the picker, Progress and the goal list are all at
  // full width rather than exercising four movements very hard.
  const lifts = BUILTIN.map(l => l.id);
  let n = 0;

  for (let i = SESSIONS; i >= 1; i--) {
    const start = now - i * (DAY / 2);      // two a day, so 700 spans a year
    const sessionId = `st_${i}`;
    clock = start;
    repo.startSession(sessionId, 'lb');
    let at = start;
    // Four lifts a session, rotating, five sets each.
    for (let k = 0; k < 4; k++) {
      const exerciseId = lifts[(i * 4 + k) % lifts.length];
      const weight = 45 + ((i + k) % 40) * 5;
      for (let set = 0; set < 5; set++) {
        repo.logSet({ id: `st_${n++}`, sessionId, exerciseId, weight, reps: 5 + (set % 6), at });
        at += 2 * MIN;
      }
    }
    repo.endSession(sessionId, at);
    clock = now;
  }

  /*
   * Enough lifts to actually reach the cap.
   *
   * One goal per exercise is enforced, and the library holds 32 movements — so
   * a hundred goals is only reachable by inventing another sixty-eight, which
   * is exactly what MAX_GOALS' own comment says the real constraint is. Worth
   * knowing before testing the cap: without this the run tops out at 32 and
   * proves nothing about the number in the code.
   */
  const invented: string[] = [];
  for (let i = 0; lifts.length + invented.length < GOALS; i++) {
    const id = `custom_${i}`;
    repo.addExercise(id, `Cable Variation ${i + 1}`);
    invented.push(id);
  }

  // A goal per lift until either the library or the cap runs out. Deliberately
  // straddles achieved and unachieved so the filters have something to filter.
  let g = 0;
  for (const exerciseId of [...lifts, ...invented]) {
    if (g >= GOALS) break;
    repo.saveGoal({
      id: `stg_${g}`, exerciseId,
      targetWeight: g % 3 === 0 ? 50 : 500,   // a third already met, two thirds far off
      targetReps: 5, unit: 'lb',
      createdAt: now - (60 + g) * DAY,
      targetDate: now + (30 + g) * DAY
    });
    g++;
  }

  repo.saveMeasurement({ id: 'stw', kind: 'bodyweight', value: 185, unit: 'lb', at: now - 30 * DAY });

  db.close();
  const bytes = fs.readFileSync(TMP);
  fs.writeFileSync(OUT, bytes.toString('base64'));
  fs.rmSync(TMP, { force: true });

  console.log(`stress: ${n} sets, ${SESSIONS} sessions, ${g} goals`);
  console.log(`wrote ${OUT} (${Math.round(bytes.length / 1024)} KB raw)`);
  console.log(`
in the browser console at localhost:${devPort()}:

  fetch('/stress.b64').then(r => r.text())
    .then(t => { localStorage.setItem('proof.db.v1', t); location.reload(); })
`);
}

main();

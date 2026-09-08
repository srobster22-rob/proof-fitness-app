/**
 * Dev-only: build a believable training history and hand it to the web preview.
 *
 * Why this exists. Journeys F (Progress after several sessions) and H (200
 * sessions) cannot be walked at all without history spread over months, and the
 * app has no way to make any: every set logged through the UI happens *now*.
 * Every date-dependent surface in the product — the streak, the sparklines, the
 * §7 predictor's decay, "last time" — was therefore being judged on a single
 * day's data, which is the one shape a real user never has.
 *
 * How. `web-db.ts` keeps the browser database as base64 of a raw SQLite file
 * under `proof.db.v1`. `node:sqlite` writes exactly that format, so this builds
 * the history through the app's OWN `Repo` — same schema, same migrations, same
 * queries — and writes the encoded bytes to `public/`, where the dev server
 * already serves `sql-wasm.wasm` from. The browser then does:
 *
 *   fetch('/seed.b64').then(r => r.text())
 *     .then(t => { localStorage.setItem('proof.db.v1', t); location.reload(); })
 *
 * Nothing here is imported by the app. `public/seed.b64` is a dev artifact and
 * is gitignored; if it ever ships it is a 40KB file nothing reads.
 *
 *   node tools/seed-web.ts [weeks]
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import { assertSaneTimes } from './seed-sanity.ts';
import { devPort } from './dev-port.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'public', 'seed.b64');
const TMP = path.join(HERE, '..', 'public', '.seed.tmp.db');

const DAY = 86_400_000, MIN = 60_000;
const WEEKS = Number(process.argv[2] ?? 12);

/** A push/pull/legs week, in the order the days are actually trained. */
const SPLIT: Array<[string, Array<[string, number, number]>]> = [
  ['push', [['bench', 135, 5], ['ohp', 75, 8], ['triext', 35, 12]]],
  ['pull', [['deadlift', 185, 5], ['row', 95, 8], ['curl', 30, 10]]],
  ['legs', [['squat', 155, 5], ['legpress', 200, 10]]]
];

/**
 * Progressive overload with a plateau in the middle.
 *
 * A history that only ever goes up makes every screen look good and tests
 * nothing: the whole point of Progress is whether it reads honestly when the
 * numbers stall, so weeks 5-8 hold flat.
 */
function weightFor(base: number, week: number, step: number): number {
  const stalled = week >= 5 && week <= 8;
  const gained = stalled ? 4 : week <= 4 ? week : week - 4;
  return base + gained * step;
}

function main(): void {
  fs.rmSync(TMP, { force: true });
  const now = Date.now();
  const db = new DatabaseSync(TMP);
  /*
   * The clock is a variable, and that is the whole point.
   *
   * `Repo.startSession` stamps `started_at` from its own clock — correctly, for
   * an app that only ever starts a session in the present. A fixed clock here
   * therefore gave every one of these sessions a `started_at` of **now**, so a
   * workout from twelve weeks ago claimed to have started today. Two of the
   * recap's five tiles read straight off that row: the date label showed
   * today's date for every seeded session, and `durationMs` came out
   * `endedAt - startedAt`, which is negative and clamps to 0 — every seeded
   * workout was "1 MIN" no matter how long its sets were spread over.
   *
   * That is the same failure this seeder was built to end (R37): a
   * date-dependent surface being judged against data that only ever says
   * "today". It just moved from the sets to the sessions holding them.
   */
  let clock = now;
  const repo = new Repo(db as never, () => clock);

  let n = 0;
  for (let week = WEEKS; week >= 1; week--) {
    SPLIT.forEach(([day, lifts], i) => {
      // Monday / Wednesday / Friday, mid-evening.
      const start = now - week * 7 * DAY + i * 2 * DAY;
      const sessionId = `seed_w${week}_${day}`;
      clock = start;                       // so started_at is when it happened
      repo.startSession(sessionId, 'lb');

      let at = start;
      for (const [exerciseId, base, reps] of lifts) {
        const step = base >= 135 ? 5 : 2.5;
        const weight = weightFor(base, WEEKS - week + 1, step);
        for (let set = 0; set < 3; set++) {
          repo.logSet({
            id: `seed_${n++}`, sessionId, exerciseId, weight, reps, at
          });
          at += 3 * MIN;
        }
        at += 2 * MIN;
      }
      repo.endSession(sessionId, at);
      clock = now;                         // back to the present for anything after
    });
  }

  // One goal, deliberately not yet met, so the goal line has something honest
  // to say on both the Goals screen and the recap.
  repo.saveGoal({
    id: 'seed_goal', exerciseId: 'squat', targetWeight: 225, targetReps: 5,
    createdAt: now - 30 * DAY, targetDate: now + 60 * DAY, unit: 'lb'
  });

  // Prove the fixture before writing it (R559).
assertSaneTimes(repo);
db.close();
  const bytes = fs.readFileSync(TMP);
  fs.writeFileSync(OUT, bytes.toString('base64'));
  fs.rmSync(TMP, { force: true });

  console.log(`seeded ${WEEKS} weeks — ${n} sets, ${WEEKS * SPLIT.length} sessions`);
  console.log(`wrote ${OUT} (${Math.round(bytes.length / 1024)} KB raw)`);
  console.log(`\nin the browser console at localhost:${devPort()}:\n`);
  console.log(`  fetch('/seed.b64').then(r => r.text())`);
  console.log(`    .then(t => { localStorage.setItem('proof.db.v1', t); location.reload(); })`);
}

main();

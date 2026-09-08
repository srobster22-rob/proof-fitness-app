/*
 * Build a realistic training history and print it as the base64 SQLite blob the
 * web build keeps in localStorage under `proof.db.v1`.
 *
 * Exists because two of BUILD_LOOP's seven journeys — the returning user, and
 * Progress after several sessions — cannot be reached by walking the app from
 * empty. Everything the app shows about trends, streaks, "last time" and
 * prediction only appears once there are weeks of history behind it, and typing
 * that in through the UI is both slow and unrepresentative.
 *
 *   node --experimental-strip-types tools/seed-history.ts [weeks] > public/seed.b64
 *
 * `public/` is served by the dev server, so the page can fetch it same-origin:
 *
 *   fetch('/seed.b64').then(r => r.text())
 *     .then(b => { localStorage.setItem('proof.db.v1', b.trim()); location.reload(); })
 *
 * Delete the file afterwards — it is 100kB of fixture and `public/` ships in a
 * web export.
 *
 * Then in the browser: localStorage.setItem('proof.db.v1', <blob>); reload.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Repo } from '../src/data/repo.ts';
import { BUILTIN } from '../src/domain/coldstart.ts';

const DAY = 86_400_000, MIN = 60_000;
const WEEKS = Number(process.argv[2] ?? 5);
/**
 * How the weight moves week to week.
 *
 * `stall` exists because every fixture in this project progresses, and a
 * plateau is the most common state a real lifter is actually in — it is what
 * the trend line, the pace judgement and the "behind pace" copy have to be
 * honest about, and none of them had ever been seen against one.
 */
const MODE = (process.argv[3] ?? 'progress') as 'progress' | 'stall' | 'year-two' | 'many-goals';

/** A push/pull/legs week, in the order a real lifter trains it. */
const SPLIT: Array<[string, Array<[string, number, number]>]> = [
  ['push', [['bench', 135, 8], ['ohp', 65, 8], ['incline', 95, 8], ['triext', 25, 12]]],
  ['pull', [['row', 95, 8], ['pulldown', 80, 10], ['curl', 25, 10], ['facepull', 30, 12]]],
  ['legs', [['squat', 155, 5], ['rdl', 115, 8], ['legpress', 180, 10], ['calf', 90, 12]]]
];

const now = Date.now();
const file = path.join(os.tmpdir(), `proof-seed-${process.pid}.sqlite`);
fs.rmSync(file, { force: true });
const db = new DatabaseSync(file);
const repo = new Repo(db as any, () => now);

let n = 0;
/*
 * `year-two` abandons half the programme partway through, which is the state
 * §5 wrote the Progress cap for — "a wall of dead lifts is what year two looks
 * like otherwise" — and which nothing had ever actually produced. Accessories
 * get dropped after the first third; the compound lifts run the whole way.
 */
const COMPOUND = new Set(['bench', 'squat', 'row', 'ohp', 'rdl', 'pulldown']);
const abandonedAfter = Math.floor(WEEKS * 2 / 3);   // in weeks-ago terms

for (let w = WEEKS; w >= 1; w--) {
  SPLIT.forEach(([day, lifts], d) => {
    // Monday / Wednesday / Friday of that week, mid-evening.
    const at = now - (w * 7 - d * 2) * DAY + 6 * 3600_000;
    const sid = `s_${w}_${day}`;
    repo.startSession(sid, 'lb', undefined, at);
    lifts.forEach(([ex, base, reps], i) => {
      // In year-two mode the accessories stop once we are inside the recent
      // third of the history.
      if (MODE === 'year-two' && !COMPOUND.has(ex) && w < abandonedAfter) return;
      // Linear progress with a stall in the middle weeks, which is what real
      // training looks like and what the trend line has to survive.
      // Progress: +5 every second week. Stall: a gain for the first fortnight
      // and then nothing, which is what a plateau looks like from the inside —
      // it started as progress.
      const weeksIn = WEEKS - w;
      const gained = MODE === 'stall'
        ? Math.min(1, Math.floor(weeksIn / 2)) * 5
        : Math.floor(weeksIn / 2) * 5;
      for (let s = 0; s < 3; s++) {
        repo.logSet({
          id: `x${n++}`, sessionId: sid, exerciseId: ex,
          weight: base + gained, reps, at: at + (i * 3 + s) * 4 * MIN
        });
      }
    });
    repo.endSession(sid, at + 55 * MIN);
  });
}

/*
 * A goal set BEFORE the history, so the pace judgement has something to judge.
 *
 * `onPace` is the app's only judgemental copy and it stays null until the lift
 * has been trained since the goal was created — which means a goal made in the
 * browser can never show it, and it had never been seen. Planted 30 days back
 * with 60 to run, against whichever way this history moves: on a `progress`
 * seed it should read on pace, on a `stall` seed it should say behind.
 */
repo.saveGoal({
  id: 'g_bench', exerciseId: 'bench', targetWeight: 185, targetReps: 5,
  createdAt: now - 30 * DAY, targetDate: now + 60 * DAY, unit: 'lb'
});

// A goal whose date has passed — the "Past the date" branch, which no fixture
// and no walk had ever reached.
if (MODE === 'year-two') {
  repo.saveGoal({
    id: 'g_squat_old', exerciseId: 'squat', targetWeight: 405, targetReps: 5,
    createdAt: now - 300 * DAY, targetDate: now - 40 * DAY, unit: 'lb'
  });
}

/*
 * A goals list long enough to need the filter bar.
 *
 * The cap moved from three to a hundred, and the screen grew a filter row and
 * a sort to earn it — none of which can be judged against the two goals a walk
 * through the app produces. This plants one on every movement in the library
 * plus a handful of invented ones, spread across split days, deadlines and
 * progress so that every chip has something behind it and DONE is not empty.
 */
if (MODE === 'many-goals') {
  const lifts = [...BUILTIN.map(l => l.id), 'sled', 'farmer', 'sandbag', 'yoke'];
  lifts.forEach((ex, i) => {
    if (ex === 'bench') return;  // already has one, with pace behind it
    if (!BUILTIN.some(l => l.id === ex)) repo.addExercise(ex, ex[0].toUpperCase() + ex.slice(1));
    // Every fifth goal is already met, so DONE is a populated filter rather
    // than a chip that only ever reads zero.
    const met = i % 5 === 0;
    repo.saveGoal({
      id: `g_many_${ex}`, exerciseId: ex,
      targetWeight: met ? 5 : 40 + (i * 17) % 260,
      targetReps: [1, 3, 5, 8, 10][i % 5],
      // Deadlines fanned from a fortnight to two years, so SOONEST orders
      // something real, and creation dates staggered so NEWEST does too.
      createdAt: now - ((i * 11) % 200) * DAY,
      targetDate: now + (14 + (i * 29) % 700) * DAY,
      unit: 'lb'
    });
  });
}

// Close before reading: Windows refuses to remove a file SQLite still has open,
// and an unclosed handle can also leave the last pages unflushed.
db.close();
const bytes = fs.readFileSync(file);
fs.rmSync(file, { force: true });
process.stderr.write(`${WEEKS} weeks, ${n} sets, ${bytes.length} bytes\n`);
process.stdout.write(bytes.toString('base64'));

/*
 * Dev-only: ask the predictor what it would suggest, and why, against a real
 * database.
 *
 * Written during a claims audit that started from a screen reading "NEXT ON
 * PUSH DAY — Tricep Extension" after three sets of bench, which looks wrong:
 * every seeded push day runs bench -> ohp -> triext, so habit says Overhead
 * Press. It is in fact correct and deliberate (`now-model.ts` blends the
 * predictor's habit ordering with `recommendNext`'s muscle advice, precisely so
 * a second heavy press does not follow the first) — but there was no way to see
 * that without reading four files, because the screen shows a name and the
 * reasoning is spread across `predict.ts`, `muscles.ts` and the Now model.
 *
 * This prints the intermediate values the screen hides: the score and typical
 * position behind every ranking, the raw predicted session, and what
 * `suggestNext` returns for a given set of finished lifts. Enough to tell a
 * real defect from a documented decision without re-deriving it each time.
 *
 *   node tools/predict-probe.ts <path-to.db> [doneExerciseId,...]
 *
 * A database comes from `npm run seed` (decode public/seed.b64 from base64) or
 * from a device export.
 */
import { DatabaseSync } from 'node:sqlite';
import { rankExercises, predictSession, suggestNext } from '../src/domain/predict.ts';
import { dayOf } from '../src/domain/split.ts';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/predict-probe.ts <path-to.db> [done,ids]');
  process.exit(1);
}
const done = (process.argv[3] ?? '').split(',').filter(Boolean);

const db = new DatabaseSync(file);
const history = (db.prepare(
  'SELECT id,session_id,exercise_id,weight,reps,at FROM sets WHERE deleted=0 ORDER BY at'
).all() as Array<Record<string, unknown>>).map(r => ({
  id: r.id, sessionId: r.session_id, exerciseId: r.exercise_id,
  weight: r.weight, reps: r.reps, at: r.at
})) as never[];

// The predictor is weekday-aware, so "now" is part of the question being asked.
const now = Date.now();
const weekday = new Date(now).getDay();
console.log(`history: ${history.length} sets   weekday: ${weekday}   done: [${done.join(', ')}]\n`);

console.log('ranked — score is recency-decayed frequency, position is where it lands in a session:');
for (const r of rankExercises(history, now, weekday)) {
  console.log(
    `  ${r.exerciseId.padEnd(12)} score ${r.score.toFixed(3).padStart(8)}` +
    `   pos ${r.typicalPosition.toFixed(2)}   day ${dayOf(r.exerciseId) ?? '—'}`
  );
}

// Ordered by typical position, NOT by score — which is why a push day can list
// squat second: every day's opener sits at position 0. The Now screen filters
// that back down to the day being trained; this shows the unfiltered truth.
console.log(`\npredictSession(12) = ${predictSession(history, now, weekday, 12).join(' -> ')}`);
console.log(`suggestNext        = ${suggestNext(history, done, now, weekday) ?? '(none)'}`);
console.log('\nnote: the Now screen blends this with recommendNext() muscle advice,');
console.log('so what it displays can legitimately differ from suggestNext above.');

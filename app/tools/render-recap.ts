/*
 * End-to-end proof: simulated training -> domain logic -> recap payload ->
 * spike/recap.js -> a real PNG.
 *
 * The unit tests assert the payload SHAPE. This asserts the renderer actually
 * accepts it, which is a different claim and the one that matters: if these
 * drift, the video a user sends stops matching the workout they did.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import { findPRs } from '../src/domain/pr.ts';
import { buildRecap, autoEnd } from '../src/domain/session.ts';
import { predictSession } from '../src/domain/predict.ts';
import type { LoggedSet, Session, Exercise } from '../src/domain/types.ts';

const require = createRequire(import.meta.url);
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const Recap = require(path.join(HERE, '..', '..', 'spike', 'recap.js'));

GlobalFonts.loadSystemFonts();

const DAY = 86_400_000, MIN = 60_000;
const NOW = Date.UTC(2026, 6, 28, 19, 30, 0);

const NAMES: Record<string, string> = {
  bench: 'Bench Press', incline: 'Incline DB Press',
  fly: 'Cable Fly', ohp: 'OHP', lateral: 'Lateral Raise'
};
const exercises = new Map<string, Exercise>(
  Object.entries(NAMES).map(([id, name]) => [id, { id, name }])
);

let uid = 0;
const mk = (sessionId: string, exerciseId: string, weight: number, reps: number, at: number): LoggedSet =>
  ({ id: `x${uid++}`, sessionId, exerciseId, weight, reps, at });

// --- twelve weeks of history, bench creeping up ----------------------------
const history: LoggedSet[] = [];
for (let w = 12; w >= 1; w--) {
  const at = NOW - w * 7 * DAY;
  const bench = 200 + Math.floor((12 - w) / 3) * 5;   // 200 -> 215
  history.push(
    mk(`h${w}`, 'bench', bench, 5, at),
    mk(`h${w}`, 'incline', 75, 10, at + 10 * MIN),
    mk(`h${w}`, 'fly', 40, 12, at + 20 * MIN),
    mk(`h${w}`, 'ohp', 130, 6, at + 30 * MIN),
    mk(`h${w}`, 'lateral', 20, 15, at + 40 * MIN)
  );
}

// --- today ------------------------------------------------------------------
const startedAt = NOW - 52 * MIN;
const today: LoggedSet[] = [
  mk('today', 'bench', 135, 8, startedAt + 4 * MIN),      // warm-up
  mk('today', 'bench', 185, 5, startedAt + 9 * MIN),      // warm-up
  mk('today', 'bench', 225, 5, startedAt + 15 * MIN),     // the PR
  mk('today', 'bench', 225, 5, startedAt + 20 * MIN),
  mk('today', 'incline', 80, 10, startedAt + 28 * MIN),
  mk('today', 'fly', 45, 12, startedAt + 35 * MIN),
  mk('today', 'ohp', 135, 6, startedAt + 43 * MIN),
  mk('today', 'lateral', 25, 15, startedAt + 50 * MIN)
];

let session: Session = { id: 'today', startedAt, endedAt: null, unit: 'lb', updatedAt: startedAt };
session = autoEnd(session, today, NOW);

const prs = findPRs(today, history, exercises);
/*
 * A goal line as well as a PR. The e2e never passed one, so the renderer's
 * goal branch had never been rendered by this proof at all — and it turned out
 * the renderer only drew it when there was NO PR, which is exactly the case a
 * progressing lifter never hits.
 */
const payload = buildRecap({
  session, sets: today, exercises, prs,
  allSets: [...history, ...today], now: NOW, title: 'PUSH DAY',
  goalLine: '10 lb from a 235 bench press'
});

console.log('predicted next session :', predictSession(history, NOW, new Date(NOW).getDay())
  .map(id => NAMES[id]).join(' -> '));
console.log('session auto-ended     :', session.endedAt !== null);
console.log('PRs found              :', prs.map(p => p.claim).join('; ') || 'none');
console.log('\npayload:');
console.log(JSON.stringify(payload, null, 2));

// --- render it --------------------------------------------------------------
const canvas = createCanvas(Recap.W, Recap.H);
const ctx = canvas.getContext('2d');
Recap.render(ctx, Recap.DURATION, { data: payload });

const out = path.join(HERE, '..', 'out');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'e2e-recap.png'), canvas.encodeSync('png'));
console.log('\nwrote app/out/e2e-recap.png');

// Guard: a blank render would still "pass" a shape assertion, so check pixels.
const hero = ctx.getImageData(150, 560, 1, 1).data;
const slab = ctx.getImageData(300, 900, 1, 1).data;
const heroWhite = hero[0] > 240 && hero[1] > 240 && hero[2] > 240;
const slabVolt = slab[0] > 190 && slab[1] > 240 && slab[2] < 60;
console.log(`hero number drawn: ${heroWhite}   PR slab drawn: ${slabVolt}`);
if (!heroWhite || !slabVolt) { console.error('RENDER CHECK FAILED'); process.exit(1); }

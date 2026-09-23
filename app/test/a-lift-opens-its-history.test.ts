import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import { liftHistory, HISTORY_SESSIONS } from '../src/ui/lift-history.ts';
import { recapFor } from '../src/ui/recap-model.ts';
import { convertWeight } from '../src/domain/types.ts';
import { PREF_UNIT } from '../src/ui/display-unit.ts';
import { recordMeasurement } from '../src/ui/measure-model.ts';
import { shortDate } from '../src/ui/dates.ts';
import type { Unit } from '../src/domain/types.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 22, 18);

/*
 * R680. A Progress row showed a sparkline and one best set, and nothing on it
 * could be tapped: "what did I bench last week", "what is my best triple" and
 * "when did I last set a record" had no answer anywhere, although every number
 * was stored. Every comparable answers them on the exercise's own page
 * (MARKET.md row 4, gap value 9).
 */

type Session = { reps: number[]; weight: number | number[]; unit?: Unit; lift?: string };

/** One workout per entry, a day apart, oldest first. */
function trained(sessions: Session[], at = T0 - sessions.length * DAY) {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  sessions.forEach((w, i) => {
    const id = `w${i + 1}`;
    const start = at + i * DAY;
    repo.startSession(id, w.unit ?? 'lb', undefined, start);
    w.reps.forEach((reps, k) => {
      const weight = Array.isArray(w.weight) ? w.weight[k] : w.weight;
      repo.logSet({ id: `${id}s${k}`, sessionId: id, exerciseId: w.lift ?? 'bench', weight, reps, at: start + k * 120_000 });
    });
    repo.endSession(id, start + 3_600_000);
  });
  return repo;
}

describe('a lift opens its own history (R680)', () => {
  test('every workout it was trained in, newest first, by the set the recap named', () => {
    const repo = trained([
      { reps: [5, 5, 5], weight: 135 },
      { reps: [5, 5], weight: 140 },
      // 200 x 5 then 185 x 10: the recap names 185 x 10, the better set by estimated max.
      { reps: [5, 10], weight: [200, 185] }
    ]);
    const h = liftHistory(repo, 'bench')!;
    assert.deepEqual(h.sessions.map(x => `${x.weight}x${x.reps} (${x.sets})`), ['185x10 (2)', '140x5 (2)', '135x5 (3)']);
  });

  test('each rep count shows a real set, and only when nothing heavier was done for more reps', () => {
    const repo = trained([
      { reps: [5, 3, 8, 5, 4], weight: [225, 235, 205, 215, 230] }
    ]);
    const h = liftHistory(repo, 'bench')!;
    // 215 x 5 is beaten by 225 x 5; every row that remains is a set that was logged.
    assert.deepEqual(h.repBests.map(b => `${b.reps}:${b.weight}`), ['3:235', '4:230', '5:225', '8:205']);
  });

  test('a record is marked on the workout whose recap awarded it, and only there', () => {
    // A heavier workout later must not take the mark off an earlier one: each is
    // judged on what came before it, as its recap was.
    const repo = trained([
      { reps: [5], weight: 135 }, { reps: [5], weight: 135 }, { reps: [5], weight: 135 },
      { reps: [5], weight: 140 }, { reps: [5], weight: 145 }
    ]);
    const h = liftHistory(repo, 'bench')!;
    const marked = h.sessions.filter(x => x.record).map(x => x.sessionId);
    assert.deepEqual(marked, ['w5', 'w4']);
    for (const x of h.sessions) {
      const recap = recapFor(repo, x.sessionId, T0)!;
      assert.equal(x.record, recap.prs.some(p => p.exerciseId === 'bench'),
        `${x.sessionId}: the sheet and its recap disagree about a record`);
    }
  });

  test('a workout logged in kilograms reads in the lifter\'s own unit', () => {
    const repo = trained([{ reps: [5], weight: 100, unit: 'kg' }, { reps: [5], weight: 225 }]);
    const h = liftHistory(repo, 'bench')!;
    assert.equal(h.unit, 'lb');
    assert.equal(h.sessions[1].weight, convertWeight(100, 'kg', 'lb'));
  });

  test(`the last ${HISTORY_SESSIONS} workouts, and a count of the rest`, () => {
    const repo = trained(Array.from({ length: HISTORY_SESSIONS + 3 }, (_, i) => ({ reps: [5], weight: 100 + i * 5 })));
    const h = liftHistory(repo, 'bench')!;
    assert.equal(h.sessions.length, HISTORY_SESSIONS);
    assert.equal(h.olderSessions, 3);
    assert.equal(h.sessions[0].weight, 100 + (HISTORY_SESSIONS + 2) * 5, 'the newest workout leads');
  });

  test('high-rep work shows its best set too', () => {
    const repo = trained([{ reps: [20, 18], weight: 0, lift: 'pushup' }]);
    const h = liftHistory(repo, 'pushup')!;
    assert.equal(h.sessions.length, 1);
    assert.deepEqual(h.repBests.map(b => `${b.reps}:${b.weight}`), ['20:0']);
  });

  test('a heavier set for more reps beats a ten, the way it does for records', () => {
    // pr.ts: after 300 x 15, a 280 x 10 is no record, so it is not "the best for ten".
    const h = liftHistory(trained([{ reps: [15], weight: 300 }, { reps: [10], weight: 280 }]), 'bench')!;
    assert.deepEqual(h.repBests.map(b => `${b.reps}:${b.weight}`), ['15:300']);
  });

  test('a rep best is dated by the set that made it, in the lifter\'s unit', () => {
    const repo = trained([{ reps: [5, 3], weight: [225, 235] }]);
    repo.setPref(PREF_UNIT, 'kg');
    const h = liftHistory(repo, 'bench')!;
    const set = repo.allSets().find(s => s.reps === 3)!;
    assert.equal(h.repBests[0].at, set.at);
    assert.equal(h.repBests[0].weight, convertWeight(235, 'lb', 'kg'), 'a pound set was shown as kilograms');
  });

  test('a record on a bodyweight lift is judged by what the lifter moved', () => {
    // Three sessions of pull-ups with 10 added at 180 lb, then 12.5 added at 170:
    // more on the belt, less moved. The recap awards nothing, so neither does the sheet.
    const repo = trained([
      { reps: [5], weight: 10, lift: 'pullup' }, { reps: [5], weight: 10, lift: 'pullup' },
      { reps: [5], weight: 10, lift: 'pullup' }, { reps: [5], weight: 12.5, lift: 'pullup' }
    ]);
    recordMeasurement(repo, 'bodyweight', '180', 'lb', T0 - 10 * DAY, '');
    recordMeasurement(repo, 'bodyweight', '170', 'lb', T0 - 1.5 * DAY, '');
    const h = liftHistory(repo, 'pullup')!;
    assert.deepEqual(h.sessions.filter(x => x.record).map(x => x.sessionId), []);
    for (const x of h.sessions) {
      assert.equal(x.record, recapFor(repo, x.sessionId, T0)!.prs.some(p => p.exerciseId === 'pullup'), x.sessionId);
    }
  });

  test('a workout that runs past midnight is dated by its start, as RECENT WORKOUTS dates it', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
    const start = new Date(2026, 8, 20, 23, 40).getTime();
    repo.startSession('late', 'lb', undefined, start);
    repo.logSet({ id: 's1', sessionId: 'late', exerciseId: 'bench', weight: 135, reps: 5, at: start + 30 * 60_000 });
    repo.endSession('late', start + 60 * 60_000);
    const h = liftHistory(repo, 'bench')!;
    assert.equal(h.sessions[0].startedAt, start);
    assert.equal(shortDate(h.sessions[0].startedAt, 'en'), shortDate(start, 'en'), 'the sheet moved the workout to the next day');
    assert.notEqual(shortDate(h.sessions[0].startedAt, 'en'), shortDate(start + 30 * 60_000, 'en'), 'the test no longer crosses midnight');
  });

  test('a lift never trained has no history', () => {
    assert.equal(liftHistory(trained([{ reps: [5], weight: 135 }]), 'squat'), null);
  });
});

/*
 * The screen half. The model above cannot see whether a row opens the sheet or
 * the sheet draws a star, and nothing renders React Native here, so these read
 * the source the way day-chooser.test.ts does.
 */
describe('the screens are wired to it', () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const progress = readFileSync(path.join(HERE, '..', 'app', 'progress.tsx'), 'utf8');
  const sheet = readFileSync(path.join(HERE, '..', 'src', 'ui', 'LiftSheet.tsx'), 'utf8');

  test('a Progress row opens the sheet, and says so', () => {
    assert.match(progress, /onOpen=\{\(\) => setOpenLift\(row\.exerciseId\)\}/, 'a row no longer opens its lift');
    assert.match(progress, /<Pressable accessibilityRole="button" onPress=\{onOpen\}/, 'the row is not a button');
    assert.match(progress, /\{openLift && <LiftSheet exerciseId=\{openLift\}/, 'the sheet is never mounted');
    assert.match(progress, /T\('openLiftHistoryA11y'\)/, 'the row does not say what the tap does');
    // One label for the whole row, so it must carry the goal the row shows.
    assert.match(progress, /accessibilityLabel=\{\[lastTrainedA11y\(row, lang\), bestSetA11y\(row, lang\), trendA11y\(row, lang\),\s*row\.goal \? goalTag\(row\.goal, lang\) : null,/,
      'the row\'s label dropped the last trained day, best set, trend or goal');
  });

  test('the sheet draws every section the registry names, and the record star', () => {
    assert.match(sheet, /LIFT_INSIGHTS\.map\(/, 'the sheet stopped drawing from LIFT_INSIGHTS');
    assert.match(sheet, /x\.record && <Text style=\{s\.star\}> ★<\/Text>/, 'a record workout lost its star');
  });

  test('each line reads as one sentence, and bodyweight takes no unit', () => {
    assert.equal((sheet.match(/style=\{s\.line\} accessible\b/g) ?? []).length, 2,
      'a rep-best or workout line is read as three loose words');
    assert.match(sheet, /const weightOf = \(w: number\) => \(w === 0 \? loadLabel\(0\) : `\$\{loadLabel\(w\)\} \$\{h\.unit\}`\)/,
      'a bodyweight set reads "BW lb"');
    assert.equal((sheet.match(/weight: weightOf\(/g) ?? []).length, 2, 'a spoken weight skips weightOf');
  });
});

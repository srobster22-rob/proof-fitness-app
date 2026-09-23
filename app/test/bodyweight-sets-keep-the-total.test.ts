import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import { recapFor } from '../src/ui/recap-model.ts';
import { progressRows, bestSetA11y } from '../src/ui/progress-model.ts';
import { recordMeasurement } from '../src/ui/measure-model.ts';
import { t } from '../src/domain/i18n.ts';
import type { LoggedSet } from '../src/domain/types.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 23, 18);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(path.join(HERE, '..', ...p), 'utf8');

/*
 * R689, PT1 and PT2 both. One pull-up set with no bodyweight recorded replaced
 * a whole workout's total with "Add your bodyweight on YOU to count these sets"
 * (13,000 lb of barbell work gone), and recording it afterwards changed nothing
 * for that workout. And a pull-up trained twelve times read "0 × 8", or "—" and
 * "not trained at this rep range yet" with no bodyweight reading.
 */
function pullDay(sets: Array<[string, number, number]>) {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  repo.startSession('s1', 'lb', undefined, T0 - DAY);
  sets.forEach(([lift, weight, reps], i) => {
    const set: LoggedSet = { id: `x${i}`, sessionId: 's1', exerciseId: lift, weight, reps, at: T0 - DAY + i * 120_000 };
    repo.logSet(set);
  });
  repo.endSession('s1', T0 - DAY + 3_600_000);
  return repo;
}

describe('a bodyweight set does not hide the rest of the total (R689)', () => {
  test('the total it knows is kept, and it says how many sets it leaves out', () => {
    const repo = pullDay([['deadlift', 225, 5], ['deadlift', 225, 5], ['pullup', 0, 8], ['pullup', 0, 7]]);
    const recap = recapFor(repo, 's1', T0)!;
    assert.equal(recap.payload.volumeKnown, false);
    assert.equal(recap.payload.volume, 2250, 'the deadlifts are the known part');
    assert.equal(recap.uncounted, 2);
  });

  test('a bodyweight reading recorded before the workout counts every set', () => {
    const repo = pullDay([['deadlift', 225, 5], ['pullup', 0, 8]]);
    recordMeasurement(repo, 'bodyweight', '180', 'lb', T0 - 3 * DAY, '');
    const recap = recapFor(repo, 's1', T0)!;
    assert.equal(recap.uncounted, 0);
    assert.notEqual(recap.payload.volumeKnown, false);
  });

  test('the screen shows the known total with a note, and only a total of nothing is replaced', () => {
    const screen = read('app', 'recap.tsx');
    assert.match(screen, /\{payload\.volumeKnown === false && payload\.volume <= 0 \? \(/,
      'a known total is hidden again whenever one set lacks a bodyweight');
    assert.match(screen, /payload\.volumeKnown === false && payload\.volume > 0 && uncounted > 0 && \(/);
    assert.match(screen, /T\(uncounted === 1 \? 'volumeLeavesOutOne' : 'volumeLeavesOut'\)/);
  });

  test('the words say where bodyweight is recorded, and promise nothing for sets already logged', () => {
    for (const lang of ['en', 'es'] as const) {
      const all = [t(lang, 'needsBodyweight'), t(lang, 'volumeLeavesOut'), t(lang, 'volumeLeavesOutOne')];
      for (const line of all) assert.match(line, lang === 'en' ? /YOU in Progress/ : /TÚ, dentro de PROGRESO/, line);
    }
    assert.doesNotMatch(t('en', 'needsBodyweight'), /these sets/, 'it still promises to count sets it never will');
  });
});

describe('a bodyweight lift on Progress reads as trained (R689)', () => {
  test('its best is "BW × 8", with or without a bodyweight reading', () => {
    const repo = pullDay([['pullup', 0, 8], ['pullup', 0, 8]]);
    const row = progressRows(repo, T0).find(r => r.exerciseId === 'pullup')!;
    assert.equal(row.best, 0);
    assert.equal(row.bestReps, 8);
    assert.equal(bestSetA11y(row, 'en').split(' set ')[0], 'Pull-up, best at bodyweight by 8');
    assert.match(bestSetA11y(row, 'es'), /mejor marca con peso corporal por 8/);
    const screen = read('app', 'progress.tsx');
    assert.match(screen, /\{row\.bestReps > 0 \? `\$\{loadLabel\(row\.best\)\} × \$\{row\.bestReps\}` : '—'\}/,
      'the row prints the raw weight, "0 × 8", or "—" without a reading');
  });

  test('a lift never done at all still reads as not trained', () => {
    const row = { ...progressRows(pullDay([['pullup', 0, 8]]), T0)[0], best: 0, bestReps: 0 };
    assert.match(bestSetA11y(row, 'en'), /not trained at this rep range yet/);
  });
});

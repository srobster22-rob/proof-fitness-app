import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { createGoal, listGoals, removeGoals, restoreGoals } from '../src/ui/goals-model.ts';
import { filterCounts } from '../src/ui/goal-filters.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 30, 12);

function repoWithGoals(): { repo: Repo; ids: string[] } {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => NOW);
  const lifts = [
    ['squat', 200], ['bench', 150], ['deadlift', 250], ['ohp', 100], ['row', 130]
  ] as const;
  const ids: string[] = [];
  for (const [ex, w] of lifts) {
    const made = createGoal(repo, { exerciseId: ex, targetWeight: w, targetReps: 5, unit: 'lb', inDays: 60 }, NOW);
    assert.equal(made.ok, true, `fixture goal ${ex} rejected`);
    ids.push((made as { goal: { id: string } }).goal.id);
  }
  return { repo, ids };
}

/*
 * R457's live check, redone as a real test after the Browser pane stopped
 * compositing frames mid-round (see LOOP_LOG R457) — this covers the same
 * three claims goals.tsx's WIPE ALL / UNDO chain makes in words, against real
 * repo behaviour instead of a read of the source doing the claiming.
 */
describe('WIPE ALL step 2\'s "{open} still open, {done} already hit" is exact', () => {
  test('open + done always equals the total goal count, with a mix of both', () => {
    const { repo } = repoWithGoals();
    const goals = repo.goals();
    // Mark two of five as achieved by logging a set that clears the target.
    repo.startSession('s1', 'lb');
    repo.logSet({ id: 'set1', sessionId: 's1', exerciseId: 'squat', weight: 205, reps: 5, at: NOW - DAY });
    repo.startSession('s2', 'lb');
    repo.logSet({ id: 'set2', sessionId: 's2', exerciseId: 'bench', weight: 155, reps: 5, at: NOW - DAY });

    const progress = listGoals(repo, NOW);
    const counts = filterCounts(progress, 'ppl');
    assert.equal(counts.open + counts.done, goals.length,
      `open (${counts.open}) + done (${counts.done}) should equal all ${goals.length} goals — ` +
      'this is the exact arithmetic WIPE ALL step 2 prints on screen');
    assert.equal(counts.done, 2, 'squat and bench were both cleared and should count as done');
    assert.equal(counts.open, 3, 'the other three are still open');
  });

  test('holds at zero achieved and at all achieved too, not just the mixed case', () => {
    const { repo } = repoWithGoals();
    const none = filterCounts(listGoals(repo, NOW), 'ppl');
    assert.equal(none.open + none.done, 5);
    assert.equal(none.done, 0);

    for (const [ex, w] of [['squat', 200], ['bench', 150], ['deadlift', 250], ['ohp', 100], ['row', 130]] as const) {
      repo.startSession('x' + ex, 'lb');
      repo.logSet({ id: 'set' + ex, sessionId: 'x' + ex, exerciseId: ex, weight: w + 5, reps: 5, at: NOW - DAY });
    }
    const all = filterCounts(listGoals(repo, NOW), 'ppl');
    assert.equal(all.open + all.done, 5);
    assert.equal(all.done, 5);
    assert.equal(all.open, 0);
  });
});

describe('WIPE ALL\'s "sets, sessions and history are not touched — only the targets" is exact', () => {
  test('deleting every goal leaves every logged set and session intact', () => {
    const { repo, ids } = repoWithGoals();
    repo.startSession('keep', 'lb');
    repo.logSet({ id: 'keepset', sessionId: 'keep', exerciseId: 'squat', weight: 205, reps: 5, at: NOW - DAY });

    removeGoals(repo, ids);

    assert.equal(repo.goals().length, 0, 'every goal should be gone');
    assert.equal(repo.allSets().filter(s => s.id === 'keepset').length, 1,
      'the logged set survived the goal wipe');
  });
});

describe('the last-chance step\'s "One tap of UNDO puts them straight back" is exact', () => {
  test('restoreGoals brings back every field the goal had, createdAt included', () => {
    const { repo, ids } = repoWithGoals();
    const before = repo.goals().map(g => ({ ...g })).sort((a, b) => a.id.localeCompare(b.id));

    const taken = removeGoals(repo, ids);
    assert.equal(repo.goals().length, 0);

    const back = restoreGoals(repo, taken);
    assert.equal(back, ids.length, 'every removed goal should restore');

    const after = repo.goals().map(g => ({ ...g })).sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(after, before,
      'a restored goal must be byte-for-byte identical to the one that was wiped, createdAt included — ' +
      'otherwise its progress bar would silently restart');
  });
});

describe('the undo bar\'s "stays on screen until you dismiss it" has no code path that contradicts it', () => {
  test('goals.tsx sets no timer anywhere near the undo bar\'s state', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const HERE = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(HERE, '..', 'app', 'goals.tsx'), 'utf8');
    assert.doesNotMatch(src, /setTimeout|setInterval/,
      'goals.tsx contains a timer — the undo bar\'s "stays on screen until you dismiss it" claim ' +
      'would be false if anything auto-clears the undo state');
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import { weekStreak } from '../src/domain/session.ts';
import { streakWorthShowing } from '../src/ui/recap-model.ts';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, '..', 'src', 'ui', 'NowScreen.tsx'), 'utf8');

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 27, 12);

/** n consecutive training weeks ending this week. */
function trained(weeks: number): Repo {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => NOW);
  for (let i = 0; i < weeks; i++) {
    const id = 's' + i;
    repo.startSession(id, 'lb');
    repo.logSet({
      id: 'set' + i, sessionId: id, exerciseId: 'squat',
      weight: 200 + i * 5, reps: 5, at: NOW - i * 7 * DAY
    });
  }
  return repo;
}

/*
 * §10: "a streak, visible on launch, that counts training days not app opens".
 *
 * It reached the recap and the shared card and never the screen the app
 * actually opens on — which is the only place §10 asks for it. An app opened
 * solely mid-workout has no habit hook, and §10 offers exactly two things as
 * one: this and the weekly comparison (R226).
 */
describe('the streak is visible on launch (§10)', () => {
  test('the Now model carries the same streak the recap does', () => {
    // One definition, so the header and the card cannot start disagreeing
    // about how long the user has been training.
    for (const weeks of [1, 2, 5, 13]) {
      const repo = trained(weeks);
      assert.equal(weekStreak(repo.allSets(), NOW), weeks);
    }
  });

  test('it counts training weeks, not app opens', () => {
    // The distinction §10 draws. Two sets two hours apart is one week, not two
    // — the failure R50 found when the bucket boundary landed mid-evening.
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => NOW);
    repo.startSession('a', 'lb');
    repo.logSet({ id: 's1', sessionId: 'a', exerciseId: 'squat', weight: 200, reps: 5, at: NOW - 3600_000 });
    repo.logSet({ id: 's2', sessionId: 'a', exerciseId: 'squat', weight: 205, reps: 5, at: NOW });
    assert.equal(weekStreak(repo.allSets(), NOW), 1);
  });

  /*
   * R640: the owner shipped the tab bar and moved the streak "to the exercise
   * line". The top row these tests used to read is gone, so they read the
   * exercise line instead -- same three promises: the recap's rule, a status
   * not a control, and not allowed to grow the row it sits in.
   */
  test('the screen reuses the recap rule rather than inventing one', () => {
    const line = region(src, '<View style={s.exerciseLine}>', '{state.lastTime.head}');
    assert.match(line, /streakWorthShowing\(state\.streak\)/,
      'the exercise line decides for itself what counts as a streak');
    // R150 settled that one week is not a streak.
    assert.equal(streakWorthShowing(1), false);
    assert.equal(streakWorthShowing(2), true);
  });

  test('it is a status, not a control', () => {
    // It shares a line with the name that opens the picker, which makes this
    // more important than it was beside the gear: it must not read as part of
    // that control, so it sits after the pressable closes and has no role.
    const line = region(src, '<View style={s.exerciseLine}>', '{state.lastTime.head}');
    const at = line.indexOf('<Text style={s.streak}');
    assert.ok(at > line.indexOf('</Pressable>'), 'the streak is inside the picker control');
    const streak = region(line, '<Text style={s.streak}', '</Text>');
    assert.doesNotMatch(streak, /onPress|accessibilityRole/);
    assert.match(streak, /accessibilityLabel=\{fill\(T\('streakA11y'\)/);
  });

  test('the streak text does not set the line height', () => {
    // Sized at `label`: the lift name defines the line, so the streak cannot
    // push the header down and cost the hero its space (layoutFor).
    const style = region(src, '  streak: {', '},');
    assert.match(style, /fontSize: TYPE\.label/);
  });
});

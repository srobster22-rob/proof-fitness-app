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

  test('the screen reuses the recap rule rather than inventing one', () => {
    const bar = region(src, '<View style={s.topRight}>', '</View>');
    assert.match(bar, /streakWorthShowing\(state\.streak\)/,
      'the header decides for itself what counts as a streak');
    // R150 settled that one week is not a streak; the header must not
    // resurrect the question by using a different threshold.
    assert.equal(streakWorthShowing(1), false);
    assert.equal(streakWorthShowing(2), true);
  });

  test('it is a status, not a control', () => {
    /*
     * A number that looks tappable and is not is its own bug. The two words
     * beside it and the gear are all destinations; this is the only thing in
     * that row that goes nowhere, so it carries no role and no onPress.
     */
    const bar = region(src, '<View style={s.topRight}>', '</View>');
    const streak = region(bar, '<Text style={s.topStreak}', '</Text>');
    assert.doesNotMatch(streak, /onPress|accessibilityRole/);
    // It still has to be announced, since the digits alone say nothing.
    assert.match(streak, /accessibilityLabel=\{fill\(T\('streakA11y'\)/);
  });

  test('it rides with the gear so the row keeps its three even gaps', () => {
    /*
     * `topBar` is spaced on the reasoning that the eye reads the GAPS, and
     * three of them measured even is why it looks right. A fourth sibling
     * would redistribute that — so the streak is grouped with the gear and the
     * row still has three children.
     */
    const bar = region(src, '<View style={s.topBar}>', 'A fixed column on a phone');
    const pressables = bar.match(/<Pressable/g) ?? [];
    assert.equal(pressables.length, 3, 'the top bar gained or lost a destination');
    assert.match(bar, /<View style=\{s\.topRight\}>/);
  });

  test('the streak text does not set the row height', () => {
    // Sized at `label` deliberately: the gear defines the row, so adding this
    // cannot push the header down and cost the hero its space (§15/layoutFor).
    const style = region(src, '  topStreak: {', '},');
    assert.match(style, /fontSize: TYPE\.label/);
  });
});

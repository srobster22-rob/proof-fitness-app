import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import { recapFor, shareText } from '../src/ui/recap-model.ts';
import { shareUrl, pack } from '../src/domain/share-url.ts';
import { createGoal } from '../src/ui/goals-model.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const ShareURL = createRequire(import.meta.url)(path.join(ROOT, 'link', 'share-url.js'));

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 27, 12);

/**
 * Twelve weeks of progress on one lift, then today's session.
 *
 * `withGoal` sets the target BEFORE today's set rather than after, because a
 * goal that has had nothing trained since it was created has no honest pace to
 * report and `narrativeLine` correctly declines to speak — R35 settled that.
 * Written the other way round first, and the code was right to refuse it.
 */
function mature(withGoal = false): Repo {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => NOW);
  for (let i = 0; i < 12; i++) {
    const id = 'w' + i;
    repo.startSession(id, 'lb');
    repo.logSet({ id: 's' + i, sessionId: id, exerciseId: 'squat',
      weight: 200 + i * 5, reps: 5, at: NOW - (11 - i) * 7 * DAY });
  }
  if (withGoal) {
    const made = createGoal(repo, { exerciseId: 'squat', targetWeight: 315, targetReps: 5,
      unit: 'lb', inDays: 60 }, NOW - 3 * DAY);
    assert.equal(made.ok, true, `fixture goal rejected: ${(made as { error?: string }).error}`);
  }
  repo.startSession('now', 'lb');
  repo.logSet({ id: 'today', sessionId: 'now', exerciseId: 'squat', weight: 255, reps: 5, at: NOW - 600_000 });
  repo.endSession('now', NOW - 300_000);
  return repo;
}

/*
 * §8's mature clause, and the half of it that was never built.
 *
 * "PRs get rarer by design — that is what makes them real. A recap that leads
 * with 'no PR today' every session for a year is a failure of framing, not of
 * the lifter. Mature accounts need a second lead: consistency, volume trend, a
 * goal's progress."
 *
 * Only the third existed. A lifter two years in with no active goal got a card
 * with nothing to say about them at all — exactly the user §8 is worried about
 * losing. R226's weekly comparison already computed the trend; it simply never
 * reached the recap.
 */
describe('a mature account with no goal still gets a lead (§8)', () => {
  test('the trend fills the narrative slot when there is no goal', () => {
    const r = recapFor(mature(), 'now', NOW)!;
    assert.equal(r.payload.goalLine, undefined, 'the fixture has no goal');
    assert.ok(r.payload.trendLine, 'the card had nothing to say about the lifter');
    assert.match(r.payload.trendLine!, /is up .* since/);
  });

  test('a goal wins, because it is the thing the user chose', () => {
    const r = recapFor(mature(true), 'now', NOW)!;
    assert.ok(r.payload.goalLine, 'the goal stopped reaching the card');
    assert.equal(r.payload.trendLine, undefined,
      'both leads arrived — they share one slot and would overprint');
  });

  test('the share message carries whichever it is', () => {
    const withTrend = mature();
    assert.match(shareText(recapFor(withTrend, 'now', NOW)!), /is up .* since/,
      'the second lead reaches the app and not the message');
  });

  test('and so does the wire, on both packers', () => {
    const p = recapFor(mature(), 'now', NOW)!.payload;
    const back = ShareURL.readURL(shareUrl(p));
    assert.equal(back.trendLine, p.trendLine, 'the landing page loses the second lead');
    assert.deepEqual(pack(p), ShareURL.pack(p), 'the two packers disagree about it');
  });

  test('it appears once a week, not on every card (§10)', () => {
    /*
     * §10 asks for "one auto-surfaced comparison per WEEK". Put on every recap
     * it fired on 676 of 700 cards — 97% of a mature account's recaps became
     * the same shape, which is exactly the failure §8's mature clause names.
     * Measured before and after: 97% -> 7%.
     */
    const repo = mature();
    // A second session later the same week as today's.
    repo.startSession('again', 'lb');
    repo.logSet({ id: 'later', sessionId: 'again', exerciseId: 'squat',
      weight: 260, reps: 5, at: NOW - 300_000 });
    repo.endSession('again', NOW - 120_000);

    const first = recapFor(repo, 'now', NOW)!;
    const second = recapFor(repo, 'again', NOW)!;
    assert.ok(first.payload.trendLine, 'the first workout of the week said nothing');
    assert.equal(second.payload.trendLine, undefined,
      'the second workout of the same week repeated the claim');
  });

  test('and the gate is derived from the data, not remembered', () => {
    // A recap is generated per session and a backup can be restored, so a
    // "shown already" flag would resurface a claim it had made. The same
    // payload built twice has to answer the same way.
    const repo = mature();
    const a = recapFor(repo, 'now', NOW)!.payload.trendLine;
    const b = recapFor(repo, 'now', NOW)!.payload.trendLine;
    assert.equal(a, b);
  });

  test('it costs nothing when there is nothing true to say', () => {
    // §8's cry-wolf rule. A lift with no history on the far side of the window
    // has no comparison, and the slot stays empty rather than inventing one.
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => NOW);
    repo.startSession('now', 'lb');
    repo.logSet({ id: 'a', sessionId: 'now', exerciseId: 'squat', weight: 100, reps: 5, at: NOW - 600_000 });
    repo.endSession('now', NOW - 300_000);
    const r = recapFor(repo, 'now', NOW)!;
    assert.equal(r.payload.trendLine, undefined);
    assert.equal('e' in (pack(r.payload) as Record<string, unknown>), false,
      'an empty second lead is still spending URL budget');
  });
});

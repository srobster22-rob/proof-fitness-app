/**
 * Does this fixture describe a workout that could have happened?
 *
 * R559, from R540. That round's seed called `startSession` — which stamps
 * `startedAt` from `now()` — and then logged its sets two minutes EARLIER. The
 * app's own rule for "history" is `x.at < session.startedAt`, so today's sets
 * became their own prior best, the card correctly claimed nothing, and the
 * screen looked exactly like a working fix. I had planted a defect and was
 * reading a broken fixture instead of the product.
 *
 * That is the failure worth catching: a fixture wrong in the direction that
 * looks like SUCCESS. A seed that renders an empty screen is obviously broken;
 * this one renders a plausible screen and quietly answers a different question.
 *
 * Called by every seed before it writes, so the fixture proves itself rather
 * than being trusted. Throws rather than warns — a warning in a tool nobody
 * watches is the empty matcher of trap 16 in another costume.
 */
import type { Repo } from '../src/data/repo.ts';

export function assertSaneTimes(repo: Repo): void {
  const sets = repo.allSets();
  const problems: string[] = [];

  for (const s of sets) {
    const session = repo.session(s.sessionId);
    if (!session) {
      problems.push(`set ${s.id} belongs to session ${s.sessionId}, which does not exist`);
      continue;
    }
    if (s.at < session.startedAt) {
      const early = Math.round((session.startedAt - s.at) / 1000);
      problems.push(
        `set ${s.id} is ${early}s EARLIER than session ${s.sessionId} started — ` +
        'the app reads that as history, so this set is its own prior best');
    }
    if (session.endedAt != null && s.at > session.endedAt) {
      const late = Math.round((s.at - session.endedAt) / 1000);
      problems.push(`set ${s.id} is ${late}s after session ${s.sessionId} ended`);
    }
  }

  if (problems.length) {
    throw new Error(
      'this fixture describes a workout that could not have happened:\n  ' +
      problems.join('\n  ') +
      '\nSee tools/seed-sanity.ts — R540 lost half a round to exactly this.');
  }
}

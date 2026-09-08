import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { assertSaneTimes } from '../tools/seed-sanity.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.join(HERE, '..', 'tools');
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 9, 12);

/*
 * R559. The fixture defect that cost most this session, made mechanical.
 *
 * `Repo.startSession` stamps `started_at` from its own clock, correctly, for an
 * app that only ever starts a session in the present. A seed that builds
 * HISTORY with a fixed clock therefore gives every past session a start time of
 * today, and the app's rule for history — `x.at < session.startedAt` — then
 * reads that session's own sets as its prior best.
 *
 * R540 lost half a round to it: the seed logged its sets two minutes before the
 * session it put them in, the card correctly claimed nothing, and the screen
 * looked exactly like the fix working — while the planted defect was not under
 * test at all. A fixture wrong in the direction that looks like SUCCESS.
 *
 * `seed-web.ts` already knew (R37, wrong dates and every workout "1 MIN") and
 * solved it by moving the clock. Six seeds written this session did not, and
 * the checker below found all six.
 */
describe('a fixture proves itself before it is used (R559)', () => {
  function sessionAt(startedAt: number, setAt: number): Repo {
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
    repo.startSession('s1', 'lb', undefined, startedAt);
    repo.logSet({ id: 'x1', sessionId: 's1', exerciseId: 'bench', weight: 135, reps: 5, at: setAt });
    return repo;
  }

  test('a set before its own session start is caught, and named', () => {
    assert.throws(
      () => assertSaneTimes(sessionAt(T0, T0 - 120_000)),
      /set x1 is 120s EARLIER than session s1 started/,
      'the check no longer catches R540\'s exact fixture');
  });

  test('a set after the session ended is caught too', () => {
    const repo = sessionAt(T0, T0 + 60_000);
    repo.endSession('s1', T0 + 30_000);
    assert.throws(() => assertSaneTimes(repo), /after session s1 ended/);
  });

  test('an honest fixture passes', () => {
    // The other half: a rule that rejects everything is as useless as one that
    // rejects nothing, and only one of those is obvious from a green suite.
    assert.doesNotThrow(() => assertSaneTimes(sessionAt(T0 - DAY, T0 - DAY + 60_000)));
  });

  test('it throws rather than warning', () => {
    /*
     * A warning printed by a tool nobody watches is trap 16 in another costume:
     * the run still succeeds, the file is still written, and the fixture is
     * still wrong. The seeds call this immediately before writing.
     */
    const src = fs.readFileSync(path.join(TOOLS, 'seed-sanity.ts'), 'utf8');
    assert.match(src, /throw new Error\(/, 'the checker stopped throwing');
    assert.doesNotMatch(src, /console\.(warn|log)\(/, 'the checker now only warns');
  });

  test('every seed calls it, and before it writes', () => {
    /*
     * Derived from the directory, not a list — a seed added tomorrow is covered
     * without anybody remembering (HANDOFF #13). The ORDER matters as much as
     * the call: checking after `writeFileSync` would still ship the bad file.
     */
    const seeds = fs.readdirSync(TOOLS).filter(f => /^seed-.*\.ts$/.test(f) && f !== 'seed-sanity.ts');
    assert.ok(seeds.length >= 6, `only ${seeds.length} seeds found — the scan has drifted`);
    for (const name of seeds) {
      const src = fs.readFileSync(path.join(TOOLS, name), 'utf8');
      const checkAt = src.indexOf('assertSaneTimes(repo)');
      const writeAt = src.indexOf('writeFileSync');
      assert.ok(checkAt > 0, `${name} never proves its fixture — call assertSaneTimes(repo)`);
      assert.ok(writeAt < 0 || checkAt < writeAt,
        `${name} checks its fixture AFTER writing it, which still ships the bad file`);
    }
  });
});

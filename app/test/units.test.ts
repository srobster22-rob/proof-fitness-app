import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { inferUnit, unitForNewSession } from '../src/domain/coldstart.ts';
import { NowModel } from '../src/ui/now-model.ts';

const DAY = 86_400_000, MIN = 60_000;
const T0 = Date.UTC(2026, 6, 29, 18);
const fresh = () => new Repo(new DatabaseSync(':memory:') as any, () => T0);

describe('unit inference (§8)', () => {
  test('US locales get pounds', () => {
    for (const l of ['en-US', 'en_US', 'en-Latn-US', 'es-US', 'und-US']) {
      assert.equal(inferUnit(l), 'lb', l);
    }
  });

  test('everywhere else gets kilos — including the UK, whose gyms are metric', () => {
    for (const l of ['en-GB', 'de-DE', 'fr-FR', 'ja-JP', 'pt-BR', 'en-AU', 'sv-SE']) {
      assert.equal(inferUnit(l), 'kg', l);
    }
  });

  test('a missing or junk locale falls back to kilos, the world majority', () => {
    assert.equal(inferUnit(null), 'kg');
    assert.equal(inferUnit(undefined), 'kg');
    assert.equal(inferUnit(''), 'kg');
    assert.equal(inferUnit('nonsense'), 'kg');
  });

  test('a language code is not mistaken for a region', () => {
    // "us" is not a language, but "mm" and "lr" could be read as one — the
    // matcher is case-insensitive so this is worth pinning.
    assert.equal(inferUnit('en-DE'), 'kg');
    assert.equal(inferUnit('de-AT'), 'kg');
  });
});

describe('unit for a new session', () => {
  test('their previous unit always wins over the locale', () => {
    assert.equal(unitForNewSession('kg', 'en-US'), 'kg',
      'someone training in kilos on a US phone chose that deliberately');
    assert.equal(unitForNewSession('lb', 'de-DE'), 'lb');
  });

  test('with no history it falls back to the locale', () => {
    assert.equal(unitForNewSession(null, 'en-US'), 'lb');
    assert.equal(unitForNewSession(null, 'de-DE'), 'kg');
  });
});

describe('the bug this round fixed', () => {
  test('a metric user no longer silently gets imperial sessions', () => {
    const repo = fresh();
    const m = new NowModel(repo, () => T0, 'de-DE');
    assert.equal(m.state().session.unit, 'kg',
      'begin() used to read liveSession()?.unit — null at that point — and default to lb');
  });

  test('a US user still gets pounds', () => {
    const m = new NowModel(fresh(), () => T0, 'en-US');
    assert.equal(m.state().session.unit, 'lb');
  });

  test('the unit persists across sessions regardless of locale', () => {
    const repo = fresh();
    const first = new NowModel(repo, () => T0, 'de-DE');
    first.log();
    assert.equal(first.state().session.unit, 'kg');
    first.finish();

    // Same device, but pretend the locale reports differently on relaunch.
    const second = new NowModel(repo, () => T0 + 3 * DAY, 'en-US');
    assert.equal(second.state().session.unit, 'kg',
      'switching a user\'s unit under them would corrupt every prefill and PR comparison');
  });

  test('lastUsedUnit reads the most recent session', () => {
    const repo = fresh();
    assert.equal(repo.lastUsedUnit(), null, 'fresh install has no opinion');
    repo.startSession('a', 'kg');
    repo.endSession('a', T0 - 2 * DAY);
    assert.equal(repo.lastUsedUnit(), 'kg');
  });

  test('steppers follow the session unit', async () => {
    const { WEIGHT_STEP } = await import('../src/ui/now-model.ts');
    const kg = new NowModel(fresh(), () => T0, 'de-DE');
    assert.equal(WEIGHT_STEP[kg.state().session.unit], 2.5, 'kg plates step 2.5, not 5');

    const lb = new NowModel(fresh(), () => T0, 'en-US');
    assert.equal(WEIGHT_STEP[lb.state().session.unit], 5);
  });

  test('a kg user gets kg seed weights, not converted pounds', () => {
    const m = new NowModel(fresh(), () => T0, 'de-DE');
    m.selectExercise('bench');
    const s = m.state();
    assert.equal(s.session.unit, 'kg');
    assert.equal(s.prefillSource, 'seed');
    assert.ok(s.weight < 100, `seeded ${s.weight}kg — that looks like a pound value`);
  });
});

// R24 fixed this in NowModel.begin(); R25 found the identical mistake in
// progress-model and the goal sheet. Pinned across every site so the pattern
// cannot come back: reading the unit off liveSession() is wrong precisely
// because these surfaces are usually opened when no session is live.
describe('no surface silently falls back to pounds', () => {
  function kgHistory() {
    const repo = fresh();
    for (let w = 4; w >= 1; w--) {
      const at = T0 - w * 7 * DAY;
      const sid = `s${w}`;
      repo.startSession(sid, 'kg');
      repo.logSet({ id: `x${w}`, sessionId: sid, exerciseId: 'squat', weight: 100 + w, reps: 5, at });
      repo.endSession(sid, at + 40 * MIN);   // nothing live afterwards
    }
    return repo;
  }

  test('Progress reports the user\'s unit with no live session', async () => {
    const { progressRows } = await import('../src/ui/progress-model.ts');
    const repo = kgHistory();
    assert.equal(repo.liveSession(), null, 'fixture sanity: nothing live');
    const rows = progressRows(repo, T0);
    assert.ok(rows.length > 0);
    assert.equal(rows[0].unit, 'kg', 'a metric user must not see imperial labels');
  });

  test('the goal target suggestion uses the user\'s unit', async () => {
    const { suggestTarget } = await import('../src/ui/goals-model.ts');
    const repo = kgHistory();
    const kg = suggestTarget(repo, 'squat', 5, repo.lastUsedUnit() ?? 'lb');
    assert.ok(kg < 200, `suggested ${kg} — that is a pound-shaped number for a kg lifter`);
  });

  test('a new session after a kg history stays kg even on a US locale', () => {
    const repo = kgHistory();
    assert.equal(new NowModel(repo, () => T0 + 3 * DAY, 'en-US').state().session.unit, 'kg');
  });
});

/*
 * Every surface above reads the right unit LABEL. This is the separate
 * question of whether the NUMBER under that label is honest when the same
 * lift was trained in two different units — `progressRows` aggregates
 * EVERY session ever logged into one row, in one unit, and until this round
 * did it by reading `s.weight` straight across sessions with no regard for
 * which unit each one was actually logged in.
 */
describe('Progress converts a mixed-unit history before it compares any of it', () => {
  async function mixedHistory() {
    const repo = fresh();
    // An old kg block, well clear of the cold-start / trend-window guards.
    for (let w = 8; w >= 5; w--) {
      const at = T0 - w * 7 * DAY;
      const sid = `k${w}`;
      repo.startSession(sid, 'kg', undefined, at);
      repo.logSet({ id: `xk${w}`, sessionId: sid, exerciseId: 'bench', weight: 100, reps: 5, at });
      repo.endSession(sid, at + 40 * MIN);
    }
    // Then a recent lb block at a genuinely LIGHTER weight than the kg PR.
    for (let w = 3; w >= 1; w--) {
      const at = T0 - w * 7 * DAY;
      const sid = `l${w}`;
      repo.startSession(sid, 'lb', undefined, at);
      repo.logSet({ id: `xl${w}`, sessionId: sid, exerciseId: 'bench', weight: 205, reps: 5, at });
      repo.endSession(sid, at + 40 * MIN);
    }
    return repo;
  }

  test('the best set is converted, not read raw off whichever session logged it', async () => {
    const { progressRows } = await import('../src/ui/progress-model.ts');
    const repo = await mixedHistory();
    const row = progressRows(repo, T0).find(r => r.exerciseId === 'bench')!;
    // Row unit follows `lastUsedUnit` — the recent lb block.
    assert.equal(row.unit, 'lb');
    // 100 kg is ~220.5 lb, genuinely heavier than the 205 lb block — the best
    // set has to still be the kg one, converted, not whichever unit happened
    // to have the larger raw number.
    assert.equal(row.best, 220.5, `raw comparison would have picked 205 lb over a mislabelled "100"`);
  });

  test('the trend compares the true first and last load, not two different scales', async () => {
    const { progressRows } = await import('../src/ui/progress-model.ts');
    const repo = await mixedHistory();
    const row = progressRows(repo, T0).find(r => r.exerciseId === 'bench')!;
    // First session in the window: 100 kg (~220.5 lb). Last: 205 lb. A real
    // decline of ~15.5 lb — not "+105", which is what comparing 100 to 205
    // as if both were already lb would report.
    assert.ok(row.trend !== null && row.trend < 0, `trend was ${row.trend}, expected a real decline`);
    assert.ok(Math.abs(row.trend! - -15.5) < 0.1, `trend was ${row.trend}, expected ~-15.5`);
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const T0 = Date.UTC(2026, 8, 9, 12);

/** A phone with nothing on it — no sessions, no prefs, no goals. */
const fresh = () => new Repo(new DatabaseSync(':memory:') as never, () => T0);

/*
 * R555. Eighteen rounds of measurement in this session were taken against a
 * SEEDED history, and OWNER.md's complaint is about what a person sees when
 * they open the app — which on day one is a cold start with nothing in it.
 *
 * Walked in the product: the split chooser, the day chooser, the first logged
 * set, the SESSION ONE recap, and Progress and Goals on a one-session history.
 * All correct, and Progress honestly prints "—" for a change it cannot compute
 * rather than inventing a trend.
 *
 * One promise is unkept, and it is stated in `coldstart.ts` itself: `source` is
 * returned "so the UI can tell the user which it is — 'last time' is
 * reassuring, a seeded guess should not pretend to be their history". The app
 * shows a confident 45 under "First time" and never says which. R299 weighed
 * that and left it, for a reason this test pins rather than repeats.
 */
describe('the first screen keeps the promises it makes (R555)', () => {
  test('a brand-new phone opens on a real, loadable starting weight', () => {
    const m = new NowModel(fresh(), () => T0, 'en-US');
    const s = m.state();
    assert.equal(s.weight, 45, 'a new user no longer opens on the empty bar');
    assert.equal(s.prefillSource, 'seed', 'the opening weight is no longer a seeded guess');
    assert.ok(s.reps >= 1, '§4: an empty number field is a bug');
  });

  test('and says "First time" rather than inventing a history', () => {
    const m = new NowModel(fresh(), () => T0, 'en-US');
    const head = m.state().lastTime.head;
    assert.match(head, /First time/, `the opening line was: "${head}"`);
    assert.doesNotMatch(head, /Last time|climbing|Stuck at/,
      `the app claimed history to somebody who has none: "${head}"`);
  });

  test('the seed/history distinction is computed and still unsurfaced, on purpose', () => {
    /*
     * `prefillSource` is on `NowState` and no screen reads it. That is a
     * DECISION (R299), not an oversight, so this pins the decision and its
     * escape hatch rather than the field — if somebody surfaces it, this test
     * should be deleted along with the acknowledgement, not quietly edited.
     */
    const screens = ['NowScreen.tsx'].map(f =>
      fs.readFileSync(path.join(APP, 'src', 'ui', f), 'utf8')).join('\n');
    assert.doesNotMatch(screens, /prefillSource/,
      'prefillSource now reaches a screen — good, but update field-scan.cjs\'s ' +
      'ACKNOWLEDGED entry and OWNER.md, which both say it does not');

    const scan = fs.readFileSync(path.join(APP, 'tools', 'field-scan.cjs'), 'utf8');
    assert.match(scan, /R555 RE-MEASURED THE CROWDING PREMISE/,
      'the acknowledgement lost the measurement and is back to inherited reasoning');
    assert.match(scan, /115px of a 335px column/,
      'the measurement behind the decision is gone, so the next session cannot check it');
  });

  test('the owner has the decision, with the number attached', () => {
    // Owner-only decisions get filed, not made. A filing with no measurement is
    // just an opinion forwarded, which is what R299 already did once.
    const owner = fs.readFileSync(path.join(APP, '..', 'OWNER.md'), 'utf8');
    assert.match(owner, /FILED R555/, 'the day-one filing is gone from OWNER.md');
    assert.match(owner, /115px of a 335px column/,
      'the filing lost the measurement that makes it decidable');
  });
});

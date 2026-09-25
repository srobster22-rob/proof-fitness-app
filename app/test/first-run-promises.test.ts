import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { nowScreenSource } from './helpers/now-screen.ts';

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

  /*
   * R641: the owner answered R555 -- "add the day-one starting point label".
   * The distinction now reaches the screen through the line itself
   * (`lastTimeParts({ start })`), not through the raw `prefillSource` field,
   * which is why the field is still screen-unread and still acknowledged.
   */
  test('day one names its number as a starting point', () => {
    const m = new NowModel(fresh(), () => T0, 'en-US');
    assert.equal(m.state().lastTime.head, 'First time — 45 is a starting point');
  });

  test('the raw seed/history field stays off the screen; the label carries it', () => {
    const screens = nowScreenSource();
    assert.doesNotMatch(screens, /prefillSource/,
      'prefillSource now reaches a screen -- update field-scan.cjs, whose ' +
      'ACKNOWLEDGED entry says only tests read it');

    const scan = fs.readFileSync(path.join(APP, 'tools', 'field-scan.cjs'), 'utf8');
    assert.match(scan, /R641: THE OWNER DECIDED/,
      'the acknowledgement still describes the decision as pending');
    assert.match(scan, /115px of a 335px column/,
      'the measurement behind the decision is gone, so the next session cannot check it');
  });

  test('the owner\'s answer is recorded, and the filing is closed', () => {
    const owner = fs.readFileSync(path.join(APP, '..', 'OWNER.md'), 'utf8');
    assert.match(owner, /Day-one starting point label -- SHIPPED R641/,
      'the answered decision is not in the Done list of OWNER.md');
    assert.doesNotMatch(owner, /FILED R555/,
      'the R555 filing is still open in OWNER.md after the owner answered it');
  });
});

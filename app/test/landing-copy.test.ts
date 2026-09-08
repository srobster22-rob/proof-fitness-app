import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const require_ = createRequire(import.meta.url);
const Copy = require_(path.join(ROOT, 'link', 'copy.js'));

/** A payload with a PR, one without, and nothing at all — the three shapes. */
const WITH_PR = { pr: { lift: 'Bench Press', weight: 225, reps: 5 } };
const WITHOUT_PR = { volume: 9800 };

/*
 * The landing page's A/B copy, which nothing tested.
 *
 * `copy.js` is the acquisition surface: four variants, each answering a
 * different question about what a recipient is actually thinking, selected by
 * `?v=`. §13's kill test carries them across its ten subjects and §13b feeds
 * the variant id into the App Store campaign token, so a broken one does not
 * merely look bad — it silently biases the one experiment this project is
 * built to run, and breaks the attribution for whatever it did earn.
 *
 * It had no coverage at all. A variant missing `withPR` would throw for
 * exactly the recipients most likely to convert (someone just hit a PR), and
 * the page would fall to its error path with nothing saying why.
 */
describe('every landing-page variant can answer every payload', () => {
  test('the ids the module advertises are the ones it has', () => {
    // `ids` feeds the campaign token, so it must not drift from `VARIANTS`.
    assert.deepEqual(Copy.ids.slice().sort(), Object.keys(Copy.VARIANTS).sort());
    assert.ok(Copy.ids.length >= 2, 'an A/B test needs at least two arms');
  });

  for (const id of Copy.ids as string[]) {
    test(`variant ${id} is complete`, () => {
      const v = Copy.VARIANTS[id];
      assert.equal(v.id, id, 'the variant does not know its own id');
      assert.ok(v.note, 'no note saying which question this arm answers');
      assert.ok(v.cta && v.cta.length > 3, 'no call to action');
      for (const shape of [WITH_PR, WITHOUT_PR, null]) {
        const out = Copy.resolve(v, shape);
        assert.ok(out && out.h && out.s,
          `variant ${id} produced no headline for ${shape ? (shape as { pr?: unknown }).pr ? 'a PR' : 'a workout' : 'a bare visit'}`);
        assert.equal(typeof out.h, 'string');
        assert.equal(typeof out.s, 'string');
      }
    });
  }

  test('a PR headline names the lift and the numbers where it claims to', () => {
    // The one shape that interpolates. `String(d.pr.lift).toLowerCase()` on an
    // absent lift would print "undefined" onto the acquisition surface.
    const a = Copy.resolve(Copy.VARIANTS.a, WITH_PR);
    assert.match(a.s, /225/);
    assert.match(a.s, /5/);
    assert.match(a.s, /bench press/);
    for (const id of Copy.ids as string[]) {
      const out = Copy.resolve(Copy.VARIANTS[id], WITH_PR);
      assert.doesNotMatch(out.h + out.s, /undefined|NaN|\[object/,
        `variant ${id} leaked a placeholder into the page`);
    }
  });

  test('?v= selects, and anything else falls back rather than breaking', () => {
    for (const id of Copy.ids as string[]) {
      assert.equal(Copy.pick(`https://x.app/r?v=${id}`).id, id);
    }
    // The fallback is the PREDICTED-BEST arm, recorded before the data — so a
    // malformed link still shows the page the project is betting on.
    for (const bad of ['https://x.app/r', 'https://x.app/r?v=', 'https://x.app/r?v=z',
                       'https://x.app/r?v=aa', 'https://x.app/r?other=a']) {
      const got = Copy.pick(bad);
      assert.ok(got && got.id, `"${bad}" produced no variant at all`);
      assert.equal(got.id, 'c', `"${bad}" did not fall back to the predicted best`);
    }
  });

  test('the fragment is read from the query, never the hash', () => {
    // The recap payload rides the HASH. If `pick` matched there it would read
    // base64 as a variant id — and a `v=` inside encoded JSON is not remote.
    const src = readFileSync(path.join(ROOT, 'link', 'copy.js'), 'utf8');
    assert.match(src, /\[\?&\]v=/, 'the selector no longer anchors to a query parameter');
  });

  test('the page and the og image both take the name from here', () => {
    // `og.cjs` draws NAME into the crawler card. Two spellings of the product
    // name on one link is the kind of thing nobody notices until it ships.
    const og = readFileSync(path.join(ROOT, 'link', 'og.cjs'), 'utf8');
    assert.match(og, /require\('\.\/copy\.js'\)\.NAME/);
    assert.equal(Copy.NAME, 'PROOF');
  });
});

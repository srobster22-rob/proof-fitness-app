import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { SPLIT_PLANS, PLAN_LABEL, PLAN_BLURB } from '../src/domain/split.ts';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, '..', 'src', 'ui', 'NowScreen.tsx'), 'utf8');

/**
 * The first screen of the app has to be answerable by somebody who has never
 * lifted. BUILD_LOOP's second rule, and §6's promise that a beginner is logging
 * after one tap.
 *
 * Measured on a cleared database: the split chooser asked "WHAT SPLIT DO YOU
 * RUN?" and offered PUSH / PULL / LEGS, UPPER / LOWER, FULL BODY — four pieces
 * of gym vocabulary, no explanation, and no way past it. The day step behind it
 * had always had a skip; this step did not, so a beginner's only moves were to
 * guess or to close the app.
 */
describe('the split question can be answered by a beginner (§6)', () => {
  test('every plan says what it means in days and body parts', () => {
    for (const p of SPLIT_PLANS) {
      const blurb = PLAN_BLURB[p];
      assert.ok(blurb && blurb.length > 20, `${p} has no plain-language explanation`);
      // The explanation cannot just restate the jargon label.
      assert.notEqual(blurb.toUpperCase(), PLAN_LABEL[p]);
      assert.match(blurb, /\b(One|Two|Three) days?\b/,
        `${p}'s blurb does not say how many days a week it is — the one fact ` +
        'that lets someone choose between them');
    }
  });

  test('the blurbs are rendered, not just declared', () => {
    // Routed through the translation table rather than read from `PLAN_BLURB`
    // directly — see i18n.ts's `PLAN_BLURB_KEY` — so this anchors on the key
    // lookup rather than the domain constant it now only seeds.
    assert.match(SOURCE, /T\(PLAN_BLURB_KEY\[p\]\)/,
      'the plain-language line exists in the domain but the sheet still shows only the label');
  });

  test('the plan step has a way out', () => {
    const step = region(SOURCE, 'SPLIT_PLANS.map', 'PLAN_DAYS[');
    // `skip` wraps `onSkip` in the exit animation added this round — same
    // control, same destination, the call is just deferred by `exitMs` now.
    assert.match(step, /onPress=\{skip\}/,
      'a beginner who does not know what a split is has no way past the first screen');
  });

  test('the question is not asked in vocabulary the answer teaches', () => {
    assert.doesNotMatch(SOURCE, /WHAT SPLIT DO YOU RUN/,
      '"split" is the word being explained — it cannot be the word in the question');
  });
});

/*
 * And having declined it once, they are not asked again. `dayOpen` is a
 * useState initializer, so it re-ran on every remount of the screen: leaving
 * for Progress and coming back put the same question up again.
 */
describe('a declined question stays declined (§4)', () => {
  const setup = () => {
    const now = Date.UTC(2026, 6, 29, 18);
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => now);
    const model = new NowModel(repo, () => now, 'en-US');
    return { repo, model };
  };

  test('the chooser opens on a fresh session', () => {
    const { model } = setup();
    assert.equal(model.state().dayAsked, false);
  });

  test('skipping is remembered', () => {
    const { model } = setup();
    model.skipDay();
    assert.equal(model.state().dayAsked, true, 'the chooser would reopen on the next remount');
    assert.equal(model.state().dayChosen, false, 'skipping is not an answer');
  });

  test('answering counts as being asked', () => {
    const { model } = setup();
    model.setDay('push');
    assert.equal(model.state().dayAsked, true);
    assert.equal(model.state().dayChosen, true);
  });

  test('the sheet opens on dayAsked, not dayChosen', () => {
    // `st.` became `state.` when `dayOpen` stopped being a `useState` initializer
    // and became a derived value — see day-chooser.test.ts. The rule is the
    // same one and is what this asserts: skipping is remembered, so the gate
    // has to be the "were they asked" flag rather than the "did they answer"
    // one, or a declined question comes back.
    assert.match(SOURCE, /const dayOpen = !state\.dayAsked/,
      'gating on dayChosen re-asks a skipped question every time the screen mounts');
    assert.doesNotMatch(SOURCE, /dayOpen = !state\.dayChosen/);
  });
});

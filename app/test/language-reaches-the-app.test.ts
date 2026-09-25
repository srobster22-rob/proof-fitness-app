import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { t, fill, languageOf, missingKeys, LANGUAGES, PREF_LANG } from '../src/domain/i18n.ts';
import { lastTimeParts } from '../src/ui/now-line.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.join(HERE, '..', ...p.split('/')), 'utf8');
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

const T = Date.UTC(2026, 7, 24, 9);
const fresh = () => new Repo(new DatabaseSync(':memory:') as any, () => T);

/*
 * Every .tsx that can render a <Text> — derived from the two directories
 * that hold component code, not a remembered subset. R403/R404 found the
 * same shape twice already tonight (a hand-picked file list, a hand-picked
 * file scope): a fixed array here means a new screen's own hardcoded
 * English string is invisible to the exact test whose docstring says "a new
 * screen must not be able to quietly opt out."
 */
function allScreenFiles(): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(path.join(HERE, '..', dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.tsx')) out.push(rel);
    }
  }
  walk('src/ui');
  walk('app');
  return out;
}

/**
 * The LANGUAGE setting translated the Settings screen and nothing else.
 *
 * Choosing Español gave AJUSTES / RUTINA / UNIDADES, and then tapping LISTO
 * landed on a logging screen reading LOG SET, FINISH, CLEAR and "Last time
 * 225 × 5", with PROGRESS and GOALS in the header — every one of which had a
 * Spanish string sitting unused in the very table the setting claims to switch.
 * The app rendered in two languages at once, and the half the user actually
 * spends their time in was the untranslated half.
 */
describe('the language reaches the screens the user lives on', () => {
  /*
   * Through `PREF_LANG`, never a raw string. `Repo.setPref` prefixes with
   * `pref.` and the constant already contains it, so the row is really
   * `pref.pref.language` — the first version of `languageOf` guessed
   * `'language'`, read an empty row and returned English for a user who had
   * chosen Español. These tests wrote the same guess and passed anyway, which
   * is why they now go through the constant like every caller does.
   */
  test('the setting is readable from anywhere, not just Settings', () => {
    const repo = fresh();
    assert.equal(languageOf(repo, 'en-US'), 'en');
    repo.setPref(PREF_LANG, 'es');
    assert.equal(languageOf(repo, 'en-US'), 'es', 'the stored choice beats the locale');
  });

  test('an unset choice still follows the device', () => {
    assert.equal(languageOf(fresh(), 'es-MX'), 'es');
    assert.equal(languageOf(fresh(), 'en-GB'), 'en');
    assert.equal(languageOf(fresh(), null), 'en', 'a half-matched locale is a worse guess');
  });

  test('the logging screen reports the language it should draw in', () => {
    const repo = fresh();
    repo.setPref(PREF_LANG, 'es');
    assert.equal(new NowModel(repo, () => T, 'en-US').state().lang, 'es');
  });

  /*
   * The strings the MODEL owns — the ones a component cannot translate on its
   * way past, because they are assembled from a number and a phrase.
   */
  test('the line under the hero speaks it too', () => {
    const prev = { id: 'x', sessionId: 's', exerciseId: 'bench', weight: 225, reps: 5, at: T };
    const en = lastTimeParts({ previous: prev, thisSession: [], goal: null }, 'en');
    const es = lastTimeParts({ previous: prev, thisSession: [], goal: null }, 'es');
    assert.match(en.head, /Last time/);
    assert.match(es.head, /Última vez|Ultima vez/i);
    assert.match(es.head, /225/, 'the numbers are numbers in every language');
  });

  test('"first time" and "just did" are translated as well', () => {
    const now = { id: 'y', sessionId: 's', exerciseId: 'bench', weight: 100, reps: 8, at: T };
    assert.notEqual(
      lastTimeParts({ previous: null, thisSession: [], goal: null }, 'es').head,
      lastTimeParts({ previous: null, thisSession: [], goal: null }, 'en').head);
    assert.notEqual(
      lastTimeParts({ previous: null, thisSession: [now], goal: null }, 'es').head,
      lastTimeParts({ previous: null, thisSession: [now], goal: null }, 'en').head);
  });

  test('the goal tail is not left in English mid-sentence', () => {
    const goal = { remaining: 30, targetWeight: 225, targetReps: 5 };
    const es = lastTimeParts({ previous: null, thisSession: [], goal }, 'es').tail;
    assert.doesNotMatch(es, /\bto\b/, '"30 to 225" in a Spanish sentence is the bug in miniature');
    assert.match(es, /225/);
  });
});

/*
 * The guard that keeps it fixed. A new screen, or a new label on an old one,
 * must not be able to quietly opt out of the setting.
 */
describe('no screen hardcodes chrome the table already translates', () => {
  const SCREENS = allScreenFiles();

  test('the scan actually found the screens it means to cover', () => {
    assert.ok(SCREENS.length >= 5, 'the scan found nothing, so it proves nothing');
  });

  /*
   * Phrases that exist in the table AND are unambiguous as UI chrome. Kept
   * short deliberately: this test is a tripwire, not a linter, and a false
   * positive on some unrelated comment would get it deleted rather than fixed.
   */
  const TRANSLATED = [
    'LOG SET', 'FINISH', 'ERASE EVERYTHING', 'EXPORT MY DATA',
    '+ ADD A GOAL', 'RECENT WORKOUTS', 'SET GOAL', 'SAVE CHANGES'
  ];

  for (const file of SCREENS) {
    test(`${file} routes its chrome through the table`, () => {
      const src = code(read(file));
      // Only inside a rendered <Text>, so an accessibilityLabel or a style name
      // is not mistaken for a visible string.
      const rendered = [...src.matchAll(/<Text[^>]*>([^<{][^<]*)</g)].map(m => m[1].trim());
      const hard = rendered.filter(x => TRANSLATED.includes(x));
      assert.deepEqual(hard, [],
        `these render in English whatever the LANGUAGE setting says: ${hard.join(', ')}`);
    });
  }

  test('every language has every key, or falls back visibly to English', () => {
    for (const lang of LANGUAGES) {
      const missing = missingKeys(lang);
      // Not an assertion that nothing is missing — coverage is allowed to be
      // partial. What must hold is that a gap resolves to English rather than
      // to a blank or a raw key, which is what `t` promises.
      for (const k of missing) {
        assert.equal(t(lang, k), t('en', k), `${lang}.${k} did not fall back`);
      }
    }
  });

  test('the Spanish table has no empty strings hiding as translations', () => {
    // Read the table directly: an empty string is not a missing key, so
    // `missingKeys` would not catch it, and it renders as nothing at all.
    const src = read('src/domain/i18n.ts');
    assert.doesNotMatch(src, /:\s*''\s*,/, 'an empty translation renders as a blank control');
  });
});

/*
 * The layering, which broke the moment `session.ts` needed a string.
 *
 * `src/domain` is pure rules and is the ONLY thing the browser bundle carries —
 * `build-domain.cjs` reads that directory and nothing else, because the
 * kill-test harness renders what real lifters see and has no React to give it.
 * So a domain file importing `../ui/anything` does not fail a type check or a
 * unit test; it fails the BUNDLE, at the point where the harness stops matching
 * the app. That is exactly what happened, and `bundle-parity` caught it.
 *
 * `i18n.ts` therefore lives in `domain`: it is a table of strings and three
 * pure functions, it imports nothing, and both `goals.ts` and `session.ts`
 * assemble sentences with it.
 */
describe('the domain layer stays importable by the browser bundle', () => {
  const DOMAIN = [
    'src/domain/session.ts', 'src/domain/goals.ts', 'src/domain/pr.ts',
    'src/domain/measure.ts', 'src/domain/measure-goal.ts', 'src/domain/coldstart.ts',
    'src/domain/predict.ts', 'src/domain/split.ts', 'src/domain/rest.ts',
    'src/domain/types.ts', 'src/domain/i18n.ts', 'src/domain/muscles.ts'
  ];

  for (const file of DOMAIN) {
    test(`${file} imports nothing from ui or data`, () => {
      const src = code(read(file));
      const bad = [...src.matchAll(/from\s+'([^']+)'/g)]
        .map(m => m[1])
        .filter(p => /\.\.\/(ui|data)\//.test(p));
      assert.deepEqual(bad, [],
        `a domain file reaching outside domain breaks the browser bundle: ${bad.join(', ')}`);
    });
  }

  test('and the bundle actually carries i18n', () => {
    const builder = readFileSync(path.join(HERE, '..', 'build-domain.cjs'), 'utf8');
    assert.match(builder, /'i18n\.ts'/,
      'session.ts and goals.ts import it, so the bundle must include it');
    // Order matters: the builder concatenates in dependency order.
    const list = /const MODULES = \[([^\]]*)\]/.exec(builder)![1];
    const names = [...list.matchAll(/'([^']+)'/g)].map(m => m[1]);
    for (const dependent of ['goals.ts', 'session.ts']) {
      assert.ok(names.indexOf('i18n.ts') < names.indexOf(dependent),
        `i18n.ts must be bundled before ${dependent}`);
    }
  });
});

/*
 * A wider sweep than the tripwire above: every rendered `<Text>` whose content
 * is a bare English literal, on every screen.
 *
 * The tripwire lists eight phrases and is deliberately narrow so a false
 * positive never gets it deleted. This one is the opposite — it looks at
 * EVERYTHING and carries an explicit allow-list, so adding a hardcoded string
 * is a decision somebody has to write down rather than something that slips in.
 */
describe('nothing renders a bare English sentence', () => {
  const SCREENS = allScreenFiles();

  /*
   * Deliberately untranslated, each for a stated reason.
   *
   * `PROOF` is the product's name and a watermark. The glyphs are symbols, not
   * words — a gear and two chevrons read the same in every language, which is
   * why they were chosen over labels in the first place.
   *
   * R527 removed `←` from this list. It exempted nothing: the arrow lives
   * inside the TRANSLATED string `editWorkout` ('← EDIT THIS WORKOUT' /
   * '← EDITAR ESTE ENTRENO'), so it was never a bare glyph needing permission
   * — and an allow-list entry for something that does not exist is a claim
   * about the code that has quietly stopped being true, which is what R526
   * found one screen over.
   *
   * The test below keeps it honest: an entry that appears nowhere in the
   * screens fails the build, so this list can only shrink by being wrong.
   */
  const ALLOWED = new Set(['PROOF', '⚙', '▾', '▴', '›', '+', '−', '×', '·']);

  test('every allowed string is actually rendered somewhere', () => {
    /*
     * An allow-list is permission to skip a check, so a dead entry is
     * permission nobody is using and nobody will re-examine — it just widens
     * the net for whatever is added next that happens to match.
     */
    const everything = SCREENS.map(f => read(f)).join('');
    const dead = [...ALLOWED].filter(a => !everything.includes(a));
    assert.deepEqual(dead, [],
      `these are allowed but appear in no screen: ${dead.join(' ')} — remove them, ` +
      'or the list is granting permission for code that no longer exists');
  });

  for (const file of SCREENS) {
    test(`${file} has no untranslated prose`, () => {
      const src = code(read(file));
      const bare = [...src.matchAll(/<Text[^>]*>\s*([A-Za-z][^<>{}]*?)\s*<\/Text>/g)]
        .map(m => m[1].trim())
        .filter(x => x && !ALLOWED.has(x))
        // A single lowercase word inside a nested <Text> is usually a unit or a
        // suffix already handled by its parent; require a capital or a space,
        // which is what actual prose looks like.
        .filter(x => /[A-Z]/.test(x) || x.includes(' '));
      assert.deepEqual(bare, [],
        `${file} renders English regardless of the LANGUAGE setting: ${bare.join(' | ')}`);
    });
  }
});

/*
 * The gap the sweep above could not see.
 *
 * Equipment rendered as `{e.toUpperCase()}` — an expression, not a literal — so
 * a screen that was otherwise entirely Spanish still showed BARBELL, DUMBBELL,
 * MACHINE and BODYWEIGHT. The same shape had already caught out the plan and
 * day names, which come from `split.ts` as English constants.
 *
 * The rule: anything drawn from a domain ID needs a key map, because the domain
 * has no opinion about language and its ids are English by construction.
 */
describe('names taken from domain ids go through the table', () => {
  const src = code(read('src/ui/NowScreen.tsx'));

  test('equipment is not uppercased straight onto the screen', () => {
    assert.doesNotMatch(src, /\{e\.toUpperCase\(\)\}/,
      'an id rendered directly is an id rendered in English');
    assert.doesNotMatch(src, /state\.equipment\.toUpperCase\(\)/);
    assert.match(src, /KIT_KEY\[/, 'it goes through the key map instead');
  });

  test('the same for plans and days', () => {
    assert.match(src, /PLAN_KEY\[/);
    assert.match(src, /DAY_KEY\[/);
    assert.match(src, /DAY_HEADING_KEY\[/);
  });

  /*
   * "OTHER DAYS · {n}" / "ONLY THIS DAY" — a ternary of two literals passed
   * straight to `{expr}`, the same shape that hid `FILTER_LABEL`/`SORT_LABEL`
   * on Goals: an expression is invisible to a sweep matching literal `<Text>`
   * content, however English the strings inside it are.
   */
  test('the day-rail toggle reads from the table on both branches', () => {
    assert.doesNotMatch(src, /'ONLY THIS DAY'/);
    assert.doesNotMatch(src, /OTHER DAYS  ·/);
    assert.match(src, /T\('onlyThisDay'\)/);
    assert.match(src, /T\('otherDaysCount'\)/);
  });

  /*
   * "START WITH" / "SWITCH TO" is the same ternary-of-literals shape again.
   * "+ Something else" is a sixth reason a string escapes a sweep: it starts
   * with punctuation, and a regex written to require the capture to begin
   * with a letter treats a leading "+" the same as a leading "{" — a
   * non-match, not a caught case.
   */
  test('the exercise-picker sheet title and add-new prompt are translated', () => {
    assert.doesNotMatch(src, /'START WITH' : 'SWITCH TO'/);
    assert.doesNotMatch(src, />\+ Something else</);
    assert.match(src, /T\('startWith'\)/);
    assert.match(src, /T\('switchTo'\)/);
    assert.match(src, /T\('somethingElse'\)/);
  });

  /*
   * Every key map must cover its domain type exactly. A missing entry is a
   * compile error at the call site rather than a silent English string, which
   * is the whole reason they are keyed off the domain's own ids — this asserts
   * the maps have not drifted from the lists they mirror.
   */
  test('the key maps cover every id the domain defines', async () => {
    const { KIT_KEY, PLAN_KEY, DAY_KEY, DAY_HEADING_KEY } =
      await import('../src/domain/i18n.ts');
    const { EQUIPMENT } = await import('../src/domain/types.ts');
    const { SPLIT_PLANS, PLAN_DAY_LABEL } = await import('../src/domain/split.ts');

    assert.deepEqual(Object.keys(KIT_KEY).sort(), [...EQUIPMENT].sort());
    assert.deepEqual(Object.keys(PLAN_KEY).sort(), [...SPLIT_PLANS].sort());
    for (const day of Object.keys(PLAN_DAY_LABEL)) {
      assert.ok(day in DAY_KEY, `${day} has no name in the table`);
      assert.ok(day in DAY_HEADING_KEY, `${day} has no rail heading in the table`);
    }
  });
})

/*
 * NowScreen's full accessibility-label sweep. Twenty-one sites, found by
 * grepping for `accessibilityLabel="[A-Z]` and `accessibilityLabel={`[A-Z]`
 * directly against the file rather than trusting the earlier per-site fixes
 * to have been exhaustive — they were not; this is the third round on this
 * one file (R154's YOU-screen pass, R156's picker-sheet pass, this one).
 */
describe('every accessibility label on the logging screen is translated', () => {
  const src = code(read('src/ui/NowScreen.tsx'));

  test('no accessibilityLabel is left as a bare English literal', () => {
    const bad = [...src.matchAll(/accessibilityLabel="([A-Z][^"]*)"/g)]
      .concat([...src.matchAll(/accessibilityLabel=\{`([A-Z][^`]*)`\}/g)])
      .map(m => m[1]);
    assert.deepEqual(bad, [], `still hardcoded: ${bad.join(' | ')}`);
  });

  // R640: the destinations moved into the tab bar, which builds each tab's
  // visible label and its accessibility label from the SAME entry.
  test('the tab bar reuses the same keys the visible PROGRESS/GOALS/SETTINGS labels use', () => {
    const bar = readFileSync(path.join(HERE, '..', 'src', 'ui', 'TabBar.tsx'), 'utf8');
    assert.match(bar, /now: 'nowWord', progress: 'progress', goals: 'goals', settings: 'settings'/);
    assert.match(bar, /const label = t\(lang, LABEL\[id\]\);/);
    assert.match(bar, /accessibilityLabel=\{label\}/,
      'the tab spoken aloud is not the tab drawn');
  });

  test('the steppers, the hero and the edit sheet all route through the table', () => {
    for (const key of [
      'changeExerciseA11y', 'changeEquipmentA11y', 'typeWeightA11y', 'typeRepsA11y',
      'undoLastSetA11y', 'addAnotherSetA11y', 'clearWorkoutA11y', 'skipWorkItOutA11y',
      'noteForSetA11y', 'machineNameA11y', 'machineTapAgain'
    ]) {
      assert.match(src, new RegExp(`T\\('${key}'\\)`), `${key} is not referenced`);
    }
  });

  /*
   * Found by opening the picker sheet live in Spanish and reading the
   * accessibility tree, not by any static sweep: the rail chip's label is
   * built by concatenating template-literal fragments, and the set chip's
   * "Tap to edit" label is built the same way — neither looks like a plain
   * `accessibilityLabel="English"` literal, so the sweep above walks right
   * past both.
   */
  test('the rail chip and the logged-set chip build their labels from the table too', () => {
    for (const key of [
      'alreadyTrainedTodayA11y', 'suggestedNextA11y', 'reasonColonA11y',
      'setByRepsA11y', 'notedA11y', 'tapToEditA11y'
    ]) {
      assert.match(src, new RegExp(`T\\('${key}'\\)`), `${key} is not referenced`);
    }
  });
});

/*
 * `recommendNext`'s five reasons never reach the screen as a `<Text>` node —
 * only as part of the rail chip's accessible name (§4 cut the visible reason
 * line) — which is exactly why they survived every earlier sweep of
 * NowScreen.tsx: they live in muscles.ts, not the screen file at all.
 */
describe('the exercise recommender speaks the chosen language', () => {
  const src = code(read('src/domain/muscles.ts'));

  test('recommendNext takes a language and never returns a bare English reason', () => {
    assert.match(src, /lang: Language = 'en'/);
    for (const key of [
      'reasonHeavyOverlap', 'reasonNotFatigued', 'reasonFinishesCompound',
      'reasonAfterHeavyWork', 'reasonFreshMuscle'
    ]) {
      assert.match(src, new RegExp(`t\\(lang, '${key}'\\)`), `${key} is not referenced`);
    }
    assert.doesNotMatch(src, /reason = '[a-z]/, 'a reason is still a raw English literal');
  });

  test('the one caller outside the domain layer passes the current language', () => {
    // By behaviour rather than by matching now-model.ts (R678 review): a Spanish
    // lifter's NEXT chip after bench gives its reason in Spanish.
    const at = Date.UTC(2026, 8, 22, 12);
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => at);
    repo.setPref(PREF_LANG, 'es');
    const m = new NowModel(repo, () => at, 'es-ES');
    m.setPlan('ppl');
    m.setDay('push');
    m.log();
    const next = m.state().dayRail.find(l => l.suggested);
    assert.equal(next?.reason, t('es', 'reasonFinishesCompound'));
  });
});

/*
 * R155/R156 both named Progress and Settings as the two screens no language
 * round had touched. Same shapes as everywhere else: bare literals in
 * `setNote(...)`, an `accessibilityLabel="..."`, and mixed literal+
 * interpolation in the hidden-lift-count note and the jump-buttons help text.
 */
describe('Progress and Settings speak the chosen language too', () => {
  const progress = code(read('app/progress.tsx'));
  const settings = code(read('app/settings.tsx'));

  test('Progress has no bare English literal left', () => {
    assert.doesNotMatch(progress, /'Everything erased\.'/);
    assert.doesNotMatch(progress, /accessibilityLabel="Your measurements"/);
    assert.doesNotMatch(progress, /accessibilityLabel="Settings"/);
    assert.doesNotMatch(progress, /accessibilityLabel="Erase everything on this device"/);
    assert.doesNotMatch(progress, /'Working…'/);
    assert.doesNotMatch(progress, /'A plain JSON file\./);
    assert.doesNotMatch(progress, /more lift/);
  });

  test('Progress routes them through the table', () => {
    for (const key of [
      'everythingErased', 'yourMeasurementsA11y', 'settingsA11y',
      'eraseEverythingA11y', 'workingEllipsis', 'plainJsonFile', 'hiddenLiftsNote'
    ]) {
      assert.match(progress, new RegExp(`T\\('${key}'\\)`), `${key} is not referenced`);
    }
  });

  /*
   * Now the Settings SCREEN, not the jump-amounts sheet that used to open over
   * Progress. R232 deleted that sheet: the owner's overrule (see the note atop
   * `app/settings.tsx`) replaced it with the screen, and it survived as a
   * second control labelled SETTINGS showing different things — including a
   * second copy of the jump fields, which is how R209's fix for an empty
   * number field reached one copy and not the other.
   */
  test('Settings has no bare English literal left', () => {
    assert.doesNotMatch(settings, /accessibilityLabel="Weight jump"/);
    assert.doesNotMatch(settings, /accessibilityLabel="Rep jump"/);
  });

  test('Settings routes them through the table', () => {
    for (const key of ['repJumpA11y', 'jumpMustBeWeight', 'repJumpRange']) {
      assert.ok(settings.includes(key), `${key} is not referenced`);
    }
  });
});

/*
 * `placeholder=` had never been part of any earlier sweep — every prior round
 * chased `accessibilityLabel` and `<Text>` — and it turns out to be its own
 * gap: three TextInput placeholders on NowScreen sat in plain English no
 * matter the setting.
 */
test('no TextInput placeholder is a bare English literal, anywhere in the app', () => {
  const files = ['src/ui/NowScreen.tsx', 'app/progress.tsx', 'app/settings.tsx', 'app/goals.tsx', 'app/measure.tsx'];
  for (const f of files) {
    const bad = [...code(read(f)).matchAll(/placeholder="([A-Z][^"]*)"/g)].map(m => m[1]);
    assert.deepEqual(bad, [], `${f} still hardcodes: ${bad.join(' | ')}`);
  }
});

/*
 * The edit-set sheet's own title, weight-field label and save button had
 * never been swept — every earlier NowScreen round chased
 * `accessibilityLabel=` or a `<Text>{'literal'}</Text>`, and these are a
 * ternary-of-two-literals and a mixed literal+interpolation, the same two
 * shapes R155 first named on Goals. The keys themselves (`addASet`,
 * `editSet`, `logIt`, `saveSet`) already existed in both tables, unused.
 */
test('the edit-set sheet title, weight label and save button are translated', () => {
  const src = code(read('src/ui/NowScreen.tsx'));
  assert.doesNotMatch(src, /'ADD A SET' : 'EDIT SET'/);
  assert.doesNotMatch(src, /WEIGHT \(\{unit/);
  assert.doesNotMatch(src, /'LOG IT' : 'SAVE SET'/);
  assert.match(src, /T\(adding \? 'addASet' : 'editSet'\)/);
  assert.match(src, /T\('weightUnitLabel'\)/);
  assert.match(src, /T\(adding \? 'logIt' : 'saveSet'\)/);
});

/*
 * The lb/kg chip's accessibility label, and the entire 404 screen — reachable
 * only from a stale share link (§5), which is exactly the kind of low-traffic
 * corner a language pass keeps skipping because nobody hits it while testing.
 */
test('the unit chips and the not-found screen are translated', () => {
  const settingsSrc = code(read('app/settings.tsx'));
  assert.doesNotMatch(settingsSrc, /'Pounds' : 'Kilograms'/);
  assert.match(settingsSrc, /t\(lang, u === 'lb' \? 'pounds' : 'kilograms'\)/);

  const notFound = code(read('app/+not-found.tsx'));
  assert.doesNotMatch(notFound, /Nothing here/);
  assert.doesNotMatch(notFound, /doesn't go anywhere/);
  assert.doesNotMatch(notFound, /GO TO YOUR WORKOUT/);
  assert.match(notFound, /T\('notFoundTitle'\)/);
  assert.match(notFound, /T\('notFoundBody'\)/);
  assert.match(notFound, /T\('goToWorkout'\)/);
});

/*
 * The hidden-lifts footer's own fix (R158) introduced a grammar bug: Spanish
 * "entrenados" was baked into the sentence template as an invariant plural,
 * so a single hidden lift read "1 ejercicio más entrenadOS" — the wrong
 * number agreeing with a subject of one. Fixed by folding the participle
 * into the already-pluralised word key instead of the shared template.
 */
test('the hidden-lifts note agrees in number, in both languages', () => {
  const one = fill(t('es', 'hiddenLiftsNote'), { n: 1, lift: t('es', 'hiddenLiftWord') });
  assert.match(one, /1 ejercicio más entrenado,/);
  assert.doesNotMatch(one, /entrenados/);

  const many = fill(t('es', 'hiddenLiftsNote'), { n: 3, lift: t('es', 'hiddenLiftsWord') });
  assert.match(many, /3 ejercicios más entrenados,/);
});

/*
 * Four more places the Goals screen names a count in a full sentence rather
 * than a bare number beside a fixed label — filterCountA11y, wipeAllTitle,
 * wipeAllA11y, goalsWiped — all reachable at n=1 (the filter chip counts can
 * be one, and "wipe all" is offered the moment a single goal exists), and all
 * previously plural-only in both languages: "OPEN, 1 goals" / "Wipe all 1
 * goals?" / "1 goals wiped." read wrong regardless of which language was
 * chosen, which the earlier language-completeness sweeps had no way to catch
 * since the sentence was never MISSING, only ungrammatical at one count.
 */
test('goal counts agree in number at exactly one, in both languages', () => {
  for (const lang of ['en', 'es'] as const) {
    const one = fill(t(lang, 'filterCountA11yOne'), { label: 'X', n: 1 });
    assert.doesNotMatch(one, / 1 (goals|metas)\b/, `${lang} filter count`);
    const title = fill(t(lang, 'wipeAllTitleOne'), { n: 1 });
    assert.doesNotMatch(title, / 1 (goals|metas)\b/, `${lang} wipe-all title`);
    const a11y = fill(t(lang, 'wipeAllA11yOne'), { n: 1 });
    assert.doesNotMatch(a11y, / 1 (goals|metas)\b/, `${lang} wipe-all a11y`);
    assert.doesNotMatch(t(lang, 'goalsWipedOne'), / 1 (goals|metas)\b/, `${lang} wiped toast`);
  }
});

/*
 * Two more of the same shape, found by checking every `{n}`-carrying key
 * against its call site's actual range rather than assuming a fixed-plural
 * template is safe. `weeksRunning` and `showAllReadingsA11y` turned out to be
 * gated (`streak >= 2`, `count > 1`) and were left alone — adding a singular
 * variant nothing can ever select would just be a second kind of dead key,
 * the thing R166 had just finished removing. `wipeGoalLeft` (a goal's own
 * days-left count) and `inDaysDash` (a user-typed day horizon) are NOT gated
 * and both read wrong at one in both languages before this fix.
 */
test('a goal with exactly one day left, and a one-day horizon, both read correctly', () => {
  for (const lang of ['en', 'es'] as const) {
    assert.doesNotMatch(t(lang, 'wipeGoalLeftOne'), / 1 (days|días)\b/, `${lang} wipe-goal days left`);
    const horizon = fill(t(lang, 'inDaysDashOne'), { date: 'X' });
    assert.doesNotMatch(horizon, / 1 (days|días)\b/, `${lang} one-day horizon`);
    assert.match(horizon, / — X$/, `${lang} still shows the date`);
  }
});

test('goals.tsx picks the singular key at exactly one day', () => {
  const src = code(read('app/goals.tsx'));
  assert.match(src, /wiping\.daysLeft === 1 \? T\('wipeGoalLeftOne'\)/);
  assert.match(src, /T\(inDays === 1 \? 'inDaysDashOne' : 'inDaysDash'\)/);
});

/*
 * `app/settings.tsx` — the PPL/units/language tab, a different file from
 * `SettingsSheet.tsx` (already covered) — had never been swept: the split
 * picker's accessibility label read straight from the domain's raw
 * `PLAN_LABEL` record, the jump-amount errors were untranslated AND, for reps,
 * factually wrong (it said "a whole number" when the real constraint is 1-12,
 * the same range `SettingsSheet.tsx` already states correctly), and the
 * "reps" unit label was a bare lowercase literal.
 */
test('the settings tab has no hardcoded English left in its jump fields or plan chips', () => {
  const src = code(read('app/settings.tsx'));
  assert.doesNotMatch(src, /PLAN_LABEL\[p\]/);
  assert.doesNotMatch(src, /A jump has to be a real weight/);
  assert.doesNotMatch(src, /A rep jump has to be a whole number/);
  assert.doesNotMatch(src, /accessibilityLabel=\{`Weight jump in/);
  assert.doesNotMatch(src, /accessibilityLabel="Rep jump"/);
  assert.doesNotMatch(src, />reps<\/Text>/);
  assert.match(src, /t\(lang, PLAN_KEY\[p\]\)/);
  assert.match(src, /jumpMustBeWeight/);
  assert.match(src, /t\(lang, 'repJumpRange'\)/);
  assert.match(src, /weightJumpUnitA11y/);
  assert.match(src, /t\(lang, 'repJumpA11y'\)/);
  assert.match(src, /t\(lang, 'repsWord'\)/);
});

/*
 * The day chooser's plan blurb — the plain-language sentence that explains
 * what "Push/Pull/Legs" actually means for someone who has never lifted
 * (§6) — was read straight from the domain's English `PLAN_BLURB` record on
 * BOTH the visible `<Text>` and the accessibility label. Neither is caught by
 * a sweep for `accessibilityLabel="[A-Z]` or a literal `<Text>` string, since
 * both read from an id-keyed record — the exact shape that first hid the
 * equipment names, five screens ago.
 */
test('the plan blurb on the first-run screen is translated, not read from the domain record', () => {
  const src = code(read('src/ui/NowScreen.tsx'));
  assert.doesNotMatch(src, /PLAN_BLURB\[p\]/);
  assert.doesNotMatch(src, /PLAN_LABEL\[p\]/);
  assert.match(src, /T\(PLAN_BLURB_KEY\[p\]\)/);
  assert.match(src, /\$\{T\(PLAN_KEY\[p\]\)\}\. \$\{T\(PLAN_BLURB_KEY\[p\]\)\}/);
});

/*
 * The exercise-picker sheet's day heading — "PUSH DAY" over the rail — read
 * `` `${SPLIT_LABEL[state.day]} DAY` ``: an id-keyed record for the word plus
 * a hardcoded English suffix, the same two-shapes-in-one-line pattern as the
 * settings jump field. `DAY_TITLE_KEY` already existed with exactly this
 * shape pre-composed ('PUSH DAY' / 'DÍA DE EMPUJE') and was simply unused here.
 */
test('the picker sheet day heading is translated, not built from SPLIT_LABEL', () => {
  const src = code(read('src/ui/NowScreen.tsx'));
  assert.doesNotMatch(src, /SPLIT_LABEL\[state\.day\]/);
  assert.doesNotMatch(src, /import \{ SPLIT_LABEL \}/);
  assert.match(src, /T\(DAY_TITLE_KEY\[state\.day\]\)/);
});

test('the recap screen has no hardcoded accessibility label left', () => {
  const src = code(read('app/recap.tsx'));
  assert.doesNotMatch(src, /accessibilityLabel="Reopen this workout/);
  assert.match(src, /accessibilityLabel=\{T\('reopenA11y'\)\}/);
});

test('the goals screen picks the singular key at exactly one', () => {
  const src = code(read('app/goals.tsx'));
  assert.match(src, /counts\[f\] === 1 \? 'filterCountA11yOne' : 'filterCountA11y'/);
  assert.match(src, /goals\.length === 1 \? 'wipeAllA11yOne' : 'wipeAllA11y'/);
  assert.match(src, /goals\.length === 1 \? 'wipeAllTitleOne' : 'wipeAllTitle'/);
  assert.match(src, /goals\.length === 1 \? T\('goalsWipedOne'\)/);
});

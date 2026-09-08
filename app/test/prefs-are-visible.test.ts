import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { displayUnit } from '../src/ui/display-unit.ts';
import { progressRows, recentSessions } from '../src/ui/progress-model.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 9, 12);

/** Twelve consecutive training days, so every path a preference feeds is live. */
function seeded(): Repo {
  const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
  let n = 0;
  for (let d = 12; d >= 1; d--) {
    const at = T0 - d * DAY, id = `d${d}`;
    repo.startSession(id, 'lb');
    for (const ex of ['bench', 'squat']) {
      for (let s = 0; s < 3; s++) {
        repo.logSet({ id: `x${n++}`, sessionId: id, exerciseId: ex, weight: 185, reps: 5, at: at + s * 60_000 });
      }
    }
    repo.endSession(id, at + 3600_000);
  }
  return repo;
}

function nowView(repo: Repo): string {
  const s = new NowModel(repo, () => T0, 'en-US').state();
  return JSON.stringify({
    lastTime: s.lastTime, weight: s.weight, reps: s.reps,
    plateJump: s.plateJump, repJump: s.repJump, planDay: s.planDay,
    rail: s.dayRail.map(r => r.name), exercise: s.exercise.name
  });
}

function progressView(repo: Repo): string {
  return JSON.stringify({
    unit: displayUnit(repo),
    rows: progressRows(repo, T0).map(r => r.best),
    recent: recentSessions(repo, 3).map(s => s.volume)
  });
}

/*
 * R520, for OWNER.md #3: "goals, units, split, jump amounts and history should
 * visibly shape what the app shows, not just what it stores".
 *
 * The audit behind this file found the premise does NOT currently hold against
 * the app — every stored preference does change something a lifter can see. So
 * this is not a fix; it is the gate that keeps the answer true, because the
 * failure it describes is one this codebase has actually had. `display-unit.ts`
 * records it: the unit preference had two readers and no shared definition, so
 * Now honoured the Settings choice and Progress, Goals and the weekly line
 * ignored it, and a lifter who switched to kilograms saw 79.5 KG on one screen
 * and 175 lb on another, for months.
 *
 * Each preference has to be DEMONSTRATED, not asserted: flip it and show a
 * rendered view changes. Writing that audit by hand produced four false
 * results in a row — a fixture with no machine, a fixture where the coach was
 * silent, a live session whose unit a display preference cannot change, and a
 * `machine` field silently dropped because `equipment` was not set — and every
 * one of them looked exactly like "the app is broken". So each case below
 * carries a PRECONDITION proving the path it feeds is live before the
 * comparison is allowed to mean anything.
 */
describe('every stored preference visibly changes the app (R520)', () => {
  interface Case {
    key: string;
    value: string;
    /** Proof the path this feeds is live in the fixture; '' means it is not. */
    precondition(repo: Repo): string;
    view(repo: Repo): string;
  }

  const CASES: Record<string, Case> = {
    'pref.unit': {
      key: 'pref.unit', value: 'kg',
      // Deliberately NOT the Now screen: a live session keeps the unit it was
      // started in, which is documented behaviour and not a defect.
      precondition: r => (progressRows(r, T0).length ? 'progress has rows' : ''),
      view: progressView
    },
    'pref.language': {
      key: 'pref.language', value: 'es',
      /*
       * Found by the derived scan below, not by me — my hand-written audit
       * covered six preferences and never noticed this one, which is the
       * argument for deriving the list in one line.
       *
       * And it is the case with the best claim to be here: `languageOf`'s own
       * docstring records that this setting once "translated nothing but
       * itself" — Settings read it and the four screens a lifter actually uses
       * hardcoded English, so choosing Espanol gave AJUSTES and then LOG SET,
       * with the Spanish strings sitting unused in the table. That is exactly
       * the failure OWNER.md #3 describes, and it has already happened here.
       */
      precondition: r => new NowModel(r, () => T0, 'en-US').state().lastTime.head,
      view: nowView
    },
    'split.plan': {
      key: 'split.plan', value: 'upper-lower',
      precondition: r => new NowModel(r, () => T0, 'en-US').state().planDay ?? '',
      view: nowView
    },
    'jump.lb': {
      key: 'jump.lb', value: '10',
      precondition: r => String(new NowModel(r, () => T0, 'en-US').state().plateJump),
      view: nowView
    },
    'jump.reps': {
      key: 'jump.reps', value: '2',
      precondition: r => String(new NowModel(r, () => T0, 'en-US').state().repJump),
      view: nowView
    },
    'pref.goal': {
      key: 'pref.goal', value: 'consistency',
      // The coach must actually be speaking, or both sides are the same silence.
      precondition: r => {
        const head = new NowModel(r, () => T0, 'en-US').state().lastTime.head;
        return /Last time|First time|Just did/.test(head) ? '' : head;
      },
      view: nowView
    }
  };

  for (const [name, c] of Object.entries(CASES)) {
    test(`${name} changes what a screen renders`, () => {
      const repo = seeded();
      const live = c.precondition(repo);
      assert.notEqual(live, '',
        `the fixture never exercises ${name}, so this comparison would pass ` +
        'whether the preference worked or not');
      const before = c.view(repo);
      repo.setPref(c.key, c.value);
      assert.notEqual(c.view(repo), before,
        `${name} was stored and changed nothing a lifter can see`);
    });
  }

  test('and every preference the code defines is demonstrated here', () => {
    /*
     * The part that keeps this honest as the app grows: the list is DERIVED
     * from the source, so a new preference either gets a demonstration or
     * fails the suite. A hand-kept list would quietly stop covering things,
     * which is the same defect this file is about, one level up.
     */
    const keys = new Set<string>();
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        const src = fs.readFileSync(full, 'utf8');
        for (const m of src.matchAll(/getPref\(\s*['"`]([a-z][\w.]*)['"`]/gi)) keys.add(m[1]);
        for (const m of src.matchAll(/PREF_\w+ = '([^']+)'/g)) keys.add(m[1]);
      }
    };
    walk(path.join(APP, 'src'));
    walk(path.join(APP, 'app'));

    assert.ok(keys.size >= 5, `only found ${keys.size} preference keys; the scan is not reading them`);

    /*
     * `pref.skipMachineName` is exempt and this is the only exemption. It never
     * passes through NowModel.state() — NowScreen reads it straight from the
     * repo and hands it to the equipment sheet — so there is no rendered view
     * here to diff. Its visibility is pinned at the point it is used instead.
     */
    const EXEMPT = new Map([
      /*
       * An EXPERIMENT, not a shipped preference (OWNER.md, 2026-09-08): the
       * owner asked to see a tab-bar variant and the current screen side by
       * side and to choose from the pictures, so it is off and neither is the
       * default. It does change the app visibly — that is the entire point of
       * it — but demonstrating that here would assert an interface the owner
       * has not agreed to keep. Removes when they choose: it either becomes a
       * real preference with a case above, or it and the variant are deleted.
       */
      ['pref.tabBar', 'an unchosen experiment; see OWNER.md 2026-09-08'],
      ['pref.skipMachineName',
      'read directly by NowScreen for the equipment sheet, never via state()']]);
    for (const key of keys) {
      if (EXEMPT.has(key)) continue;
      assert.ok(key in CASES,
        `${key} is stored but nothing here shows it changing the app — add a case ` +
        'or an exemption with a reason');
    }
    for (const [key] of EXEMPT) {
      assert.ok(keys.has(key), `${key} is exempted but no longer exists; drop the exemption`);
      assert.match(fs.readFileSync(path.join(APP, 'src', 'ui', 'NowScreen.tsx'), 'utf8'),
        /skipMachine=\{repo\.getPref\(PREF_SKIP_MACHINE\) === '1'\}/,
        'the exemption claims NowScreen reads this directly, and it no longer does');
    }
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnSource, enclosingBody } from './helpers/fn-source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');
/*
 * All three screen models, not just `now-model` (R543).
 *
 * The gate was written for the file where the seam kept biting, which made it
 * a gate against the defect that already happened. `recap-model` and
 * `progress-model` consume history the same way and were unwatched.
 */
const MODELS = ['now-model', 'recap-model', 'progress-model'].map(name =>
  [name, fs.readFileSync(path.join(SRC, 'ui', `${name}.ts`), 'utf8')] as const);
const MODEL = MODELS[0][1];

/**
 * Where an imported name comes from, read from the import statements rather
 * than guessed — so moving a function between modules cannot quietly make this
 * gate stop looking.
 */
function moduleOf(src: string, name: string): string | null {
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+'([^']+)'/g)) {
    const names = m[1].split(',').map(s => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim());
    if (names.includes(name)) return m[2];
  }
  return null;
}

/*
 * R542. Four rounds in a row landed on the same seam from different sides:
 * R537 (the coach read a kilogram history as pounds), R538 (converting for
 * `goalProgress` converts twice and reports a goal as met), R539 (the PR cache),
 * R541's neighbour. Every one of them was one line in `now-model`, and the rule
 * separating a correct line from a wrong one was never written down anywhere a
 * test could read.
 *
 * It is a simple rule, and it is derivable rather than a list (HANDOFF #13):
 *
 *   a function handed RAW `allSets()` must either never read a weight,
 *   or take `sessionUnits` and convert them itself.
 *
 * Raw history mixes units, because a `LoggedSet` carries no unit — the SESSION
 * owns it. So a consumer that compares weights across sessions without the map
 * is comparing 86 kg against 185 lb and calling one of them bigger.
 *
 * The population is derived from the source: every `allSets()` call in
 * now-model, resolved to its callee, checked against the callee's own body.
 * A NEW consumer added tomorrow is therefore covered without anybody
 * remembering to add it here — which is the whole point, since not remembering
 * is exactly what happened four times.
 */
describe('every raw-history consumer is unit-safe (R542)', () => {
  /**
   * The name of the call that ENCLOSES the character at `i`, found by walking
   * backwards over balanced parentheses.
   *
   * The first version of this matched `f(rawSource` with a regex and missed
   * `findPRs` — the most important consumer in the file — because raw history
   * reaches it as the SECOND argument. A gate whose scan silently covers less
   * than it claims is the failure this whole round is about, so the position of
   * the argument had to stop mattering.
   */
  function enclosingCall(src: string, i: number): string | null {
    let depth = 0;
    for (let j = i - 1; j >= 0; j--) {
      const c = src[j];
      /*
       * Stop at a statement boundary. Without this the walk runs out of the
       * statement entirely and returns whatever call happened to appear
       * earlier in the file — which is not a near miss: it reported
       * `sessionStats` for five bare assignments like
       * `const all = this.repo.allSets();`, and I spent a round-quarter
       * investigating a consumer the scan had invented. A raw source that is
       * not an argument to anything has no enclosing call, and null says so.
       */
      if (depth === 0 && (c === ';' || c === '{' || c === '}')) return null;
      if (c === ')') depth++;
      else if (c === '(') {
        if (depth === 0) {
          const name = /([A-Za-z_$][\w$]*)\s*$/.exec(src.slice(Math.max(0, j - 60), j));
          return name ? name[1] : null;
        }
        depth--;
      }
    }
    return null;
  }

  /**
   * Every expression in `now-model` that yields UNCONVERTED history.
   *
   * `allSets()` is the obvious one and was the only one the first draft knew
   * about. `historyBefore` comes straight off the same table, and `setsFor` is
   * R525's per-exercise bucket of `allSets()` — both are exactly as unit-mixed,
   * and one of them is how `findPRs` is fed.
   *
   * `setsInSession` is NOT here, and the reason is the rule rather than an
   * exemption. The hazard is never "raw" on its own; it is comparing weights
   * across SESSIONS, because the session is what owns the unit. One session's
   * sets are unit-uniform by construction, so there is nothing to convert.
   *
   * `sessionStats` is the function that made the distinction worth writing
   * down: it reads weights out of raw sets and is correct, because it is fed
   * one session's and takes that session. The test below pins that reason, so
   * the exemption cannot outlive it (R526: a stated reason is necessary and is
   * not sufficient; the reason has to be true).
   */
  /*
   * Built with String.raw and `new RegExp`, not written as literals carrying
   * a word-boundary escape. Composing these through anything that re-escapes
   * turns that escape into a real BACKSPACE byte, and the pattern becomes one
   * that can never match — so the gate scans nothing and passes. That is what
   * happened here, in the file that carries the warning about it, and the only
   * thing that noticed was the "the scan finds the call sites it is supposed
   * to" test below. That test exists for exactly this, and it is the whole
   * difference between a detour and a shipped no-op.
   */
  const RAW = [
    new RegExp(String.raw`\brepo\.allSets\(\)`, 'g'),
    new RegExp(String.raw`\brepo\.historyBefore\(`, 'g'),
    new RegExp(String.raw`\bthis\.setsFor\(`, 'g')
  ];

  function rawConsumers(MODEL: string): string[] {
    const names = new Set<string>();
    for (const pattern of RAW) {
      for (const m of MODEL.matchAll(pattern)) {
        const name = enclosingCall(MODEL, m.index!);
        if (name) names.add(name);
      }
    }
    // Locals assigned straight from allSets(), then passed on — `openingExercise`
    // does this, and matching only the inline form would miss it.
    for (const a of MODEL.matchAll(/const (\w+) = (?:this\.)?repo\.allSets\(\);/g)) {
      // Only inside the method that made the binding (R543). `now-model` has
      // two methods each opening `const all = ...`, one raw and one converted,
      // so a file-wide name match reported `prefillFor` — which is handed the
      // converted form — as a raw consumer.
      const [from, to] = enclosingBody(MODEL, a.index!);
      const scope = MODEL.slice(from, to);
      // Built with String.raw, not a plain template: a `\w` in an ordinary
      // template literal survives the file but a `\b` becomes a real backspace
      // (HANDOFF trap 7), and the pattern then matches nothing while looking
      // exactly right — a gate that reads zero call sites and passes.
      const call = new RegExp(String.raw`(\w+)\(\s*` + a[1] + String.raw`\b`, 'g');
      for (const m of scope.matchAll(call)) names.add(m[1]);
    }
    for (const own of ['allSets', 'historyBefore', 'setsFor', 'filter', 'if', 'for', 'map', 'some']) {
      names.delete(own);
    }
    return [...names];
  }

  test('the scan finds the call sites it is supposed to', () => {
    // A gate that reads nothing passes for ever. R529 and R536 both shipped one.
    const found = rawConsumers(MODEL);
    assert.ok(found.length >= 4, `only ${found.length} raw-history consumers found: ${found.join(', ')}`);
    for (const expected of ['findPRs', 'weekStreak', 'pickerFor']) {
      assert.ok(found.includes(expected), `the scan missed ${expected}; its pattern has drifted`);
    }
  });


  test('the setsInSession exemption is true, not just stated', () => {
    /*
     * `sessionStats` is handed raw sets and reads weights, and this gate does
     * not flag it — because those sets all belong to ONE session, which is
     * where the unit lives. That is only sound while it keeps taking the
     * session itself, so that is what gets pinned. If it ever starts accepting
     * sets from more than one, the exemption above is wrong and this fails.
     */
    const SESSION = fs.readFileSync(path.join(SRC, 'domain', 'session.ts'), 'utf8');
    const stats = fnSource(SESSION, 'sessionStats');
    assert.match(stats, /session: Session/,
      'sessionStats no longer takes the session it is summarising, so nothing ' +
      'ties its sets to a single unit and it needs sessionUnits like the rest');
    for (const call of MODEL.matchAll(/sessionStats\(([^,]+),/g)) {
      assert.doesNotMatch(call[1], /allSets|historyBefore|setsFor/,
        `sessionStats is being handed history from more than one session: ${call[0]}`);
    }
  });

  test('each one either ignores weights or takes sessionUnits', () => {
    const bad: string[] = [];
    for (const [model, src] of MODELS) for (const name of rawConsumers(src)) {
      const mod = moduleOf(src, name);
      if (!mod || !mod.startsWith('.')) continue;   // a method on this class, or a builtin
      const file = path.join(SRC, 'ui', mod).replace(/\.ts$/, '.ts');
      if (!fs.existsSync(file)) continue;
      let body: string;
      try { body = fnSource(fs.readFileSync(file, 'utf8'), name); } catch { continue; }
      const readsWeight = /\.weight\b/.test(body);
      const unitAware = /sessionUnits/.test(body);
      if (readsWeight && !unitAware) {
        bad.push(`${model}: ${name} (${mod}) compares weights from raw history without sessionUnits`);
      }
    }
    assert.deepEqual(bad, [],
      'a consumer is being handed a history that mixes kilograms and pounds: ' + bad.join(' | '));
  });

  test('the check can actually tell the two apart', () => {
    /*
     * The gate above passes today, which means it has never been seen to fail
     * — and a rule nobody has watched reject anything is not yet a rule. So:
     * two real functions from this repo, one of each kind.
     */
    const pr = fnSource(fs.readFileSync(path.join(SRC, 'domain', 'pr.ts'), 'utf8'), 'findPRs');
    assert.ok(/\.weight\b/.test(pr) && /sessionUnits/.test(pr),
      'findPRs is the unit-aware exemplar and no longer looks like one');

    const streak = fnSource(fs.readFileSync(path.join(SRC, 'domain', 'session.ts'), 'utf8'), 'weekStreak');
    assert.ok(!/\.weight\b/.test(streak),
      'weekStreak now reads weights, so it needs sessionUnits like the rest');
    assert.ok(/\.weight\b/.test(fs.readFileSync(path.join(SRC, 'domain', 'session.ts'), 'utf8')),
      'session.ts reads no weights at all, so this test is no longer proving that ' +
      'the check is per-function rather than per-module');
  });
});

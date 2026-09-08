import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const UI_DIR = path.join(ROOT, 'app', 'src', 'ui');

/*
 * R454's structural fix, per the peer's ask: the render-side completeness
 * check (recap-fields-reach-consumers.test.ts) derives its field list from
 * `RecapPayload`'s own source and found a fourth gap on its first run. This
 * is the same technique aimed at the mechanism that produced R454's bug.
 *
 * This is the house pattern for "every X must do Y", named in HANDOFF.md's
 * traps list (#13) alongside its sibling recap-fields-reach-consumers.test.ts:
 * derive the population from source rather than hand-listing it, exempt
 * explicitly with a stated reason, and prove the gate can fail before
 * trusting it (this file's own bug-planting run is in R455). Read that entry
 * before writing a third instance of this shape.
 *
 * `display-unit.ts`'s own header comment already describes fixing this once
 * — Progress, Goals and the weekly comparison each read `lastUsedUnit() ??
 * 'lb'` and ignored the Settings choice. `progressRows` got the fix and a
 * test for it. `recentSessions` — a SIBLING function, built later, returning
 * the identical shape of claim ("here is a number, and the unit it is in") —
 * never called `displayUnit` at all, and nothing caught it because the
 * existing test was written for `progressRows` specifically, not for the
 * CLASS of function `progressRows` belongs to.
 *
 * The class, derived rather than hand-listed: any exported function in
 * `src/ui/` whose return type is an interface carrying a `unit: Unit` field.
 * That field is the function's own claim about what unit its numbers are
 * in — the same role `RecapPayload`'s fields play for the render sweep. A
 * function making that claim without deriving it from `displayUnit()` is
 * either wrong (recentSessions' shape) or has a specific, statable reason
 * the raw unit is correct (a goal draft holding what the USER typed, a
 * domain type describing what was STORED) — and that reason belongs in the
 * exemption list below, named and justified, not silently assumed.
 */

const EXEMPT: Record<string, string> = {
  // `Session` and `Goal` are storage types — `unit` here is what was
  // actually logged or set, and MUST stay raw. `displayUnit()` in a domain
  // storage type would corrupt the record it is supposed to describe.
  'domain/types.ts': 'storage type — Session.unit is what was logged, not a display concern',
  'domain/session.ts': 'RecapPayload and friends carry the SESSION\'s own unit for its own recap; the render layer (recap.tsx/spike/recap.js) decides display, not this file',
  'domain/goals.ts': 'Goal is a storage type — unit is what the target was SET in',
  // `GoalDraft` is what the user is actively TYPING into a goal-creation
  // sheet — their own live choice, not a computed display value.
  'ui/goals-model.ts': 'GoalDraft.unit is the user\'s own live input, not a computed display unit'
};

function findInterfacesWithUnitField(src: string): string[] {
  const names: string[] = [];
  const re = /export interface (\w+)\s*\{([^}]*)\}/gs;
  let m;
  while ((m = re.exec(src))) {
    if (/\bunit:\s*Unit\b/.test(m[2])) names.push(m[1]);
  }
  return names;
}

/** The body of a top-level exported function, matched by brace depth. */
function functionBody(src: string, name: string): string | null {
  const anchor = `export function ${name}(`;
  const start = src.indexOf(anchor);
  if (start < 0) return null;
  const bodyStart = src.indexOf('{', src.indexOf(')', start));
  if (bodyStart < 0) return null;
  let depth = 0, i = bodyStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(bodyStart, i + 1);
}

describe('every function returning a unit: Unit claim derives it from displayUnit()', () => {
  const files = fs.readdirSync(UI_DIR).filter(f => /\.ts$/.test(f) && f !== 'display-unit.ts');

  test('the scan still finds the two known cases — a sanity floor', () => {
    const src = fs.readFileSync(path.join(UI_DIR, 'progress-model.ts'), 'utf8');
    const names = findInterfacesWithUnitField(src);
    assert.ok(names.includes('ProgressRow') && names.includes('SessionSummary'),
      `expected ProgressRow and SessionSummary, got [${names.join(', ')}] — did the anchor break?`);
  });

  for (const file of files) {
    const src = fs.readFileSync(path.join(UI_DIR, file), 'utf8');
    const interfaceNames = findInterfacesWithUnitField(src);
    if (!interfaceNames.length) continue;

    for (const iface of interfaceNames) {
      // Which exported function(s) return this interface (directly, or as an
      // array of it) — a function CONSTRUCTS the claim, an interface only
      // states its shape.
      const returnRe = new RegExp(
        `export function (\\w+)\\([^)]*\\):\\s*${iface}(\\[\\])?\\s*\\{`, 'g');
      let rm;
      let found = 0;
      while ((rm = returnRe.exec(src))) {
        found++;
        const fnName = rm[1];
        test(`${file}: ${fnName}() (returns ${iface}) calls displayUnit()`, () => {
          const exemptReason = EXEMPT[`ui/${file}`];
          const body = functionBody(src, fnName);
          assert.ok(body, `could not extract ${fnName}'s body — anchor broke`);
          if (exemptReason) return; // recorded, not silently skipped — see EXEMPT above
          assert.match(body!, /displayUnit\(/,
            `${fnName} returns ${iface} (which carries "unit: Unit") but never calls displayUnit() — ` +
            `this is the exact shape that let recentSessions ship unconverted (R454)`);
        });
      }
      if (found === 0 && !EXEMPT[`ui/${file}`]) {
        test(`${file}: something constructs ${iface} — anchor sanity`, () => {
          assert.ok(false,
            `${iface} declares a unit: Unit field but no exported function in ${file} returns it via ` +
            `an explicit "): ${iface}" annotation — either the anchor regex broke, or this interface ` +
            `needs its own EXEMPT entry with a stated reason`);
        });
      }
    }
  }
});

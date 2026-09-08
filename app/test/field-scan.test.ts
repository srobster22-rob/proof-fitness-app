import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const TOOL = path.join(APP, 'tools', 'field-scan.cjs');

function scan(): { out: string; code: number } {
  try {
    return { out: execFileSync('node', [TOOL], { cwd: APP, encoding: 'utf8' }), code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    return { out: err.stdout ?? '', code: err.status ?? -1 };
  }
}

/*
 * `orphan-scan.cjs` gates the FUNCTION level; this gates one below it — a
 * field on a data-shape interface that a model computes and returns and no
 * screen (or downstream domain function) ever reads. Same class of waste as
 * `reachedAt` before R267 and `bestAt`/`trendSince` before R292/R293, found
 * by hand five times this session before this made the question mechanical.
 *
 * Runs every `npm test`, same contract as orphan-scan.cjs: exits non-zero
 * for anything NEW, so a fresh dead field cannot ship unnoticed the way this
 * whole thread's earlier instances did.
 */
describe('every field on a tracked interface is read somewhere, or is acknowledged', () => {
  test('the scan is clean, or names exactly what changed', () => {
    const { out, code } = scan();
    assert.equal(code, 0, 'field-scan wants a decision:\n' + out);
  });

  test('and it examined a real number of interfaces and fields', () => {
    // Same guard as orphan-scan's own test, for the same reason: "clean" and
    // "looked at nothing" print identically unless the count is checked.
    const { out } = scan();
    const m = out.match(/scanned (\d+) interfaces, (\d+) fields/);
    assert.ok(m, 'the scan no longer reports how much it read');
    assert.ok(Number(m![1]) >= 5, `only ${m![1]} interfaces scanned — the scan is looking at almost nothing`);
    assert.ok(Number(m![2]) >= 50, `only ${m![2]} fields scanned — the scan is looking at almost nothing`);
  });

  test('a field read only in the SAME file as its interface still counts as used', () => {
    // The false positive this tool caught on itself the day it was written:
    // cutting the whole defining file out (rather than just the interface
    // block) made `bestAt`/`trendSince` read as unused, because their real
    // readers — `bestSetA11y`, `trendA11y` — live right below the interface
    // in progress-model.ts, not in a screen file.
    const src = readFileSync(TOOL, 'utf8');
    assert.match(src, /prodMinusInterface/,
      'the scan must exclude only the interface BLOCK, not the whole defining file');
  });

  test('a field matches only by dot-access, never by its own colon-form write', () => {
    // The other false positive caught on day one: `lastTrainedAt: tops.length
    // ? ...` — the field's own WRITE inside the object literal that builds
    // it — satisfied a colon-form regex and read as "used" by itself.
    const src = readFileSync(TOOL, 'utf8');
    const block = region(src, "const re = new RegExp('\\\\.' + f", 'orphans.push');
    assert.doesNotMatch(block, /\[\{,\]/,
      'a colon-form (destructure-shaped) pattern is back — it will match the field\'s own write site');
  });

  test('a field touched only via assignment (+=, ++, =) does not count as read', () => {
    // R301: `\.field\b` alone matches `row.field += 1` exactly as readily as
    // a real read — calibrated in by hand against a canary field that was
    // only ever compound-assigned, never read, and passed clean until this
    // was fixed. At least one occurrence has to NOT be a write.
    const src = readFileSync(TOOL, 'utf8');
    const block = region(src, "const re = new RegExp('\\\\.' + f", 'orphans.push');
    assert.match(block, /isRead/, 'the write-vs-read split is gone — a write-only field will pass silently again');
  });

  test('the acknowledged list still explains itself', () => {
    const src = readFileSync(TOOL, 'utf8');
    const block = region(src, 'const ACKNOWLEDGED', 'function fields');
    for (const name of ['upNext', 'prefillSource']) {
      assert.ok(block.includes(name), `${name} left the acknowledged list without a note`);
    }
  });
});

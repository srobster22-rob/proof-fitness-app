import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonical, T0 } from '../tools/snapshot.ts';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/*
 * tools/snapshot.ts (R695) is how an ORGANIZE round proves it moved code
 * without changing a decision: its hash must be identical before and after.
 * Before and after are two runs in two processes, so that is what is compared:
 * in two time zones, so the fixed world really is fixed.
 */
describe('the domain snapshot is a stable fingerprint', () => {
  test('two runs of the same code hash the same, section by section, in any time zone', () => {
    const snap = (tz: string) => spawnSync(process.execPath, ['tools/snapshot.ts'], {
      cwd: APP, encoding: 'utf8', env: { ...process.env, TZ: tz, NODE_NO_WARNINGS: '1' }
    });
    const a = snap('UTC'), b = snap('Asia/Tokyo');
    assert.equal(a.status, 0, a.stderr);
    assert.equal(b.stdout, a.stdout, 'the snapshot moved between two runs of the same code');
    const sections = [...a.stdout.matchAll(/^\s+(\w+)\s+[0-9a-f]{16}$/gm)].map(m => m[1]);
    assert.deepEqual(sections, [
      'exports', 'library', 'find', 'coach', 'nowEn', 'nowEs', 'nowPure', 'recaps', 'progress',
      'goals', 'measure', 'lifts', 'data', 'domain', 'ui'
    ]);
  });

  test('an id stamped with the frozen clock becomes its order of appearance; a decision does not', () => {
    const stamp = T0.toString(36);
    const one = canonical({ id: `s_${stamp}_1`, sets: [{ id: `s_${stamp}_2`, weight: 200 }] });
    const two = canonical({ id: `s_${stamp}_7`, sets: [{ id: `s_${stamp}_8`, weight: 200 }] });
    assert.equal(one, two, 'an id counter moved the snapshot');
    assert.notEqual(one, canonical({ id: `s_${stamp}_1`, sets: [{ id: `s_${stamp}_2`, weight: 205 }] }));
  });

  test('a real id that merely has underscores is kept, so a reorder of real ids still shows', () => {
    assert.equal(canonical({ id: 'seated_hamstring_curl' }), '{"id":"seated_hamstring_curl"}');
    assert.notEqual(canonical(['seed_1', 'seed_2']), canonical(['seed_2', 'seed_1']));
  });

  test('key order, Maps and Sets cannot move it', () => {
    assert.equal(canonical({ b: 1, a: new Set([1, 2]) }), canonical({ a: new Set([1, 2]), b: 1 }));
    assert.equal(canonical(new Map([['x', 1]])), '[["x",1]]');
  });
});

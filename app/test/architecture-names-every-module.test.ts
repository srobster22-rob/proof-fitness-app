import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measure } from '../tools/sizes.mjs';

const MAP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ARCHITECTURE.md');

/*
 * ARCHITECTURE.md (R695, AGENT_LOOP §3a) is the map a round opens before it
 * opens a file. A map that misses a module, names one that is gone, or still
 * says a file is 400 lines after it doubled sends the next round to the wrong
 * place, so it is checked against the source itself.
 */
describe('ARCHITECTURE.md names every module, at its real size', () => {
  const text = fs.readFileSync(MAP, 'utf8').replace(/\r\n/g, '\n');
  const listed = new Map([...text.matchAll(/^\| `((?:src|app)\/[^`]+)` \| ([\d,]+) \|/gm)]
    .map(m => [m[1], Number(m[2].replace(/,/g, ''))] as const));
  const actual = new Map(measure().files.map(f => [f.path, f.lines] as const));

  test('every source file is on the map, and nothing on it is gone', () => {
    assert.deepEqual([...actual.keys()].filter(p => !listed.has(p)), [], 'modules missing from ARCHITECTURE.md');
    assert.deepEqual([...listed.keys()].filter(p => !actual.has(p)), [], 'ARCHITECTURE.md lists modules that no longer exist');
  });

  test('each size is within 15% (or 40 lines) of the file today', () => {
    const drifted = [...listed].filter(([p, n]) => {
      const now = actual.get(p);
      return now !== undefined && Math.abs(now - n) > Math.max(40, 0.15 * now);
    }).map(([p, n]) => `${p}: map says ${n}, file has ${actual.get(p)}`);
    assert.deepEqual(drifted, [], 'regenerate the sizes: node tools/sizes.mjs');
  });

  test('it stays a map, not a manual: at most 200 lines', () => {
    const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    assert.ok(lines <= 200, `ARCHITECTURE.md is ${lines} lines`);
  });
});

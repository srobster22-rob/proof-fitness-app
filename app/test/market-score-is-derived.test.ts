import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMatrix, tables, marketScore, regenerate } from '../tools/market.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/*
 * R679 (AGENT_LOOP v3.2 §2b, COACH.md review 1). MARKET.md's totals and gap values were
 * added up by hand, so a re-scored cell could leave the market score behind it. They now
 * come from `tools/market.ts`, and this holds the committed file to what the script says.
 */

const TINY = [
  '| # | dimension | weight | **PROOF** | our evidence | Big | Small |',
  '|---|---|---|---|---|---|---|',
  '| 1 | Speed | 3 | **4** | H2 | 5 (Live Activity) | 3 |',
  '| 2 | Library | 2 | **1** | CONTENT.md | 2 | 4 (m) |',
  ''
].join('\n');

describe('the market score is computed, never typed (R679)', () => {
  test('sums, scores and gaps follow from the cells', () => {
    const m = parseMatrix(TINY);
    assert.deepEqual(m.comparables, ['Big', 'Small']);
    const t = tables(m, new Map([[2, 'frozen for a reason']]));
    // PROOF 3·4 + 2·1 = 14 of 25; Big 3·5 + 2·2 = 19; Small 3·3 + 2·4 = 17.
    assert.equal(t.score, marketScore(14, m.rows));
    assert.equal(t.score, 56);
    assert.match(t.scores, /\| weighted sum \| 14 \| 19 \| 17 \|/);
    // Row 2's gap is 2 × (4 − 1) = 6, ahead of row 1's 3 × (5 − 4) = 3.
    assert.match(t.gaps, /\| 2 Library \| 2 × \(4 − 1\) = \*\*6\*\* \| frozen for a reason \|\n\| 1 Speed \| 3 × \(5 − 4\) = \*\*3\*\* \| no \|/);
  });

  test('a row with a missing cell is refused, not scored', () => {
    const short = TINY.replace('| 4 (m) |', '|');
    assert.notEqual(short, TINY, 'the fixture lost no cell');
    assert.throws(() => parseMatrix(short), /cells/);
  });

  test('a cell with no score is refused', () => {
    assert.throws(() => parseMatrix(TINY.replace('| 2 | Library | 2 | **1** |', '| 2 | Library | 2 | **n/a** |')), /no 0-5 score/);
  });

  test('MARKET.md carries exactly what its own matrix computes', () => {
    const md = fs.readFileSync(path.join(HERE, '..', '..', 'MARKET.md'), 'utf8');
    assert.ok(regenerate(md) === md, "MARKET.md's scores or gap values are stale: run `node tools/market.ts` in app/");
  });
});

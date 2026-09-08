import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const SKIP = new Set(['node_modules', '.git', '.expo', 'dist', '.export', 'public']);
const EXT = ['.ts', '.tsx', '.js', '.cjs', '.mjs', '.json', '.md'];

/*
 * R503. A backslash escape that collapsed into the raw byte it names.
 *
 * `recap-layout.test.ts` asserted `doesNotMatch(block, /PERSONAL RECORD|\bPR\b/)`
 * -- two things a first-session recap must never say. The `\b` had been eaten
 * somewhere upstream and what reached the file was byte 0x08, a literal
 * BACKSPACE, so the second alternative was `<BS>PR<BS>`: a pattern matching a
 * control character that appears in no rendered text and no source file. Half
 * of that assertion had never once been evaluated.
 *
 * Proven rather than assumed, in both directions. Planting `// PR planted`
 * into recap.tsx's first-session block: with the backspace version the suite
 * passed 32 of 32; with `\b` restored the same plant fails by name. The
 * product was clean either way -- what was broken was the check.
 *
 * This is the third instance of one class in two rounds: R500 wrote a NUL byte
 * as a glob placeholder (invisible, but harmless), and the collapse behind
 * both is a known hazard of the tooling. So the gate below is derived from the
 * DISK rather than from a list of known offenders: any control character in a
 * source file is a mistake, because every one of them can be written as an
 * escape, and a byte a reviewer cannot see is a byte nobody is reviewing.
 *
 * Tab, newline and carriage return are the only ones a text file has business
 * containing.
 */
describe('no source file contains an invisible control character (R503)', () => {
  /** Every source file under app/, minus build output and dependencies. */
  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      if (SKIP.has(e.name)) return [];
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return EXT.includes(path.extname(e.name)) ? [full] : [];
    });
  }

  const files = walk(APP);

  test('there are source files to scan at all', () => {
    // Guard on the instrument: an empty walk would make the scan below pass
    // for free, which is the exact shape of failure this file exists to catch.
    assert.ok(files.length > 200, `only found ${files.length} source files`);
  });

  test('and none of them hides one', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const bytes = fs.readFileSync(file);
      for (let i = 0; i < bytes.length; i++) {
        const c = bytes[i];
        // 0x09 tab, 0x0a newline, 0x0d carriage return are legitimate.
        if (c < 0x09 || (c > 0x0d && c < 0x20) || c === 0x0b || c === 0x0c) {
          const line = bytes.subarray(0, i).toString('utf8').split('\n').length;
          offenders.push(
            `${path.relative(APP, file)}:${line} contains 0x${c.toString(16).padStart(2, '0')}`);
          break;   // one report per file is enough to act on
        }
      }
    }
    assert.deepEqual(offenders, [],
      'a control character reached a source file, almost certainly a backslash ' +
      'escape that collapsed into the byte it names — write it as an escape:\n' +
      offenders.join('\n'));
  });
});

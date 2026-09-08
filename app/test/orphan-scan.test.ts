import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const TOOL = path.join(APP, 'tools', 'orphan-scan.cjs');

function scan(): { out: string; code: number } {
  try {
    return { out: execFileSync('node', [TOOL], { cwd: APP, encoding: 'utf8' }), code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    return { out: err.stdout ?? '', code: err.status ?? -1 };
  }
}

/*
 * The orphan scan runs as part of the suite, so a new one cannot be missed.
 *
 * A tested export with no production caller reads as coverage of a live
 * feature while guarding something the app no longer runs — `armSet` (R176)
 * and `FILTER_LABEL` (R160) both sat that way for rounds. The scanner has
 * existed since R205, but running it was a thing somebody had to remember, and
 * it printed the same five acknowledged names every time, so a genuinely new
 * hit would have arrived at the bottom of a list that always looks the same.
 *
 * It now separates NEW from acknowledged and exits non-zero for anything that
 * needs a decision — including an ACKNOWLEDGED entry that has stopped being an
 * orphan, because a stale exemption is a false claim about the codebase, which
 * is the failure the tool exists to catch.
 */
describe('no tested export has quietly lost its caller', () => {
  test('the scan is clean, or names exactly what changed', () => {
    const { out, code } = scan();
    assert.equal(code, 0,
      'orphan-scan wants a decision:\n' + out);
  });

  /*
   * R483. The scanner listed `src/domain`, `src/ui` and `app` — and `src/`'s
   * THIRD directory, `src/data`, was simply absent, so the tool built to find
   * code with no caller could not see the repo, the database layer or the web
   * driver, while printing "scanned 47 source files" under a clean verdict.
   * The one dead export this project knows about, `resetWebDb`, lives there and
   * was found by a hand grep in R461. Adding the directory took it to 55 files
   * and surfaced two real orphans on the first run.
   *
   * So the list is checked against the FILESYSTEM rather than restated here: a
   * fourth production directory cannot go missing the way the third did, and
   * this fails naming it rather than quietly scanning less.
   */
  test('and it looks in every production source directory', () => {
    const src = readFileSync(TOOL, 'utf8');
    const declared = region(src, 'const DIRS = [', '];');
    const onDisk = readdirSync(path.join(APP, 'src'), { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => 'src/' + d.name);
    assert.ok(onDisk.length >= 3, `only ${onDisk.length} src dirs found — the scan went stale`);
    for (const dir of onDisk) {
      assert.ok(declared.includes(`'${dir}'`),
        `${dir} holds production source and orphan-scan does not read it — ` +
        'every export in it is invisible to the scan, and the summary line ' +
        'would still report a file count that reads as coverage');
    }
  });

  test('and it examined a real number of files', () => {
    // Same guard as R217/R218: "no problems found" and "nothing was examined"
    // produce identical output unless the count is printed.
    const { out } = scan();
    const m = out.match(/scanned (\d+) source files/);
    assert.ok(m, 'the scan no longer reports how much it read');
    assert.ok(Number(m![1]) >= 30,
      `only ${m![1]} source files scanned — the scan is looking at almost nothing`);
  });

  test('tools count as callers, so a dev-tool entry point is not reported dead', () => {
    // `suggestNext` was on the orphan list while `tools/predict-probe.ts` was
    // built around it. A false positive teaches people to skim the output.
    const src = readFileSync(TOOL, 'utf8');
    assert.match(src, /TOOL_DIR/);
    const { out } = scan();
    assert.doesNotMatch(out, /suggestNext/,
      'suggestNext is reported as an orphan despite having a caller in tools/');
  });

  test('the acknowledged list still explains itself', () => {
    // The entries are the record of a decision R205 deliberately left to the
    // owner. An entry without a reason is just a silenced warning.
    const src = readFileSync(TOOL, 'utf8');
    // Through `region` so a moved anchor fails loudly instead of silently
    // reading the wrong part of the file — see source-helper.test.ts.
    const block = region(src, 'const ACKNOWLEDGED', 'const files');
    for (const name of ['missingKeys', 'kindOf', 'columnHeight', 'headline', 'goalE1rmGap']) {
      assert.ok(block.includes(name), `${name} left the acknowledged list without a note`);
    }
    // The owner answered R205 (closed R269): the spec line is superseded and
    // `displayStreak` is deleted, not merely un-flagged.
    assert.doesNotMatch(block, /displayStreak/,
      'displayStreak was deleted (R269) — it should not still be on this list');
  });
});

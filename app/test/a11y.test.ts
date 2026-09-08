import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.join(HERE, '..', ...p.split('/')), 'utf8');

/*
 * Found by auditing the running app rather than by reading the code: the goal
 * TARGET row renders the unit TWICE — once for real and once as an invisible
 * twin on the other side of the number, so the digits sit optically centred
 * instead of the digits-and-unit pair. The technique is right and the execution
 * had a hole: `opacity: 0` removes a node from the screen and leaves it in the
 * accessibility tree, so VoiceOver read the row as "lb, 100, lb".
 *
 * An invisible thing that is only invisible to people who can see is not
 * invisible.
 */
describe('spacers are invisible to everybody', () => {
  test('the goal target ghost is hidden from assistive technology', () => {
    const src = read('app/goals.tsx');
    const ghost = region(src, 'targetUnitGhost]}', '>{unit}</Text>');
    assert.match(ghost, /aria-hidden/, 'web');
    assert.match(ghost, /accessibilityElementsHidden/, 'iOS');
    assert.match(ghost, /importantForAccessibility="no-hide-descendants"/, 'Android');
  });

  /*
   * The standing sweep. Any FUTURE `opacity: 0` used as a layout spacer has the
   * same hole, and the failure is silent to anyone testing by looking — so the
   * rule is enforced across every screen rather than pinned to the one instance
   * that was found.
   *
   * Deliberately narrow: it looks for the literal `opacity: 0` used as a style
   * value, not for the transitional `opacity: 0` inside an entrance animation,
   * which is a different thing and is announced correctly because the node
   * becomes visible a frame later.
   */
  test('and no screen grows another invisible-but-announced element', () => {
    const dirs = ['app', 'src/ui'];
    const offenders: string[] = [];
    // Counted, because the assertion below is `deepEqual(offenders, [])` and an
    // empty sweep satisfies it perfectly. If the extension filter ever goes
    // stale this test reports a clean app while reading no source at all —
    // measured on the sibling sweep in `modal-follows-screen.test.ts`, which
    // went fully green having opened zero files.
    let scanned = 0;
    for (const dir of dirs) {
      const full = path.join(HERE, '..', ...dir.split('/'));
      for (const file of readdirSync(full)) {
        if (!/\.tsx$/.test(file)) continue;
        scanned++;
        const src = readFileSync(path.join(full, file), 'utf8');
        // Style entries whose ONLY declaration is opacity: 0 — a spacer, not a
        // transition (those carry a transform or live inside an animation).
        for (const m of src.matchAll(/(\w+)\s*:\s*\{\s*opacity:\s*0\s*\}/g)) {
          const name = m[1];
          // Is every use of that style accompanied by an aria-hidden nearby?
          const uses = [...src.matchAll(new RegExp(`s\\.${name}\\b`, 'g'))];
          for (const use of uses) {
            const window = src.slice(use.index!, use.index! + 400);
            if (!/aria-hidden/.test(window)) offenders.push(`${dir}/${file}: ${name}`);
          }
        }
      }
    }
    assert.ok(scanned >= 8,
      `only ${scanned} screens were scanned — this test would pass without looking at anything`);
    assert.deepEqual(offenders, [],
      `these are invisible on screen and still announced: ${offenders.join(', ')}`);
  });
});

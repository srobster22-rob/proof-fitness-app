import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TYPE, SPACING } from '../src/ui/type.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOTS = [path.join(HERE, '..', 'app'), path.join(HERE, '..', 'src', 'ui')];

function sources(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const dir of ROOTS) {
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.tsx')) out.push([f, readFileSync(path.join(dir, f), 'utf8')]);
    }
  }
  return out;
}

/*
 * The two uppercase roles keep their own letter-spacing.
 *
 * `type.ts` sets `SPACING.label` against `TYPE.label` and `SPACING.micro`
 * against `TYPE.micro`, and says why: "the two values track the two label
 * sizes so a `micro` label does not end up more widely spaced than a `label`
 * twice its size". Smaller type takes MORE tracking, which is the ordinary
 * typographic rule and the reason micro is the larger number.
 *
 * Four styles had them crossed, and two of those were adjacent on the same
 * row of the Goals card: `cardLift` set an 11pt name at 2.0 tracking while the
 * 10pt CHANGE / WIPE beside it sat at 1.5 — each wearing the other's spacing,
 * so the smaller text was the tighter one. It reads as slightly wrong without
 * being obviously wrong, which is why it survived: nothing is misaligned, the
 * name is simply wider than it should be, and on a 320pt phone that width is
 * taken straight out of the lift's own name.
 */
describe('the uppercase roles keep their matching letter-spacing', () => {
  test('the scale still pairs the way the fix assumes', () => {
    // If these ever converge the whole rule is moot, and this file would be
    // asserting a distinction that no longer exists.
    assert.notEqual(SPACING.label, SPACING.micro);
    assert.ok(SPACING.micro > SPACING.label, 'smaller type should take more tracking');
    assert.ok(TYPE.label > TYPE.micro);
  });

  for (const [name, src] of sources()) {
    test(`${name} never crosses a size with the other role's spacing`, () => {
      // Same declaration, so the regex only has to stay inside one style block.
      const crossed = [
        ...(src.match(/TYPE\.label[^}\n]*SPACING\.micro/g) ?? []),
        ...(src.match(/TYPE\.micro[^}\n]*SPACING\.label/g) ?? []),
        ...(src.match(/SPACING\.micro[^}\n]*TYPE\.label/g) ?? []),
        ...(src.match(/SPACING\.label[^}\n]*TYPE\.micro/g) ?? [])
      ];
      assert.deepEqual(crossed, [],
        `${name} pairs a label size with micro spacing (or the reverse) — ` +
        'see the pairing rule in src/ui/type.ts');
    });
  }

  test('and the conforming pairings are still there to be broken', () => {
    // Guards against the sweep passing because nothing uses the roles at all.
    const all = sources().map(([, s]) => s).join('\n');
    const ok = (all.match(/TYPE\.label[^}\n]*SPACING\.label/g) ?? []).length
      + (all.match(/TYPE\.micro[^}\n]*SPACING\.micro/g) ?? []).length;
    assert.ok(ok >= 10, `only ${ok} correctly paired styles found — the sweep may be looking at nothing`);
  });
});

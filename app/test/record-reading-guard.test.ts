import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.join(HERE, '..', ...p.split('/')), 'utf8');

/*
 * R421: third sibling to log-set-guard.test.ts and undo-guard.test.ts. Looked
 * elsewhere for a genuinely-new-write with no guard and found RECORD IT
 * (AddReading, app/measure.tsx — shared by both BODYWEIGHT and HEIGHT).
 * recordMeasurement's id is `m_${now.toString(36)}_${round(value*10)}`
 * (measure-model.ts) and saveMeasurement is an INSERT ... ON CONFLICT(id) DO
 * UPDATE (repo.ts) — on paper a same-tick duplicate should collide onto its
 * own id and upsert harmlessly, the deterministic-upsert category that made
 * editGoal/createGoal safe without a guard. It did NOT hold in practice: a
 * real same-tick double pointerdown/mousedown/pointerup/mouseup/click on
 * RECORD IT went from "2 READINGS" to "3 READINGS", not staying at "2" —
 * the two dispatches took long enough in real wall-clock JS execution to
 * land in different milliseconds, so Date.now() produced two different ids
 * and two real rows. The lesson: a same-millisecond id collision is not a
 * reliable substitute for an explicit guard, even though it looked
 * structurally sound on paper the same way R373's UNDO reasoning did.
 */
describe('RECORD IT does not save twice from one same-tick double-fired tap', () => {
  const src = read('app/measure.tsx');

  test('a synchronous ref guard sits before recordMeasurement is ever called', () => {
    assert.match(src, /const savingRef = useRef\(false\);/,
      'no guard — a same-tick second tap can create a second, duplicate reading');
    assert.match(src, /if \(savingRef\.current\) return;/);
    assert.match(src, /savingRef\.current = true;/);
    assert.match(src, /setTimeout\(\(\) => \{ savingRef\.current = false; \}, 50\);/);
  });

  test('a rejected save (bad input) clears the guard so the retry after fixing it is not silently blocked', () => {
    assert.match(src, /savingRef\.current = false; return setError/,
      'the guard must not stay latched on a validation failure — that would leave RECORD IT dead after a typo');
  });
});

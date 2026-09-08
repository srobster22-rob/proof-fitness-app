import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openOnce } from '../src/data/open-once.ts';

describe('openOnce', () => {
  test('opens once and reuses the value', () => {
    let calls = 0;
    const h = openOnce(() => ({ n: ++calls }));
    assert.equal(h.get().value!.n, 1);
    assert.equal(h.get().value!.n, 1);
    assert.equal(h.get().value!.n, 1);
    assert.equal(h.attempts(), 1, 'a successful open must not be repeated');
  });

  test('a throw becomes a value, not an exception', () => {
    const h = openOnce(() => { throw new Error('database is locked'); });
    const r = h.get();
    assert.equal(r.value, null);
    assert.equal(r.error!.message, 'database is locked');
  });

  // The whole reason this caches failure: get() runs inside component bodies.
  test('failure is cached, so a throwing opener is not re-run every render', () => {
    let calls = 0;
    const h = openOnce(() => { calls++; throw new Error('locked'); });
    for (let i = 0; i < 50; i++) h.get();
    assert.equal(calls, 1, `opener ran ${calls} times — that would spin the UI thread`);
    assert.equal(h.attempts(), 1);
  });

  test('reset allows exactly one more attempt', () => {
    let calls = 0;
    const h = openOnce(() => { calls++; throw new Error('locked'); });
    h.get(); h.get();
    h.reset();
    h.get(); h.get();
    assert.equal(calls, 2);
  });

  test('a failure that later succeeds is picked up after reset', () => {
    let ok = false;
    const h = openOnce(() => { if (!ok) throw new Error('locked'); return 'open'; });
    assert.ok(h.get().error);
    ok = true;
    assert.ok(h.get().error, 'still cached until reset');
    h.reset();
    assert.equal(h.get().value, 'open');
  });

  test('non-Error throws are normalised', () => {
    const h = openOnce(() => { throw 'just a string'; });
    assert.ok(h.get().error instanceof Error);
    assert.match(h.get().error!.message, /just a string/);
  });

  test('an opener returning null fails loudly instead of retrying forever', () => {
    let calls = 0;
    const h = openOnce<unknown>(() => { calls++; return null; });
    for (let i = 0; i < 10; i++) h.get();
    assert.ok(h.get().error, 'null must be treated as a failure');
    assert.equal(calls, 1);
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const src = readFileSync(path.join(APP, 'src', 'data', 'repo.ts'), 'utf8');

/** Method bodies, split on their own declarations. */
function methods(): Array<[string, string]> {
  const starts = [...src.matchAll(/^ {2}(?:private )?([a-zA-Z][A-Za-z0-9_]*)\(/gm)];
  return starts.map((m, i) => {
    const from = m.index!;
    const to = i + 1 < starts.length ? starts[i + 1].index! : src.length;
    return [m[1], src.slice(from, to)] as [string, string];
  });
}

/**
 * Each cached table, the SQL that changes it, and the call that must follow.
 *
 * `allSets` and its neighbours are memoised, and the comment above the cache
 * states the contract plainly: "a cache is safe because this Repo is the only
 * writer: every mutation calls `dirty()`". That is true today — verified by
 * hand, four caches, every write paired — but it is a contract nothing checked,
 * and the failure mode is silent. A method added later that deletes a
 * measurement without invalidating would leave the app serving a bodyweight
 * that no longer exists, and `realLoad` would keep scoring pull-ups against it.
 */
const TABLES: Array<[string, RegExp, RegExp]> = [
  ['sets', /(?:INSERT INTO|UPDATE|DELETE FROM) sets\b/, /this\.dirty\(\)/],
  ['goals', /(?:INSERT INTO|UPDATE|DELETE FROM) goals\b/, /this\.goalsDirty\(\)/],
  ['measurements', /(?:INSERT INTO|UPDATE|DELETE FROM) measurements\b/, /this\.measureDirty\(\)/],
  ['measure_goals', /(?:INSERT INTO|UPDATE|DELETE FROM) measure_goals\b/, /this\.measureGoalDirty\(\)/]
];

describe('every write invalidates the cache it invalidates', () => {
  const all = methods();

  test('the parse found the methods it is about to check', () => {
    // Otherwise this whole file passes by examining nothing — the failure five
    // other instruments here have had.
    assert.ok(all.length >= 25, `only parsed ${all.length} methods out of repo.ts`);
    assert.ok(all.some(([n]) => n === 'eraseAll'), 'eraseAll was not parsed');
    assert.ok(all.some(([n]) => n === 'logSet'), 'logSet was not parsed');
  });

  for (const [table, writes, invalidates] of TABLES) {
    test(`nothing writes ${table} without invalidating it`, () => {
      const writers = all.filter(([, body]) => writes.test(body));
      assert.ok(writers.length > 0, `no method writes ${table} — has it been renamed?`);
      for (const [name, body] of writers) {
        assert.match(body, invalidates,
          `${name}() writes ${table} and never invalidates its cache — ` +
          'readers will keep being served rows that no longer exist');
      }
    });
  }

  test('eraseAll clears all four, because it empties all four', () => {
    const [, body] = all.find(([n]) => n === 'eraseAll')!;
    for (const [, , invalidates] of TABLES) assert.match(body, invalidates);
  });

  test('and Repo really is the only writer the cache assumes', () => {
    /*
     * The contract rests on it. Anything else holding the Db could write behind
     * the cache's back and nothing would ever invalidate.
     */
    const offenders: string[] = [];
    for (const dir of ['src/data', 'src/domain', 'src/ui', 'app']) {
      for (const f of readdirSync(path.join(APP, dir))) {
        if (!/\.tsx?$/.test(f) || f === 'repo.ts') continue;
        // The two Db adapters ARE the SQL layer; everything else must go
        // through Repo.
        if (dir === 'src/data' && /-db\.ts$/.test(f)) continue;
        const body = readFileSync(path.join(APP, dir, f), 'utf8');
        if (/\.(exec|prepare)\(/.test(body)) offenders.push(`${dir}/${f}`);
      }
    }
    assert.deepEqual(offenders, [], 'these reach past Repo straight to SQL');
  });
});

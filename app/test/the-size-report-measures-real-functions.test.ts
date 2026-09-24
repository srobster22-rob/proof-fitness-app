import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { functionsIn, measure, refreshMap, FILE_LIMIT, FUNCTION_LIMIT } from '../tools/sizes.mjs';

/*
 * tools/sizes.mjs (R695) measures functions with TypeScript's parser. A brace
 * matcher, the first version, ended `coachSuggestion` inside its own parameter
 * type (`opts: { goal?: … }`) and never reported the 375-line function at all.
 */
describe('the size report measures real functions', () => {
  test('a function whose parameters hold braces is measured to its real end', () => {
    const src = [
      'export function call(',            // 1
      '  history: number[],',
      '  opts: { goal?: string; unit: string }',
      '): { weight: number } | null {',
      '  if (!history.length) return null;', // 5
      '  return { weight: history[0] };',
      '}',                                 // 7
      '',
      'const arrow = (a: { x: number }) => {', // 9
      '  return a.x;',
      '};',                                // 11
      'class Model {',
      '  state(): number {',               // 13
      '    return 1;',
      '  }',                               // 15
      '}',
    ].join('\n');
    assert.deepEqual(functionsIn(src, 'x.ts').map(f => [f.name, f.line, f.lines]), [
      ['call', 1, 7], ['arrow', 9, 3], ['Model.state', 13, 3]
    ]);
  });

  test('a component in a .tsx file is a function too', () => {
    const src = 'export function Row({ label }: { label: string }) {\n  return <Text>{label}</Text>;\n}\n';
    assert.deepEqual(functionsIn(src, 'Row.tsx').map(f => [f.name, f.lines]), [['Row', 3]]);
  });

  test('--map rewrites the map\'s sizes and names the rows it lacks or no longer needs (R696)', () => {
    const m = measure();
    const now = m.files.find(f => f.path === 'src/ui/now-model.ts')!;
    const r = refreshMap('# map\r\n| `src/ui/now-model.ts` | 1 | the Now model |\r\n| `src/gone.ts` | 5 | was here |\r\n', m);
    assert.ok(r.text.includes(`| \`src/ui/now-model.ts\` | ${now.lines.toLocaleString('en-US')} | the Now model |`), r.text);
    assert.ok(r.text.includes('| `src/gone.ts` | 5 | was here |'), 'a gone row was rewritten instead of reported');
    assert.ok(!r.text.includes('\r'), 'CRLF left in the refreshed map');
    assert.deepEqual(r.gone, ['src/gone.ts']);
    assert.ok(r.missing.includes('src/domain/coach.ts') && !r.missing.includes('src/ui/now-model.ts'));
    // And each table is largest first again, whatever order the rows were in.
    const sorted = refreshMap('| `src/ui/type.ts` | 9 | a |\n| `src/ui/now-model.ts` | 9 | b |\n\ntext\n', m).text;
    assert.ok(sorted.indexOf('now-model.ts') < sorted.indexOf('type.ts'), sorted);
  });

  test('the app measures as the source it is, against the §3a limits', () => {
    const m = measure();
    assert.equal(FILE_LIMIT, 3000);
    assert.equal(FUNCTION_LIMIT, 150);
    assert.ok(m.files.length > 40, `only ${m.files.length} source files found`);
    assert.ok(m.files.every(f => /^(src|app)\//.test(f.path)), 'tests or tools counted as product source');
    assert.ok(m.files.some(f => f.path === 'src/ui/now-model.ts'));
    assert.equal(m.totalLines, m.files.reduce((n, f) => n + f.lines, 0));
    assert.deepEqual(m.functionsOver, m.functions.filter(f => f.lines > FUNCTION_LIMIT));
  });
});

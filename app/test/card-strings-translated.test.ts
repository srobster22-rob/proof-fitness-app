import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { weeklyCard, type WeeklyComparison } from '../src/domain/weekly.ts';
import { multipleLine } from '../src/ui/recap-model.ts';
import { LANGUAGES } from '../src/domain/i18n.ts';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

/*
 * R482. R221 fixed "the card's own labels are English on a Spanish card" by
 * giving `spike/recap.js` a per-language LABELS table. That fixed every string
 * the RENDERER owns — and left every string the APP hands it, because those
 * never pass through LABELS at all.
 *
 * Four survived, found by a defect sweep and each confirmed by reading:
 *
 *   weekly.ts        the date tile, "4 WEEKS", beside a label already reading
 *                    "SUBIO" — half-translated on one card
 *   recap-model.ts   "1.75x bodyweight", which rides the card AND the message
 *   NowScreen.tsx    "BODYWEIGHT" under the hero, on the logging screen, on the
 *                    first pull-up any Spanish lifter records
 *   spike/recap.js   "Bodyweight not recorded" and "+N more", two literals the
 *                    LABELS table exists for and that were never moved into it
 *
 * The weekly one is worth naming: R477 rendered the card sheet with Spanish
 * rows, and I looked at "SUBIO ... 4 WEEKS" and called the sheet clean. Looking
 * is necessary and it is not sufficient — this is the check that does not get
 * tired.
 */
describe('every string on the shared card is translated (§5, R221)', () => {
  const comparison = {
    lift: 'Leg Press', then: 220, now: 240, gain: 20, days: 28
  } as unknown as WeeklyComparison;

  test('the weekly card dates itself in its own language', () => {
    assert.equal((weeklyCard(comparison, 'lb', 'PROOF', 'en') as { date: string }).date, '4 WEEKS');
    assert.equal((weeklyCard(comparison, 'lb', 'PROOF', 'es') as { date: string }).date, '4 SEMANAS');
  });

  test('and says one week, not 1 weeks, in both', () => {
    const oneWeek = { ...comparison, days: 7 } as unknown as WeeklyComparison;
    assert.equal((weeklyCard(oneWeek, 'lb', 'PROOF', 'en') as { date: string }).date, '1 WEEK');
    assert.equal((weeklyCard(oneWeek, 'lb', 'PROOF', 'es') as { date: string }).date, '1 SEMANA');
  });

  test('the bodyweight-multiple line is translated', () => {
    const payload = {
      unit: 'lb', best: { lift: 'Squat', weight: 315, reps: 5, exerciseId: 'squat' }
    };
    const measurements = [{ id: 'm', kind: 'bodyweight', value: 180, unit: 'lb', at: 1 }];
    const en = multipleLine({ ...payload, lang: 'en' } as never, measurements as never, 2);
    const es = multipleLine({ ...payload, lang: 'es' } as never, measurements as never, 2);
    assert.match(en!, /bodyweight$/);
    assert.match(es!, /peso corporal$/,
      'the milestone line still says "bodyweight" on a Spanish card and message');
  });

  test('the renderer keeps every drawn word in its LABELS table', () => {
    const src = fs.readFileSync(path.join(ROOT, 'spike', 'recap.js'), 'utf8');
    // A literal English string handed to fillText/fit is a word LABELS never
    // sees. Counted, so this cannot pass having matched nothing.
    const offenders: string[] = [];
    for (const m of src.matchAll(/(?:fillText|fit)\(\s*(?:ctx,\s*)?'([A-Za-z][^']{2,})'/g)) {
      offenders.push(m[1]);
    }
    assert.deepEqual(offenders, [],
      'these words are drawn on the card as English literals — put them in ' +
      'LABELS and read them through L(D, key)');
  });

  test('and both language tables define the same keys', () => {
    const src = fs.readFileSync(path.join(ROOT, 'spike', 'recap.js'), 'utf8');
    const en = region(src, '    en: {', '},');
    const es = region(src, '    es: {', '}');
    const keys = (s: string) => [...s.matchAll(/(\w+):\s*'/g)].map(m => m[1]).sort();
    assert.ok(keys(en).length >= 13, `only ${keys(en).length} label keys — the scan went stale`);
    assert.deepEqual(keys(es), keys(en),
      'the two LABELS tables have drifted — a key missing from es falls back ' +
      'to English silently, which is the bug R221 fixed');
  });

  test('and the app-side card strings exist in every language', () => {
    const i18n = fs.readFileSync(path.join(ROOT, 'app', 'src', 'domain', 'i18n.ts'), 'utf8');
    const es = region(i18n, 'const ES');
    for (const key of ['cardWeeks', 'cardWeekOne', 'bodyweightWord', 'bodyweight']) {
      for (const lang of LANGUAGES) {
        if (lang === 'en') continue;
        // Line-wise rather than a regex. Written as one first, and the Bash
        // heredoc that created this file ate the doubled backslashes, so the
        // pattern became "newline then a literal s" and reported every key
        // missing — HANDOFF trap 7 demonstrating itself, twice in one round.
        // This form has no escapes for anything to eat.
        const declared = es.split('\n').some(l => l.trim().startsWith(key + ':'));
        assert.ok(declared, `${key} is missing from the ${lang} table`);
      }
    }
  });
});

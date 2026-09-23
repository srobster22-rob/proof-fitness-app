/**
 * What a user can do in PROOF, counted from source — never by hand.
 *
 *   node tools/inventory.ts                 regenerate ../CONTENT.md
 *   node tools/inventory.ts --history R680  ...and append a history row (RETRO rounds)
 *
 * Every count below comes from a definition the app itself runs on: an exported constant
 * where one exists, otherwise the declaration parsed out of the source file. Targets come
 * from the axis table in ../VISION.md, keyed by its `id` column, so the target and the count
 * cannot quietly disagree about which axes exist: an axis with a target but no counter, or a
 * counter with no target, is an error rather than a missing row.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN } from '../src/domain/coldstart.ts';
import { SPLIT_PLANS } from '../src/domain/split.ts';
import { KINDS } from '../src/domain/measure.ts';
import { LANGUAGES } from '../src/domain/i18n.ts';
import { TRAINING_GOALS } from '../src/ui/training-goal.ts';
import { LIFT_INSIGHTS } from '../src/ui/lift-history.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const ROOT = path.join(APP, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(APP, ...p), 'utf8');

type Count = { count: number; items: string[] };
const of = (items: string[]): Count => ({ count: items.length, items });

/** The block of a TypeScript declaration, from its opening line to the first unindented `}`. */
function block(src: string, opener: string): string {
  const at = src.indexOf(opener);
  if (at < 0) throw new Error(`inventory: cannot find "${opener}"`);
  const end = src.indexOf('\n}', at);
  return src.slice(at, end);
}

/*
 * RecapPayload fields that are the card's frame or plumbing rather than something the app
 * TELLS the lifter. Anything not listed here counts as an insight, so a new claim added to the
 * payload is counted by default instead of silently missed.
 */
const NOT_INSIGHTS = new Set([
  'title', 'date', 'volume', 'volumeKnown', 'lang', 'sets', 'duration', 'streak',
  'kind', 'unit', 'watermark', 'lifts'
]);

const COUNTERS: Record<string, () => Count> = {
  exercises: () => of(BUILTIN.map(e => e.id)),
  programs: () => of([...SPLIT_PLANS]),
  coach: () => of([...new Set([...read('src', 'domain', 'coach.ts').matchAll(/key: '(coach\w+)'/g)].map(m => m[1]))]),
  insights: () => {
    const fields = [...block(read('src', 'domain', 'session.ts'), 'export interface RecapPayload {')
      .matchAll(/^ {2}(\w+)\??:/gm)].map(m => m[1]).filter(f => !NOT_INSIGHTS.has(f));
    const weekly = /export function weeklyLine\(/.test(read('src', 'ui', 'progress-model.ts')) ? ['weeklyLine'] : [];
    // What a lift's own history shows (R680), from the registry the sheet renders.
    return of([...fields, ...weekly, ...LIFT_INSIGHTS.map(i => `lift:${i}`)]);
  },
  goals: () => {
    const dir = path.join(APP, 'src', 'domain');
    const names = fs.readdirSync(dir).filter(f => f.endsWith('.ts'))
      .flatMap(f => [...fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/export interface (\w*Goal) \{/g)].map(m => m[1]));
    return of(names);
  },
  measurements: () => of(Object.keys(KINDS)),
  equipment: () => {
    const m = read('src', 'domain', 'types.ts').match(/export type Equipment = ([^;]+);/);
    if (!m) throw new Error('inventory: cannot find the Equipment type');
    return of([...m[1].matchAll(/'(\w+)'/g)].map(x => x[1]));
  },
  trainingGoals: () => of([...TRAINING_GOALS]),
  languages: () => of([...LANGUAGES]),
  screens: () => of(fs.readdirSync(path.join(APP, 'app')).filter(f => f.endsWith('.tsx') && !/^[_+]/.test(f))
    .map(f => f.replace(/\.tsx$/, '')))
};

// ---- targets from VISION.md
const vision = fs.readFileSync(path.join(ROOT, 'VISION.md'), 'utf8');
const axes = [...vision.matchAll(/^\| (\w+) \| ([^|]+?) \| [^|]+ \| (\d+) \|/gm)]
  .map(m => ({ id: m[1], name: m[2].trim(), target: Number(m[3]) }));
if (!axes.length) throw new Error('inventory: VISION.md has no axis table');
const missing = axes.filter(a => !COUNTERS[a.id]).map(a => a.id);
const orphan = Object.keys(COUNTERS).filter(id => !axes.some(a => a.id === id));
if (missing.length || orphan.length) {
  throw new Error(`inventory: VISION.md and the counters disagree — no counter for [${missing.join(', ')}], no target for [${orphan.join(', ')}]`);
}

const rows = axes.map(a => ({ ...a, ...COUNTERS[a.id]() }));
const pct = (r: { count: number; target: number }) => Math.round((r.count / r.target) * 100);
const furthest = [...rows].sort((a, b) => a.count / a.target - b.count / b.target)[0];

// ---- CONTENT.md, keeping its history section
const OUT = path.join(ROOT, 'CONTENT.md');
const previous = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
const historyAt = previous.indexOf('## History');
let history = historyAt >= 0
  ? previous.slice(historyAt).trimEnd()
  : ['## History', '', `| round | ${axes.map(a => a.id).join(' | ')} |`, `|---|${axes.map(() => '---').join('|')}|`].join('\n');

const flag = process.argv.indexOf('--history');
if (flag >= 0) {
  const round = process.argv[flag + 1];
  if (!/^R\d+$/.test(round ?? '')) throw new Error('inventory: --history needs a round id like R680');
  if (new RegExp(`^\\| ${round} \\|`, 'm').test(history)) throw new Error(`inventory: ${round} already has a history row`);
  history += `\n| ${round} | ${rows.map(r => r.count).join(' | ')} |`;
}

const table = rows.map(r =>
  `| ${r.name} | ${r.count} | ${r.target} | ${pct(r)}% | ${r.items.length <= 12 ? r.items.join(', ') : `${r.items.length} items`} |`);

const content = [
  '# CONTENT — what a user can do in PROOF, counted from source',
  '',
  'Generated by `app/tools/inventory.ts` (in app/: `node tools/inventory.ts`). Do not edit the',
  'table by hand: counts come from source and targets come from VISION.md. RETRO rounds append a',
  'history row with `--history R<n>`.',
  '',
  '| axis | count | target | of target | what is counted |',
  '|---|---|---|---|---|',
  ...table,
  '',
  `Furthest below target: **${furthest.name}** (${furthest.count} of ${furthest.target}, ${pct(furthest)}%).`,
  '',
  history,
  ''
].join('\n');

fs.writeFileSync(OUT, content);
console.log(rows.map(r => `${r.id} ${r.count}/${r.target}`).join('  '));
console.log(`furthest below target: ${furthest.id} (${pct(furthest)}%)`);

/**
 * The market score and the gap values, computed from MARKET.md's parity matrix — never by hand.
 *
 *   node tools/market.ts            rewrite the generated blocks in ../MARKET.md
 *   node tools/market.ts --check    exit 1 if the blocks are stale (nothing is written)
 *
 * The matrix is the one source: a row per dimension, `| # | dimension | weight | **PROOF** |
 * our evidence | <comparable> ... |`, each score a 0–5 integer at the start of its cell. This
 * script writes the two tables that follow from it, between `<!-- market:scores -->` and
 * `<!-- market:gaps -->` markers, and reads the frozen-row notes from the list under
 * `### Frozen rows` (`- <row #>: <note>`), so a note stays prose and every number stays derived.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, '..', '..', 'MARKET.md');

export interface Row { n: number; name: string; weight: number; us: number; them: number[] }
export interface Matrix { comparables: string[]; rows: Row[] }

/** A cell's score: the integer it starts with, after any bold markers. */
function score(cell: string, where: string): number {
  const m = cell.replace(/\*/g, '').trim().match(/^(\d)\b/);
  if (!m) throw new Error(`market: no 0-5 score in "${cell.trim()}" (${where})`);
  return Number(m[1]);
}

export function parseMatrix(md: string): Matrix {
  const lines = md.split(/\r?\n/);
  const head = lines.findIndex(l => /^\| # \| dimension \| weight \| \*\*PROOF\*\* \| our evidence \|/.test(l));
  if (head < 0) throw new Error('market: cannot find the parity matrix header');
  const comparables = lines[head].split('|').slice(6, -1).map(c => c.trim());
  const rows: Row[] = [];
  for (let i = head + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const cells = lines[i].split('|').slice(1, -1);
    if (cells.length !== 5 + comparables.length) {
      throw new Error(`market: row ${i + 1} has ${cells.length} cells, the header has ${5 + comparables.length}`);
    }
    const n = Number(cells[0].trim());
    rows.push({
      n,
      name: cells[1].trim(),
      weight: Number(cells[2].trim()),
      us: score(cells[3], `row ${n}, PROOF`),
      them: cells.slice(5).map((c, k) => score(c, `row ${n}, ${comparables[k]}`))
    });
  }
  if (!rows.length) throw new Error('market: the matrix has no rows');
  return { comparables, rows };
}

/** 100 × Σ(weight × score) ÷ Σ(weight × 5), rounded. */
export function marketScore(sum: number, rows: Row[]): number {
  const max = rows.reduce((s, r) => s + r.weight * 5, 0);
  return Math.round((100 * sum) / max);
}

/** The scores table and the gap table the matrix implies, as Markdown, plus PROOF's score. */
export function tables(m: Matrix, frozen: Map<number, string>) {
  const sums = [m.rows.reduce((s, r) => s + r.weight * r.us, 0),
    ...m.comparables.map((_, k) => m.rows.reduce((s, r) => s + r.weight * r.them[k], 0))];
  const order = ['PROOF', ...m.comparables].map((name, i) => ({ name, sum: sums[i] }))
    .sort((a, b) => (a.name === 'PROOF' ? -1 : b.name === 'PROOF' ? 1 : b.sum - a.sum));
  const best = order.filter(o => o.name !== 'PROOF')[0];
  const weights = m.rows.reduce((s, r) => s + r.weight, 0);
  const scores = [
    `| | ${order.map(o => o.name).join(' | ')} |`,
    `|---|${order.map(() => '---').join('|')}|`,
    `| weighted sum | ${order.map(o => o.sum).join(' | ')} |`,
    `| **market score** | ${order.map(o => `**${marketScore(o.sum, m.rows)}**`).join(' | ')} |`,
    '',
    `Best comparable: **${best.name}, ${marketScore(best.sum, m.rows)}**. ` +
      `The weights sum to ${weights}, so the maximum weighted sum is ${weights * 5}.`
  ];
  const gaps = m.rows.map(r => {
    const top = Math.max(...r.them);
    return { r, top, gap: r.weight * Math.max(0, top - r.us) };
  }).sort((a, b) => b.gap - a.gap || a.r.n - b.r.n);
  const gapTable = [
    '| row | gap | frozen or gated? |',
    '|---|---|---|',
    ...gaps.map(g => `| ${g.r.n} ${g.r.name} | ${g.r.weight} × (${g.top} − ${g.r.us}) = **${g.gap}** | ${frozen.get(g.r.n) ?? 'no'} |`)
  ];
  return { scores: scores.join('\n'), gaps: gapTable.join('\n'), score: marketScore(sums[0], m.rows) };
}

/** The `- <row>: <note>` lines under `### Frozen rows`. */
function frozenNotes(md: string): Map<number, string> {
  const at = md.indexOf('### Frozen rows');
  const out = new Map<number, string>();
  if (at < 0) return out;
  for (const line of md.slice(at).split(/\r?\n/).slice(1)) {
    if (/^#/.test(line)) break;
    const m = line.match(/^- (\d+): (.+)$/);
    if (m) out.set(Number(m[1]), m[2].trim());
  }
  return out;
}

/** Swaps the text between a block's markers, in the file's own line endings. */
function replaceBlock(md: string, name: string, body: string): string {
  const open = `<!-- market:${name} -->`, close = `<!-- /market:${name} -->`;
  const a = md.indexOf(open), b = md.indexOf(close);
  if (a < 0 || b < a) throw new Error(`market: MARKET.md has no ${open} ... ${close} block`);
  const eol = md.includes('\r\n') ? '\r\n' : '\n';
  return md.slice(0, a + open.length) + eol + body.split('\n').join(eol) + eol + md.slice(b);
}

/** MARKET.md with both generated blocks recomputed from its own matrix and frozen-row notes. */
export function regenerate(md: string): string {
  const t = tables(parseMatrix(md), frozenNotes(md));
  return replaceBlock(replaceBlock(md, 'scores', t.scores), 'gaps', t.gaps);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const md = fs.readFileSync(FILE, 'utf8');
  const next = regenerate(md);
  const { score: ours } = tables(parseMatrix(md), frozenNotes(md));
  if (process.argv.includes('--check')) {
    if (next !== md) { console.error('MARKET.md is stale: run `node tools/market.ts`'); process.exit(1); }
    console.log(`MARKET.md is current (market score ${ours})`);
  } else {
    fs.writeFileSync(FILE, next);
    console.log(`market score ${ours}`);
  }
}

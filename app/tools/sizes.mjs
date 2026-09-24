/**
 * How big the app's own source is: every file's line count, and every
 * function's, measured by TypeScript's parser rather than by counting braces
 * (a brace in a parameter's type ends a function early for any regex).
 *
 * ARCHITECTURE.md's module sizes and every ORGANIZE round's before → after
 * come from here, and `npm run check` prints its headline.
 *
 *   node tools/sizes.mjs           the largest files and functions
 *   node tools/sizes.mjs --json    everything, as JSON on stdout
 *   node tools/sizes.mjs --map     refresh ../ARCHITECTURE.md's sizes; name rows it lacks or no longer needs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** AGENT_LOOP §3a: no source file over this many lines, no function over FUNCTION_LIMIT. */
export const FILE_LIMIT = 3000;
export const FUNCTION_LIMIT = 150;

/** The shipped source: the domain, the data layer, the UI and the routes. Tests and tools are not product. */
export const SOURCE_DIRS = ['src', 'app'];

function sourceFiles(root) {
  const out = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
    }
  };
  for (const d of SOURCE_DIRS) if (fs.existsSync(path.join(root, d))) walk(path.join(root, d));
  return out.sort();
}

/** A function's name as a reader would search for it: `Class.method`, the const it is bound to, or the key it sits under. */
function nameOf(node) {
  if (node.name && ts.isIdentifier(node.name)) {
    const owner = node.parent && ts.isClassLike(node.parent) && node.parent.name ? `${node.parent.name.text}.` : '';
    return owner + node.name.text;
  }
  const p = node.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) return p.name.text;
  if (p && ts.isCallExpression(p) && ts.isIdentifier(p.expression)) return `(passed to ${p.expression.text})`;
  return '(anonymous)';
}

/** Every function in one source text, with the line it starts on and how many lines it spans. */
export function functionsIn(text, fileName = 'x.tsx') {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [];
  const visit = node => {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) ||
         ts.isFunctionExpression(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessor(node) ||
         ts.isSetAccessor(node)) && node.body) {
      const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
      const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
      found.push({ name: ts.isConstructorDeclaration(node) ? 'constructor' : nameOf(node), line: start + 1, lines: end - start + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Every source file and function under `root`, largest first. */
export function measure(root = APP) {
  const files = [], functions = [];
  for (const abs of sourceFiles(root)) {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const text = fs.readFileSync(abs, 'utf8');
    // Counted as `wc -l` counts them, so a file ending in a newline has no phantom last line.
    files.push({ path: rel, lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0) });
    for (const f of functionsIn(text, abs)) functions.push({ path: rel, ...f });
  }
  files.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
  functions.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path) || a.line - b.line);
  return {
    files, functions,
    totalLines: files.reduce((n, f) => n + f.lines, 0),
    filesOver: files.filter(f => f.lines > FILE_LIMIT),
    functionsOver: functions.filter(f => f.lines > FUNCTION_LIMIT),
  };
}

/**
 * ARCHITECTURE.md's module rows with their sizes rewritten from the source,
 * plus the modules it lacks and the ones it lists that are gone. A commit
 * that adds, moves or splits a module runs `--map`, writes the new module's
 * row by hand (what it owns is a sentence, not a number), and runs it again.
 */
export function refreshMap(text, m = measure()) {
  const sizes = new Map(m.files.map(f => [f.path, f.lines]));
  const seen = new Set();
  const ROW = /^\| `((?:src|app)\/[^`]+)` \| ([\d,]+) \|/;
  const resized = text.replace(/\r\n/g, '\n').split('\n').map(line => line.replace(ROW, (row, p) => {
    seen.add(p);
    return sizes.has(p) ? `| \`${p}\` | ${sizes.get(p).toLocaleString('en-US')} |` : row;
  }));
  // Each table stays largest first, so the monoliths are the first thing a reader sees.
  const lines = [];
  for (let i = 0; i < resized.length;) {
    let j = i;
    while (j < resized.length && ROW.test(resized[j])) j++;
    if (j === i) { lines.push(resized[i++]); continue; }
    const size = l => Number(ROW.exec(l)[2].replace(/,/g, ''));
    lines.push(...resized.slice(i, j).sort((a, b) => size(b) - size(a) || a.localeCompare(b)));
    i = j;
  }
  return { text: lines.join('\n'), missing: [...sizes.keys()].filter(p => !seen.has(p)).sort(), gone: [...seen].filter(p => !sizes.has(p)).sort() };
}

/** One line for the check's summary. */
export function headline(m) {
  const f = m.files[0], fn = m.functions[0];
  return `${m.files.length} files, ${m.totalLines} lines; largest file ${f.path} ${f.lines}; ` +
    `largest function ${fn.name} (${fn.path}:${fn.line}) ${fn.lines}; ` +
    `over the limits: ${m.filesOver.length} files > ${FILE_LIMIT}, ${m.functionsOver.length} functions > ${FUNCTION_LIMIT}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const m = measure();
  if (process.argv.includes('--map')) {
    const file = path.join(APP, '..', 'ARCHITECTURE.md');
    const r = refreshMap(fs.readFileSync(file, 'utf8'), m);
    fs.writeFileSync(file, r.text);
    for (const p of r.missing) console.log(`missing from ARCHITECTURE.md (write its row): ${p}`);
    for (const p of r.gone) console.log(`listed in ARCHITECTURE.md but gone (remove its row): ${p}`);
    console.log(r.missing.length || r.gone.length ? 'sizes refreshed; the rows above need a hand' : 'ARCHITECTURE.md sizes refreshed');
    process.exit(r.missing.length || r.gone.length ? 1 : 0);
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(m, null, 1) + '\n');
  } else {
    console.log(headline(m));
    console.log('\nlargest files:');
    for (const f of m.files.slice(0, 12)) console.log(`  ${String(f.lines).padStart(5)}  ${f.path}`);
    console.log(`\nfunctions over ${FUNCTION_LIMIT} lines:`);
    for (const f of m.functionsOver) console.log(`  ${String(f.lines).padStart(5)}  ${f.name}  ${f.path}:${f.line}`);
  }
}

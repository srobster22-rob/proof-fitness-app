/*
 * Emits the domain logic as a single browser-loadable script.
 *
 * Uses Node's own `module.stripTypeScriptTypes` — the same stripper that runs
 * the .ts files directly — so there is no compiler, no bundler, and no
 * dependency. Types are erased, nothing is transformed.
 *
 * Why this exists: the kill-test harness was building its artifacts from
 * hand-typed JSON, which meant the videos shown to ten real lifters were NOT
 * produced by the product's own logic. Any divergence between what the harness
 * shows and what the app would render invalidates the test silently. Now both
 * run the same code.
 */
const { stripTypeScriptTypes } = require('node:module');
const fs = require('fs');
const path = require('path');

/*
 * Both paths are overridable, and only so the build's own guards can be
 * exercised without touching what ships.
 *
 * The gate below refuses malformed exports, and the only honest way to test
 * that is to build a module tree that HAS one. Doing that in src/domain would
 * mean editing real sources while ~120 test processes read them, which is
 * precisely the class of defect R501 spent a round removing. So a test copies
 * the modules to a temp directory, plants its bug there, and points the build
 * at the copy. Unset, both fall back to the real thing.
 */
const SRC = process.env.PROOF_BUNDLE_SRC || path.join(__dirname, 'src', 'domain');
const OUT = process.env.PROOF_BUNDLE_OUT || path.join(__dirname, 'dist', 'proof-domain.js');

// Dependency order — these are small and interdependent, so concatenation in
// order beats pulling in a module graph resolver.
// i18n first: it imports nothing and both goals.ts and session.ts read it.
// Order matters: a module's imports are destructured out of the shared
// registry when its IIFE runs, so every module must appear after the ones it
// imports from. `split.ts` sits before `session.ts` for exactly that reason.
const MODULES = ['types.ts', 'i18n.ts', 'measure.ts', 'predict.ts', 'pr.ts', 'goals.ts', 'split.ts', 'session.ts', 'coldstart.ts'];

/*
 * Each module gets its OWN IIFE rather than being flattened into one scope.
 * Flattening looked simpler until two modules both declared a private DAY_MS
 * and the bundle died on a redeclaration — module-private names are supposed to
 * be private, and a bundler that leaks them is just waiting to break.
 *
 * So: imports are resolved out of a shared registry, exports are published back
 * into it. Both lists are parsed from the source, so adding an export to a
 * module needs no change here.
 */
/**
 * Does this `export const/let` line declare more than one name?
 *
 * Depth-aware, because a comma inside `= { a, b }` or `= [1, 2]` or a call is
 * not a second declarator. Only a comma at bracket depth zero is.
 */
function topLevelComma(line) {
  let depth = 0;
  for (const c of line) {
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) return true;
  }
  return false;
}

const chunks = [];
const seenExports = new Set();   // names published by modules already emitted
const importProblems = [];
for (const file of MODULES) {
  const source = fs.readFileSync(path.join(SRC, file), 'utf8');

  // Value imports only. `import type` is erased by the stripper and naming a
  // type in the destructure would throw at runtime.
  const imported = new Set();
  for (const m of source.matchAll(/^\s*import\s+\{([^}]*)\}\s*from\s*['"][^'"]+['"]/gm)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/^type\s+/, '');
      if (!name || /^type\s/.test(raw.trim())) continue;
      if (raw.includes('type ')) continue;
      imported.add(name.split(/\s+as\s+/).pop().trim());
    }
  }

  let js = stripTypeScriptTypes(source, { mode: 'strip' });

  const exported = new Set();
  for (const m of source.matchAll(/^\s*export\s+(?:const|function|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    exported.add(m[1]);
  }
  /*
   * Every `export` in the source must be one this collector fully understands.
   *
   * The regexp above sees `export const NAME` and takes ONE name. That is every
   * export in these eight modules today, and the failure mode when it stops
   * being true is silent: `export const A = 1, B = 2;` strips correctly to a
   * valid `const A = 1, B = 2`, so the bundle runs, B is simply never published
   * into the registry, and the harness gets `undefined` for it at some later
   * moment far from here. `export async function`, `export default` and
   * `export *` are the same story from other directions.
   *
   * The existing guard cannot catch any of that: it only asks whether the
   * rewrite matched nothing at all -- R504's lesson, in a second build script.
   * So this asks the opposite question, is there an export here I did NOT
   * account for, and refuses to build rather than shipping a bundle with a hole
   * in it. A new export form should cost somebody one clear error, not a
   * debugging session in a different file.
   */
  for (const m of js.matchAll(/^[ \t]*export\b[^\n]*/gm)) {
    const line = m[0].trim();
    if (/^export\s+(?:type|interface)\b/.test(line)) continue;
    if (/^export\s*\{/.test(line)) continue;
    const named = /^export\s+(?:const|function|let|class)\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (!named || !exported.has(named[1])) {
      console.error(`FAILED: ${file} has an export this bundler does not understand:`);
      console.error(`  ${line}`);
      console.error('  Recognised: export type/interface, export { ... }, and a SINGLE');
      console.error('  named const/let/function/class. Teach build-domain.cjs the new');
      console.error('  form -- do not leave it to be dropped silently.');
      process.exit(1);
    }
    if (/^export\s+(?:const|let)\b/.test(line) && topLevelComma(line)) {
      console.error(`FAILED: ${file} exports several names in one declaration:`);
      console.error(`  ${line}`);
      console.error('  Only the first would reach the bundle. Split it into one export each.');
      process.exit(1);
    }
  }

  js = js
    .replace(/^\s*import[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*export\s+(const|function|let|class)\b/gm, '$1')
    .replace(/^\s*export\s+\{[^}]*\};?\s*$/gm, '');

  /*
   * Every name this module imports must already be published by a module
   * EARLIER in MODULES, because the destructure below runs when this IIFE
   * runs, not lazily.
   *
   * Nothing checked this, and it was wrong in the shipped bundle: `session.ts`
   * imports `sessionPlanDay` from `split.ts`, which was not in MODULES at all,
   * so the bundle destructured `undefined` and `Domain.sessionTitle` threw
   * `sessionPlanDay is not a function` for anyone who called it. The build's
   * own verify step could not see it -- it walked a hand-written EXPORTS list
   * of 28 names and asks whether each loaded, which is a question about
   * exports and says nothing about imports.
   *
   * Derived from the sources on both sides, so adding a module or moving one
   * up the list needs no edit here -- it just has to be true.
   */
  for (const name of imported) {
    if (!seenExports.has(name)) {
      importProblems.push(`${file} imports ${name}, which no earlier bundled module exports`);
    }
  }
  for (const name of exported) seenExports.add(name);
  const prologue = imported.size ? `const { ${[...imported].join(', ')} } = M;\n` : '';
  const epilogue = exported.size ? `\nObject.assign(M, { ${[...exported].join(', ')} });` : '';

  chunks.push(
    `// ---- ${file} ${'-'.repeat(Math.max(0, 58 - file.length))}\n` +
    `(function () {\n${prologue}${js.trim()}${epilogue}\n})();\n`
  );
}

// Names the browser side needs. Kept explicit so an accidental rename fails the
// build rather than silently dropping a function from the harness.

if (importProblems.length) {
  console.error('FAILED: the bundle would destructure names nothing provides:');
  for (const p of importProblems) console.error('  ' + p);
  console.error('  Add the missing module to MODULES, or move it earlier in the list.');
  process.exit(1);
}

const bundle = `/* GENERATED by app/build-domain.cjs — do not edit. Source: app/src/domain/ */
(function (root) {
'use strict';
const M = {};

${chunks.join('\n')}

root.Domain = M;
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;

/*
 * `--check` reports staleness instead of curing it.
 *
 * `npm test` runs this builder BEFORE the parity test, so by the time parity
 * compares source against bundle they have just been made to agree — the guard
 * catches a build that MANGLES semantics and can never catch a bundle that is
 * merely out of date. That is the risk §12 actually names: `harness/index.html`
 * loads `dist/proof-domain.js` directly and "a divergence would make the kill
 * test silently measure the wrong artifact". A tester walks the harness, the
 * harness runs month-old logic, and every test in this repo is green.
 *
 * So the freshness question gets its own answer, and one that does not repair
 * the evidence while looking at it.
 */
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  if (current === bundle) {
    console.log('dist/proof-domain.js is current');
    process.exit(0);
  }
  console.error(
    current === null
      ? 'dist/proof-domain.js does not exist — run `node build-domain.cjs`'
      : 'dist/proof-domain.js is STALE — the harness would run older logic than ' +
        'the tests. Run `node build-domain.cjs`.'
  );
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
/*
 * Written through a temp file and renamed, never straight over the top.
 *
 * `writeFileSync` truncates first and then writes, so for the whole of that
 * window the bundle on disk is EMPTY -- and this file is read concurrently:
 * `npm test` runs the suite as ~120 separate processes, and one of them
 * (`card-sheet-is-hard.test.ts`) `require`s this very artifact at load time.
 * A require that lands inside the window gets a file with no exports.
 *
 * Measured rather than reasoned about, because the window sounds narrow and
 * is not: hammering 400 rewrites while a second process read the path, 39 of
 * 50 reads saw ZERO bytes instead of 160,188. That is a sufficient mechanism
 * for R499's single unreproducible suite failure, which had already been
 * written off once as a phantom.
 *
 * `rename` within a directory is atomic, so a concurrent reader now sees
 * either the whole old bundle or the whole new one, never half of either.
 * The pid in the temp name keeps two concurrent builds from colliding.
 */
const tmp = OUT + '.tmp' + process.pid;
fs.writeFileSync(tmp, bundle);
/*
 * Windows refuses a rename ONTO a path another process currently has open,
 * with EPERM -- and a concurrent reader is precisely the case this rename
 * exists to protect, so the two collide by construction. Measured here while
 * building this: a reader looping on readFileSync made the rename fail outright.
 * Retry briefly; a reader's handle is open for microseconds, so this settles on
 * the first or second attempt or not at all.
 */
for (let attempt = 0; ; attempt++) {
  try { fs.renameSync(tmp, OUT); break; }
  catch (e) {
    if (attempt >= 200 || (e.code !== 'EPERM' && e.code !== 'EACCES' && e.code !== 'EBUSY')) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
    const until = Date.now() + 10;
    while (Date.now() < until) { /* brief spin; this is a build script */ }
  }
}

// Verify it actually loads and the exports are all present, rather than
// trusting that string surgery produced valid JavaScript.
const sandbox = {};
new Function('globalThis', bundle).call(sandbox, sandbox);
/*
 * Two questions, both derived, neither remembered.
 *
 * This used to check a hand-written list of 28 names, and that list had gone
 * wrong in both directions at once: the bundle publishes 108 names, so it was
 * verifying a quarter of them, and the harness -- the only consumer that
 * exists -- calls exactly TWO, so it was not a contract either. A list that is
 * neither complete nor accurate reports success for both reasons.
 *
 * COMPLETENESS: every name the bundler collected while parsing the modules
 * must survive into the registry. That is the question the string surgery can
 * actually get wrong, and it now covers everything rather than a sample.
 *
 * CONTRACT: what the harness needs is read out of the harness. `Domain.foo`
 * in its source IS the requirement, so it cannot drift from the thing it
 * describes -- adding a call there makes this build check for it, with no
 * list to update here and no way to forget.
 */
const collected = [...seenExports].sort();
const missing = collected.filter(n => typeof sandbox.Domain?.[n] === 'undefined');
if (missing.length) {
  console.error('FAILED — the bundle collected these exports but did not publish them: ' + missing.join(', '));
  process.exit(1);
}

/*
 * The whole harness the repo owns, not just its page: a Domain call added to
 * clip.js or encode.js is the same contract, and the test that used to guard
 * this scanned those files too. `node_modules` and the vendored muxer are
 * somebody else's code and are skipped.
 */
const harnessDir = path.join(__dirname, '..', 'harness');
let needed = [];
if (fs.existsSync(harnessDir)) {
  const owned = fs.readdirSync(harnessDir)
    .filter(f => /\.(html|js)$/.test(f) && f !== 'mp4-muxer.js')
    .map(f => path.join(harnessDir, f));
  needed = [...new Set(owned.flatMap(f => [...fs.readFileSync(f, 'utf8')
    .matchAll(/Domain\.([A-Za-z_$][\w$]*)/g)].map(m => m[1])))].sort();
  const unmet = needed.filter(n => typeof sandbox.Domain?.[n] === 'undefined');
  if (unmet.length) {
    console.error('FAILED — the harness calls names the bundle does not publish: ' + unmet.join(', '));
    process.exit(1);
  }
} else {
  console.error('FAILED — harness/ is missing, so its contract cannot be checked.');
  process.exit(1);
}

console.log(`wrote dist/proof-domain.js (${(bundle.length / 1024).toFixed(1)} kB)`);
console.log(`verified all ${collected.length} collected exports load in a bare scope,`);
console.log(`and the ${needed.length} the harness calls: ${needed.join(', ')}`);

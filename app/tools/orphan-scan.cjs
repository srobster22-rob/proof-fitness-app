/*
 * Dev-only: exported functions that tests exercise and nothing in the app calls.
 *
 * Twice now a function has sat in the codebase with its own passing tests and
 * no production caller — `armSet` (R176), superseded when set removal moved
 * into the edit sheet, and `FILTER_LABEL`/`SORT_LABEL` (R160), superseded by
 * the translation tables. Both read as coverage of a live feature while
 * guarding something the shipping app no longer ran, which is worse than no
 * test: it is a false statement about what is protected.
 *
 * This finds the shape mechanically. It reports candidates, not verdicts — a
 * hit may be deliberate API with a documented reason (`reachedAt`, R202), so
 * read the source before deleting anything.
 *
 *   node tools/orphan-scan.cjs
 *
 * Exits non-zero when there is something NEW to look at, so it can gate a
 * build; a run whose only hits are the acknowledged backlog exits 0.
 */
const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..');
/*
 * Every directory holding production source. `src/data` was missing until R483,
 * so this scanner — the one built to find code with no caller — could not see
 * `src/`'s third directory at all, while printing "scanned 47 source files"
 * underneath a clean verdict. That count reads as coverage and was not: the one
 * dead export this project actually knows about, `resetWebDb`, lives in
 * `src/data/web-db.ts` and was found in R461 by a HAND grep, not by this tool.
 *
 * HANDOFF trap 10 in the instrument written to catch trap 10. Adding the
 * directory took 47 files to 55 and surfaced two real orphans on the first run.
 *
 * `test/orphan-scan.test.ts` now derives this list from the filesystem, so a
 * fourth directory cannot be invisible the way the third was.
 */
const DIRS = ['src/domain', 'src/ui', 'src/data', 'app'];

/*
 * `tools/` counts as a caller, separately from the app.
 *
 * A dev tool is not the shipping app, but an export it drives is not dead
 * either — `suggestNext` sat on this list while `tools/predict-probe.ts` was
 * being built around it. Reporting that is a false positive, and a scanner
 * people learn to skim is a scanner that has stopped working.
 */
const TOOL_DIR = 'tools';

/*
 * Hits that have already been examined and consciously kept.
 *
 * R205 ran this, found seven, deleted the two that were provably superseded,
 * and left five that each need an owner's judgement rather than a developer's.
 * Reprinting those five identically on every run means the next person cannot
 * tell a NEW orphan from the backlog — which is the only thing this tool
 * exists to surface. Listed with the reason, so a clean run can say so.
 */
/*
 * R462: the peer's caution held up under a second look. `headline`'s reason
 * below ("shareText covers the shipped path") was checked against the real
 * call graph and found INACCURATE — `shareText` builds the share TEXT
 * message, a different surface with its own EXEMPT set (title/date/duration
 * excluded — see recap-fields-reach-consumers.test.ts); it does not compute
 * or subsume what `headline` computes. What actually happened: `headline`'s
 * claim-priority logic (PR beats a goal/trend line beats plain volume) is
 * independently REIMPLEMENTED, not called, by two real consumers —
 * `recap.tsx`'s own JSX and `spike/recap.js`'s `drawClaim`/`NARRATIVE` —
 * because neither can import TS domain code (the same cross-runtime boundary
 * `bundle-parity.test.ts` exists for). `headline` is a tested REFERENCE MODEL
 * of the rule those two copies each reimplement, with nothing enforcing
 * agreement — closer kin to the Swift-port drift HANDOFF.md already tracks
 * than to a genuinely redundant function. Corrected below rather than left
 * wrong.
 *
 * R463 correction: `link/copy.js` does NOT belong in that list. Read closely
 * for a completeness gate and found it answers a different question — its
 * `resolve()` is a two-way branch (has a PR / has any workout / bare) for
 * LANDING-PAGE marketing copy (which of four campaign variants' headline to
 * show), not the five-way claim-priority rule (PR / first session / early
 * best / goal / volume) `headline`, `recap.tsx` and `recap.js` share. Naming
 * it as a third instance of the same rule in R462's log entry was wrong —
 * recorded here rather than silently dropped, the same discipline this file
 * asks of every acknowledged reason.
 *
 * The REAL bug behind the false reason: `headline` itself was stale, not
 * merely unwired. It predates `firstSession`/`bestYet` on `RecapPayload`
 * (R435-442) and was missing both branches — the exact defect `shareText`'s
 * neighbouring branches (added in the same rounds) describe fixing for
 * themselves. Fixed in `recap-model.ts` (R463), with tests proving the two
 * missing branches now match `recap.tsx`'s and `recap.js`'s real guards.
 *
 * Every entry now states, in addition to why it's here, what would take it
 * off the list — a hand-maintained allowlist that only ever grows converges
 * on no gate at all, one reasonable-looking addition at a time.
 */
const ACKNOWLEDGED = {
  /*
   * The two `src/data` orphans this scanner found the moment it was allowed to
   * look there (R483). Both are half-finished extractions, and both are listed
   * with what is actually true about them rather than a shrug — an
   * acknowledged list whose reasons are wrong is worse than no list, which
   * R462 already found out the hard way with `headline`.
   */
  coachSuggestion:
    'the OWNER.md #2 rule engine (R517). Deliberately unwired for exactly one round: ' +
    'the engine is the half that can be proven right against fixtures and against the ' +
    "app's own seeded history, and it already caught a real defect that way — it told a " +
    'lifter on linear progression to "stay here" at a weight they had hit once. The ' +
    'screen half is a separate problem and a harder one: the Now column has no vertical ' +
    'room at all (R512 measured the 568px phone at 624px of unshrinkable content), so ' +
    'where a suggestion line goes has to be solved before it can be rendered, and ' +
    'solving it badly is how R511 pushed LOG SET below the fold. Removes when: the Now ' +
    'screen renders the line, which is the next round — if this entry is still here ' +
    'several rounds later, the engine is speculative code and should be deleted rather ' +
    'than kept.',
  lastSetOf:
    'a Repo method whose own comment calls it "the single hottest read in the app" and ' +
    'says the §4 prefill "is where the value comes from" — and no production code calls ' +
    'it (R483). The comment is false, and it cannot become true as written: the prefill ' +
    'has to compare across sessions, and a LoggedSet carries no unit, so `NowModel` ' +
    'converts the whole history through `historyInSessionUnit()` before `prefillFor` ' +
    'sees it (HANDOFF trap 9). A single-row SQL query cannot do that conversion, which ' +
    'is why the indexed path was abandoned rather than wired. `idx_sets_exercise_at` in ' +
    'schema.ts exists solely to serve this method and is therefore also unused, costing ' +
    'a write on every set logged. Removes when: an owner decides whether to delete the ' +
    'method (three tests use it, and portable.test.ts uses it as a convenient accessor, ' +
    'so deletion is not free) and whether dropping the index is worth a migration.',
  openOnce:
    'a SECOND implementation of a rule `db.ts` already implements and never adopted ' +
    '(R483). Its docstring says it "lives apart from db.ts purely so it can be tested", ' +
    'and db.ts:102 carries almost the same paragraph over its own copy — the extraction ' +
    'happened and the caller was never switched, the same half-done shape as the ' +
    'sparkline in R475. Worse than plain duplication: this one is SYNCHRONOUS ' +
    '(`open: () => T`) while the shipped `initRepo` is a Promise, so the eight tests in ' +
    'open-once.test.ts do not model the shipped path\'s harder case at all — a second ' +
    'call arriving while the first is still opening. Removes when: `db.ts` is refactored ' +
    'onto an async version of this and genuinely calls it (it drops off this list by ' +
    'gaining a real caller), or an owner deletes it as a decoy. Do NOT read the green ' +
    'open-once tests as coverage of `initRepo`.',
  missingKeys:
    'explicit test helper — "for the tests to check" is written above it (R205). ' +
    'Removes when: never expected to — it exists to be called FROM tests, not to gain a ' +
    'production caller. A permanent exemption by category, not a deferred one.',
  kindOf:
    'accessor over KINDS; only its own test reads it (R205). ' +
    'Removes when: never expected to, same category as missingKeys.',
  columnHeight:
    'layout arithmetic the Now tests assert the column against (R205). ' +
    'Removes when: never expected to — the tests exist to pin the arithmetic itself, not to ' +
    'stand in for a production call site that is coming.',
  headline:
    'a tested reference model of the claim-priority rule (PR beats first session beats early ' +
    'best beats goal/trend beats volume) that recap.tsx and spike/recap.js each independently ' +
    'reimplement rather than call, because neither can import TS domain code (R462 — corrected ' +
    'from R205\'s "shareText covers the shipped path," which was checked against the real call ' +
    'graph and found inaccurate: shareText solves a different problem, the share TEXT message, ' +
    'not this; link/copy.js was also named in R462 and was itself a mistake — its resolve() is a ' +
    'two-way landing-page-copy branch, not this rule, corrected R463). The rule itself was found ' +
    'stale, not just unwired: missing the firstSession/bestYet branches shareText already had — ' +
    'fixed R463, with tests pinning it against recap.tsx\'s and recap.js\'s real branch guards. ' +
    'The drift-risk gate is now built too (R466 — test/claim-priority-parity.test.ts), scoped to ' +
    'the slab choice specifically (goal-as-fallback vs goal-as-additive-row is a deliberate, ' +
    'documented difference between the surfaces, not something the gate forces to agree). ' +
    'Removes when: an owner decides the residual redundancy is not worth carrying and deletes ' +
    'this function, now that agreement is enforced rather than merely hoped for — flagged in ' +
    'HANDOFF.md.',
  goalE1rmGap:
    'built for a Progress secondary readout that was never wired in; correctness is tested ' +
    '(test/goals.test.ts) but the UI call site does not exist yet (R461). ' +
    'Removes when: it gets wired into progress-model.ts (drops off this list on its own, having ' +
    'gained a real caller), or an owner decides to delete it instead — flagged in HANDOFF.md.'
};

const files = [];
for (const d of DIRS) {
  const abs = path.join(HERE, d);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs)) {
    if (/\.(ts|tsx)$/.test(f)) files.push(path.join(d, f));
  }
}

const prod = files.map(f => ({ f, src: fs.readFileSync(path.join(HERE, f), 'utf8') }));

const readAll = (abs, re) =>
  fs.existsSync(abs)
    ? fs.readdirSync(abs)
        .filter(f => re.test(f))
        .map(f => fs.readFileSync(path.join(abs, f), 'utf8'))
        .join('\n')
    : '';

/*
 * Every tool EXCEPT this one.
 *
 * Naming `NowModel.next()` in the acknowledgement below made the scanner treat
 * itself as a caller, so the entry immediately reported "no longer orphaned" —
 * a tool that cannot mention what it is reporting without un-reporting it.
 */
const toolSrc = fs.readdirSync(path.join(HERE, TOOL_DIR))
  .filter(f => /\.(ts|cjs|js)$/.test(f) && f !== path.basename(__filename))
  .map(f => fs.readFileSync(path.join(HERE, TOOL_DIR, f), 'utf8'))
  .join('\n');
const testSrc = readAll(path.join(HERE, 'test'), /\.ts$/);

const called = (src, name) => new RegExp('\\b' + name + '\\s*\\(').test(src);
const callCount = (src, name) =>
  (src.match(new RegExp('\\b' + name + '\\s*\\(', 'g')) || []).length;

const orphans = [];

/*
 * Class METHODS, not only exported functions.
 *
 * `NowModel.next()` sat tested and uncalled for a very long time and this tool
 * could not see it: it scanned `export function` only, and a method on an
 * exported class is neither. It was the swipe §5 asks for. Two superseded jump
 * setters were hiding in the same blind spot.
 *
 * Same heuristic as below — a name nothing calls with a leading dot — which is
 * loose enough to produce false positives in principle and produced exactly
 * three real ones in practice.
 */
for (const { f, src } of prod) {
  if (!/export class/.test(src)) continue;
  for (const m of src.matchAll(/^  ([a-zA-Z_][A-Za-z0-9_]*)\(/gm)) {
    const name = m[1];
    if (['constructor', 'if', 'for', 'while', 'switch', 'catch', 'return'].includes(name)) continue;
    const dotted = new RegExp('\\.' + name + '\\s*\\(');
    if (prod.some(p => dotted.test(p.src))) continue;
    if (dotted.test(toolSrc)) continue;
    if (dotted.test(testSrc)) orphans.push({ name, f });
  }
}

for (const { f, src } of prod) {
  for (const m of src.matchAll(/^export function ([A-Za-z0-9_]+)/gm)) {
    const name = m[1];
    const elsewhere = prod.some(p => p.f !== f && called(p.src, name));
    // >1 because the declaration itself matches the call pattern.
    const selfUse = callCount(src, name) > 1;
    if (!elsewhere && !selfUse && !called(toolSrc, name) && called(testSrc, name)) {
      orphans.push({ name, f });
    }
  }
}

/*
 * The scan has to have looked at something.
 *
 * Every report below is "the list of problems is empty", which an empty sweep
 * satisfies perfectly — the exact failure R217 and R218 found in two other
 * checks, where a stale filter produced a confident clean result from zero
 * files. A count is the only thing that separates the two.
 */
if (prod.length < 8 || !testSrc.length) {
  console.error(
    'orphan-scan read ' + prod.length + ' source files and ' +
    testSrc.length + ' bytes of tests — too little to conclude anything.'
  );
  process.exitCode = 2;
  return;
}

const fresh = orphans.filter(o => !(o.name in ACKNOWLEDGED));
const known = orphans.filter(o => o.name in ACKNOWLEDGED);
const resolved = Object.keys(ACKNOWLEDGED).filter(n => !orphans.some(o => o.name === n));

/*
 * Name the directories, not just the count. A bare "scanned 47 source files"
 * is exactly what let `src/data` sit outside this scan unnoticed — a number
 * with no denominator reads as coverage. Saying WHERE it looked makes an
 * omission legible to anyone who glances at the output (HANDOFF trap 10:
 * anything reporting "no problems" must also report how much it examined).
 */
console.log('scanned ' + prod.length + ' source files in ' + DIRS.join(', ') +
  ' against the test suite.\n');

if (fresh.length) {
  console.log('NEW — tested, but no production caller. Read the source before acting:');
  for (const o of fresh) console.log('  ' + o.name.padEnd(28) + o.f);
} else {
  console.log('no new orphans: every tested export has a caller, or is on the known list.');
}

if (known.length) {
  console.log('\nknown, and kept on purpose:');
  for (const o of known) {
    console.log('  ' + o.name.padEnd(28) + o.f);
    console.log('  ' + ' '.repeat(28) + ACKNOWLEDGED[o.name]);
  }
}

/*
 * An acknowledged name that no longer shows up has been wired in or deleted,
 * so its entry is now a stale claim about the codebase — the same rot this
 * tool exists to catch, in the tool itself.
 */
if (resolved.length) {
  console.log('\nno longer orphaned — remove from ACKNOWLEDGED: ' + resolved.join(', '));
}

process.exitCode = fresh.length || resolved.length ? 1 : 0;

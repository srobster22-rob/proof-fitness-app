/*
 * Dev-only, and permanent (runs every `npm test`): a FIELD on a data-shape
 * interface that is computed and returned but never READ anywhere in
 * production source.
 *
 * `orphan-scan.cjs` catches this at the FUNCTION level — an exported name
 * with no caller. It cannot see this shape: `bestSetAtReps` returning the
 * full `LoggedSet` and `ProgressRow.bestAt` discarding `.at` before it ever
 * reached a screen was a live function with a live caller the whole time —
 * the waste was one field deep inside an object both were built to move.
 * Found by hand five times this session (`reachedAt` R267, `weeklyCard`'s own
 * unread `kind` R285, `bestAt`/`trendSince`/`goalBarA11y` R292-295) before
 * becoming a question worth asking mechanically instead of by luck.
 *
 * Same day it was written, it caught four more without anyone looking:
 * `ProgressRow.lastTrainedAt`, and three on `NowState` — `upNext`,
 * `prefillSource`, `planDays` — the sibling projects' own shape, computed on
 * every render and read by nothing. See `ACKNOWLEDGED` below.
 *
 *   node tools/field-scan.cjs
 *
 * Exits non-zero when there is something NEW to look at, same contract as
 * orphan-scan.cjs, so it gates a build without needing anyone to remember it.
 */
const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..');

/*
 * The interfaces this checks. Each is a data shape a model builds and a
 * screen (or another domain function) is meant to consume field by field —
 * as opposed to an opaque type nothing destructures, which this would only
 * ever report false positives on.
 */
const INTERFACES = [
  { file: 'src/ui/progress-model.ts', name: 'ProgressRow' },
  { file: 'src/domain/goals.ts', name: 'GoalProgress' },
  { file: 'src/ui/now-model.ts', name: 'NowState' },
  { file: 'src/ui/now-model.ts', name: 'RailLift' },
  { file: 'src/ui/measure-model.ts', name: 'KindRow' },
  { file: 'src/domain/measure-goal.ts', name: 'MeasureGoalProgress' },
  { file: 'src/data/portable.ts', name: 'RestoreReport' },
  { file: 'src/ui/progress-model.ts', name: 'SessionSummary' }
];

/*
 * Fields that have been examined and are staying, with the reason.
 *
 * A hit here is not "the app doesn't need this" — it may be a field kept for
 * a future screen, or dead weight nobody has removed yet. Read the note.
 * Same contract as `orphan-scan.cjs`'s own list: an entry that stops showing
 * up as unused is a stale claim and this tool says so.
 */
/*
 * R465: which of these reasons is checkable, and by what. `upNext`'s "12
 * tests" and "real logic dayRail still calls into" are checkable by reading
 * now-model.test.ts and grepping `candidates` — grep confirms both. Whether
 * "forcing a fourth label has no clean home" is a design judgment about
 * screen crowding, not something any test here observes; named as such
 * below rather than left to read as equally settled.
 */
const ACKNOWLEDGED = {
  upNext:
    'NowState — R300: kept, deliberately. `next()` was moved off it (R258: ' +
    'taking upNext could swipe somewhere the rail never named), so it has ' +
    'no UI surface of its own — but its 12 tests are not incidental debt, ' +
    'they are the only regression guard against reintroducing that exact ' +
    'bug (one test pins upNext and the rail\'s tag DIVERGING on a real ' +
    'fixture) and they separately pin the whole-library predictor itself ' +
    '(day-first ranking, history-beats-convention, cold-start fallback to ' +
    '`companionFor`) — real logic `dayRail` still calls into via the same ' +
    '`candidates` array, just capped and filtered differently. Deleting ' +
    'the field would mean inventing a parallel non-field seam just to keep ' +
    'testing that logic, which is more machinery for the same coverage. ' +
    'Acknowledged for good, as a deliberate test-only field. ' +
    'Removes when: never expected to — `next()` moving off it was the deliberate design (R258), ' +
    'not a step toward giving it a caller (R464).',
  prefillSource:
    'NowState — set from `this.source`, distinct from `.prefillSource` so ' +
    'this scan does not catch its own write. Only ever asserted in tests. ' +
    'R299: deliberately left unsurfaced, not a gap. `lastTimeParts()` ' +
    'already gives the Now hero its one prior/this-session/first-time ' +
    'distinction (`Last time` / `Just did` / `First time`), keyed on ' +
    'whether `previous` exists — the thing a lifter actually reads at a ' +
    'glance. `prefillSource`\'s seed/history/fallback split is a level ' +
    'finer than that (why a number showed up, not whether one did) and ' +
    'the Now hero is the most crowding-sensitive surface in the app; ' +
    'unlike the three Progress-row wins (bestAt/trendSince/lastTrainedAt), ' +
    'forcing a fourth label here has no clean home. Acknowledged for good. ' +
    'R555 RE-MEASURED THE CROWDING PREMISE and it no longer holds as stated: on a 375x568 ' +
    'phone with a full twelve-week history the column fits with ZERO overflow, and the ' +
    'head line uses 115px of a 335px column - 2.9x its current width still free. The ' +
    'constraint on that hero is VERTICAL, and a longer one-line label adds no height. ' +
    'Note also WHEN the label would ever show: only on day one or a movement never ' +
    'trained, which is the emptiest the screen ever is. So the first half of the ' +
    'Removes-when condition is arguably met on measurement; the second half is not ours ' +
    'to decide and is filed in OWNER.md. Left unsurfaced, deliberately, pending that. ' +
    'Removes when: an owner decides the extra distinction is worth the crowding (R464).'
};

function fields(file, ifaceName) {
  const abs = path.join(HERE, file);
  const src = fs.readFileSync(abs, 'utf8');
  const start = src.indexOf(`export interface ${ifaceName} {`);
  if (start < 0) return null;
  const end = src.indexOf('\n}', start);
  const body = src.slice(start, end);
  return [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map(m => m[1]);
}

/*
 * Everything the app could read a field from — every domain and UI file,
 * with the ONE interface block being checked cut out of its own defining
 * file. Cutting the whole file was tried first and produced a false
 * "unused" on `bestAt`/`trendSince`: their real readers (`bestSetA11y`,
 * `trendA11y`) live in the SAME file as the interface, right below it.
 */
/*
 * `src/data` joined the search in R560, and it had to before `RestoreReport`
 * could join the scan. `summarise()` reads `report.added` and
 * `report.skipped` and lives there, so scanning the shape without scanning
 * the file that consumes it reported three fields as dead that are read on
 * every restore. A gate that cries wolf gets switched off (R543), so the
 * population and the search area have to grow together.
 */
const DIRS = ['src/domain', 'src/ui', 'src/data', 'app'];
function prodMinusInterface(file, ifaceName) {
  let out = '';
  for (const d of DIRS) {
    const abs = path.join(HERE, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (!/\.tsx?$/.test(f)) continue;
      const rel = path.join(d, f).replace(/\\/g, '/');
      let content = fs.readFileSync(path.join(abs, f), 'utf8');
      if (rel === file) {
        const start = content.indexOf(`export interface ${ifaceName} {`);
        const end = content.indexOf('\n}', start);
        content = content.slice(0, start) + content.slice(end);
      }
      out += content + '\n';
    }
  }
  return out;
}

const missing = [];
const orphans = [];

for (const { file, name } of INTERFACES) {
  const flds = fields(file, name);
  if (flds === null) { missing.push(`${name} (${file})`); continue; }
  const prod = prodMinusInterface(file, name);
  for (const f of flds) {
    /*
     * Dot-access ONLY — `.field` — never the colon form (`field:`). A
     * colon-form match is ambiguous between a genuine destructure-read and
     * the field's own WRITE site inside the object literal that builds it,
     * and it is not a hypothetical: `lastTrainedAt: tops.length ? ...`
     * matched its OWN assignment line and reported itself as used, the
     * first time this ran. `region.ts`'s own two-anchor discipline exists
     * for the same reason a loose match reads the wrong thing.
     */
    /*
     * A write-only touch must not count as "used" either. `\.field\b` alone
     * matches `row.field += 1` and `row.field = x` exactly as readily as a
     * real read — calibrated in by hand (R301): a field touched only via
     * `+=`/`++`/`=` passed this scan clean while never once being read back.
     * So every `.field` occurrence is inspected, and at least one has to NOT
     * be immediately followed by an assignment operator (allowing `==`/`===`
     * through, since those compare rather than assign).
     */
    const re = new RegExp('\\.' + f + '\\b(\\s*(?:[-+*/%&|^]?=(?!=)|\\+\\+|--))?', 'g');
    const isRead = m => !m[1];
    const matches = [...prod.matchAll(re)];
    if (!matches.some(isRead)) orphans.push({ name, field: f });
  }
}

if (missing.length) {
  console.error('field-scan could not find these interfaces — check the anchors:\n  ' +
    missing.join('\n  '));
  process.exitCode = 2;
  return;
}

const fresh = orphans.filter(o => !(o.field in ACKNOWLEDGED));
const known = orphans.filter(o => o.field in ACKNOWLEDGED);
const resolved = Object.keys(ACKNOWLEDGED).filter(n => !orphans.some(o => o.field === n));

const totalFields = INTERFACES.reduce((n, i) => n + (fields(i.file, i.name)?.length ?? 0), 0);
console.log(`scanned ${INTERFACES.length} interfaces, ${totalFields} fields, against ${DIRS.join(' + ')}.\n`);

if (fresh.length) {
  console.log('NEW — computed, never read. Read the source before acting:');
  for (const o of fresh) console.log('  ' + `${o.name}.${o.field}`.padEnd(32));
} else {
  console.log('no new dead fields: every field is read somewhere, or is on the known list.');
}

if (known.length) {
  console.log('\nknown, and kept on purpose:');
  for (const o of known) {
    console.log('  ' + `${o.name}.${o.field}`.padEnd(32));
    console.log('  ' + ' '.repeat(32) + ACKNOWLEDGED[o.field]);
  }
}

if (resolved.length) {
  console.log('\nno longer dead — remove from ACKNOWLEDGED: ' + resolved.join(', '));
}

process.exitCode = fresh.length || resolved.length ? 1 : 0;

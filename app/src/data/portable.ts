import type { Repo } from './repo.ts';
import type { LoggedSet, Session, Exercise, Unit } from '../domain/types.ts';
import type { Goal } from '../domain/goals.ts';
import type { Measurement, MeasurementKind, MeasureUnit } from '../domain/measure.ts';
import type { MeasureGoal } from '../domain/measure-goal.ts';
import { KINDS } from '../domain/measure.ts';
import { t, fill, type Language } from '../domain/i18n.ts';
import { SCHEMA_VERSION } from './schema.ts';

/**
 * Export and restore. PROMPT.md §11.
 *
 *   "Plus a plain-file export, user-initiated. Cheap insurance, and a trust
 *    signal for an audience that is deeply sceptical of apps holding their data
 *    hostage."
 *
 * Two rules follow from that sentence and shape everything here:
 *
 *  1. **The file has to be readable by a human and by something that is not this
 *     app.** A SQLite blob would be a smaller, faster export and it would also be
 *     hostage-taking with extra steps. Plain JSON, self-describing keys.
 *  2. **Restore must never silently discard anything.** It reports what it
 *     skipped and why, because "imported successfully" over a file that lost half
 *     someone's history is worse than a clear failure.
 */

export const EXPORT_FORMAT = 'proof.export.v1';

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  /** Schema version the data came from, so a future reader can adapt. */
  schemaVersion: number;
  exportedAt: number;
  counts: {
    exercises: number; sessions: number; sets: number; goals: number;
    measurements: number; measureGoals: number;
  };
  exercises: Exercise[];
  sessions: Session[];
  sets: LoggedSet[];
  goals: Goal[];
  /*
   * Everything below is OPTIONAL on read and always written.
   *
   * The four arrays above were the whole file, and the erase confirmation on
   * Progress had already grown past them: it says "700 workouts, 14,000 sets,
   * 100 goals **and 3 measurements** will be deleted" — while the EXPORT MY
   * DATA button sitting directly above it wrote a file with no measurements in
   * it at all. The app named what it was about to destroy and offered a safety
   * net that did not cover it. Preferences were in the same position: `eraseAll`
   * hard-deletes them under the comment "their chosen jump amounts are theirs
   * too", and nothing carried them.
   *
   * Optional rather than required so that a file written before this still
   * restores — `parse` demands the original four and treats the rest as absent
   * rather than malformed.
   */
  measurements?: Measurement[];
  measureGoals?: MeasureGoal[];
  /** Unprefixed, as `repo.allPrefs()` returns them. */
  prefs?: Record<string, string>;
}

export function exportAll(repo: Repo, now: number): ExportFile {
  const exercises = [...repo.exercises().values()];
  const sets = repo.allSets();
  const goals = repo.goals();
  const measurements = repo.measurements();
  const measureGoals = repo.measureGoals();
  const prefs = repo.allPrefs();

  // Sessions are not directly enumerable, so derive them from the sets that
  // reference them. A session with no sets carries no information worth moving.
  const sessions: Session[] = [];
  for (const id of new Set(sets.map(s => s.sessionId))) {
    const session = repo.session(id);
    if (session) sessions.push(session);
  }
  sessions.sort((a, b) => a.startedAt - b.startedAt);

  return {
    format: EXPORT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now,
    counts: {
      exercises: exercises.length, sessions: sessions.length,
      sets: sets.length, goals: goals.length,
      measurements: measurements.length, measureGoals: measureGoals.length
    },
    exercises, sessions, sets, goals, measurements, measureGoals, prefs
  };
}

/** Stable, diffable, and small enough to paste into a support message. */
export function serialize(file: ExportFile): string {
  return JSON.stringify(file, null, 2);
}

export interface RestoreReport {
  ok: boolean;
  /** Why the whole file was rejected. Present only when ok is false. */
  fatal?: string;
  added: {
    exercises: number; sessions: number; sets: number; goals: number;
    measurements: number; measureGoals: number; prefs: number;
  };
  /** Rows that could not be restored, each with a reason. Never silently dropped. */
  skipped: Array<{ kind: string; id: string; reason: string }>;
}

const UNITS = new Set<Unit>(['lb', 'kg']);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

export function parse(text: string): { file: ExportFile; error: null } | { file: null; error: string } {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { file: null, error: `Not valid JSON: ${(e as Error).message}` };
  }
  if (!raw || typeof raw !== 'object') return { file: null, error: 'Not an export file.' };
  if (raw.format !== EXPORT_FORMAT) {
    return { file: null, error: `Unrecognised format: ${String(raw.format)}` };
  }
  if (isNum(raw.schemaVersion) && raw.schemaVersion > SCHEMA_VERSION) {
    // Refuse rather than guess: a newer file may carry columns this build would
    // drop on the next export, quietly losing data on a round trip.
    return {
      file: null,
      error: `That file is from a newer version of the app (schema ${raw.schemaVersion}, this build reads ${SCHEMA_VERSION}). Update and try again.`
    };
  }
  for (const key of ['exercises', 'sessions', 'sets', 'goals']) {
    if (!Array.isArray(raw[key])) return { file: null, error: `Missing or malformed "${key}".` };
  }
  /*
   * R627, filed R626. These three are OPTIONAL — older backups predate
   * measurements/targets, and `restore()` already treats an absent one as
   * empty (`file.measurements ?? []`, `file.prefs ?? {}`). Absent is fine;
   * present-but-wrong-shape is not, and until this round nothing caught it.
   * A hand-corrupted `"measurements": {}` passed straight through to
   * `restore()`'s `for (const m of file.measurements ?? [])`, which throws
   * on a non-iterable — caught by `applyBackup`'s try/catch so the app never
   * crashed, but the user got a raw `TypeError: ... is not iterable` instead
   * of the same clean "Missing or malformed" message every other field gets.
   */
  for (const key of ['measurements', 'measureGoals']) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) {
      return { file: null, error: `Missing or malformed "${key}".` };
    }
  }
  if (raw.prefs !== undefined && (typeof raw.prefs !== 'object' || raw.prefs === null || Array.isArray(raw.prefs))) {
    return { file: null, error: 'Missing or malformed "prefs".' };
  }
  return { file: raw as ExportFile, error: null };
}

/**
 * Merge an export into the current database.
 *
 * Additive by design — it never deletes. Restoring onto a device that has been
 * used since the export must not throw away the sets logged in between, and a
 * "replace everything" mode is a data-loss button wearing a helpful label.
 * Existing ids win; anything already present is skipped and reported.
 */
export function restore(repo: Repo, file: ExportFile): RestoreReport {
  const report: RestoreReport = {
    ok: true,
    added: {
      exercises: 0, sessions: 0, sets: 0, goals: 0,
      measurements: 0, measureGoals: 0, prefs: 0
    },
    skipped: []
  };
  const skip = (kind: string, id: unknown, reason: string) =>
    report.skipped.push({ kind, id: String(id ?? '?'), reason });

  // Exercises first — sets carry a foreign key to them.
  const knownExercises = new Set(repo.exercises().keys());
  for (const e of file.exercises) {
    if (!isStr(e?.id) || !isStr(e?.name)) { skip('exercise', e?.id, 'missing id or name'); continue; }
    if (knownExercises.has(e.id)) continue;              // already there, not an error
    // An id absent from the live map is either never-seen or deliberately
    // removed (§16 on removeExercise: only ever offered for one that has
    // never logged a set, so there is no history relying on it staying
    // gone the way a set's does). `addExercise` upserts and clears the
    // deleted flag, so calling it here for the second case would silently
    // undo a removal the moment an OLDER backup — from before the
    // deletion — gets restored. Same rule the set restore below already
    // gives an undone set.
    if (repo.exerciseWasRemoved(e.id)) { skip('exercise', e.id, 'deliberately removed on this device'); continue; }
    repo.addExercise(e.id, e.name);
    knownExercises.add(e.id);
    report.added.exercises++;
  }

  const knownSessions = new Set<string>();
  for (const s of file.sessions) {
    if (!isStr(s?.id) || !isNum(s?.startedAt)) { skip('session', s?.id, 'missing id or start time'); continue; }
    if (!UNITS.has(s.unit)) { skip('session', s.id, `unknown unit "${s.unit}"`); continue; }
    if (repo.session(s.id)) { knownSessions.add(s.id); continue; }
    // `startedAt` is restored, not re-stamped. Dropping it moved the workout to
    // the day of the restore while its sets kept their real timestamps — the
    // recap then read "WED 29 JUL / 1 MIN" for a 45-minute session on the 15th.
    // `updatedAt` gets the same treatment for the same reason: a live session
    // that had already gone idle before it was ever exported must not read as
    // freshly touched the moment it lands on the restoring device, or the
    // R333 idle rule never fires on it. Older backups predate the field, so
    // `s.updatedAt` is undefined for them and `startSession` falls back to now
    // — the honest answer when the file genuinely does not say.
    repo.startSession(s.id, s.unit, undefined, s.startedAt, isNum(s.updatedAt) ? s.updatedAt : undefined);
    if (s.endedAt != null) repo.endSession(s.id, s.endedAt);
    knownSessions.add(s.id);
    report.added.sessions++;
  }

  /*
   * Ids that exist in ANY state, soft-deleted included. `allSets()` hides a set
   * the user undid, but its row still owns the primary key, so restoring a
   * backup that predates the undo aborted the whole operation with a UNIQUE
   * constraint failure. Skipping it also means a deliberate deletion is never
   * silently reversed by a restore.
   */
  const existingSetIds = repo.knownSetIds();
  for (const st of file.sets) {
    if (!isStr(st?.id)) { skip('set', st?.id, 'missing id'); continue; }
    if (existingSetIds.has(st.id)) { skip('set', st.id, 'already on this device'); continue; }
    if (!isNum(st.weight) || !isNum(st.reps) || !isNum(st.at)) {
      skip('set', st.id, 'missing weight, reps or timestamp'); continue;
    }
    // Both foreign keys must exist or the write fails at the database level.
    if (!knownSessions.has(st.sessionId)) { skip('set', st.id, `session ${st.sessionId} not in file`); continue; }
    if (!knownExercises.has(st.exerciseId)) { skip('set', st.id, `exercise ${st.exerciseId} not in file`); continue; }
    repo.logSet(st);
    existingSetIds.add(st.id);
    report.added.sets++;
  }

  // Same rule for goals: `goals()` filters deleted, so a restore was quietly
  // resurrecting goals the user had removed and counting them as newly added.
  const existingGoalIds = repo.knownGoalIds();
  for (const g of file.goals) {
    if (!isStr(g?.id)) { skip('goal', g?.id, 'missing id'); continue; }
    if (existingGoalIds.has(g.id)) { skip('goal', g.id, 'already on this device'); continue; }
    if (!knownExercises.has(g.exerciseId)) { skip('goal', g.id, `exercise ${g.exerciseId} not in file`); continue; }
    try {
      repo.saveGoal(g);
      report.added.goals++;
    } catch (e) {
      // The three-goal cap is enforced at the write; hitting it on restore is
      // expected, not corruption.
      skip('goal', g.id, (e as Error).message);
    }
  }

  /*
   * Measurements. No foreign keys, so the only rules are the shape and the id.
   *
   * `knownMeasurementIds` rather than `measurements()` for the same reason sets
   * use `knownSetIds`: the read filters tombstones, so restoring a backup that
   * predates a deletion would silently resurrect a reading the user removed on
   * purpose — and count it as newly added.
   */
  const KIND_KEYS = new Set(Object.keys(KINDS));
  const existingMeasurements = repo.knownMeasurementIds();
  for (const m of file.measurements ?? []) {
    if (!isStr(m?.id)) { skip('measurement', m?.id, 'missing id'); continue; }
    if (existingMeasurements.has(m.id)) { skip('measurement', m.id, 'already on this device'); continue; }
    if (!KIND_KEYS.has(m.kind)) { skip('measurement', m.id, `unknown kind "${m.kind}"`); continue; }
    if (!isNum(m.value) || !isNum(m.at)) { skip('measurement', m.id, 'missing value or timestamp'); continue; }
    if (!isStr(m.unit)) { skip('measurement', m.id, 'missing unit'); continue; }
    repo.saveMeasurement({
      id: m.id, kind: m.kind as MeasurementKind, value: m.value,
      unit: m.unit as MeasureUnit, at: m.at, note: m.note ?? null
    });
    existingMeasurements.add(m.id);
    report.added.measurements++;
  }

  const existingMeasureGoals = repo.knownMeasureGoalIds();
  for (const g of file.measureGoals ?? []) {
    if (!isStr(g?.id)) { skip('target', g?.id, 'missing id'); continue; }
    if (existingMeasureGoals.has(g.id)) { skip('target', g.id, 'already on this device'); continue; }
    if (!KIND_KEYS.has(g.kind)) { skip('target', g.id, `unknown kind "${g.kind}"`); continue; }
    if (!isNum(g.target) || !isNum(g.targetDate) || !isNum(g.createdAt)) {
      skip('target', g.id, 'missing target, date or creation time'); continue;
    }
    try {
      repo.saveMeasureGoal(g);
      report.added.measureGoals++;
    } catch (e) {
      // One target per kind is enforced at the write. Hitting it on a restore
      // means the device already has one, which is not corruption.
      skip('target', g.id, (e as Error).message);
    }
  }

  /*
   * Preferences last, and NEVER over one already set on this device.
   *
   * Restore is additive everywhere else — it does not delete and it does not
   * overwrite — and a preference is the easiest thing to get that wrong with:
   * importing an old backup should not silently reset the unit or the split
   * somebody changed this morning.
   */
  for (const [key, value] of Object.entries(file.prefs ?? {})) {
    if (!isStr(key) || typeof value !== 'string') continue;
    if (repo.getPref(key) !== null) { skip('preference', key, 'already set on this device'); continue; }
    repo.setPref(key, value);
    report.added.prefs++;
  }

  return report;
}

/**
 * "1 session", not "1 sessions".
 *
 * A restore of one workout read "Restored 2 sets, 1 sessions." Small, and the
 * kind of small that reads as carelessness on the one screen whose whole job is
 * convincing somebody their training is safe.
 */
export function count(n: number, singular: string, plural = singular + 's'): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * One line for the user. Says what happened, including the awkward part.
 *
 * `lang` defaults to English so every existing caller and test keeps working
 * unchanged — this line reaches the one screen whose whole job is reassuring
 * somebody about their data, and it stayed English regardless of the LANGUAGE
 * setting until this parameter existed.
 */
export function summarise(report: RestoreReport, lang: Language = 'en'): string {
  if (!report.ok) return report.fatal ?? t(lang, 'restoreFailedPlain');
  const { sets, sessions, goals, measurements, measureGoals, prefs } = report.added;
  // Sets and sessions always, the rest only when there were any — naming a
  // category that came back empty reads as a failure rather than an absence.
  const parts = [
    count(sets, t(lang, 'setOne'), t(lang, 'sets')),
    count(sessions, t(lang, 'sessionOneLower'), t(lang, 'sessionsLower'))
  ];
  if (goals) parts.push(count(goals, t(lang, 'goalLower'), t(lang, 'goalsLower')));
  // Targets fold in with readings: "1 measurement, 1 target" is precise and
  // reads as bookkeeping. This line is a reassurance, not an inventory.
  const body = measurements + measureGoals;
  if (body) parts.push(count(body, t(lang, 'measurementLower'), t(lang, 'measurementsLower')));
  if (prefs) parts.push(count(prefs, t(lang, 'settingLower'), t(lang, 'settingsLower')));
  const head = fill(t(lang, 'restoredLine'), { parts: parts.join(', ') });
  if (!report.skipped.length) return head;
  /*
   * A REASON, not just a count (R568).
   *
   * `report.skipped` has always carried a reason per row and only the count
   * reached the user — "3 skipped" with no way to learn whether that was
   * ordinary or a sign the backup is damaged.
   *
   * "already on this device" is the harmless, EXPECTED case: restoring the
   * same file twice, or restoring after some of it was already merged in.
   * Everything else is a real signal — a foreign id space, a corrupted row, an
   * unknown unit — and a lifter who sees only a number cannot tell one from
   * the other, or know there is a real problem versus nothing to worry about.
   *
   * So: if every skip is the harmless kind, the count alone still speaks for
   * itself (no wall of near-identical detail, §15's quiet-by-default). The
   * moment even one skip is NOT that, name it — the first one, not all of
   * them, because a restore of a badly mismatched file could skip hundreds of
   * rows for the same underlying reason and this is a status line, not a log.
   */
  // The literal string `skip()` writes for the harmless case — a diagnostic
  // constant like `parsed.error`, not a translated key: skip reasons are meant
  // to be pasted into a support message as-is, the same reasoning applyBackup
  // already gives for parse errors.
  const real = report.skipped.find(s => s.reason !== 'already on this device');
  const tail = real
    ? fill(t(lang, 'skippedWithReason'), { n: report.skipped.length, reason: real.reason })
    : `${report.skipped.length} ${t(lang, 'skippedWord')}`;
  return `${head} ${tail}.`;
}

import type { LoggedSet, Session, Exercise, Unit } from '../domain/types.ts';
import { SCHEMA_VERSION, MIGRATIONS } from './schema.ts';
import { BUILTIN } from '../domain/coldstart.ts';
import { MAX_GOALS, activeGoals, type Goal } from '../domain/goals.ts';
import type { Measurement } from '../domain/measure.ts';
import type { MeasureGoal } from '../domain/measure-goal.ts';

/**
 * Persistence. PROMPT.md §12.
 *
 * Deliberately narrow: the domain functions are pure and take plain arrays, so
 * this layer's only job is to hand them arrays and put rows back. No business
 * logic lives here — PR rules, prediction and streaks stay testable without a
 * database, and this stays testable without them.
 *
 * `Db` is the minimal slice of node:sqlite's DatabaseSync that we use, so the
 * same code runs against expo-sqlite on device by supplying an adapter. Nothing
 * here imports a driver.
 */

/**
 * What SQLite can actually bind. Was `unknown`, which type-checked fine against
 * the node:sqlite test double and then failed against the real expo-sqlite
 * types — `unknown` is not assignable to a bind value, and no amount of casting
 * at the call site makes that untrue. Narrow is correct here: the repository
 * only ever binds strings, numbers and nulls.
 */
export type BindValue = string | number | null | Uint8Array;

export interface Stmt {
  run(...p: BindValue[]): unknown;
  all(...p: BindValue[]): unknown[];
  get(...p: BindValue[]): unknown;
}
export interface Db { exec(sql: string): void; prepare(sql: string): Stmt; }

type Row = Record<string, any>;

const toSet = (r: Row): LoggedSet => ({
  id: r.id, sessionId: r.session_id, exerciseId: r.exercise_id,
  weight: r.weight, reps: r.reps, at: r.at,
  // Null for every set logged before the columns existed. Left undefined
  // rather than defaulted, because "we do not know" is the truth about them.
  ...(r.equipment ? { equipment: r.equipment as LoggedSet['equipment'] } : {}),
  ...(r.machine ? { machine: String(r.machine) } : {}),
  ...(r.note ? { note: String(r.note) } : {})
});
const toMeasurement = (r: Row): Measurement => ({
  id: r.id, kind: r.kind as Measurement['kind'], value: r.value,
  unit: r.unit as Measurement['unit'], at: r.at,
  ...(r.note ? { note: String(r.note) } : {})
});
const toMeasureGoal = (r: Row): MeasureGoal => ({
  id: r.id, kind: r.kind as MeasureGoal['kind'], target: r.target,
  unit: r.unit as MeasureGoal['unit'], targetDate: r.target_date, createdAt: r.created_at
});
const toSession = (r: Row): Session => ({
  id: r.id, startedAt: r.started_at, endedAt: r.ended_at ?? null, unit: r.unit as Unit,
  updatedAt: r.updated_at
});
const toGoal = (r: Row): Goal => ({
  id: r.id, exerciseId: r.exercise_id, targetWeight: r.target_weight,
  targetReps: r.target_reps, targetDate: r.target_date,
  unit: r.unit as Unit, createdAt: r.created_at
});

export class Repo {
  // Declared explicitly rather than as constructor parameter properties:
  // those need a real transform, and this project runs TypeScript through
  // Node's strip-only mode, which erases types and rewrites nothing.
  db: Db;
  now: () => number;

  /** See `allSets` — null means "not read yet or invalidated". */
  private setsCache: LoggedSet[] | null = null;
  private goalsCache: Goal[] | null = null;
  private measureCache: Measurement[] | null = null;
  private measureGoalCache: MeasureGoal[] | null = null;

  constructor(db: Db, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
    this.migrate();
  }

  /** Runs pending migrations. Safe to call on every launch. */
  migrate(): void {
    this.dirty();
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as Row | undefined;
    const current = row ? Number(row.value) : 0;

    for (let v = current; v < MIGRATIONS.length; v++) this.db.exec(MIGRATIONS[v]);

    if (current < SCHEMA_VERSION) {
      this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run('schema_version', String(SCHEMA_VERSION));
      this.seedBuiltins();
    }
  }

  /** §6 — the starting twelve exist before the user has done anything. */
  private seedBuiltins(): void {
    const stmt = this.db.prepare(
      'INSERT INTO exercises (id, name, builtin, updated_at) VALUES (?, ?, 1, ?) ' +
      'ON CONFLICT(id) DO NOTHING'
    );
    const t = this.now();
    for (const e of BUILTIN) stmt.run(e.id, e.name, t);
  }

  // ---- exercises ----------------------------------------------------------

  exercises(): Map<string, Exercise> {
    const rows = this.db.prepare('SELECT id, name FROM exercises WHERE deleted = 0').all() as Row[];
    return new Map(rows.map(r => [r.id as string, { id: r.id, name: r.name } as Exercise]));
  }

  /**
   * True only for an id that WAS a custom exercise and was deliberately
   * removed — never seen at all returns false, same as one that is still
   * live. `restore` needs this one distinction `exercises()` cannot make on
   * its own: an id missing from the live map is either "never existed" (add
   * it) or "existed and was removed on purpose" (leave it gone), and treating
   * both the same way resurrects a deletion the moment an old backup lands.
   */
  exerciseWasRemoved(id: string): boolean {
    const row = this.db.prepare('SELECT deleted FROM exercises WHERE id = ?').get(id) as Row | undefined;
    return !!row && row.deleted === 1;
  }

  /**
   * Undo a custom exercise added by mistake — a typo, a duplicate, a name
   * picked and immediately regretted. §16: adding one has always existed;
   * removing one never did, so a slip stayed in the picker forever.
   *
   * Refuses rather than orphaning anything: a built-in cannot go (it is not
   * this user's to remove), and a custom one that has EVER logged a set —
   * including one since undone — is kept, because soft-deleting the exercise
   * while its own set rows still reference it would leave `exercises()`
   * silently missing an id that history still points at. Only a genuinely
   * untouched mistake, added and never logged against, can go.
   *
   * Returns whether it actually removed anything, so a caller cannot assume
   * success from a call that was silently refused.
   */
  removeExercise(id: string): boolean {
    const row = this.db.prepare(
      'SELECT builtin FROM exercises WHERE id = ? AND deleted = 0'
    ).get(id) as Row | undefined;
    if (!row || row.builtin) return false;
    const used = this.db.prepare(
      'SELECT 1 FROM sets WHERE exercise_id = ? LIMIT 1'
    ).get(id);
    if (used) return false;
    this.db.prepare('UPDATE exercises SET deleted = 1, updated_at = ? WHERE id = ?')
      .run(this.now(), id);
    return true;
  }

  addExercise(id: string, name: string): void {
    this.db.prepare(
      'INSERT INTO exercises (id, name, builtin, updated_at) VALUES (?, ?, 0, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at, deleted = 0'
    ).run(id, name, this.now());
  }

  // ---- sessions -----------------------------------------------------------

  /**
   * @param at When the session began. Defaults to now, which is right for the
   *           app — it only ever starts a session in the present — and wrong
   *           for `restore`, which knows exactly when the workout happened.
   *           Without it, restoring a backup stamped every session with the
   *           restore time: a 15 July / 45 MIN workout came back as 29 July /
   *           1 MIN while its own sets kept their true timestamps, leaving the
   *           database disagreeing with itself.
   * @param updatedAt Same reasoning, one field over. Defaults to now for the
   *           same reason `at` does — but `restore` importing a session that
   *           was still live (killed mid-workout, never auto-ended) and
   *           stamping it with the RESTORE time undoes the R333 idle rule the
   *           moment a backup touches it: a session that had already sat idle
   *           three hours on the device it came from reads as freshly touched
   *           on the device it lands on, and never auto-ends. Preserved for
   *           the same reason `startedAt` is.
   */
  startSession(id: string, unit: Unit, title?: string, at?: number, updatedAt?: number): Session {
    const t = at ?? this.now();
    const u = updatedAt ?? this.now();
    this.unitsCache = null;
    this.db.prepare(
      'INSERT INTO sessions (id, started_at, ended_at, unit, title, updated_at) VALUES (?, ?, NULL, ?, ?, ?)'
    ).run(id, t, unit, title ?? null, u);
    return { id, startedAt: t, endedAt: null, unit, updatedAt: u };
  }

  /** The live session, if there is one. §4: cold launch goes straight here. */
  liveSession(): Session | null {
    const r = this.db.prepare(
      'SELECT * FROM sessions WHERE ended_at IS NULL AND deleted = 0 ORDER BY started_at DESC LIMIT 1'
    ).get() as Row | undefined;
    return r ? toSession(r) : null;
  }

  endSession(id: string, endedAt: number): void {
    this.db.prepare('UPDATE sessions SET ended_at = ?, updated_at = ? WHERE id = ?')
      .run(endedAt, this.now(), id);
  }

  /**
   * Put a finished session back into progress.
   *
   * FINISH used to be one-way. It is the last thing you tap while still stood
   * in the gym, which is exactly when you notice the set you typed wrong — and
   * the only route back was to start a NEW workout and log corrections into it,
   * which splits one session into two and puts the fix on the wrong day.
   *
   * Clearing `ended_at` is all it takes: `liveSession()` finds it again, and
   * every set, its start time and its order are untouched. FINISH just sets the
   * end time again, so a reopened session that is finished a second time is the
   * same session with a later end.
   */
  reopenSession(id: string): boolean {
    const r = this.db.prepare('SELECT id FROM sessions WHERE id = ? AND deleted = 0').get(id);
    if (!r) return false;
    this.db.prepare('UPDATE sessions SET ended_at = NULL, updated_at = ? WHERE id = ?')
      .run(this.now(), id);
    return true;
  }

  /**
   * The unit of the most recent session, live or finished. Null on a fresh
   * install. Drives `unitForNewSession` — a user's chosen unit must outlive any
   * locale guess.
   */
  /**
   * Which unit every session was logged in, by session id.
   *
   * A `LoggedSet` deliberately carries no unit of its own — the session owns it
   * (see types.ts) — which is fine until something reads a set's weight against
   * a DIFFERENT session's unit. Then 195 lb becomes "195 kg", and the number is
   * out by a factor of 2.2 with nothing on screen to say so.
   *
   * Memoised on its OWN flag (R665), not the sets generation. `startSession`
   * does not call `dirty()`, so a cache keyed on sets would miss the one event
   * that adds a row — and a stale unit map is the exact bug this method exists
   * to prevent, wearing a hat. It used to be unmemoised on the belief that it
   * was "read when the exercise changes, not on every render"; measured at 800
   * sessions, `state()` read it twice per tap and it was the largest single
   * cost of a repeat render.
   *
   * Sound because a session's unit is written exactly once, by the INSERT in
   * `startSession`: `endSession` and `reopenSession` touch only `ended_at`,
   * nothing soft-deletes a session, and `eraseAll` drops the lot. Those two
   * clear the memo. Callers only read the map (checked: no `.set`/`.delete`
   * on it anywhere), which is what makes handing out one shared instance safe.
   */
  private unitsCache: Map<string, Unit> | null = null;

  sessionUnits(): Map<string, Unit> {
    if (this.unitsCache) return this.unitsCache;
    const rows = this.db.prepare(
      'SELECT id, unit FROM sessions WHERE deleted = 0'
    ).all() as Row[];
    this.unitsCache = new Map(rows.map(r => [String(r.id), r.unit as Unit]));
    return this.unitsCache;
  }

  lastUsedUnit(): Unit | null {
    const r = this.db.prepare(
      'SELECT unit FROM sessions WHERE deleted = 0 ORDER BY started_at DESC LIMIT 1'
    ).get() as Row | undefined;
    return r ? (r.unit as Unit) : null;
  }

  session(id: string): Session | null {
    const r = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Row | undefined;
    return r ? toSession(r) : null;
  }

  // ---- sets ---------------------------------------------------------------

  logSet(s: LoggedSet): void {
    this.dirty();
    this.db.prepare(
      'INSERT INTO sets (id, session_id, exercise_id, weight, reps, at, equipment, machine, note, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      s.id, s.sessionId, s.exerciseId, s.weight, s.reps, s.at,
      s.equipment ?? null,
      // Only meaningful for a machine. Storing "Arsenal" against a barbell set
      // would be a fact about nothing.
      s.equipment === 'machine' ? (s.machine?.trim() || null) : null,
      s.note?.trim() || null,
      this.now()
    );
  }

  /**
   * Amend a set that is already logged.
   *
   * The only way to fix a wrong set used to be to destroy it and log another,
   * which loses its place in the session and its `at` — so a mistyped middle
   * set became a set at the END of the workout, in the wrong order, and the
   * recap's "top set per exercise" read a different session than the one that
   * happened. Editing in place keeps the id, the time and the order.
   *
   * `note` is passed as `undefined` to leave it alone and as `null` or `''` to
   * clear it: a caller that only wants to fix the weight must not silently
   * erase what the lifter wrote.
   */
  updateSet(
    id: string,
    patch: { weight?: number; reps?: number; note?: string | null }
  ): boolean {
    const row = this.db.prepare('SELECT * FROM sets WHERE id = ? AND deleted = 0').get(id) as Row | undefined;
    if (!row) return false;
    this.dirty();
    const note = patch.note === undefined
      ? (row.note ?? null)
      : (patch.note?.trim() || null);
    this.db.prepare(
      'UPDATE sets SET weight = ?, reps = ?, note = ?, updated_at = ? WHERE id = ?'
    ).run(
      patch.weight ?? row.weight,
      patch.reps ?? row.reps,
      note,
      this.now(),
      id
    );
    return true;
  }

  /**
   * Machines this user has actually logged on, most recent first.
   *
   * "Save the machine for easy access" needs no table: the machines someone
   * knows about are the ones they have used, so the list IS the history.
   * A second table would be a second home for the same fact, and the two would
   * drift the moment a set was deleted.
   *
   * Scoped to one exercise when given, because the machines that matter when
   * you are standing at the lateral raise are the lateral raise machines.
   */
  knownMachines(exerciseId?: string): string[] {
    const rows = (exerciseId
      ? this.db.prepare(
          'SELECT machine, MAX(at) AS last FROM sets ' +
          'WHERE machine IS NOT NULL AND deleted = 0 AND exercise_id = ? ' +
          'GROUP BY machine ORDER BY last DESC, machine ASC'
        ).all(exerciseId)
      : this.db.prepare(
          'SELECT machine, MAX(at) AS last FROM sets ' +
          'WHERE machine IS NOT NULL AND deleted = 0 ' +
          'GROUP BY machine ORDER BY last DESC, machine ASC'
        ).all()) as Row[];
    return rows.map(r => String(r.machine));
  }

  /** Soft delete — a tombstone, so §11 sync can propagate the removal. */
  deleteSet(id: string): void {
    this.dirty();
    this.db.prepare('UPDATE sets SET deleted = 1, updated_at = ? WHERE id = ?').run(this.now(), id);
  }

  setsInSession(sessionId: string): LoggedSet[] {
    return (this.db.prepare(
      'SELECT * FROM sets WHERE session_id = ? AND deleted = 0 ORDER BY at ASC'
    ).all(sessionId) as Row[]).map(toSet);
  }

  /**
   * Everything logged BEFORE a session — the shape `findPRs` wants.
   * Excludes the session itself so a set cannot beat itself.
   */
  historyBefore(sessionId: string): LoggedSet[] {
    return (this.db.prepare(
      'SELECT * FROM sets WHERE deleted = 0 AND session_id != ? ' +
      'AND at < (SELECT MIN(at) FROM sets WHERE session_id = ?) ORDER BY at ASC'
    ).all(sessionId, sessionId) as Row[]).map(toSet);
  }

  /**
   * Every set on the device, oldest first — memoised until something writes.
   *
   * This is the hot read in the whole app. `NowModel.state()` alone calls it
   * five times, and `state()` runs on every tap of the logging path, so its
   * cost is paid per stepper press. Measured against five years of training
   * (9,360 sets, native sqlite): one call is 11.4ms and `state()` was 47ms —
   * three frames dropped on every tap, and getting worse the longer somebody
   * uses the app. §4's claim is that this is the fastest way to record a set,
   * and that claim was decaying fastest for the users who had earned it.
   *
   * A cache is safe because this Repo is the only writer: every mutation calls
   * `dirty()`. It is deliberately NOT a query cache keyed on arguments — one
   * array, one flag, invalidated by anything that could change it, which is
   * small enough to reason about.
   *
   * The array is frozen because callers keep it: handing out a mutable
   * reference to the cache would let one screen's `.sort()` reorder another's.
   */
  allSets(): LoggedSet[] {
    if (this.setsCache) return this.setsCache;
    const rows = (this.db.prepare('SELECT * FROM sets WHERE deleted = 0 ORDER BY at ASC').all() as Row[])
      .map(toSet);
    this.setsCache = Object.freeze(rows) as unknown as LoggedSet[];
    return this.setsCache;
  }

  /** Drop the memoised read. Called by every method that writes to `sets`. */
  private dirty(): void {
    this.setsCache = null;
  }

  /** The same, for anything that writes to `goals`. */
  private goalsDirty(): void {
    this.goalsCache = null;
  }

  // ---- goals (§5 screen 3) -------------------------------------------------

  /**
   * A small key/value store for the user's own settings.
   *
   * §9 bans a settings screen, which is a rule about SURFACE, not about the
   * app having no preferences — the jump amounts are set from the control they
   * change, on the screen they act on. This is where the chosen values live so
   * they survive a relaunch, and `meta` already exists for the schema version.
   */
  getPref(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?')
      .get(`pref.${key}`) as Row | undefined;
    return row ? String(row.value) : null;
  }

  setPref(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(`pref.${key}`, value);
  }

  /**
   * Forget a preference, so the app's own default takes over again.
   *
   * Missing until a settings field was cleared and watched: the jump inputs
   * wrote on every keystroke and skipped the write when the field was empty,
   * so emptying one left the OLD custom value in force behind a placeholder
   * showing the default. A user who had set 50 lb, cleared the field to go
   * back to a plate, and walked away kept jumping by 50 while the screen read
   * 45. Deleting the row is the only honest meaning of "I no longer have a
   * preference" — writing the default back in would look identical today and
   * pin the value if the default ever changed.
   */
  clearPref(key: string): void {
    this.db.prepare('DELETE FROM meta WHERE key = ?').run(`pref.${key}`);
  }

  /**
   * Erase everything the user has put in, and leave a usable app behind.
   *
   * A HARD delete, not the soft one every other write uses. `deleted = 1` is
   * there so a future CloudKit reconciliation has tombstones (§11), but a user
   * who asks to erase their data means erase it — leaving 1,680 rows marked
   * "deleted" and calling that erased would be a lie told for a sync feature
   * that does not exist yet.
   *
   * The twelve built-in movements are re-seeded rather than dropped: they are
   * library, not user data, and without them the next launch has nothing to
   * offer. What goes is every set, session, goal, and any movement the user
   * invented.
   *
   * There is no undo. §11 has no server copy, so the only thing standing behind
   * this is the user's own export — which is exactly why the control that calls
   * it sits next to EXPORT MY DATA.
   */
  eraseAll(): void {
    this.dirty();
    this.unitsCache = null;
    this.goalsDirty();
    this.measureDirty();
    this.measureGoalDirty();
    this.db.exec(
      'DELETE FROM sets; DELETE FROM goals; DELETE FROM sessions; DELETE FROM exercises; ' +
      'DELETE FROM measurements; DELETE FROM measure_goals;'
    );
    // Their chosen jump amounts are theirs too. The schema version is not.
    this.db.prepare("DELETE FROM meta WHERE key LIKE 'pref.%'").run();
    this.seedBuiltins();
  }

  /**
   * Every set id the table holds, **including soft-deleted ones**.
   *
   * `allSets()` filters `deleted = 0`, so a set the user undid is invisible to
   * it while its row still owns the primary key. `restore` used `allSets()` to
   * decide what it already had, tried to insert the undone set, and the whole
   * restore aborted with "UNIQUE constraint failed: sets.id" — so undoing a
   * single set made that backup permanently un-restorable.
   */
  knownSetIds(): Set<string> {
    return new Set((this.db.prepare('SELECT id FROM sets').all() as Row[])
      .map(r => String(r.id)));
  }

  /** Every measurement id, tombstones included. Same reason as `knownSetIds`. */
  knownMeasurementIds(): Set<string> {
    return new Set((this.db.prepare('SELECT id FROM measurements').all() as Row[])
      .map(r => String(r.id)));
  }

  /** Every measurement-goal id, tombstones included. */
  knownMeasureGoalIds(): Set<string> {
    return new Set((this.db.prepare('SELECT id FROM measure_goals').all() as Row[])
      .map(r => String(r.id)));
  }

  /**
   * Every preference, unprefixed, for the backup.
   *
   * `eraseAll` hard-deletes these with the comment "their chosen jump amounts
   * are theirs too" — so the app already classifies them as the user's data.
   * They then were not in the export, which made the round trip lossy in a way
   * only the user would ever notice, and only afterwards.
   */
  allPrefs(): Record<string, string> {
    const rows = this.db.prepare("SELECT key, value FROM meta WHERE key LIKE 'pref.%'")
      .all() as Row[];
    const out: Record<string, string> = {};
    for (const r of rows) out[String(r.key).slice('pref.'.length)] = String(r.value);
    return out;
  }

  /**
   * Exercises the user named themselves — not the starting twelve `seedBuiltins`
   * installs before they have done anything, which `eraseAll` puts straight back.
   * A custom exercise does not come back: it is the user's own naming work, the
   * same way their jump amounts and their language choice are theirs. See
   * `erasureLine` (R446) for why this needs to be countable at all.
   */
  customExerciseCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as n FROM exercises WHERE deleted = 0 AND builtin = 0')
      .get() as Row;
    return row.n as number;
  }

  /** Every goal id, including soft-deleted ones. Same reason as `knownSetIds`. */
  knownGoalIds(): Set<string> {
    return new Set((this.db.prepare('SELECT id FROM goals').all() as Row[])
      .map(r => String(r.id)));
  }

  /** Live goals, newest first. Capped at MAX_GOALS by `saveGoal`. */
  /*
   * Memoised for the same reason `allSets` is, and for a worse cadence.
   *
   * The Now screen calls `state()` on every render, and during rest that is
   * once a SECOND for the whole timer — the goal on the lift being trained is
   * read from here each time. On the Goals screen it is read once per card per
   * render, and the cap is a hundred. None of those reads can change without
   * going through this class.
   *
   * Frozen for the same reason too: callers keep the array, and `rankGoals`
   * sorts what it is handed.
   */
  goals(): Goal[] {
    if (this.goalsCache) return this.goalsCache;
    const rows = (this.db.prepare(
      'SELECT * FROM goals WHERE deleted = 0 ORDER BY created_at DESC'
    ).all() as Row[]).map(toGoal);
    this.goalsCache = Object.freeze(rows) as unknown as Goal[];
    return this.goalsCache;
  }

  /**
   * Create or update a goal.
   *
   * Validation lives in the domain (`validateNewGoal`), not here — but the cap
   * is enforced at the write as well, because a UI bug that let a fourth goal
   * through would otherwise persist it and §5's "three is a hard cap" would
   * quietly stop being true.
   */
  saveGoal(goal: Goal): void {
    const existing = this.goals();
    const isNew = !existing.some(g => g.id === goal.id);
    // Achieved goals are results, not commitments, and do not occupy a slot —
    // see `activeGoals`. Counting them here made three wins a dead end.
    if (isNew && activeGoals(existing, this.allSets(), this.sessionUnits()).length >= MAX_GOALS) {
      throw new Error(`refusing a ${existing.length + 1}th goal — §5 caps this at ${MAX_GOALS}`);
    }
    this.db.prepare(
      'INSERT INTO goals (id, exercise_id, target_weight, target_reps, target_date, unit, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET target_weight = excluded.target_weight, ' +
      'target_reps = excluded.target_reps, target_date = excluded.target_date, ' +
      'unit = excluded.unit, updated_at = excluded.updated_at, deleted = 0'
    ).run(goal.id, goal.exerciseId, goal.targetWeight, goal.targetReps,
          goal.targetDate, goal.unit, goal.createdAt, this.now());
    this.goalsDirty();
  }

  // ---- measurements (of the lifter, not of a lift) -------------------------

  /**
   * Every reading, newest last.
   *
   * Memoised like `allSets` and `goals`: the Now screen needs a bodyweight to
   * work out what a pull-up actually weighed, and that is inside `state()`,
   * which runs on every render and once a second through a rest timer.
   *
   * Ordered oldest-first because everything that consumes it — trends, "what
   * did I weigh then" — reads forwards through time.
   */
  measurements(): Measurement[] {
    if (this.measureCache) return this.measureCache;
    const rows = (this.db.prepare(
      'SELECT * FROM measurements WHERE deleted = 0 ORDER BY at ASC'
    ).all() as Row[]).map(toMeasurement);
    this.measureCache = Object.freeze(rows) as unknown as Measurement[];
    return this.measureCache;
  }

  /**
   * Record a reading, or correct one.
   *
   * Upserts on id like `saveGoal`, so fixing a mistyped weight keeps the entry
   * where it was in time rather than adding a second, contradictory one.
   */
  saveMeasurement(m: Measurement): void {
    this.measureDirty();
    this.db.prepare(
      'INSERT INTO measurements (id, kind, value, unit, at, note, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET value = excluded.value, unit = excluded.unit, ' +
      'at = excluded.at, note = excluded.note, updated_at = excluded.updated_at, deleted = 0'
    ).run(m.id, m.kind, m.value, m.unit, m.at, m.note?.trim() || null, this.now());
  }

  /** Soft delete, so §11 sync can propagate the removal. */
  deleteMeasurement(id: string): void {
    this.measureDirty();
    this.db.prepare('UPDATE measurements SET deleted = 1, updated_at = ? WHERE id = ?')
      .run(this.now(), id);
  }

  private measureDirty(): void {
    this.measureCache = null;
  }

  // ---- goals about the lifter ---------------------------------------------

  /** Live measurement goals, newest first. At most one per kind. */
  measureGoals(): MeasureGoal[] {
    if (this.measureGoalCache) return this.measureGoalCache;
    const rows = (this.db.prepare(
      'SELECT * FROM measure_goals WHERE deleted = 0 ORDER BY created_at DESC'
    ).all() as Row[]).map(toMeasureGoal);
    this.measureGoalCache = Object.freeze(rows) as unknown as MeasureGoal[];
    return this.measureGoalCache;
  }

  /**
   * Create or update a target.
   *
   * One per kind, enforced here as well as in `validateMeasureGoal`, for the
   * same reason `saveGoal` enforces its cap at the write: a UI bug that let a
   * second bodyweight target through would persist it, and "one per kind" would
   * quietly stop being true for that install for ever.
   */
  saveMeasureGoal(goal: MeasureGoal): void {
    const clash = this.measureGoals().some(g => g.kind === goal.kind && g.id !== goal.id);
    if (clash) throw new Error(`a ${goal.kind} target already exists`);
    this.measureGoalDirty();
    this.db.prepare(
      'INSERT INTO measure_goals (id, kind, target, unit, target_date, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET target = excluded.target, unit = excluded.unit, ' +
      'target_date = excluded.target_date, updated_at = excluded.updated_at, deleted = 0'
    ).run(goal.id, goal.kind, goal.target, goal.unit, goal.targetDate,
          goal.createdAt, this.now());
  }

  /** Soft delete, so §11 sync can propagate the removal. */
  deleteMeasureGoal(id: string): void {
    this.measureGoalDirty();
    this.db.prepare('UPDATE measure_goals SET deleted = 1, updated_at = ? WHERE id = ?')
      .run(this.now(), id);
  }

  private measureGoalDirty(): void {
    this.measureGoalCache = null;
  }

  /** Soft delete, so §11 sync can propagate the removal. */
  deleteGoal(id: string): void {
    this.db.prepare('UPDATE goals SET deleted = 1, updated_at = ? WHERE id = ?')
      .run(this.now(), id);
    this.goalsDirty();
  }

  /**
   * The most recent set of one lift.
   *
   * This comment used to say it was "the single hottest read in the app" and
   * that §4's prefill "is where the value comes from". Neither is true and
   * neither can be (R483): nothing in production calls this, and the prefill
   * cannot use it. A `LoggedSet` carries no unit — the SESSION owns it — so
   * `NowModel` converts the entire history through `historyInSessionUnit()`
   * before handing it to `prefillFor`, and a single-row SQL query cannot do
   * that conversion (HANDOFF trap 9). The indexed path was abandoned, not
   * wired, and the comment outlived the decision.
   *
   * Left in place rather than deleted because three tests use it and
   * `portable.test.ts` reads it as a convenient accessor when comparing a
   * restored database against its source; whether to remove it, and whether
   * dropping the now-unused `idx_sets_exercise_at` is worth a migration, is an
   * owner's call. Listed in `tools/orphan-scan.cjs` so it stays visible.
   */
  lastSetOf(exerciseId: string): LoggedSet | null {
    const r = this.db.prepare(
      'SELECT * FROM sets WHERE exercise_id = ? AND deleted = 0 ORDER BY at DESC LIMIT 1'
    ).get(exerciseId) as Row | undefined;
    return r ? toSet(r) : null;
  }
}

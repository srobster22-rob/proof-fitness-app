/**
 * SQLite schema. PROMPT.md §12 — local-first, data lives on the device from the
 * first tap and no network call is required for any core action.
 *
 * Design notes that are not obvious from the DDL:
 *
 * - Weight is stored in the unit it was ENTERED in, alongside that unit, rather
 *   than normalised to one canonical unit. Normalising loses the user's actual
 *   plate loadout to float error: 102.5 kg round-tripped through pounds does not
 *   come back 102.5, and a lifter who sees their own numbers drift stops
 *   trusting the app. Conversion is a display concern.
 *
 * - `at` is epoch ms, not a SQLite date. The domain layer is pure and takes
 *   numbers; storing text dates would mean parsing on every read of the hot path.
 *
 * - Every table carries `updated_at` and a soft `deleted` flag. Both exist for
 *   §11 sync: CloudKit reconciliation needs last-writer-wins timestamps and
 *   tombstones, and retrofitting them onto a shipped local database is a
 *   migration nobody enjoys.
 */

export const SCHEMA_VERSION = 6;

export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exercises (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  -- 1 for the built-in starting twelve, 0 for anything the user added
  builtin    INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  -- NULL while live; set explicitly or backdated by the idle rule (§8)
  ended_at   INTEGER,
  unit       TEXT NOT NULL CHECK (unit IN ('lb','kg')),
  title      TEXT,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sets (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  weight      REAL NOT NULL,
  reps        INTEGER NOT NULL,
  at          INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0
);

-- The logging path's hot read is "what did I do on this exercise last time",
-- which is this index and nothing else.
CREATE INDEX IF NOT EXISTS idx_sets_exercise_at ON sets(exercise_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_sets_session     ON sets(session_id);
CREATE INDEX IF NOT EXISTS idx_sets_at          ON sets(at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
`;

/**
 * Goals. PROMPT.md §5 screen 3.
 *
 * Added as migration index 1 rather than folded into the base schema, because
 * by the time this was written index 0 was already the shape a shipped database
 * would have run. Editing it would mean existing installs silently never get
 * this table.
 *
 * `created_at` is load-bearing, not bookkeeping: goal progress is measured from
 * what the user could lift WHEN THEY SET THE GOAL, so losing this column turns
 * every progress bar into a lie (someone with a 300 lb squat showing 95% toward
 * 315 having trained once).
 */
const MIGRATION_GOALS = `
CREATE TABLE IF NOT EXISTS goals (
  id            TEXT PRIMARY KEY,
  exercise_id   TEXT NOT NULL REFERENCES exercises(id),
  target_weight REAL NOT NULL,
  target_reps   INTEGER NOT NULL,
  target_date   INTEGER NOT NULL,
  unit          TEXT NOT NULL CHECK (unit IN ('lb','kg')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_goals_live ON goals(deleted, created_at DESC);
`;

/**
 * Ordered migrations. Index 0 takes an empty database to version 1.
 *
 * Append only — never edit a shipped entry. There is no account and no server
 * (§11), so a botched migration destroys the only copy of someone's training
 * history that exists.
 */
/**
 * Equipment, and for a machine, WHICH machine.
 *
 * On the set rather than on the exercise, because it is a property of what was
 * actually done: "Lateral Raise" is dumbbells one week and the machine the
 * next, and pinning it to the exercise would rewrite history every time
 * somebody switched. Both columns are nullable — every set logged before this
 * migration was logged without an answer, and inventing one for them would be
 * exactly the kind of made-up number §16 exists to prevent.
 *
 * There is deliberately NO machines table. "Save this machine for easy access"
 * falls out of the history for free: the machines a user knows about are the
 * ones they have logged, which is `SELECT DISTINCT machine FROM sets`. A
 * separate table would be a second place for the same fact to live, and the
 * two would drift the first time a set was deleted.
 */
const MIGRATION_EQUIPMENT = `
ALTER TABLE sets ADD COLUMN equipment TEXT;
ALTER TABLE sets ADD COLUMN machine   TEXT;
CREATE INDEX IF NOT EXISTS idx_sets_machine ON sets(machine);
`;

/**
 * A free-text note on a set.
 *
 * On the set, for the same reason `equipment` and `machine` are: it is a
 * property of what was actually done. "RIR 2", "third notch", "tempo 3-1-1",
 * "left shoulder felt it" — all of those are true of one set and false of the
 * next, and hanging them off the exercise would rewrite every past session the
 * moment somebody typed one.
 *
 * Deliberately ONE free-text column rather than fields for RIR, tempo and the
 * rest. The app cannot know what a lifter needs to write down, and a schema
 * that guesses gets three columns that are null 95% of the time plus the one
 * thing they actually wanted to say with nowhere to go. Nullable, because every
 * set logged before this migration has no note and inventing one would be a
 * made-up fact (§16).
 */
const MIGRATION_NOTES = `
ALTER TABLE sets ADD COLUMN note TEXT;
`;

/**
 * Measurements of the lifter, rather than of a lift.
 *
 * One table for every kind rather than a bodyweight table and a height table,
 * because they differ only in what they measure: a named quantity, a number, a
 * unit, and when it was taken. Waist, arm, whatever comes next is a new `kind`
 * and no new schema.
 *
 * `unit` is stored per row and never rewritten, for exactly the reason set
 * weights are: a measurement is a fact about a moment, and converting it on
 * write would rewrite history the first time somebody changed a preference.
 * The display converts; the record does not.
 *
 * Deliberately NOT one row per day. People weigh themselves more than once and
 * an app that silently overwrote this morning's number with this evening's
 * would be deciding which one was true. The model picks what to show.
 */
const MIGRATION_MEASUREMENTS = `
CREATE TABLE IF NOT EXISTS measurements (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  value      REAL NOT NULL,
  unit       TEXT NOT NULL,
  at         INTEGER NOT NULL,
  note       TEXT,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_measurements_kind_at ON measurements(kind, at DESC);
`;

/*
 * A target for a MEASUREMENT rather than for a lift.
 *
 * Its own table rather than a nullable column on `goals`, because the two share
 * a word and almost nothing else: a lift goal has reps and an exercise, a
 * measurement goal has neither and has a direction. Folding them together would
 * mean four columns that are null for one kind and four that are null for the
 * other, and every query having to remember which is which.
 *
 * `kind` is UNIQUE among live rows, enforced in `saveMeasureGoal` rather than
 * by a constraint, because the soft `deleted` tombstone means the column cannot
 * be unique in SQL without also excluding every goal the user ever abandoned.
 */
const MIGRATION_MEASURE_GOALS = `
CREATE TABLE IF NOT EXISTS measure_goals (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  target      REAL NOT NULL,
  unit        TEXT NOT NULL,
  target_date INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0
);
`;

export const MIGRATIONS: string[] = [
  SCHEMA, MIGRATION_GOALS, MIGRATION_EQUIPMENT, MIGRATION_NOTES, MIGRATION_MEASUREMENTS,
  MIGRATION_MEASURE_GOALS
];

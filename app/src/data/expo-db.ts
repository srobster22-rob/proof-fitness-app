import type { Db, Stmt, BindValue } from './repo.ts';

/**
 * expo-sqlite adapter. PROMPT.md §12.
 *
 * `Repo` takes a two-method `Db` interface and imports no driver, so the exact
 * same repository code runs against `node:sqlite` in tests and expo-sqlite on
 * device. This file is the only place that knows which one is which — and it is
 * the only file in the data layer that cannot be tested on a laptop.
 *
 * The mapping is deliberately dumb. Anything clever here would be logic that
 * exists only on device, which is logic nobody can run in CI.
 */

/** The slice of expo-sqlite's SQLiteDatabase we depend on. */
export interface ExpoSQLiteDatabase {
  execSync(sql: string): void;
  prepareSync(sql: string): ExpoStatement;
}
interface ExpoStatement {
  // params is REQUIRED, not optional. Declaring it optional made this interface
  // wider than the real expo-sqlite signature, so `SQLiteDatabase` failed to
  // satisfy it — a mismatch that only surfaced under tsc, because nothing on
  // this machine can import the real module at runtime.
  executeSync(params: BindValue[]): { getAllSync(): unknown[] };
  finalizeSync(): void;
}

class ExpoStmt implements Stmt {
  db: ExpoSQLiteDatabase;
  sql: string;

  constructor(db: ExpoSQLiteDatabase, sql: string) {
    this.db = db;
    this.sql = sql;
  }

  /**
   * Statements are prepared per call and finalised immediately.
   *
   * expo-sqlite leaks a native handle for every prepared statement that is not
   * finalised, and the logging path prepares one on every set. Caching them
   * would be faster and would also mean owning a lifecycle across screen
   * unmounts and hot reloads; at the volumes this app writes — a few dozen rows
   * per workout — the prepare cost is invisible and the leak is not.
   */
  private exec(params: BindValue[]): unknown[] {
    const stmt = this.db.prepareSync(this.sql);
    try {
      return stmt.executeSync(params).getAllSync();
    } finally {
      stmt.finalizeSync();
    }
  }

  run(...params: BindValue[]): unknown { this.exec(params); return undefined; }
  all(...params: BindValue[]): unknown[] { return this.exec(params); }
  get(...params: BindValue[]): unknown { return this.exec(params)[0]; }
}

class ExpoDb implements Db {
  db: ExpoSQLiteDatabase;
  constructor(db: ExpoSQLiteDatabase) { this.db = db; }
  exec(sql: string): void { this.db.execSync(sql); }
  prepare(sql: string): Stmt { return new ExpoStmt(this.db, sql); }
}

/**
 * Wrap an open expo-sqlite database.
 *
 * Call site, kept out of here so this module imports nothing native and stays
 * type-checkable on any machine:
 *
 *   import * as SQLite from 'expo-sqlite';
 *   import { adaptExpoDb } from './data/expo-db.ts';
 *   import { Repo } from './data/repo.ts';
 *
 *   const repo = new Repo(adaptExpoDb(SQLite.openDatabaseSync('proof.db')));
 *
 * `Repo`'s constructor migrates, so there is no separate setup step and no
 * state where the app is running against an unmigrated database.
 */
export function adaptExpoDb(db: ExpoSQLiteDatabase): Db {
  return new ExpoDb(db);
}

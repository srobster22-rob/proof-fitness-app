import initSqlJs, { type Database } from 'sql.js';
import type { Db, Stmt, BindValue } from './repo.ts';

/**
 * A `Db` for running the app in a browser. Development only.
 *
 * Why this exists: expo-sqlite's web backend is wasm-over-`SharedArrayBuffer`,
 * which browsers only expose to cross-origin-isolated documents. Getting those
 * headers through Metro's dev server and the preview proxy proved unreliable, and
 * the app was unrunnable on a laptop as a result — no first boot, no clicking
 * through, no runtime bugs found until someone had a phone.
 *
 * sql.js is the same SQLite, compiled without the SharedArrayBuffer requirement.
 * The whole reason this is a ~90 line file rather than a rewrite is that `Repo`
 * was built against a two-method `Db` interface and imports no driver: the real
 * repository, the real schema, the real migrations and the real queries all run
 * here unchanged. That is the payoff of the abstraction, collected.
 *
 * **iOS and Android never load this.** `db.ts` picks by platform.
 */

const STORAGE_KEY = 'proof.db.v1';

class SqlJsStmt implements Stmt {
  private db: Database;
  private sql: string;
  private onWrite: () => void;

  constructor(db: Database, sql: string, onWrite: () => void) {
    this.db = db;
    this.sql = sql;
    this.onWrite = onWrite;
  }

  private rows(params: BindValue[]): Record<string, unknown>[] {
    const stmt = this.db.prepare(this.sql);
    try {
      stmt.bind(params as any);
      const out: Record<string, unknown>[] = [];
      while (stmt.step()) out.push(stmt.getAsObject() as Record<string, unknown>);
      return out;
    } finally {
      stmt.free();
    }
  }

  run(...params: BindValue[]): unknown {
    this.rows(params);
    this.onWrite();
    return undefined;
  }
  all(...params: BindValue[]): unknown[] { return this.rows(params); }
  get(...params: BindValue[]): unknown { return this.rows(params)[0]; }
}

class SqlJsDb implements Db {
  private db: Database;
  private onWrite: () => void;

  constructor(db: Database, onWrite: () => void) {
    this.db = db;
    this.onWrite = onWrite;
  }
  exec(sql: string): void { this.db.exec(sql); this.onWrite(); }
  prepare(sql: string): Stmt { return new SqlJsStmt(this.db, sql, this.onWrite); }
}

/**
 * Open the browser database, restoring any previous session from localStorage.
 *
 * Persisting matters even in development: without it every reload wipes the
 * history, and the paths worth exercising most — prefills, PR detection against
 * prior sessions, streaks — are exactly the ones that need history to exist.
 */
export async function openWebDb(): Promise<Db> {
  const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });

  let saved: Uint8Array | undefined;
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored) saved = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
  } catch {
    // A corrupt or oversized entry should cost the history, never the app.
  }

  const database = saved ? new SQL.Database(saved) : new SQL.Database();

  // Debounced: `Repo` issues many small writes per interaction and serialising
  // the whole database on each one would make logging a set feel slow.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const persist = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const bytes = database.export();
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        globalThis.localStorage?.setItem(STORAGE_KEY, btoa(binary));
      } catch {
        // Over quota, most likely. Losing the dev snapshot is acceptable;
        // taking down the screen mid-workout is not.
      }
    }, 250);
  };

  return new SqlJsDb(database, persist);
}

/** Wipe the browser database. Development affordance, not a product feature. */
export function resetWebDb(): void {
  try { globalThis.localStorage?.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

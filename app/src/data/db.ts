import { Platform } from 'react-native';
import { adaptExpoDb } from './expo-db.ts';
import { Repo } from './repo.ts';
import type { Db } from './repo.ts';
import {
  APP_GROUP,
  DB_NAME,
  describeDbLocation,
  planDbMigration,
  planDbOpen,
  resolveDbLocation,
  type DbLocation,
  type DbMigration
} from './db-location.ts';

export { APP_GROUP, DB_NAME };

/**
 * Opening is async because one platform makes it so.
 *
 * Native expo-sqlite opens synchronously; the browser's sql.js has to fetch and
 * instantiate wasm first. Rather than pretend both are sync and block a render,
 * `RepoGate` awaits this once at startup — which it was already positioned to do,
 * since it existed to handle open *failure*.
 */
type State =
  | { status: 'idle' }
  | { status: 'opening'; promise: Promise<void> }
  | { status: 'open'; repo: Repo }
  | { status: 'failed'; error: Error };

let state: State = { status: 'idle' };
let diagnostic: string | null = null;

/**
 * Move an existing database into the App Group container. PROMPT.md §8b, §11.
 *
 * Everything decidable is in `planDbMigration`, which is tested; this is the
 * two filesystem calls it cannot make. A throw becomes `status: 'failed'`
 * rather than propagating, because `planDbOpen` has a strictly better answer
 * for it than a dead launch: open from the old directory, where the data still
 * is, and try the move again next time.
 */
async function migrateIntoSharedContainer(
  location: DbLocation,
  legacyDirectory: string | null
): Promise<DbMigration> {
  const { Directory, File } = await import('expo-file-system');

  const plan = planDbMigration({
    from: legacyDirectory,
    to: location.directory,
    exists: path => new File(path).exists
  });
  if (plan.status !== 'move' || !location.directory) return plan;

  try {
    new Directory(location.directory).create({ intermediates: true, idempotent: true });
    // Sidecars first, proof.db last — planDbMigration's rule 1. Preserve the
    // order it returned; do not sort, parallelise or continue past a failure.
    for (const step of plan.steps) {
      new File(step.from).move(new File(step.to));
    }
  } catch (e) {
    return { ...plan, status: 'failed', note: `move interrupted: ${(e as Error).message}.` };
  }
  return plan;
}

async function openPlatformDb(): Promise<Db> {
  if (Platform.OS === 'web') {
    // Development only — see web-db.ts for why the browser cannot use
    // expo-sqlite. Imported lazily so no native build ever pulls in sql.js.
    const { openWebDb } = await import('./web-db.ts');
    return openWebDb();
  }
  const SQLite = await import('expo-sqlite');
  const { Paths } = await import('expo-file-system');

  const legacyDirectory = SQLite.defaultDatabaseDirectory ?? null;
  const location = resolveDbLocation({
    platform: Platform.OS,
    appGroup: APP_GROUP,
    sharedContainers: Paths.appleSharedContainers
  });
  const migration = await migrateIntoSharedContainer(location, legacyDirectory);

  diagnostic = describeDbLocation(location, migration);
  // Nominal is silent. This only ever prints when the file is somewhere the
  // Live Activity cannot reach it, or when a move was interrupted — states that
  // otherwise look exactly like a working app.
  if (diagnostic) console.warn(`[proof/db] ${diagnostic}`);

  const plan = planDbOpen(location, migration, legacyDirectory);
  if (!plan.open) throw new Error(plan.error);

  return adaptExpoDb(
    SQLite.openDatabaseSync(DB_NAME, undefined, plan.directory ?? undefined)
  );
}

/**
 * Open once, remembering both success and failure.
 *
 * Caching the failure matters because the caller renders: retrying a failed
 * open on every render would spin against a locked file instead of showing a
 * message.
 */
export function initRepo(): Promise<void> {
  if (state.status === 'open' || state.status === 'failed') return Promise.resolve();
  if (state.status === 'opening') return state.promise;

  const promise = openPlatformDb()
    .then(db => { state = { status: 'open', repo: new Repo(db) }; })
    .catch(e => {
      state = { status: 'failed', error: e instanceof Error ? e : new Error(String(e)) };
    });

  state = { status: 'opening', promise };
  return promise;
}

export type RepoStatus =
  | { ready: true; repo: Repo; error: null }
  | { ready: false; repo: null; error: Error | null };

/** Where the open got to. `error: null` while still opening. */
export function repoStatus(): RepoStatus {
  if (state.status === 'open') return { ready: true, repo: state.repo, error: null };
  if (state.status === 'failed') return { ready: false, repo: null, error: state.error };
  return { ready: false, repo: null, error: null };
}

/**
 * Anything worth knowing about where the file ended up, or `null` when it went
 * where it should. Surfaced by `RepoGate`'s error screen, which is the one
 * place in the app that already talks about storage.
 */
export function dbDiagnostic(): string | null {
  return diagnostic;
}

/** Clear a cached failure so a user-initiated retry can actually retry. */
export function resetRepo(): void {
  state = { status: 'idle' };
}

/**
 * Throwing accessor for anything rendered past `RepoGate` — which is every
 * screen, so screens never handle the not-ready case themselves.
 */
export function getRepo(): Repo {
  if (state.status !== 'open') {
    throw new Error('getRepo() before the database was open — must render inside RepoGate');
  }
  return state.repo;
}

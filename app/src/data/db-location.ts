/**
 * Where the database file lives, and how it gets there. PROMPT.md §8b, §11.
 *
 * §8b makes the Live Activity the primary logging path. Its `−` / `+` / `✓`
 * buttons are driven by an App Intent, and an App Intent's `perform()` may run
 * in the **widget extension process** — a separate sandbox from the app. A
 * database opened with no directory lands in the app's own container, where
 * that process cannot reach it. The file therefore lives in the **App Group
 * container** declared in `app.json`, which both targets can open.
 *
 * (`LiveActivityIntent` specifically is documented as running in the *app's*
 * process, which would make the sandbox problem moot. The App Group costs
 * nothing and is correct either way, so this does not wait on verifying a doc
 * sentence on a device.)
 *
 * This module is pure on purpose. `db.ts` imports react-native and expo-sqlite
 * and so cannot be loaded by any test runner on a laptop — the same reason
 * `open-once.ts` exists. Every rule with teeth is here: which directory wins,
 * what happens when the entitlement is missing, and exactly which files a
 * migration moves and in what order. `db.ts` is left with the two calls that
 * touch the filesystem.
 */

/** The database filename. Unchanged by any of this — only its directory moves. */
export const DB_NAME = 'proof.db';

/** Must match `ios.entitlements['com.apple.security.application-groups']` in app.json. */
export const APP_GROUP = 'group.com.example.proof';

/**
 * Subdirectory inside the container, mirroring expo-sqlite's own default layout
 * (`<documents>/SQLite`). The App Group root is shared with the widget
 * extension and will accumulate other things; the database gets its own folder
 * so a future `Directory.list()` over the container is not a lucky dip.
 */
export const DB_SUBDIR = 'SQLite';

/**
 * `schema.ts` sets `PRAGMA journal_mode = WAL`, so SQLite keeps two sidecar
 * files beside the database. **A migration that moves only `proof.db` loses
 * every commit still sitting in the write-ahead log** — which, after a crash or
 * a force-quit, is the most recent training the user did. They move together.
 *
 * Order is deliberate: see `planDbMigration`.
 */
export const DB_SIDECARS = ['-wal', '-shm'] as const;

export type LocationReason =
  /** The App Group container was found; the Live Activity can reach the file. */
  | 'shared'
  /** Not iOS. App Groups are an Apple concept and there is no Live Activity here. */
  | 'not-ios'
  /**
   * iOS, but the container came back empty. The entitlement is only visible to
   * `Paths.appleSharedContainers` when it is in the **code-signing**
   * entitlements, so Expo Go and any build made without the provisioning
   * profile land here. Falling back keeps the app usable; saying so keeps the
   * fallback from being mistaken for success.
   */
  | 'no-container';

export type DbLocation = {
  /** Pass to `openDatabaseSync`. `null` means "expo-sqlite's default directory". */
  directory: string | null;
  /** True only when the file is somewhere the widget extension can open it. */
  shared: boolean;
  reason: LocationReason;
};

export type SharedContainers = Record<string, { uri: string } | undefined>;

/**
 * `file:///a/b/` → `/a/b`.
 *
 * expo-file-system hands back a percent-encoded `file://` URI; expo-sqlite's
 * `directory` argument is a **plain path** — its own `defaultDatabaseDirectory`
 * is `URL.standardized.path`, and the native side runs the result through
 * `URL(string:)`, which a `file://` prefix would make into a second scheme.
 * Passing the URI through unconverted produces a path that looks right in a log
 * and opens the wrong file.
 */
export function toFsPath(uri: string): string {
  let p = uri.trim().replace(/^file:\/\/(?:localhost)?/, '');
  try {
    p = decodeURIComponent(p);
  } catch {
    // A malformed escape is not worth failing an app launch over — the
    // undecoded path is still very likely correct, and if it is not, the open
    // fails with a readable error through RepoGate.
  }
  return stripTrailingSlash(p);
}

function stripTrailingSlash(p: string): string {
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

/** Join path segments without doubling or dropping separators. */
export function joinPath(...parts: string[]): string {
  const [head = '', ...rest] = parts;
  return [stripTrailingSlash(head), ...rest.map(p => p.replace(/^\/+|\/+$/g, ''))]
    .filter((p, i) => i === 0 || p.length > 0)
    .join('/');
}

/**
 * Decide which directory the database opens from.
 *
 * Never throws and never returns nothing: a missing entitlement degrades to the
 * app's own container rather than to a launch failure, because a user who
 * cannot open their log is worse off than one whose Lock Screen buttons do not
 * work. `shared: false` is how the caller knows which of the two it got.
 */
export function resolveDbLocation(env: {
  platform: string;
  appGroup: string;
  sharedContainers: SharedContainers | null | undefined;
}): DbLocation {
  if (env.platform !== 'ios') {
    return { directory: null, shared: false, reason: 'not-ios' };
  }
  const uri = env.sharedContainers?.[env.appGroup]?.uri;
  if (!uri || !uri.trim()) {
    return { directory: null, shared: false, reason: 'no-container' };
  }
  return {
    directory: joinPath(toFsPath(uri), DB_SUBDIR),
    shared: true,
    reason: 'shared'
  };
}

export type MigrationStep = { from: string; to: string };

export type MigrationStatus =
  /** Nowhere to move to — not iOS, no entitlement, or already the same directory. */
  | 'not-needed'
  /** No database in the old location. The overwhelmingly common case. */
  | 'fresh-install'
  /** Both locations hold a database. Refuse: see below. */
  | 'both-present'
  /** There is history in the old location and the new one is clear. */
  | 'move'
  /** A move was planned and the filesystem refused part-way. */
  | 'failed';

export type DbMigration = {
  status: MigrationStatus;
  steps: MigrationStep[];
  note: string;
};

/**
 * Plan the one-time move out of the app container. PROMPT.md §11.
 *
 * Three rules, and the reasoning behind each is the whole value of this
 * function:
 *
 * **1. The sidecars move too, and they move first.** See `DB_SIDECARS`. The
 * order matters because a move is not atomic across files and the process can
 * die between them. Moving `proof.db` last means "the old `proof.db` is gone"
 * is a truthful completion marker — so a crash halfway leaves the old database
 * in place, still findable, and the next launch replans and finishes the job.
 * Moving it first would leave a database at the new path whose write-ahead log
 * was still in the old one, and rule 2 would then declare that torso migrated.
 *
 * **2. Completion is keyed on the OLD file being gone, not the new one being
 * there.** Directly from rule 1: the new location is partially populated for
 * the duration of the move, so its contents cannot mean anything.
 *
 * **3. Two databases means stop.** If both locations hold a `proof.db`, one of
 * them contains training the other does not, and there is no server copy to
 * reconcile against (§11). Merging on guesswork or picking a winner both
 * silently destroy real history, so this does neither — it reports, and lets a
 * human decide. Same principle as `RepoGate` refusing to offer "delete and
 * recreate": recovery is a conversation, not a button.
 */
export function planDbMigration(env: {
  /** Old directory (plain path), or null if it cannot be determined. */
  from: string | null;
  /** New directory (plain path), or null when the location is not shared. */
  to: string | null;
  dbName?: string;
  exists: (path: string) => boolean;
}): DbMigration {
  const { from, to, exists } = env;
  const dbName = env.dbName ?? DB_NAME;

  if (!from || !to || from === to) {
    return { status: 'not-needed', steps: [], note: 'no separate shared container to move to' };
  }

  const oldDb = joinPath(from, dbName);
  const newDb = joinPath(to, dbName);

  if (!exists(oldDb)) {
    return { status: 'fresh-install', steps: [], note: `nothing at ${oldDb}` };
  }
  if (exists(newDb)) {
    return {
      status: 'both-present',
      steps: [],
      note:
        `two databases: ${oldDb} and ${newDb}. Neither was touched — one holds ` +
        `training the other does not, and there is no copy to reconcile against.`
    };
  }

  // Sidecars first, database last. Rule 1.
  const steps: MigrationStep[] = [];
  for (const suffix of DB_SIDECARS) {
    const src = joinPath(from, dbName + suffix);
    if (exists(src)) steps.push({ from: src, to: joinPath(to, dbName + suffix) });
  }
  steps.push({ from: oldDb, to: newDb });

  return {
    status: 'move',
    steps,
    note: `moving ${steps.length} file(s) from ${from} to ${to}`
  };
}

export type OpenPlan =
  | { open: true; directory: string | null; shared: boolean }
  | { open: false; error: string };

/**
 * Which directory to actually open, once the move has been attempted.
 *
 * The case this exists for: **a move that fails part-way must not be followed
 * by an open at the new path.** `openDatabaseSync` creates what it does not
 * find, so opening the destination after a failed move manufactures an empty
 * database beside a full one — which on the next launch is indistinguishable
 * from two real databases, and `planDbMigration` would then correctly refuse to
 * touch either. One transient filesystem error would strand the user's history
 * permanently. So a failed move falls back to the directory the data is
 * demonstrably still in, and the next launch retries.
 *
 * `both-present` refuses to open at all. It cannot happen from a completed
 * migration — a move deletes its source — so reaching it means two databases
 * exist that no single launch created, and neither can be shown to be the one
 * with the user's real history. `RepoGate` renders the refusal as "couldn't
 * open your training log · your sets are still on this device", which is
 * exactly true, and both paths are in the message. Guessing here is the only
 * option that can silently destroy training (§11).
 */
export function planDbOpen(
  location: DbLocation,
  migration: DbMigration,
  legacyDirectory: string | null
): OpenPlan {
  if (migration.status === 'both-present') {
    return { open: false, error: migration.note };
  }
  if (migration.status === 'failed') {
    return { open: true, directory: legacyDirectory, shared: false };
  }
  return { open: true, directory: location.directory, shared: location.shared };
}

/**
 * One line describing anything a developer would want to know, or `null` when
 * everything is nominal.
 *
 * Returning `null` for the happy path is the point: a diagnostic that always
 * says something is a diagnostic nobody reads. The failure this guards against
 * is specifically a **silent** fallback — the app works perfectly, and the Live
 * Activity's buttons do nothing, with no way to connect the two.
 */
export function describeDbLocation(location: DbLocation, migration: DbMigration): string | null {
  const parts: string[] = [];

  if (!location.shared && location.reason === 'no-container') {
    parts.push(
      `App Group ${APP_GROUP} is not in this build's code-signing entitlements, so the ` +
      `database is in the app container. It works; the Live Activity cannot reach it (§8b).`
    );
  }
  if (migration.status === 'failed') {
    parts.push(
      `${migration.note} Still open from the old location, where the data is — ` +
      `the next launch retries the move.`
    );
  }
  return parts.length ? parts.join(' ') : null;
}

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_GROUP,
  DB_NAME,
  DB_SIDECARS,
  DB_SUBDIR,
  describeDbLocation,
  joinPath,
  planDbMigration,
  planDbOpen,
  resolveDbLocation,
  toFsPath,
  type DbLocation,
  type DbMigration,
  type SharedContainers
} from '../src/data/db-location.ts';

/**
 * PROMPT.md §8b, §11.
 *
 * The Live Activity's buttons run in the widget extension process and can only
 * reach the database if it lives in the App Group container. Getting that wrong
 * has no symptom inside the app — logging works, Progress works, everything
 * looks correct — so nothing but a test is going to catch it.
 *
 * The migration half is here for the opposite reason: it is a one-shot that
 * runs on exactly one launch of exactly one install, moving the only copy of a
 * user's training history that exists, and there is no way to exercise it twice.
 */

const CONTAINER = 'file:///private/var/mobile/Containers/Shared/AppGroup/AAAA-BBBB/';
const CONTAINER_PATH = '/private/var/mobile/Containers/Shared/AppGroup/AAAA-BBBB';
const SHARED = CONTAINER_PATH + '/' + DB_SUBDIR;
const LEGACY = '/var/mobile/Containers/Data/Application/CCCC/Documents/SQLite';

const containers = (uri: string = CONTAINER): SharedContainers => ({ [APP_GROUP]: { uri } });

const fs = (...present: string[]) => (path: string) => present.includes(path);

describe('path conversion', () => {
  // expo-file-system speaks file:// URIs, expo-sqlite's `directory` argument is
  // a plain path. Handing the URI over unconverted opens the wrong file while
  // logging something that reads correctly.
  test('a file:// URI becomes a plain path', () => {
    assert.equal(toFsPath('file:///a/b/'), '/a/b');
    assert.equal(toFsPath('file:///a/b'), '/a/b');
  });

  test('a plain path is left alone', () => {
    assert.equal(toFsPath('/a/b'), '/a/b');
    assert.equal(toFsPath('/a/b/'), '/a/b');
  });

  test('percent escapes are decoded', () => {
    assert.equal(toFsPath('file:///a%20b/c'), '/a b/c');
  });

  test('a malformed escape does not throw — an app launch is not worth losing to it', () => {
    assert.equal(toFsPath('file:///a%zz/b'), '/a%zz/b');
  });

  test('a localhost authority is dropped', () => {
    assert.equal(toFsPath('file://localhost/a/b'), '/a/b');
  });

  test('joinPath does not double or drop separators', () => {
    assert.equal(joinPath('/a', 'b'), '/a/b');
    assert.equal(joinPath('/a/', '/b/'), '/a/b');
    assert.equal(joinPath('/a', 'b', 'c'), '/a/b/c');
    assert.equal(joinPath('/a', ''), '/a');
  });
});

describe('where the database opens from (§8b)', () => {
  test('on iOS with the entitlement it is the App Group container', () => {
    const l = resolveDbLocation({ platform: 'ios', appGroup: APP_GROUP, sharedContainers: containers() });
    assert.equal(l.directory, SHARED);
    assert.equal(l.shared, true);
    assert.equal(l.reason, 'shared');
  });

  // The bug this whole change exists to prevent. Before it, the open call
  // passed no directory at all and the file landed in the app's own container.
  test('the shared directory is NOT the app container', () => {
    const l = resolveDbLocation({ platform: 'ios', appGroup: APP_GROUP, sharedContainers: containers() });
    assert.ok(l.directory!.startsWith(CONTAINER_PATH), `${l.directory} is outside the App Group`);
    assert.ok(!l.directory!.includes('/Data/Application/'), 'that is the app container, not the group');
  });

  test('the file keeps its name — only the directory moves', () => {
    assert.equal(DB_NAME, 'proof.db');
  });

  test('a build without the code-signing entitlement falls back rather than failing', () => {
    const l = resolveDbLocation({ platform: 'ios', appGroup: APP_GROUP, sharedContainers: {} });
    assert.equal(l.directory, null, 'null means expo-sqlite\'s default — the app still opens');
    assert.equal(l.shared, false);
    assert.equal(l.reason, 'no-container');
  });

  test('a container for some OTHER app group is not mistaken for ours', () => {
    const l = resolveDbLocation({
      platform: 'ios',
      appGroup: APP_GROUP,
      sharedContainers: { 'group.com.example.other': { uri: CONTAINER } }
    });
    assert.equal(l.shared, false);
  });

  test('an empty or missing uri counts as no container', () => {
    for (const c of [containers(''), containers('   '), {}, null, undefined]) {
      const l = resolveDbLocation({ platform: 'ios', appGroup: APP_GROUP, sharedContainers: c });
      assert.equal(l.shared, false);
    }
  });

  test('android has no App Groups and says so, rather than pretending', () => {
    const l = resolveDbLocation({ platform: 'android', appGroup: APP_GROUP, sharedContainers: containers() });
    assert.equal(l.directory, null);
    assert.equal(l.shared, false);
    assert.equal(l.reason, 'not-ios');
  });

  test('the app group matches the one declared in app.json', () => {
    // Changing one without the other produces an app that opens a database
    // nothing else can see, with no error anywhere.
    assert.equal(APP_GROUP, 'group.com.example.proof');
  });
});

describe('migrating an existing database (§11)', () => {
  const plan = (present: string[], from: string | null = LEGACY, to: string | null = SHARED) =>
    planDbMigration({ from, to, exists: fs(...present) });

  test('a fresh install moves nothing', () => {
    const m = plan([]);
    assert.equal(m.status, 'fresh-install');
    assert.deepEqual(m.steps, []);
  });

  test('an existing database moves', () => {
    const m = plan([`${LEGACY}/${DB_NAME}`]);
    assert.equal(m.status, 'move');
    assert.deepEqual(m.steps, [{ from: `${LEGACY}/${DB_NAME}`, to: `${SHARED}/${DB_NAME}` }]);
  });

  /*
   * schema.ts sets PRAGMA journal_mode = WAL. Moving only proof.db leaves every
   * commit still in the write-ahead log behind — which, after a force-quit, is
   * the session the user just finished.
   */
  test('the write-ahead log moves with the database', () => {
    const m = plan([`${LEGACY}/${DB_NAME}`, `${LEGACY}/${DB_NAME}-wal`, `${LEGACY}/${DB_NAME}-shm`]);
    assert.equal(m.status, 'move');
    assert.deepEqual(
      m.steps.map(s => s.from),
      [`${LEGACY}/${DB_NAME}-wal`, `${LEGACY}/${DB_NAME}-shm`, `${LEGACY}/${DB_NAME}`]
    );
  });

  test('every sidecar SQLite writes is accounted for', () => {
    assert.deepEqual([...DB_SIDECARS], ['-wal', '-shm']);
  });

  /*
   * A move is not atomic across files and the process can die between them.
   * proof.db goes last so that "the old proof.db is gone" is a truthful
   * completion marker: a crash halfway leaves the database findable at the old
   * path and the next launch finishes the job.
   */
  test('proof.db is moved LAST', () => {
    const m = plan([`${LEGACY}/${DB_NAME}`, `${LEGACY}/${DB_NAME}-wal`]);
    assert.equal(m.steps.at(-1)!.from, `${LEGACY}/${DB_NAME}`);
  });

  test('a sidecar with no database beside it is not moved on its own', () => {
    const m = plan([`${LEGACY}/${DB_NAME}-wal`]);
    assert.equal(m.status, 'fresh-install');
    assert.deepEqual(m.steps, []);
  });

  test('a crash after the sidecars is resumed, and the pieces reunite', () => {
    // Second launch: -wal already at the destination, proof.db still at source.
    const m = plan([`${LEGACY}/${DB_NAME}`, `${SHARED}/${DB_NAME}-wal`]);
    assert.equal(m.status, 'move');
    assert.deepEqual(m.steps, [{ from: `${LEGACY}/${DB_NAME}`, to: `${SHARED}/${DB_NAME}` }]);
  });

  test('a completed migration is not repeated', () => {
    const m = plan([`${SHARED}/${DB_NAME}`]);
    assert.equal(m.status, 'fresh-install', 'nothing left at the old path — done');
    assert.deepEqual(m.steps, []);
  });

  /*
   * Rule 3. Two databases means one holds training the other does not, and §11
   * has no server copy to reconcile against. Picking a winner silently destroys
   * real history, so this reports instead.
   */
  test('two databases are both left alone', () => {
    const m = plan([`${LEGACY}/${DB_NAME}`, `${SHARED}/${DB_NAME}`]);
    assert.equal(m.status, 'both-present');
    assert.deepEqual(m.steps, [], 'neither file may be touched');
    assert.match(m.note, /two databases/i);
    assert.ok(m.note.includes(LEGACY) && m.note.includes(SHARED), 'both paths must be in the message');
  });

  test('nothing to move to means nothing to do', () => {
    assert.equal(plan([`${LEGACY}/${DB_NAME}`], LEGACY, null).status, 'not-needed');
    assert.equal(plan([`${LEGACY}/${DB_NAME}`], null, SHARED).status, 'not-needed');
    assert.equal(plan([`${LEGACY}/${DB_NAME}`], SHARED, SHARED).status, 'not-needed');
  });
});

describe('which directory actually gets opened', () => {
  const shared: DbLocation = { directory: SHARED, shared: true, reason: 'shared' };
  const mig = (status: DbMigration['status']): DbMigration => ({ status, steps: [], note: 'n' });

  test('the shared container, when the move went fine', () => {
    for (const s of ['move', 'fresh-install', 'not-needed'] as const) {
      const p = planDbOpen(shared, mig(s), LEGACY);
      assert.equal(p.open && p.directory, SHARED, `status ${s}`);
      assert.equal(p.open && p.shared, true);
    }
  });

  /*
   * The one that matters. openDatabaseSync CREATES what it does not find, so
   * opening the destination after a half-finished move manufactures an empty
   * database beside the full one — and the next launch reads that as two real
   * databases and refuses to touch either. One transient filesystem error would
   * strand the user's history for good.
   */
  test('a failed move opens the OLD directory, never the new one', () => {
    const p = planDbOpen(shared, mig('failed'), LEGACY);
    assert.equal(p.open, true);
    assert.equal(p.open && p.directory, LEGACY);
    assert.notEqual(p.open && p.directory, SHARED, 'this would create an empty database');
    assert.equal(p.open && p.shared, false, 'and it must not claim to be shared');
  });

  test('two databases refuse to open at all', () => {
    const m: DbMigration = { status: 'both-present', steps: [], note: 'two databases: /a and /b' };
    const p = planDbOpen(shared, m, LEGACY);
    assert.equal(p.open, false);
    assert.equal(!p.open && p.error, m.note, 'the paths reach the error screen verbatim');
  });

  test('without a container it opens the default, and does not claim to be shared', () => {
    const none: DbLocation = { directory: null, shared: false, reason: 'no-container' };
    const p = planDbOpen(none, mig('not-needed'), LEGACY);
    assert.equal(p.open && p.directory, null);
    assert.equal(p.open && p.shared, false);
  });
});

describe('the diagnostic', () => {
  const shared: DbLocation = { directory: SHARED, shared: true, reason: 'shared' };
  const ok: DbMigration = { status: 'fresh-install', steps: [], note: '' };

  // A diagnostic that always says something is a diagnostic nobody reads.
  test('a healthy launch says nothing at all', () => {
    assert.equal(describeDbLocation(shared, ok), null);
    assert.equal(describeDbLocation(shared, { status: 'move', steps: [], note: '' }), null);
  });

  test('a silent fallback is named, and names the consequence', () => {
    const none: DbLocation = { directory: null, shared: false, reason: 'no-container' };
    const d = describeDbLocation(none, ok)!;
    assert.ok(d, 'a fallback that says nothing is the failure this guards against');
    assert.match(d, /Live Activity/);
    assert.ok(d.includes(APP_GROUP));
  });

  test('android is not reported as a problem — there is nothing wrong with it', () => {
    const a: DbLocation = { directory: null, shared: false, reason: 'not-ios' };
    assert.equal(describeDbLocation(a, ok), null);
  });

  test('an interrupted move says where the data is', () => {
    const d = describeDbLocation(shared, { status: 'failed', steps: [], note: 'move interrupted: EPERM.' })!;
    assert.match(d, /EPERM/);
    assert.match(d, /old location/);
  });
});

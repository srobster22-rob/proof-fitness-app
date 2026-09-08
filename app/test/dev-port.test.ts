import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { devPort } from '../tools/dev-port.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(path.join(HERE, '..', ...p), 'utf8');

/*
 * The dev port is written down in three places and they have to agree.
 *
 * `package.json`'s `web` script opens the socket. `.claude/launch.json` tells
 * the preview tool where to connect. `seed-web.ts` and `stress-web.ts` print a
 * URL for a human to paste. The third used to be a hardcoded literal, and it
 * went wrong the first time the launch entry moved — the tools spent a session
 * telling whoever ran them to open a port nothing was listening on.
 *
 * The printed URL now comes from `devPort()`, so this only has to hold the two
 * declarations together. There is no clever way to make one of them derive
 * from the other — `launch.json` is read by tooling outside this repo — so the
 * check is that they match.
 */
describe('the dev port agrees everywhere it is written down', () => {
  test('devPort() reports the port the web script actually binds', () => {
    const web = (JSON.parse(read('package.json')).scripts?.web ?? '') as string;
    const m = web.match(/--port[= ]+(\d+)/);
    assert.ok(m, 'the web script no longer names a port — devPort() would silently fall back');
    assert.equal(devPort(), Number(m![1]));
  });

  test('the launch config points at that same port', () => {
    const cfg = JSON.parse(read('.claude', 'launch.json')) as
      { configurations?: Array<{ name?: string; port?: number }> };
    const entry = cfg.configurations?.find(c => typeof c.port === 'number');
    assert.ok(entry, 'no launch configuration declares a port');
    assert.equal(entry!.port, devPort(),
      'launch.json and the web script disagree — the preview will open the wrong page');
  });

  test('neither seeding tool hardcodes a port any more', () => {
    for (const f of ['seed-web.ts', 'stress-web.ts']) {
      const src = read('tools', f);
      assert.match(src, /devPort\(\)/, `${f} should print the resolved port`);
      assert.doesNotMatch(src, /localhost:\d+/,
        `${f} hardcodes a port in the instructions it prints`);
    }
  });

  test('HANDOFF names the same port, since that is what a fresh session reads', () => {
    // Not pedantry: HANDOFF is the first file a new session opens, its trap
    // list is what people act on before running anything, and it went stale
    // the moment the port moved — pointing the next reader at a dead server
    // is the exact failure the seeding tools had.
    const handoff = readFileSync(path.join(HERE, '..', '..', 'HANDOFF.md'), 'utf8');
    const ports = [...handoff.matchAll(/localhost:(\d{4})|Port \*\*(\d{4})\*\*/g)]
      .map(m => Number(m[1] ?? m[2]));
    assert.ok(ports.length > 0, 'HANDOFF no longer names a port at all');
    for (const p of ports) {
      assert.equal(p, devPort(), `HANDOFF names port ${p}, but the app binds ${devPort()}`);
    }
  });

  test('and it never throws, whatever it finds', () => {
    // It runs at the end of a seeding job that has already written its output;
    // failing there would lose the work over a log line.
    assert.doesNotThrow(() => devPort());
    assert.equal(typeof devPort(), 'number');
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => fs.readFileSync(path.join(HERE, '..', ...p), 'utf8');

/**
 * The port the dev server will actually bind.
 *
 * `seed-web.ts` and `stress-web.ts` both printed "in the browser console at
 * localhost:8099" as a hardcoded string — a third copy of a number that also
 * lives in `package.json` and in `.claude/launch.json`. Three copies drift the
 * moment one is changed, and this one had: the launch entry was moved to 8100
 * while the tools went on telling whoever ran them to open 8099. A dev tool
 * whose printed instruction sends you to a page that is not there costs more
 * than the tool saves.
 *
 * Read from the `web` SCRIPT first, deliberately. That is the command line
 * that opens the socket, so it is the only copy that cannot be wrong — the
 * `port` in `launch.json` is what the preview tool connects to, which is a
 * claim about the same number rather than the number itself. Falls back down
 * the chain and finally to the historical default, because a seeding tool must
 * never fail over a log line.
 */
export function devPort(fallback = 8099): number {
  const fromScript = (() => {
    try {
      const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
      const m = (pkg.scripts?.web ?? '').match(/--port[= ]+(\d+)/);
      return m ? Number(m[1]) : null;
    } catch { return null; }
  })();
  if (fromScript) return fromScript;

  try {
    const cfg = JSON.parse(read('.claude', 'launch.json')) as
      { configurations?: Array<{ port?: number }> };
    const port = cfg.configurations?.find(c => typeof c.port === 'number')?.port;
    return typeof port === 'number' ? port : fallback;
  } catch {
    return fallback;
  }
}

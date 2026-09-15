import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');

/*
 * R647. `public/seed.b64` is history dated relative to the moment it was
 * written. Leave it a couple of weeks and its last sessions age out of the
 * coach's 14-day window, so the coach line silently falls back to "Last time"
 * -- the AI feature the owner asked for, invisible in the one place they look
 * at it. That happened in R586 and again in R628, both times found by accident.
 *
 * The preview server runs `npm run web`, so regenerating there means the
 * sample data is always as fresh as the server.
 */
describe('the preview regenerates its sample data when it starts (R647)', () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')).scripts;

  test('npm run web writes a fresh seed before starting the dev server', () => {
    assert.match(scripts.web, /^node tools\/seed-web\.ts && expo start --web/,
      'the preview starts on whatever seed.b64 was left lying around -- the coach line ' +
      'goes blank once that history is older than the coach window');
  });

  test('the seed is dated from now, so regenerating is enough', () => {
    // If the seeder ever pins a fixed date, running it on start stops helping.
    const src = fs.readFileSync(path.join(APP, 'tools', 'seed-web.ts'), 'utf8');
    assert.match(src, /const now = Date\.now\(\);/);
    assert.match(src, /const start = now - week \* 7 \* DAY/);
  });

  /*
   * R666. Regenerating was not enough: the seed was BORN on the coach window's
   * edge, its second-to-last push day exactly 14 days back, so the owner's own
   * "TO SEE IT" steps showed "Last time 175 × 5" minutes after a fresh start.
   * Checked here the way the owner checks it -- the real seeder, the real
   * model, the line on screen -- a day after the seed was written, so a
   * schedule that only works at the instant of writing cannot pass.
   */
  test('a day-old seed still shows the coach line the owner is told to look for (R666)', async () => {
    const { execFileSync } = await import('node:child_process');
    const os = await import('node:os');
    const { DatabaseSync } = await import('node:sqlite');
    const { Repo } = await import('../src/data/repo.ts');
    const { NowModel } = await import('../src/ui/now-model.ts');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-seed-'));
    try {
      const out = path.join(dir, 'seed.b64');
      execFileSync(process.execPath, ['--no-warnings', path.join(APP, 'tools', 'seed-web.ts')],
        { cwd: APP, env: { ...process.env, PROOF_SEED_OUT: out }, stdio: 'pipe' });
      const file = path.join(dir, 'seed.db');
      fs.writeFileSync(file, Buffer.from(fs.readFileSync(out, 'utf8'), 'base64'));

      const later = Date.now() + 86_400_000;
      const db = new DatabaseSync(file);
      try {
        const m = new NowModel(new Repo(db as never, () => later), () => later, 'en-US');
        m.selectExercise('bench');
        const { head, tail } = m.state().lastTime;
        assert.match(`${head}${tail}`, /175 and climbing, 2 sessions — try 180/,
          `the seeded preview shows "${head}${tail}" -- the coach line has aged out of its window`);
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

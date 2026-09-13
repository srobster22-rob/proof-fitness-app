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
});

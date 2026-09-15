import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREENS = path.join(HERE, '..', 'app');

/*
 * R661. No screen title was a heading anywhere in the app, so a screen-reader
 * user could not jump by heading or hear which screen they had landed on --
 * GOALS, PROGRESS, SETTINGS and the rest were plain text among plain text.
 *
 * Every screen draws its title as `<Text style={s.title}>`, so the population
 * is derived from source rather than listed: a new screen written the same way
 * enters the check by being written the same way. React Native's Role union has
 * 'heading' and react-native-web passes it straight through. No aria-level is
 * set: it is not in the installed React Native types, and readers default it.
 *
 * Now's lift name is not in this set on purpose. It sits inside the button
 * that opens the exercise picker, and that button's own label replaces its
 * children, so a heading role there would never be read.
 */
describe('every screen title is a heading (R661)', () => {
  test('each <Text style={s.title}> carries role="heading"', () => {
    let titles = 0;
    const offenders: string[] = [];
    for (const f of readdirSync(SCREENS).filter(n => n.endsWith('.tsx'))) {
      const src = readFileSync(path.join(SCREENS, f), 'utf8');
      for (const m of src.matchAll(/<Text style=\{s\.title\}[^>]*>/g)) {
        titles++;
        if (!/role="heading"/.test(m[0])) {
          offenders.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
        }
      }
    }
    assert.deepEqual(offenders, [],
      'these screen titles are plain text to a screen reader -- add role="heading"');
    assert.ok(titles >= 6,
      `found ${titles} screen titles; Goals, Measure, Progress, Recap, Settings and not-found make six, so the scan went stale`);
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOALS = readFileSync(path.join(HERE, '..', 'app', 'goals.tsx'), 'utf8');
const PROGRESS = readFileSync(path.join(HERE, '..', 'app', 'progress.tsx'), 'utf8');

/*
 * R659, the other half of R658. Errors became alerts; the RESULTS of an action
 * were still painted and never read -- the undo strip after wiping a goal, and
 * the backup note on Progress that says "Working..." and then how an export,
 * restore or erase went. Focus does not move to either.
 *
 * They are not errors, so they are `status` (polite), not `alert`. The two
 * render differently and that decides how reliably they speak: the backup note
 * is always mounted and only its text changes -- the case a live region
 * announces dependably -- while the undo strip mounts only after a wipe.
 */
describe('a result that appears after an action is announced (R659)', () => {
  test('the undo strip label is a status, and only the label', () => {
    assert.match(GOALS, /<Text style=\{s\.undoText\} numberOfLines=\{1\} role="status">\{undo\.label\}<\/Text>/,
      'the undo strip appears after a wipe and nothing tells a screen reader it is there');
    const strip = region(GOALS, '<View style={s.undoBar}>', '</View>');
    assert.equal((strip.match(/role="status"/g) ?? []).length, 1,
      'the status role spread beyond the label, so UNDO and the dismiss button get read as the message');
  });

  test('the backup note is a polite live region that stays mounted', () => {
    const note = region(PROGRESS, '<Text style={s.backupNote}', '</Text>');
    assert.match(note, /role="status"/, 'the backup note reports results without saying so');
    assert.match(note, /aria-live="polite"/, 'the backup note is not a live region');
    assert.match(note, /busy\s*\?\s*T\('workingEllipsis'\)/,
      'the note no longer changes in place from Working... to the result');
    assert.doesNotMatch(PROGRESS, /&&\s*\(?\s*<Text style=\{s\.backupNote\}/,
      'the backup note only mounts when there is a message, so its live region is often missed');
  });
});

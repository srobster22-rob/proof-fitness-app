import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN } from '../src/domain/coldstart.ts';
import { region } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, '..', 'app', 'goals.tsx'), 'utf8');

/**
 * Widest built-in name measured in the rendered style — 11px, weight 800,
 * 1.5 letter-spacing — on the running app: "Bulgarian Split Squat" at 146pt.
 * Five more of the thirty-three cleared 117pt: Romanian Deadlift (127),
 * Incline Bench Press (132), Machine Chest Press (139), DB Shoulder Press
 * (125), Seated Cable Row (120).
 */
const WIDEST_NAME_PT = 146;

/** A 320pt phone, less the 24pt screen gutters and the card's 18pt padding. */
const NAME_ROOM_AT_320 = 320 - 24 * 2 - 18 * 2;

/*
 * A goal card must be able to show the name of the lift it is about.
 *
 * The name shared its line with CHANGE and WIPE, which left it 117pt of a
 * 234pt row on a 320pt phone — and six of the thirty-three built-in movements
 * are wider than that. The card whose whole identity is a lift was truncating
 * the lift, on the narrowest phone the app supports and nowhere else, which is
 * why it went unnoticed.
 *
 * Putting the controls on the deadline's line instead was tried and was worse:
 * the names fitted and the deadline truncated, on 89 of 100 stress cards
 * rather than 6 of 33. A 234pt row cannot hold a sentence and two controls, so
 * each got its own line.
 */
describe('a goal card has room for the name of its lift', () => {
  test('the widest built-in name fits the full-width row at 320pt', () => {
    assert.ok(WIDEST_NAME_PT <= NAME_ROOM_AT_320,
      `the widest movement needs ${WIDEST_NAME_PT}pt and the row offers ${NAME_ROOM_AT_320}pt`);
  });

  test('the measurement is about names that actually exist', () => {
    // If the library shrank to a handful of short names the constant above
    // would be stale, and this file would be guarding a case that no longer
    // occurs. 20+ characters is what produced the 146pt measurement.
    const longest = BUILTIN.reduce((m, e) => Math.max(m, e.name.length), 0);
    assert.ok(BUILTIN.length >= 20, `only ${BUILTIN.length} built-in movements`);
    assert.ok(longest >= 18,
      `the longest built-in name is now ${longest} chars — re-measure WIDEST_NAME_PT`);
  });

  test('the name is alone on its line', () => {
    const top = region(src, '<View style={s.cardTop}>', '</View>');
    assert.match(top, /s\.cardLift/);
    assert.doesNotMatch(top, /s\.cardActions|onPress/,
      'the controls are back on the name line and it will truncate again');
  });

  test('the controls are on their own line, not sharing with the deadline', () => {
    const foot = region(src, 'cardFoot: {', '},');
    assert.match(foot, /justifyContent: 'flex-end'/);
    assert.doesNotMatch(foot, /space-between/,
      'sharing the footer is what made the deadline truncate instead');
  });

  test('and the deadline is not clamped to one line to make room', () => {
    // `numberOfLines={1}` on the meta was the intermediate attempt; it is what
    // turned an overflow into a silent truncation of the pace sentence.
    const meta = region(src, 's.meta, !line && s.metaQuiet', '</Text>');
    assert.doesNotMatch(meta, /numberOfLines/);
  });
});

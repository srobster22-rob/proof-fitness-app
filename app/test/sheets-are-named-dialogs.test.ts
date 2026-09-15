import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from '../src/domain/i18n.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

function sources(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const dir of [path.join(ROOT, 'app'), path.join(ROOT, 'src', 'ui')]) {
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.tsx')) out.push([f, readFileSync(path.join(dir, f), 'utf8')]);
    }
  }
  return out;
}

/** Every opening tag starting with `open`, read whole (braces balanced, so `=>` inside a prop is not the end). */
function tags(src: string, open: string): Array<{ line: number; tag: string }> {
  const out: Array<{ line: number; tag: string }> = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf(open, from);
    if (at < 0) return out;
    let i = at + open.length, depth = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push({ line: src.slice(0, at).split('\n').length, tag: src.slice(at, i + 1) });
    from = i + 1;
  }
}

/*
 * R663. react-native-web's Modal already exposes an open sheet as
 * role="dialog" with aria-modal and a focus trap -- but every sheet in the app
 * was an unnamed dialog ("dialog", and nothing else), and every sheet's
 * backdrop was a Pressable, so tabbing landed on a tab stop with no role and
 * no label. Measured live on Goals' add-goal sheet.
 *
 * Modal passes props it does not consume onto the dialog element, and
 * ModalProps includes ViewProps, so each ScreenModal is named from a title it
 * already translates. focusable={false} takes the backdrop out of the tab order
 * (tabindex -1) and keeps tap-to-close.
 */
describe('a sheet is a named dialog, and its backdrop is not a tab stop (R663)', () => {
  test('every ScreenModal carries an accessible name', () => {
    let sheets = 0;
    const offenders: string[] = [];
    for (const [name, src] of sources()) {
      for (const { line, tag } of tags(src, '<ScreenModal')) {
        // Skip longer names only. (A literal "ScreenModal" followed by an open
        // paren here made orphan-scan read this test as CALLING ScreenModal,
        // and report the component as tested with no production caller.)
        if (/^<ScreenModal\w/.test(tag)) continue;
        sheets++;
        if (!/aria-label=\{/.test(tag)) offenders.push(`${name}:${line}`);
      }
    }
    assert.deepEqual(offenders, [],
      'these sheets open as a dialog a screen reader can only call "dialog" -- give ScreenModal an aria-label');
    assert.ok(sheets >= 8, `found ${sheets} sheets; there are eight, so the scan went stale`);
  });

  test('no sheet backdrop is an unnamed tab stop', () => {
    let backdrops = 0;
    const offenders: string[] = [];
    for (const [name, src] of sources()) {
      for (const { line, tag } of tags(src, '<Pressable style={s.backdrop}')) {
        backdrops++;
        // tabIndex={-1}, not focusable={false}: react-native-web's Pressable
        // computes its own tabIndex (0 unless disabled) and passes it to the
        // DOM, which never consults `focusable`. R663's first pass used
        // focusable={false}; this test passed and every backdrop still read
        // tabindex="0" live.
        if (!/tabIndex=\{-1\}/.test(tag) || /focusable=\{false\}/.test(tag)) offenders.push(`${name}:${line}`);
      }
    }
    assert.deepEqual(offenders, [],
      'these backdrops are keyboard tab stops with no role or label -- add tabIndex={-1} (focusable={false} does nothing on a Pressable)');
    assert.ok(backdrops >= 8, `found ${backdrops} backdrops; there are eight, so the scan went stale`);
  });

  test('the goal sheet has a name in both languages', () => {
    assert.equal(t('en', 'newGoalA11y'), 'New goal');
    assert.equal(t('en', 'editGoalA11y'), 'Edit goal');
    assert.equal(t('es', 'newGoalA11y'), 'Nueva meta');
    assert.equal(t('es', 'editGoalA11y'), 'Editar meta');
  });
});

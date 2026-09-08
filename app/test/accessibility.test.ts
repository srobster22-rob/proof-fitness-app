import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { around } from './helpers/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

function sources(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const dir of [path.join(ROOT, 'app'), path.join(ROOT, 'src', 'ui')]) {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.tsx')) out.push([f, fs.readFileSync(path.join(dir, f), 'utf8')]);
    }
  }
  return out;
}

/** Every `<Pressable ...>` opening tag in a file, whole. */
function pressables(src: string): string[] {
  const out: string[] = [];
  const re = /<Pressable\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // Walk to the end of the opening tag, ignoring `>` inside braces or strings.
    let i = m.index + '<Pressable'.length, depth = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

/**
 * PROOF is iOS-first, where VoiceOver is the assistive technology, and the
 * accessibility tree had never been read.
 *
 * It was worse than untidy. Every stepper, both typed-entry targets, the only
 * control that changes exercise, and **LOG SET — the primary action of the
 * whole app** — came back as unlabelled `generic` nodes, and the two navigation
 * links were not exposed as interactive at all. A `Pressable` with no
 * `accessibilityRole` is not announced as something you can activate.
 *
 * Roles change what assistive technology SAYS, never what is painted, so this
 * costs the design nothing — the exercise name is still not drawn as a button,
 * per §7.
 */
describe('every control announces itself (§4)', () => {
  test('no Pressable is left without a role', () => {
    for (const [name, src] of sources()) {
      for (const tag of pressables(src)) {
        // A Pressable used purely as a backdrop or a scroll-blocker is
        // structural, not a control; those carry `stopPropagation` or are the
        // sheet's own backdrop.
        if (/stopPropagation|style=\{s\.backdrop\}/.test(tag)) continue;
        assert.match(tag, /accessibilityRole=/,
          `${name}: a Pressable with no accessibilityRole reads as plain text to ` +
          `VoiceOver —\n${tag.slice(0, 160)}`);
      }
    }
  });

  /*
   * R473. This test used to accept "or a `<Text>` child supplies the name",
   * and that clause was false — measured, not reasoned about, in the running
   * app against a planted probe:
   *
   *   <button>PLAIN TEXT PROBE</button>              -> named
   *   <button role="button"><div>DIV CHILD</div></button> -> ANONYMOUS
   *
   * The second is exactly what react-native-web emits for a `<Pressable>`
   * wrapping a `<Text>`, so name-from-content never reaches the string. The
   * escape hatch was excusing 25 real controls, 19 of them anonymous on the
   * add-goal sheet alone — and it is how R450 came to hand-fix nine of these
   * (FINISH among them) while the gate that exists to catch them stayed green.
   *
   * So: an explicit `accessibilityLabel` is the only accessible name that
   * works here, and the gate now demands one. Exemptions are listed below by
   * name with a reason; nothing is excluded silently.
   */
  test('nothing interactive is anonymous', () => {
    // Counted for the same reason the sibling sweeps count: `assert.ok` inside
    // an empty loop passes perfectly. An instrument that reports no problems
    // must also report how much it examined (HANDOFF trap 10).
    let checked = 0;
    for (const [name, src] of sources()) {
      for (const tag of pressables(src)) {
        // Structural, not a control: a backdrop or a scroll-blocker.
        if (/stopPropagation|style=\{s\.backdrop\}/.test(tag)) continue;
        if (!/accessibilityRole=/.test(tag)) continue;
        checked++;
        assert.match(tag, /accessibilityLabel=/,
          `${name}: this control has no accessible name. A <Text> child does ` +
          `NOT supply one — react-native-web renders it as a <div> and ` +
          `name-from-content does not cross it. Add an accessibilityLabel:\n` +
          tag.slice(0, 160));
      }
    }
    assert.ok(checked > 60, `only ${checked} controls examined — the sweep went stale`);
  });

  /*
   * Four steppers all called "Increase" or "Decrease" leave a VoiceOver user
   * counting swipes to work out which pair is the weight.
   */
  test('the steppers say what they step', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'NowScreen.tsx'), 'utf8');
    // Translated behind T('increaseWord')/T('decreaseWord') now — see
    // i18n.ts — so the structural rule (two shared names across four
    // steppers) is checked at the key rather than at the English string.
    assert.match(src, /T\(label === '\+' \? 'increaseWord' : 'decreaseWord'\)/,
      'the four steppers share two names between them');
    for (const what of ['what="weight"', 'what="reps"']) {
      assert.equal((src.match(new RegExp(what, 'g')) || []).length, 2,
        `expected two ${what} steppers`);
    }
  });

  test('the primary action is a button, by name', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'NowScreen.tsx'), 'utf8');
    // Translated behind T('logSet') now; same anchor rule as elsewhere.
    const log = around(src, "accessibilityLabel={T('logSet')}", 400, 40);
    assert.match(log, /accessibilityRole="button"/,
      'LOG SET is the one control the whole app exists for');
  });

  test('the exercise name is announced without being drawn as a button', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'NowScreen.tsx'), 'utf8');
    assert.match(src, /accessibilityLabel=\{fill\(T\('changeExerciseA11y'\), \{ name: state\.exercise\.name \}\)\}/);
    // §7: it must still not LOOK like a button.
    assert.doesNotMatch(src, /style=\{s\.exerciseTap[^}]*button/i);
  });
});

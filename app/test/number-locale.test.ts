import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { number, dateLocale, LANGUAGES } from '../src/domain/i18n.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const require_ = createRequire(import.meta.url);

function sources(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const dir of [path.join(ROOT, 'app', 'app'), path.join(ROOT, 'app', 'src', 'ui')]) {
    for (const f of fs.readdirSync(dir)) {
      if (/\.(tsx|ts)$/.test(f)) out.push([f, fs.readFileSync(path.join(dir, f), 'utf8')]);
    }
  }
  return out;
}

/*
 * R479. Dates followed the app's chosen language; numbers followed the DEVICE.
 *
 * `dateLocale` exists because of exactly this failure one level up — its own
 * comment records "Mon, Aug 24" sitting under "ENTRENOS RECIENTES" on a screen
 * that was otherwise entirely Spanish. The fix was applied to dates and the
 * numbers beside them were left calling a bare `toLocaleString()`, which reads
 * the OS. Measured in the running app with the language set to Spanish and the
 * browser at en-US: Progress rendered "dom, 30 ago" and "10,125 lb" on the same
 * row. Spanish groups with dots — that row should read "10.125".
 *
 * The shared card was worse: `spike/recap.js` used a hardcoded comma regex, so
 * a Spanish lifter on a Spanish device saw "1.284.600" in the app and shipped
 * "1,284,600" to whoever opened the link — one workout, two numbers, on the two
 * surfaces that are meant to be the same card.
 */
describe('a number is grouped by the card\'s language, not the reader\'s device', () => {
  test('each language groups the way that language groups', () => {
    assert.equal(number(1284600, 'en'), '1,284,600');
    assert.equal(number(1284600, 'es'), '1.284.600');
  });

  test('and never consults the device, unlike dateLocale', () => {
    // `dateLocale` returns undefined for English, which means "ask the OS" —
    // acceptable for a date read on the device that produced it. A number on a
    // SHARED card is read somewhere else, so it may never be undefined.
    assert.equal(dateLocale('en'), undefined, 'the date rule changed; re-check this reasoning');
    // Seven figures, not four: Spanish deliberately leaves a four-digit number
    // ungrouped ("1000", not "1.000"), so 1000 cannot distinguish "grouped in
    // Spanish" from "not grouped at all" — this assertion was written at 1000
    // first and failed for that reason, which is the right kind of failure.
    for (const lang of LANGUAGES) {
      assert.match(number(1284600, lang), /^1[.,]284[.,]600$/,
        `${lang} produced no grouping — an undefined locale would follow the reader's device`);
    }
  });

  /*
   * The one that actually matters. `spike/recap.js` is a standalone Canvas2D
   * file that cannot import TypeScript (the same boundary bundle-parity.test.ts
   * exists for), so the rule is written out twice — and two implementations of
   * one rule is precisely the shape this codebase keeps paying for. Rather than
   * trusting a comment that says they agree, this runs BOTH.
   */
  test('the app and the shared card produce byte-identical numbers', () => {
    const R = require_(path.join(ROOT, 'spike', 'recap.js'));
    const { createCanvas, GlobalFonts } = require_('@napi-rs/canvas');
    GlobalFonts.loadSystemFonts();

    // Read the card's own grouping by rendering and capturing what it draws,
    // rather than by reaching for a private function — the drawn string is the
    // thing the recipient actually sees.
    const drawnVolume = (volume: number, lang: string): string => {
      const c = createCanvas(R.W, R.H);
      const ctx = c.getContext('2d');
      const seen: string[] = [];
      const real = ctx.fillText.bind(ctx);
      ctx.fillText = (t: string, x: number, y: number) => {
        seen.push(String(t));
        return real(t, x, y);
      };
      R.render(ctx, R.DURATION, {
        data: {
          title: 'LEGS DAY', date: 'THU 27 AUG', volume, sets: 12, duration: '48 MIN',
          streak: 14, unit: 'lb', watermark: 'PROOF',
          ...(lang === 'en' ? {} : { lang }),
          lifts: [['Squat', '225 × 5', true]]
        }
      });
      // The volume is drawn at the largest size; find the string that is the
      // formatted number rather than assuming a draw order.
      return seen.find(t => /^[\d.,]+$/.test(t) && t.replace(/[.,]/g, '') === String(volume)) ?? '';
    };

    for (const [lang, n] of [['en', 1284600], ['es', 1284600], ['en', 9800], ['es', 9800]] as const) {
      assert.equal(drawnVolume(n, lang), number(n, lang),
        `the card drew a different number than the app for ${n} in ${lang} — ` +
        'the sender and the recipient would see different totals for one workout');
    }
  });

  test('no surface still reads the reader\'s device for a number', () => {
    // Counted, so this cannot pass having scanned nothing (HANDOFF trap 10).
    let scanned = 0;
    const offenders: string[] = [];
    for (const [name, src] of sources()) {
      scanned++;
      for (const m of src.matchAll(/(\w+)\.toLocaleString\(\)/g)) {
        offenders.push(`${name}: ${m[0]}`);
      }
    }
    assert.ok(scanned > 20, `only ${scanned} files scanned — the sweep went stale`);
    assert.deepEqual(offenders, [],
      'a bare toLocaleString() follows the OS, not the app\'s language — use number(n, lang)');
  });
});

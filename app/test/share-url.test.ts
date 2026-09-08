import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/data/repo.ts';
import { recapFor, shareText } from '../src/ui/recap-model.ts';
import { shareUrl, pack, b64url, SHARE_BASE } from '../src/domain/share-url.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const require_ = createRequire(import.meta.url);

/** The landing page's own copy — the thing that has to be able to read this. */
const ShareURL = require_(path.join(ROOT, 'link', 'share-url.js'));

const DAY = 86_400_000, MIN = 60_000;
const T = Date.UTC(2026, 6, 29, 18);

/** Six weeks of history, then a session that beats it — enough to clear §8's guard. */
function trained(): Repo {
  const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
  let n = 0;
  for (let w = 6; w >= 1; w--) {
    const sid = 'w' + w, at = T - w * 7 * DAY;
    repo.startSession(sid, 'lb', undefined, at);
    for (const [ex, base, reps] of [['bench', 175, 5], ['ohp', 85, 5]] as const) {
      repo.logSet({ id: 'o' + n++, sessionId: sid, exerciseId: ex, weight: base + (6 - w) * 5, reps, at });
    }
    repo.endSession(sid, at + 40 * MIN);
  }
  const at = T - 70 * MIN;
  repo.startSession('now', 'lb', undefined, at);
  repo.logSet({ id: 'n1', sessionId: 'now', exerciseId: 'bench', weight: 205, reps: 5, at: at + 8 * MIN });
  repo.logSet({ id: 'n2', sessionId: 'now', exerciseId: 'ohp', weight: 115, reps: 5, at: at + 20 * MIN });
  repo.endSession('now', T - 5 * MIN);
  return repo;
}

/**
 * §5 says the group chat is the destination to design for and is "the only
 * destination that can carry a link", and `link/README.md` calls it the single
 * strongest acquisition mechanism the product has. The landing page, the wire
 * format and the deep-link manifests were all built and the app never produced
 * a URL, so the message went out as bare text.
 */
describe('the share message carries a link (§5)', () => {
  test('it is in the message', () => {
    const text = shareText(recapFor(trained(), 'now', T)!);
    assert.ok(text.includes(SHARE_BASE), `no link in: ${text}`);
  });

  test('the watermark still signs it, and the URL follows', () => {
    const text = shareText(recapFor(trained(), 'now', T)!);
    assert.ok(text.indexOf('PROOF') < text.indexOf(SHARE_BASE),
      'a 300-character fragment before the mark buries the signature');
  });

  test('the work still leads — a link does not become the message', () => {
    const text = shareText(recapFor(trained(), 'now', T)!);
    assert.ok(text.indexOf('Bench Press') < text.indexOf('http'));
  });

  test('it stays inside what chat clients will carry', () => {
    const url = shareUrl(recapFor(trained(), 'now', T)!.payload);
    assert.ok(url.length < 2000, `${url.length} characters — clients truncate around 2,000`);
  });
});

/*
 * Two implementations of one wire format is the real risk here: the app encodes
 * in TypeScript and the landing page decodes with `link/share-url.js`. If they
 * drift the link does not error, it renders an empty card — so the test encodes
 * with one and decodes with the other.
 */
describe('the landing page can read what the app writes', () => {
  const payload = () => recapFor(trained(), 'now', T)!.payload;

  test('a full workout round-trips', () => {
    const back = ShareURL.readURL(shareUrl(payload()));
    assert.ok(back, 'the landing page could not decode the app\'s own URL');
    const p = payload();
    assert.equal(back.volume, p.volume);
    assert.equal(back.sets, p.sets);
    assert.equal(back.unit, p.unit);
    assert.equal(back.duration, p.duration);
    assert.equal(back.watermark, p.watermark);
  });

  test('the PR survives, which is the thing worth sending', () => {
    const p = payload();
    assert.ok(p.pr, 'fixture is wrong — no PR to carry');
    const back = ShareURL.readURL(shareUrl(p));
    assert.equal(back.pr.lift, p.pr!.lift);
    assert.equal(back.pr.weight, p.pr!.weight);
    assert.equal(back.pr.reps, p.pr!.reps);
    assert.equal(back.pr.prev, p.pr!.prev);
    // `gain` was not in the wire format at all, so every shared card fell back
    // to "BEST YET" where it should have read "+5 LB". The renderer refuses to
    // derive it from `prev` on purpose: prev is 0 in the e1RM branch, and
    // subtracting printed the entire bar as the improvement.
    assert.equal(back.pr.gain, p.pr!.gain);
  });

  test('the lift list survives, including which one is badged', () => {
    const p = payload();
    const back = ShareURL.readURL(shareUrl(p));
    assert.deepEqual(back.lifts, p.lifts);
  });

  test('both packers agree field for field', () => {
    const p = payload();
    assert.deepEqual(pack(p), ShareURL.pack(p),
      'the app and the landing page disagree about the wire format');
  });

  /*
   * `multiple` — R435-438. Computed with real care (`multipleLine`'s four
   * curation rules) but originally kept OUTSIDE RecapPayload entirely, so it
   * never reached shareText, the wire format, or the shareable PNG — visible
   * only to someone already looking at the live screen. Now on the payload
   * itself; this is the same round-trip proof `pr` and `bestYet` already get.
   */
  test('the bodyweight-multiple milestone survives the wire (R435-438)', () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    repo.saveMeasurement({ id: 'w1', kind: 'bodyweight', value: 200, unit: 'lb', at: T - 50 * DAY });
    repo.startSession('sq', 'lb', undefined, T - 40 * DAY);
    repo.logSet({ id: 'sq1', sessionId: 'sq', exerciseId: 'squat', weight: 350, reps: 5, at: T - 40 * DAY });
    repo.endSession('sq', T - 40 * DAY + 60_000);
    const p = recapFor(repo, 'sq', T)!.payload;
    assert.ok(p.multiple, 'fixture is wrong — no multiple to carry');
    const back = ShareURL.readURL(shareUrl(p));
    assert.equal(back.multiple, p.multiple, 'the milestone did not survive the wire');
    assert.deepEqual(pack(p), ShareURL.pack(p), 'both packers must agree once `multiple` rides too');
  });

  /*
   * `bestYet` — beat your own best while §8 is still withholding the word
   * "record" — was added to the in-app card and the share message first. The
   * shared LINK renders from this wire format with its own copy of the
   * renderer, so a field that does not ride here is a claim slot that comes
   * up empty for the recipient while the sender sees it full. Two sessions,
   * then a third that beats them: one short of what the cold-start guard
   * needs, which is exactly the window this claim exists for.
   */
  function bestYetRepo(): Repo {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    let n = 0;
    for (let w = 2; w >= 1; w--) {
      const sid = 'w' + w, at = T - w * 7 * DAY;
      repo.startSession(sid, 'lb', undefined, at);
      repo.logSet({ id: 'o' + n++, sessionId: sid, exerciseId: 'bench', weight: 90, reps: 8, at });
      repo.endSession(sid, at + 40 * MIN);
    }
    const at = T - 70 * MIN;
    repo.startSession('now', 'lb', undefined, at);
    repo.logSet({ id: 'n1', sessionId: 'now', exerciseId: 'bench', weight: 135, reps: 8, at: at + 8 * MIN });
    repo.endSession('now', at + 30 * MIN);
    return repo;
  }

  test('a best-yet session reaches the recipient with its claim intact', () => {
    const p = recapFor(bestYetRepo(), 'now', T)!.payload;
    assert.ok(p.bestYet, 'fixture is wrong — no bestYet to carry');
    assert.equal(p.pr, undefined, 'fixture is wrong — the guard should still withhold the record');
    const back = ShareURL.readURL(shareUrl(p));
    assert.ok(back.bestYet, 'the recipient got an empty claim slot the sender saw filled');
    assert.equal(back.bestYet.prev, p.bestYet!.prev,
      'the number that makes the claim checkable did not survive the URL');
  });

  test('both packers agree on a best-yet session too', () => {
    const p = recapFor(bestYetRepo(), 'now', T)!.payload;
    assert.deepEqual(pack(p), ShareURL.pack(p));
  });

  test('an ordinary session spends no URL budget on the field', () => {
    const p = payload();
    assert.equal(p.bestYet, undefined, 'fixture sanity: this one PRs, so bestYet stands down');
    assert.ok(!('y' in (pack(p) as Record<string, unknown>)),
      'an absent claim must not ride as a key — URL budget is what this format exists to respect');
  });

  test('the encoders agree, including on non-ASCII a user could type', () => {
    for (const s of ['', 'Bench', 'Übung', 'スクワット', 'a"b\\c', '💪 press', '{"v":1}']) {
      assert.equal(b64url(s), ShareURL._b64urlEncode(s), `disagreed on ${JSON.stringify(s)}`);
    }
  });

  test('a send token rides in the query, not the fragment', () => {
    // The query IS sent to the server; the fragment never is. The token
    // identifies the send so attribution works at all — see link/README.md.
    const url = shareUrl(payload(), 'abc123');
    assert.ok(url.indexOf('?r=abc123') < url.indexOf('#'));
    assert.equal(ShareURL.readRef(url), 'abc123');
    assert.ok(ShareURL.readURL(url), 'the payload must still decode with a ref present');
  });
});

/*
 * A second copy of the domain is a second thing to change when the real one
 * lands, and the one that gets missed breaks Universal Links silently.
 */
describe('the link points where the app claims it does', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'app.json'), 'utf8'));

  test('the host matches associatedDomains', () => {
    const host = new URL(SHARE_BASE).host;
    const links: string[] = appJson.expo.ios.associatedDomains;
    assert.ok(links.includes(`applinks:${host}`),
      `SHARE_BASE is ${host} but app.json declares ${links.join(', ')}`);
  });

  test('the path matches the Android intent filter', () => {
    const url = new URL(SHARE_BASE);
    const data = appJson.expo.android.intentFilters
      .flatMap((f: any) => f.data ?? [])
      .find((d: any) => d.host === url.host);
    assert.ok(data, `no Android intent filter for ${url.host}`);
    assert.equal(data.scheme, url.protocol.replace(':', ''));
    assert.ok(url.pathname.startsWith(data.pathPrefix),
      `${url.pathname} is not under the declared prefix ${data.pathPrefix}`);
  });
});

/*
 * The claim slot on the card needs these three, and none of them were in the
 * wire format — which is why a PR-less session had nothing true to put there.
 */
describe('the card gets what its claim slot needs', () => {
  const first = () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    const at = T - 50 * MIN;
    repo.startSession('now', 'lb', undefined, at);
    repo.logSet({ id: 'a', sessionId: 'now', exerciseId: 'bench', weight: 95, reps: 8, at: at + 8 * MIN });
    repo.logSet({ id: 'b', sessionId: 'now', exerciseId: 'ohp', weight: 45, reps: 8, at: at + 16 * MIN });
    repo.endSession('now', T - 5 * MIN);
    return recapFor(repo, 'now', T)!.payload;
  };

  test('firstSession and the heaviest set both travel', () => {
    const p = first();
    assert.equal(p.firstSession, true, 'fixture is wrong');
    const back = ShareURL.readURL(shareUrl(p));
    assert.equal(back.firstSession, true);
    assert.deepEqual(back.best, { lift: p.best!.lift, weight: p.best!.weight, reps: p.best!.reps });
  });

  test('a one-week streak is not sent at all', () => {
    // The in-app card already refuses to print one (streakWorthShowing is >= 2).
    // The shared card had no such rule and claimed "1 WK" on a first workout,
    // so the artifact that travels made a claim the phone had suppressed.
    const p = first();
    assert.equal(p.streak, 1, 'fixture is wrong');
    assert.equal(ShareURL.readURL(shareUrl(p)).streak, undefined);
  });

  test('a real streak still travels', () => {
    const p = { ...first(), streak: 7 };
    assert.equal(ShareURL.readURL(shareUrl(p)).streak, 7);
  });

  test('a new streak record travels, absent when it is not one', () => {
    const record = { ...first(), streak: 7, streakRecord: true };
    assert.equal(ShareURL.readURL(shareUrl(record)).streakRecord, true);
    const ordinary = { ...first(), streak: 7 };
    assert.equal(ShareURL.readURL(shareUrl(ordinary)).streakRecord, undefined,
      'an ordinary streak must not spend URL budget restating "not a record"');
    // Both packers, not just the round trip — the two implementations of one
    // wire format are the thing that silently drifts (see share-card.test.ts).
    assert.deepEqual(pack(record as any), ShareURL.pack(record));
  });

  test('a goal line travels', () => {
    const p = { ...first(), goalLine: '20 lb from a 225 bench press' };
    assert.equal(ShareURL.readURL(shareUrl(p)).goalLine, '20 lb from a 225 bench press');
  });

  test('both packers still agree once all of it is present', () => {
    const p = { ...first(), goalLine: '20 lb from a 225 bench press', streak: 7 };
    assert.deepEqual(pack(p as any), ShareURL.pack(p));
  });
});

/*
 * §8 calls kg the world majority, and the notes record three separate occasions
 * where a fixture with no locale was assumed to be pounds. Every walk of this
 * app so far has been in lb.
 */
describe('a kg lifter sends kg (§8)', () => {
  const kg = () => {
    const repo = new Repo(new DatabaseSync(':memory:') as any, () => T);
    let n = 0;
    for (let w = 6; w >= 1; w--) {
      const sid = 'w' + w, at = T - w * 7 * DAY;
      repo.startSession(sid, 'kg', undefined, at);
      repo.logSet({ id: 'o' + n++, sessionId: sid, exerciseId: 'squat', weight: 100 + (6 - w) * 2.5, reps: 5, at });
      repo.endSession(sid, at + 40 * MIN);
    }
    const at = T - 70 * MIN;
    repo.startSession('now', 'kg', undefined, at);
    repo.logSet({ id: 'n1', sessionId: 'now', exerciseId: 'squat', weight: 115, reps: 5, at: at + 8 * MIN });
    repo.endSession('now', T - 5 * MIN);
    return recapFor(repo, 'now', T)!;
  };

  test('the message is in kg and never mentions pounds', () => {
    const text = shareText(kg());
    assert.match(text, /\bkg\b/);
    assert.doesNotMatch(text, /\blb\b/i, `pounds leaked into a kg message: ${text}`);
  });

  test('half-kilo plates survive the wire', () => {
    // 2.5 kg is the smallest plate most gyms have; rounding it away would make
    // the shared card disagree with the app about what was lifted.
    const p = kg().payload;
    assert.equal(p.pr!.gain, 2.5, 'fixture is wrong');
    assert.equal(ShareURL.readURL(shareUrl(p)).pr.gain, 2.5);
  });

  test('the unit is always sent, so the card never has to guess', () => {
    // The renderer falls back to LB when `unit` is missing, which is exactly the
    // silent-pounds default §8 forbids — so the packer must never omit it.
    const p = kg().payload;
    assert.equal((pack(p) as any).n, 'kg');
    assert.equal(ShareURL.readURL(shareUrl(p)).unit, 'kg');
  });

  test('a later session does not spend URL budget saying it is not the first', () => {
    const p = kg().payload;
    assert.equal(p.firstSession, false, 'fixture is wrong');
    assert.equal('f' in (pack(p) as any), false);
    assert.equal(ShareURL.readURL(shareUrl(p)).firstSession, undefined);
  });
});

/*
 * The card's language has to reach the recipient's browser.
 *
 * `spike/recap.js` draws its own chrome — TOTAL VOLUME, SETS, STREAK, the
 * claim slabs — and held those as English literals while `buildRecap` was
 * already translating the values beside them. The fix puts a language code on
 * the payload, which means it has to survive the URL: without it a Spanish
 * workout renders English labels around Spanish content on the one surface §5
 * says the product is judged by.
 */
describe('the card language travels', () => {
  const base = () => recapFor(trained(), 'now', T)!.payload;
  const spanish = () => ({ ...base(), lang: 'es' as const });

  test('a Spanish card arrives Spanish', () => {
    const back = ShareURL.readURL(shareUrl(spanish()));
    assert.equal(back.lang, 'es');
  });

  test('an English card spends no URL budget saying so', () => {
    // Same rule as `volumeKnown` and `firstSession`: absent means the default,
    // and every ordinary session would otherwise restate it forever.
    const packed = pack(base()) as Record<string, unknown>;
    assert.equal('a' in packed, false, 'an English card is paying for a field it does not need');
    assert.equal(ShareURL.readURL(shareUrl(base())).lang, undefined);
  });

  test('both packers agree about it', () => {
    // The two implementations of this format are the place drift lives — see
    // the other "both packers agree" tests in this file.
    assert.deepEqual(pack(spanish()), ShareURL.pack(spanish()),
      'the app and the landing page disagree about the card language');
  });

  test('everything else still travels alongside it', () => {
    const p = spanish();
    const back = ShareURL.readURL(shareUrl(p));
    assert.equal(back.title, p.title);
    assert.equal(back.volume, p.volume);
    assert.deepEqual(back.lifts, p.lifts);
  });
});

/*
 * The bug class R285 found: `kind: 'weekly'` was a real `RecapPayload` field
 * that `pack()` had simply never been told about, so a shared weekly link
 * silently decoded as an ordinary session — no crash, no failing test, until
 * something happened to notice the field was missing from the wire.
 *
 * A full single-declaration refactor (one source both `pack()` and the
 * interface read from) was considered and rejected: the wire format's
 * LONG/SHORT ordering is deliberately append-only, because reordering it
 * would silently reinterpret every link already shared before this build —
 * collapsing it into something generated from the interface risks exactly
 * that kind of silent reordering the append-only convention exists to
 * prevent. The claim-priority chain in `recap.js` also has real per-branch
 * logic (`pr` beats `firstSession && best` beats `bestYet && best`...) that
 * does not reduce to a flat list of names without restructuring
 * `RecapPayload` into a discriminated union — a bigger, riskier change than
 * the bug it would prevent.
 *
 * Cheaper and safer: read the field names straight out of the interface's
 * own source and assert each one is referenced SOMEWHERE in `pack()` — either
 * through `LONG` or through one of the hand-written special cases
 * (`volumeKnown`, `lang`, `best`, `bestYet`, `pr`, `lifts` all ride this way,
 * not through LONG). This would have failed before R285's fix, the same way
 * it fails now if reverted.
 */
describe('every RecapPayload field is at least mentioned in pack() (R290)', () => {
  const HERE2 = path.dirname(fileURLToPath(import.meta.url));
  const sessionSrc = fs.readFileSync(path.join(HERE2, '..', 'src', 'domain', 'session.ts'), 'utf8');
  // Comments stripped first — a field named only in the PROSE explaining why
  // an earlier field is missing (exactly what happened here, the first time
  // this test was written: `kind` stayed matched by its own removal comment
  // even after being pulled from the wire) must not read as present.
  const packSrc = fs.readFileSync(path.join(HERE2, '..', 'src', 'domain', 'share-url.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  // The interface body, from its declaration to the closing brace that ends
  // it — `region`'s own two-anchor approach, inlined here since this file
  // does not otherwise use the shared helper.
  const start = sessionSrc.indexOf('export interface RecapPayload {');
  const end = sessionSrc.indexOf('\n}', start);
  const body = sessionSrc.slice(start, end);
  const fields = [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map(m => m[1]);

  test('the interface still has the fields this test expects to check', () => {
    // A sanity floor so this cannot pass by parsing nothing — the same rule
    // `source-helper.test.ts` polices project-wide.
    assert.ok(fields.length >= 15, `only found ${fields.length} fields — did the anchor break?`);
    assert.ok(fields.includes('streakRecord') && fields.includes('kind'),
      'the two newest fields are missing from the parse — check the anchors');
  });

  for (const field of fields) {
    test(`pack() mentions "${field}"`, () => {
      assert.match(packSrc, new RegExp(`\\b${field}\\b`),
        `RecapPayload.${field} is never referenced in share-url.ts's pack() — ` +
        'it will silently vanish off the wire, the same way `kind` did until R285');
    });
  }
});

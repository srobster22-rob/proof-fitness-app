import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

/** The inline script out of the DEPLOYED page, not the source one. */
function pageScript(): string {
  const html = fs.readFileSync(path.join(ROOT, 'link', 'dist', 'index.html'), 'utf8');
  const parts = html.split('<script>');
  const js = parts[parts.length - 1].split('</script>')[0];
  assert.ok(js.includes('RecapRender'), 'could not find the page script — has index.html moved?');
  return js;
}

/**
 * Run the landing page's own script against stub globals.
 *
 * `render` is supplied by the caller so the failure the page must survive can
 * be injected directly, which is the only way to test it: the two real
 * instances were both malformed payloads, and the next one has not been
 * written yet.
 */
function runPage(render: () => void) {
  const els: Record<string, any> = {};
  const mk = (id: string) => (els[id] ||= {
    textContent: '', dataset: {}, hidden: false, style: {}, onclick: null, href: '',
    getContext: () => ({})
  });
  const g = globalThis as any;
  const saved = { document: g.document, location: g.location, matchMedia: g.matchMedia,
    requestAnimationFrame: g.requestAnimationFrame, cancelAnimationFrame: g.cancelAnimationFrame,
    performance: g.performance, ShareURL: g.ShareURL, Copy: g.Copy, RecapRender: g.RecapRender };
  try {
    g.document = { getElementById: mk, querySelector: mk, documentElement: { dataset: {} } };
    g.location = { href: 'https://example.app/r#zz', search: '' };
    g.matchMedia = () => ({ matches: true });          // reduced motion: no rAF loop
    g.requestAnimationFrame = () => 0;
    g.cancelAnimationFrame = () => {};
    g.performance = { now: () => 0 };
    g.ShareURL = { readURL: () => null };
    g.Copy = { pick: () => ({ id: 'a', cta: 'Get PROOF' }), resolve: () => ({ h: 'Head', s: 'Sub' }) };
    g.RecapRender = { DURATION: 6, render };
    // eslint-disable-next-line no-new-func
    new Function(pageScript())();
    return { els, mk };
  } finally {
    Object.assign(g, saved);
  }
}

/*
 * §5 makes this page an acquisition path: "a tappable install path beside the
 * file". The card is the nice half; the headline and the button are the JOB.
 *
 * Every value on the card arrives from a URL fragment written by some version
 * of the app — not necessarily this one — so the renderer is fed input it
 * cannot trust, and it has thrown on that input twice already: an unguarded
 * `D.pr.weight` blanked the link for every first-ever workout (§8 forbids a PR
 * before three sessions), and `D.lifts.length` did the same for a payload whose
 * lift list was legitimately omitted by `pack`. Both are fixed. The third has
 * not been written yet, which is what this guards.
 */
describe('the landing page survives a card it cannot draw', () => {
  test('a throwing renderer does not take the page down', () => {
    assert.doesNotThrow(() => runPage(() => { throw new Error('bad payload'); }),
      'an uncaught render error kills every line after it, including the CTA wiring');
  });

  test('the install button still works when the card does not', () => {
    const { mk } = runPage(() => { throw new Error('bad payload'); });
    assert.equal(mk('get').textContent, 'Get PROOF', 'the acquisition path went with the card');
    assert.equal(mk('headline').textContent, 'Head');
  });

  test('the empty stage is hidden rather than left as a blank box', () => {
    const { mk } = runPage(() => { throw new Error('bad payload'); });
    assert.equal(mk('.stage').hidden, true,
      'an empty framed box reads as broken; headline + button reads as a landing page');
  });

  test('an ordinary card is unaffected — the stage stays visible', () => {
    const { mk } = runPage(() => {});
    assert.equal(mk('.stage').hidden, false);
    assert.equal(mk('get').textContent, 'Get PROOF');
  });
});

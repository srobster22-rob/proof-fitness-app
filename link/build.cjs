/*
 * Assembles the deployable static site into ./dist.
 *
 * recap.js is copied, not duplicated in source: spike/recap.js stays the single
 * design source of truth, so the landing page can never drift from what the app
 * actually renders. If it drifts, the recipient sees a different product than
 * the sender does.
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const DIST = path.join(HERE, 'dist');
const WELL_KNOWN = path.join(DIST, '.well-known');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(WELL_KNOWN, { recursive: true });

// The source page loads ../spike/recap.js so it runs in place during development.
// dist/ is self-contained, so rewrite the path as it is copied. If this rewrite
// ever silently no-ops, the deployed page renders nothing — so it is asserted.
const srcHtml = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
const outHtml = srcHtml.replaceAll('../spike/recap.js', './recap.js');
if (outHtml === srcHtml) {
  console.error('FAILED: expected "../spike/recap.js" in index.html and did not find it.');
  process.exit(1);
}
/*
 * replaceAll, and then a check that does not depend on counting.
 *
 * The guard above only catches a rewrite that matched NOTHING. It cannot see
 * the other way this fails: `replace` with a string argument rewrites the
 * FIRST occurrence only, so a second `<script src="../spike/recap.js">` would
 * leave the page shipping a path that does not exist inside dist/, with the
 * build reporting success. There is one occurrence today, which is exactly why
 * it would go unnoticed the day there are two.
 *
 * So the real check is the invariant rather than the edit: dist/ is
 * self-contained, therefore NOTHING in it may point outside itself.
 */
const escapes = [...outHtml.matchAll(/(?:src|href)="([^"]*\.\.\/[^"]*)"/g)].map(m => m[1]);
if (escapes.length) {
  console.error('FAILED: dist/index.html still points outside dist/: ' + escapes.join(', '));
  process.exit(1);
}
fs.writeFileSync(path.join(DIST, 'index.html'), outHtml);
console.log('  dist/index.html  (recap.js path rewritten)');

const copies = [
  [path.join(HERE, 'share-url.js'), path.join(DIST, 'share-url.js')],
  [path.join(HERE, 'copy.js'), path.join(DIST, 'copy.js')],
  [path.join(HERE, 'og.png'), path.join(DIST, 'og.png')],
  [path.join(HERE, '..', 'spike', 'recap.js'), path.join(DIST, 'recap.js')],
  [path.join(HERE, 'apple-app-site-association'), path.join(WELL_KNOWN, 'apple-app-site-association')],
  [path.join(HERE, 'assetlinks.json'), path.join(WELL_KNOWN, 'assetlinks.json')]
];

for (const [from, to] of copies) {
  if (!fs.existsSync(from)) { console.error(`MISSING ${from}`); process.exitCode = 1; continue; }
  fs.copyFileSync(from, to);
  console.log(`  ${path.relative(HERE, to)}`);
}

// /r is the share path; static hosts need it to resolve to the same document.
fs.writeFileSync(path.join(DIST, 'r.html'), outHtml);
console.log('  dist/r.html');

// Netlify/Cloudflare-style rewrite so /r/<anything> serves the page without a redirect.
// A redirect would break Universal Links — iOS refuses to follow one for app matching.
fs.writeFileSync(path.join(DIST, '_redirects'), '/r/*  /r.html  200\n/r    /r.html  200\n');
console.log('  dist/_redirects');

// AASA must be served as application/json with no extension and no redirect.
fs.writeFileSync(path.join(DIST, '_headers'),
  '/.well-known/apple-app-site-association\n  Content-Type: application/json\n');
console.log('  dist/_headers');

console.log('\ndist/ ready — deploy this folder to any static host.');

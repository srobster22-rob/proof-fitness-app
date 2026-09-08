/*
 * Fails if any Expo-managed dependency has drifted off what this SDK bundles.
 *
 * Exists because it found real drift: caret ranges had quietly moved react to
 * 19.2.8 and react-native to 0.81.6 against an SDK that wants 19.1.0 and 0.81.5.
 * That class of mismatch does not fail the bundler or tsc — it fails at runtime
 * on a device, for no visible reason, which is the worst place to find it.
 *
 * Also verifies the tree is actually complete, because npm does not reliably
 * repair transitive dependencies after a version pin.
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const bundled = require(path.join(HERE, 'node_modules', 'expo', 'bundledNativeModules.json'));
const pkg = require(path.join(HERE, 'package.json'));
const declared = { ...pkg.dependencies, ...pkg.devDependencies };

const problems = [];

/** Minimal semver satisfaction for the ~ / ^ / exact forms Expo uses. */
function satisfies(have, want) {
  const [wMaj, wMin, wPatch] = want.replace(/^[~^]/, '').split('.').map(Number);
  const [hMaj, hMin, hPatch] = have.split('.').map(Number);
  if (want.startsWith('~')) return hMaj === wMaj && hMin === wMin && hPatch >= wPatch;
  if (want.startsWith('^')) return hMaj === wMaj && (hMin > wMin || (hMin === wMin && hPatch >= wPatch));
  return have === want;
}

for (const [name, want] of Object.entries(bundled)) {
  if (!declared[name]) continue;
  const manifest = path.join(HERE, 'node_modules', name, 'package.json');
  if (!fs.existsSync(manifest)) {
    problems.push(`${name}: declared but not installed`);
    continue;
  }
  const have = require(manifest).version;
  if (!satisfies(have, want)) {
    problems.push(`${name}: have ${have}, SDK bundles ${want}`);
  }
}

// Transitive completeness for the three packages that matter most.
for (const root of ['expo', 'react-native', 'expo-router']) {
  const manifest = path.join(HERE, 'node_modules', root, 'package.json');
  if (!fs.existsSync(manifest)) { problems.push(`${root}: not installed`); continue; }
  for (const dep of Object.keys(require(manifest).dependencies || {})) {
    // Web-only, and genuinely optional for an iOS-first build.
    if (dep === '@radix-ui/react-tabs') continue;
    if (!fs.existsSync(path.join(HERE, 'node_modules', dep))) {
      problems.push(`${root} -> ${dep}: missing from the tree`);
    }
  }
}

if (problems.length) {
  console.error('Dependency drift:\n  ' + problems.join('\n  '));
  console.error('\nFix with: npm install --save-exact <pkg>@<version the SDK bundles>');
  process.exit(1);
}
console.log(`deps ok — ${Object.keys(bundled).filter(n => declared[n]).length} Expo-managed packages match SDK ${pkg.dependencies.expo}`);

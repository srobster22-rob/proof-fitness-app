/*
 * Metro config.
 *
 * The non-default settings all exist for one reason: this package lives at
 * C:\Users\srobs\fitness-app\app, and C:\Users\srobs itself contains a
 * package.json AND a node_modules with its own copy of expo. Node's upward
 * resolution finds that copy, and an early bundle attempt did exactly that —
 * pulling `expo/AppEntry.js` out of the parent tree and bundling a project that
 * was not this one.
 *
 * So: resolve modules ONLY from this package, and do not watch above it.
 */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

config.projectRoot = projectRoot;
config.watchFolders = [projectRoot];
config.resolver.nodeModulesPaths = [path.join(projectRoot, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;

/*
 * Cross-origin isolation, for running the app in a browser.
 *
 * expo-sqlite's web backend is wasm and needs SharedArrayBuffer, which browsers
 * only expose to cross-origin-isolated documents. Without these two headers the
 * database fails to open with "SharedArrayBuffer is not defined" — which is
 * exactly what happened on the first web run.
 *
 * Dev-server only. It exists so the app can be exercised on a laptop; iOS does
 * not go through Metro's server and is unaffected.
 */
config.server = config.server ?? {};
const previous = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const base = previous ? previous(middleware, server) : middleware;
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return base(req, res, next);
  };
};

module.exports = config;

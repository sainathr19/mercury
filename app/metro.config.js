// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const projectRoot = __dirname;
// The native wallet core is a turbo module from a separate checkout, linked in
// via a `file:` dependency (symlinked into node_modules). Its real source path
// is OUTSIDE the app project root, so Metro needs that location as a watch
// folder and node_modules resolution rooted at both places.
//
// UPSTREAM_MODULE is the package's own name and cannot be changed from here —
// it belongs to another repository. The app imports it as `mercury-wallet-core`
// throughout and the alias below is the single point of translation.
const UPSTREAM_MODULE = 'standard-rn';
const WALLET_CORE = 'mercury-wallet-core';
const moduleRoot = path.resolve(
  fs.realpathSync(path.resolve(projectRoot, `node_modules/${UPSTREAM_MODULE}`)),
);

const config = getDefaultConfig(projectRoot);

config.watchFolders = [moduleRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(moduleRoot, 'node_modules'),
];
// Follow the file: symlink to the module's real location.
config.resolver.unstable_enableSymlinks = true;
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  [WALLET_CORE]: moduleRoot,
};

// The ubrn `async public` codegen issue is fixed on-disk by
// scripts/fix-bindings.js (run as part of `ubrn:ios`/`release:ios`). But that
// leaves a race: during a rebuild ubrn writes the bad modifier order and Metro
// can re-transform + cache the broken file in the window before fix-bindings
// runs, producing "SyntaxError: Unexpected token, expected '('" on the bindings.
// So we ALSO reorder the modifiers in-memory at transform time (belt-and-
// suspenders — this transformer delegates to Expo's default, so Unistyles +
// Reanimated plugins still apply). Together they make the bindings bundle
// regardless of cache/rebuild timing.
config.transformer.babelTransformerPath = path.resolve(projectRoot, 'ubrn-babel-transformer.js');

module.exports = config;

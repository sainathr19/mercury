// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const projectRoot = __dirname;
// The `standard-rn` turbo module lives in the parent directory and is linked
// via `file:..` (symlinked into node_modules). Its real source path is OUTSIDE
// the app project root, so Metro needs the parent added as a watch folder and
// node_modules resolution rooted at both locations.
// In the reference repo the app lives INSIDE standard-rn, so '..' was the
// module root. Here the app is its own project and standard-rn is symlinked in
// from another checkout, so point at its real location instead.
const moduleRoot = path.resolve(
  fs.realpathSync(path.resolve(projectRoot, 'node_modules/standard-rn')),
);

const config = getDefaultConfig(projectRoot);

config.watchFolders = [moduleRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(moduleRoot, 'node_modules'),
];
// Follow the file:.. symlink to the module's real location.
config.resolver.unstable_enableSymlinks = true;

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

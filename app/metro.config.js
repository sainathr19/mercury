const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Unistyles v3 needs react-native-nitro-modules (a NATIVE module), which Expo
// Go cannot load. While developing in Expo Go we resolve it to a plain-JS shim
// (src/theme/unistyles-shim.ts). Set this to false once running on a dev
// client to use the real library — no other change is needed.
const USE_UNISTYLES_SHIM = true;

const config = getDefaultConfig(__dirname);

config.watchFolders = [path.resolve(__dirname, '../shared')];
config.resolver.extraNodeModules = { '@shared': path.resolve(__dirname, '../shared') };

if (USE_UNISTYLES_SHIM) {
  const shim = path.resolve(__dirname, 'src/theme/unistyles-shim.ts');
  const upstream = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === 'react-native-unistyles') {
      return { type: 'sourceFile', filePath: shim };
    }
    return (upstream ?? context.resolveRequest)(context, moduleName, platform);
  };
}

module.exports = config;

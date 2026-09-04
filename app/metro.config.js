const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const config = getDefaultConfig(__dirname);
// Metro does not read tsconfig paths, so the alias is declared again here.
config.watchFolders = [path.resolve(__dirname, '../shared')];
config.resolver.extraNodeModules = { '@shared': path.resolve(__dirname, '../shared') };
module.exports = config;

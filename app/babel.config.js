module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // NOTE: the react-native-unistyles Babel plugin is intentionally absent —
    // it transforms code for the native runtime we are shimming out. Re-add it
    // alongside USE_UNISTYLES_SHIM=false when moving to a dev client.
    plugins: ['react-native-worklets/plugin'], // must stay last
  };
}

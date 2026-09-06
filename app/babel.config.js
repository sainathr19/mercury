module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // `root: 'src'` only makes src/ components reactive to runtime theme
      // changes. Our screens live in app/ (expo-router), so without
      // autoProcessPaths their StyleSheet backgrounds keep the stale theme on a
      // runtime switch (e.g. private mode) while inline colors update → mixed
      // theme. Process the route groups too so app/ screens re-theme reactively.
      ['react-native-unistyles/plugin', { root: 'src', autoProcessPaths: ['(app)', '(auth)'] }],
      'react-native-reanimated/plugin', // re-exports react-native-worklets/plugin; MUST be last
    ],
  };
};

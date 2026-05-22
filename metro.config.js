const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Optimized exclusion: We only block the specific platforms 
// and deep internals that exhaust the Android file limit.
config.resolver.blockList = [
  /.*\/ios\/.*/,
  /.*\/android\/.*/,
  /node_modules\/.*\/node_modules\/react-native\/.*/,
];

module.exports = config;


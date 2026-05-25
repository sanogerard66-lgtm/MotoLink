const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.watchFolders = [__dirname]; // only watch the project root
config.resolver.blockList = [
  /node_modules\/.*\/node_modules/,  // skip nested node_modules
];

module.exports = config;

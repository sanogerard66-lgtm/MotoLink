const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname, {
  isCSSEnabled: true,
});

const { resolver, transformer, watcher } = config;

config.resolver.assetExts = resolver.assetExts.filter((ext) => ext !== "svg");

config.resolver.sourceExts = [
  ...resolver.sourceExts,
  "svg",
  "cjs",
  "mjs",
];

config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = [
  "require",
  "import",
  "react-native",
  "default",
];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && moduleName === "react-native-webview") {
    return {
      filePath: path.resolve(__dirname, "shims/WebViewShim.web.js"),
      type: "sourceFile",
    };
  }
  if (platform === "web" && moduleName === "react-native-quick-crypto") {
    return {
      filePath: path.resolve(__dirname, "shims/CryptoShim.web.js"),
      type: "sourceFile",
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

config.resolver.extraNodeModules = {
  crypto: require.resolve("react-native-quick-crypto"),
  stream: require.resolve("readable-stream"),
  buffer: require.resolve("@craftzdog/react-native-buffer"),
};

config.resolver.blockList = [
  /node_modules\/.*\/node_modules\/react-native\/.*/,
  /\.git\/.*/,
  /android\/build\/.*/,
  /ios\/build\/.*/,
  /\.expo\/web\/cache\/.*/,
];

config.transformer.getTransformOptions = async () => ({
  transform: {
    inlineRequires: true,
    experimentalImportSupport: false,
  },
});

config.watchFolders = [path.resolve(__dirname)];

module.exports = config;

const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname, {
  isCSSEnabled: true,
});

const { resolver } = config;

config.resolver.assetExts = resolver.assetExts.filter((ext) => ext !== "svg");
config.resolver.sourceExts = [...resolver.sourceExts, "svg", "cjs", "mjs"];

const WEB_SHIMS = [
  "react-native-webview",
  "react-native-quick-crypto",
  "react-native-android-widget",
  "react-native-maps",
  "react-native-reanimated",
  "react-native-worklets",
  "@craftzdog/react-native-buffer",
  "react-native-url-polyfill",
  "expo-task-manager",
  "expo-print",
  "expo-sharing",
  "expo-image-picker",
  "expo-network",
];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web") {
    if (
      WEB_SHIMS.includes(moduleName) ||
      WEB_SHIMS.some((s) => moduleName.startsWith(s + "/"))
    ) {
      return {
        filePath: path.resolve(__dirname, "shims/empty.web.js"),
        type: "sourceFile",
      };
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

config.resolver.blockList = [
  /node_modules\/.*\/node_modules\/react-native\/.*/,
  /\.git\/.*/,
  /android\/build\/.*/,
  /ios\/build\/.*/,
];

config.transformer.getTransformOptions = async () => ({
  transform: { inlineRequires: true, experimentalImportSupport: false },
});

config.watchFolders = [path.resolve(__dirname)];
module.exports = config;

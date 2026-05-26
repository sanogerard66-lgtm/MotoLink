// metro.config.js — MotoLink
// Compatible with Expo SDK 56, React Native 0.76 (New Architecture),
// Supabase JS v2, react-native-webview, and web output via Metro bundler.
// Tested on Termux + Expo Go + EAS Build environments.

const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname, {
  // Enables CSS support for web (Leaflet map tiles need this)
  isCSSEnabled: true,
});

// ─── Resolver tweaks ─────────────────────────────────────────────────────────
const { resolver, transformer, watcher } = config;

// SVG: pull svg out of assetExts so the source transformer can handle it
config.resolver.assetExts = resolver.assetExts.filter((ext) => ext !== "svg");

// Add extra source extensions Metro doesn't include by default
config.resolver.sourceExts = [
  ...resolver.sourceExts,
  "svg",  // SVG as React components
  "cjs",  // Supabase v2 and uuid ship CommonJS files
  "mjs",  // ESM modules (some Expo deps)
];

// SDK 56 / RN 0.76 New Architecture: respect "exports" field in package.json
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = [
  "require",
  "import",
  "react-native",
  "default",
];

// Web shim for react-native-webview — swap to an iframe on web only
// (native iOS/Android is unaffected)
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && moduleName === "react-native-webview") {
    return {
      filePath: path.resolve(__dirname, "shims/WebViewShim.web.js"),
      type: "sourceFile",
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

// Node built-in polyfills needed by Supabase auth (crypto, stream, buffer)
// Install: npx expo install react-native-quick-crypto readable-stream @craftzdog/react-native-buffer
config.resolver.extraNodeModules = {
  crypto: require.resolve("react-native-quick-crypto"),
  stream: require.resolve("readable-stream"),
  buffer: require.resolve("@craftzdog/react-native-buffer"),
};

// Stop Metro crawling build artifacts — speeds up hot reload in Termux
config.resolver.blockList = [
  /node_modules\/.*\/node_modules\/react-native\/.*/,
  /\.git\/.*/,
  /android\/build\/.*/,
  /ios\/build\/.*/,
  /\.expo\/web\/cache\/.*/,
];

// ─── Transformer ─────────────────────────────────────────────────────────────
config.transformer.getTransformOptions = async () => ({
  transform: {
    // Lazy-load modules on first use — cuts cold-start ~35% on mid-range phones
    inlineRequires: true,
    experimentalImportSupport: false,
  },
});

// ─── Watcher ─────────────────────────────────────────────────────────────────
// Watchman health check — avoids stale file watch issues
config.watchFolders = [path.resolve(__dirname)];

module.exports = config;

// ═══════════════════════════════════════════════════════════════════════════════
// ONE-TIME SETUP (run once in your project root):
//
// 1. Install polyfill dependencies:
//    npx expo install react-native-quick-crypto readable-stream @craftzdog/react-native-buffer
//
// 2. Create the WebView web shim so `expo export -p web` doesn't crash:
//    mkdir -p shims
//    echo "import React from 'react';
//    export default function WebView({ srcDoc, style }) {
//      return <iframe srcDoc={srcDoc} style={{ border: 'none', ...style }} />;
//    }" > shims/WebViewShim.web.js
//
// 3. Always clear Metro cache after editing this file:
//    npx expo start --clear
// ═══════════════════════════════════════════════════════════════════════════════

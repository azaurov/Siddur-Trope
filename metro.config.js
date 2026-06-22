// Expo / Metro config.
// Default Expo config plus the asset extensions Metro needs to bundle the
// Whisper model binary (assets/whisper/ggml-base.bin).
//
// Without this, Metro's resolver rejects `.bin` files because it's not in the
// default sourceExts — so require("../../assets/whisper/ggml-base.bin") errors
// out with "Unable to resolve module".
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Treat .bin as an asset, not a source file. Metro will copy it into the
// bundle alongside images and other non-JS resources.
config.resolver.assetExts = Array.from(
  new Set([...(config.resolver.assetExts || []), "bin"])
);

module.exports = config;
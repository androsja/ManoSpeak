const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  resolver: {
    // Allow Metro to bundle model and animated-avatar files as binary assets.
    assetExts: [...(getDefaultConfig(__dirname).resolver?.assetExts ?? []), 'tflite', 'onnx', 'glb'],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);

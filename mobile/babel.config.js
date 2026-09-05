module.exports = api => {
  const isTest = api.env('test');

  return {
    presets: ['module:@react-native/babel-preset'],
    // Jest executes frame processors as ordinary functions; workletizing them
    // would replace captured mock objects with native-runtime closures.
    plugins: isTest
      ? []
      : [['react-native-worklets-core/plugin', {processNestedWorklets: true}]],
  };
};

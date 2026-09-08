/* babel-preset-expo carries the expo-router plugin and the RN JSX runtime. */
module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};

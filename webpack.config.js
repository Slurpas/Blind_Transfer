const path = require('path');

module.exports = {
  entry: './src/widget-entry.js',
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: 'bundle.js',
    libraryTarget: 'umd'
  },
  module: {
    rules: [
      {
        test: /\.m?js$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: { presets: ['@babel/preset-env'] }
        }
      }
    ]
  },
  resolve: {
    fallback: {
      // Browser polyfills if needed
    }
  }
};

// webpack.config.js (minimal; merge with your existing config if you already had loaders/etc)
const path = require("path");

module.exports = {
  mode: "production", // or "development" while testing
  entry: path.resolve(__dirname, "src/widget-entry.js"),
  output: {
    filename: "bundle.js",
    path: path.resolve(__dirname, "build"),
    libraryTarget: "umd",
    globalObject: "this"
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: { loader: "babel-loader", options: { presets: ["@babel/preset-env"] } }
      }
    ]
  },
  externals: {
    // Tell webpack: do NOT bundle @wxcc-desktop/sdk — it will be provided by the Desktop at runtime.
    "@wxcc-desktop/sdk": "Desktop"
  }
};

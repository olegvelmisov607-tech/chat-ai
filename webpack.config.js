import path from 'path';
import { fileURLToPath } from 'url';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import CopyPlugin from 'copy-webpack-plugin';
import ESLintPlugin from 'eslint-webpack-plugin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  entry: './src/app.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.[contenthash].js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/i,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/index.html',
      filename: 'index.html',
    }),
    new MiniCssExtractPlugin({
      filename: 'style.[contenthash].css',
    }),
    new CopyPlugin({
      patterns: [
        // ОБНОВЛЕННЫЕ ПУТИ:
        { from: 'src/assets/manifest.json', to: 'manifest.json' },
        { from: 'src/assets/sw.js', to: 'sw.js' },
        { from: 'src/assets/icon-512.png', to: 'icon-512.png' },
        { from: 'src/assets/icon-192.png', to: 'icon-192.png' }
      ],
    }),
    new ESLintPlugin({
      extensions: ['js'],
      fix: true,
      context: path.resolve(__dirname, 'src'),
      configType: 'flat',
      overrideConfigFile: path.resolve(__dirname, 'eslint.config.js'),
    }),
  ],
};
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
        { from: 'src/manifest.json', to: 'manifest.json' },
        { from: 'src/sw.js', to: 'sw.js' },
      ],
    }),
  
    new ESLintPlugin({
      extensions: ['js'],
      fix: true,
      // ДОБАВЛЯЕМ ЭТИ ДВЕ СТРОКИ:
      context: path.resolve(__dirname, 'src'), // Где искать файлы
      configType: 'flat', // Говорим плагину, что у нас Flat Config
      overrideConfigFile: path.resolve(__dirname, 'eslint.config.js'), // Путь к конфигу
    }),

  ],
};
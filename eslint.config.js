import globals from 'globals';
import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'server.js', 'server/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-console': 'off',
      'semi': ['error', 'always'],
      'quotes': ['error', 'single'],
      'eqeqeq': ['error', 'always'],
    },
  },
  {
    // Блок для конфигов
    files: ['webpack.config.js', 'playwright.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // ДОБАВЛЕНО: Блок для E2E-тестов Playwright
    files: ['**/*.spec.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node, // Включает Buffer, process и т.д.
      },
    },
  },
  {
    ignores: ['dist/', 'playwright-report/', 'test-results/'],
  }
];
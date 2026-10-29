import globals from 'globals';
import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'server/**/*.js'],
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
      'quotes': ['error','single'],
      'eqeqeq': ['error', 'always'],
    },
  },
  {
    // Отдельный блок для Service Worker (sw.js)
    files: ['src/assets/sw.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.serviceworker,
      },
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
    // Блок для E2E-тестов Playwright
    files: ['**/*.spec.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,    
        ...globals.browser, 
      },
    },
  },
  {
    // Игнорируем папки со сборкой, документацией и временные файлы IDE/агентов
    ignores: [
      'dist/',
      'docs/', // <--- ДОБАВЛЕНО: Игнорируем сгенерированную JSDoc документацию
      'playwright-report/',
      'test-results/',
      'node_modules/',
      '.gigacode_vsc/',
      '.vscode/'
    ],
  }
];
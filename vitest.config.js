import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom', // эмуляция браузера для UI-модулей
    globals: true,        // чтобы использовать describe/it/expect без импортов
    setupFiles: ['./tests/setup.js'], // файл для полифилов (fake-indexeddb)
    
    // Ищем тесты ТОЛЬКО в папке tests и только с суффиксом .test.js
    include: ['tests/**/*.test.js'], 
    
    // Игнорируем E2E-тесты Playwright и служебные папки
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/tests/*.spec.js', 
      '**/.gigacode_vsc/**'
    ],

    coverage: {
      provider: 'v8',     // быстрый нативный сборщик покрытия
      reporter: ['text', 'html', 'lcov'], // text — в консоль, html — красивый отчёт
      reportsDirectory: './coverage',
      include: ['src/**/*.js'], // какие файлы анализировать
      
      // Исключаем сложные для юнитов модули и инфраструктуру
      exclude: [
        'src/features/**', 
        'src/api.js', 
        'src/app.js',
        'src/sw.js',        // Service Worker (инфраструктура)
        'src/assets/**'     // Ассеты (картинки/шрифты)
      ], 
      
      all: true,          // показать даже те файлы, которые не были импортированы
      thresholds: {
        lines: 70,        // минимальный порог, как в JaCoCo
        functions: 70,
        branches: 50,
        statements: 70,
      },
    },
  },
});
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  
  // Ищем ТОЛЬКО файлы .spec.js, чтобы не цеплять юнит-тесты Vitest (.test.js)
  testMatch: '**/*.spec.js',

  fullyParallel: true,
  reporter: 'list',
  use: {
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run build && node server/server.js',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 15 * 1000,
  },
});
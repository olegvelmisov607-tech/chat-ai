import { test, expect } from '@playwright/test';

test.describe('Local AI Chat E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
  });

  test('должен успешно загружать главную страницу и проверять роутинг', async ({ page }) => {
    await expect(page).toHaveTitle(/Local AI Chat/);
    const chatScreen = page.locator('#screen-chat');
    await expect(chatScreen).toHaveClass(/active/);

    await page.click('text=Настройки');
    await expect(page).toHaveURL(/#settings/);
    const settingsScreen = page.locator('#screen-settings');
    await expect(settingsScreen).toHaveClass(/active/);
  });

  test('должен отправлять сообщение пользователя и отображать его в контейнере', async ({ page }) => {
    const inputSelector = '#user-input';
    const testMessage = 'Привет, модель! Это автоматический тест.';

    await page.waitForSelector(inputSelector);
    await page.fill(inputSelector, testMessage);
    await page.press(inputSelector, 'Enter');

    await expect(page.locator(inputSelector)).toHaveValue('');
    const userMessage = page.locator('.message.user');
    await expect(userMessage).toContainText(testMessage);
  });
});
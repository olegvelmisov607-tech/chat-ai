import { test, expect } from '@playwright/test';

test.describe('Local AI Chat E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Переходим на локальный сервер (порт 3000)
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

    // Возвращаемся обратно
    await page.click('text=Чат');
    await expect(page).toHaveURL(/#chat/);
    await expect(chatScreen).toHaveClass(/active/);
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

  test('кнопка Отправить заблокирована, если нет текста и картинки', async ({ page }) => {
    const sendBtn = page.locator('#send-btn');
    const inputSelector = '#user-input';

    await expect(sendBtn).toBeDisabled();

    await page.fill(inputSelector, 'Тест');
    await expect(sendBtn).toBeEnabled();

    await page.fill(inputSelector, '');
    await expect(sendBtn).toBeDisabled();
  });

  test('кнопка Отправить активируется при прикреплении картинки', async ({ page }) => {
    const sendBtn = page.locator('#send-btn');
    const fileInput = page.locator('#file-input');
    const previewContainer = page.locator('#image-preview-container');

    await expect(sendBtn).toBeDisabled();

    await fileInput.setInputFiles({
      name: 'test-image.png',
      mimeType: 'image/png',
      buffer: Buffer.from('fake-image-content')
    });

    await expect(previewContainer).not.toHaveClass(/hidden/);
    await expect(sendBtn).toBeEnabled();

    await page.click('#remove-image-btn');
    await expect(previewContainer).toHaveClass(/hidden/);
    await expect(sendBtn).toBeDisabled();
  });

  test('полный цикл отправки картинки с моком API (Vision)', async ({ page }) => {
    await page.route('**/api/chat', async route => {
      const body = 'data: {"type":"model_info","modelName":"gemma3:12b"}\n\n' +
                   'data: {"type":"content","text":"Я вижу"}\n\n' +
                   'data: {"type":"content","text":" тестовую картинку."}\n\n' +
                   'data: [DONE]\n\n';
      
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: body
      });
    });

    const fileInput = page.locator('#file-input');
    await fileInput.setInputFiles({
      name: 'test-image.png',
      mimeType: 'image/png',
      buffer: Buffer.from('fake-image-content')
    });

    await page.click('#send-btn');

    const aiMessage = page.locator('.message.ai');
    await expect(aiMessage).toContainText('Я вижу тестовую картинку.');
    await expect(aiMessage.locator('strong')).toHaveText('gemma3:12b: ');
  });

  test('переключение температуры обновляет значение', async ({ page }) => {
    const slider = page.locator('#temperature-slider');
    const valueDisplay = page.locator('#temp-value');

    await expect(valueDisplay).toHaveText('0.7');
    await slider.fill('0.2'); 
    await expect(valueDisplay).toHaveText('0.2');
  });

  // --- НОВЫЕ ТЕСТЫ ДЛЯ PiP И УВЕДОМЛЕНИЙ ---

  test('элементы PiP и уведомлений присутствуют в интерфейсе', async ({ page }) => {
    // Проверяем наличие кнопки PiP
    await expect(page.locator('#pip-btn')).toBeVisible();
    // Проверяем наличие чекбокса Авто-PiP
    await expect(page.locator('#auto-pip-toggle')).toBeVisible();
    // Проверяем наличие кнопки уведомлений
    await expect(page.locator('#notify-btn')).toBeVisible();
  });

  test('авто-PiP переключается по клику', async ({ page }) => {
    const toggle = page.locator('#auto-pip-toggle');
    // Изначально выключен
    await expect(toggle).not.toBeChecked();
    // Кликаем и проверяем, что включился
    await toggle.click();
    await expect(toggle).toBeChecked();
    // Кликаем еще раз и проверяем, что выключился
    await toggle.click();
    await expect(toggle).not.toBeChecked();
  });

  test('запрос разрешения на уведомления при клике на колокольчик', async ({ page }) => {
    // Мокаем запрос разрешения
    await page.addInitScript(() => {
      window.Notification = class {
        static permission = 'default';
        static requestPermission = async () => {
          window.Notification.permission = 'granted';
          return 'granted';
        };
        constructor(title, options) {
          // Для теста можно сохранить последнее уведомление
          window.lastNotification = { title, options };
        }
      };
    });

    await page.goto('http://localhost:3000'); // Перезагружаем с моком
    
    const notifyBtn = page.locator('#notify-btn');
    await notifyBtn.click();
    
    // Проверяем, что колокольчик стал активным (зеленым)
    await expect(notifyBtn).toHaveClass(/active/);
  });
});
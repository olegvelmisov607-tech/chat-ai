import { test, expect } from '@playwright/test';

test.describe('Local AI Chat E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Переходим на локальный сервер (порт 3000, как в твоем npm start)
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

    // По умолчанию кнопка должна быть неактивна (disabled)
    await expect(sendBtn).toBeDisabled();

    // Вводим текст — кнопка активируется
    await page.fill(inputSelector, 'Тест');
    await expect(sendBtn).toBeEnabled();

    // Удаляем текст — кнопка снова блокируется
    await page.fill(inputSelector, '');
    await expect(sendBtn).toBeDisabled();
  });

  test('кнопка Отправить активируется при прикреплении картинки', async ({ page }) => {
    const sendBtn = page.locator('#send-btn');
    const fileInput = page.locator('#file-input');
    const previewContainer = page.locator('#image-preview-container');

    await expect(sendBtn).toBeDisabled();

    // Симулируем загрузку файла через скрытый инпут
    await fileInput.setInputFiles({
      name: 'test-image.png',
      mimeType: 'image/png',
      buffer: Buffer.from('fake-image-content') // Мок-картинка
    });

    // Проверяем, что превью появилось
    await expect(previewContainer).not.toHaveClass(/hidden/);
    // И кнопка разблокировалась
    await expect(sendBtn).toBeEnabled();

    // Удаляем картинку
    await page.click('#remove-image-btn');
    await expect(previewContainer).toHaveClass(/hidden/);
    await expect(sendBtn).toBeDisabled();
  });

  test('полный цикл отправки картинки с моком API (Vision)', async ({ page }) => {
    // Перехватываем запрос к API, чтобы не напрягать Ollama
    await page.route('**/api/chat', async route => {
      // Имитируем SSE-ответ от сервера
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

    // Отправляем без текста (только картинку)
    await page.click('#send-btn');

    // Ждем, пока появится ответ ИИ в чате
    const aiMessage = page.locator('.message.ai');
    await expect(aiMessage).toContainText('Я вижу тестовую картинку.');
    
    // Проверяем, что имя модели обновилось на gemma3:12b (из мока)
    await expect(aiMessage.locator('strong')).toHaveText('gemma3:12b: ');
  });

  test('переключение температуры обновляет значение', async ({ page }) => {
    const slider = page.locator('#temperature-slider');
    const valueDisplay = page.locator('#temp-value');

    // Стартовое значение 0.7
    await expect(valueDisplay).toHaveText('0.7');

    // Двигаем ползунок на 0.2
    await slider.fill('0.2'); 
    await expect(valueDisplay).toHaveText('0.2');
  });
});
// tests/ui.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { 
  renderTextSafely, 
  updateSendButtonState, 
  showToast, 
  createMessageElement 
} from '../src/ui.js';

describe('ui.js', () => {
  // Очищаем body перед каждым тестом, чтобы тосты не мешали друг другу
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('updateSendButtonState', () => {
    it('блокирует кнопку, если нет ни текста, ни картинки', () => {
      const input = { value: '' };
      const btn = { disabled: false };
      updateSendButtonState(input, btn, false);
      expect(btn.disabled).toBe(true);
    });

    it('разблокирует кнопку, если есть текст', () => {
      const input = { value: 'Привет' };
      const btn = { disabled: true };
      updateSendButtonState(input, btn, false);
      expect(btn.disabled).toBe(false);
    });

    it('разблокирует кнопку, если есть картинка (даже без текста)', () => {
      const input = { value: '' };
      const btn = { disabled: true };
      updateSendButtonState(input, btn, true);
      expect(btn.disabled).toBe(false);
    });
  });

  describe('renderTextSafely', () => {
    it('безопасно рендерит reasoning-теги в блок .thought', () => {
      const container = document.createElement('div');
      const text = 'Привет! <think>Я думаю...</think> Ответ.';
      
      renderTextSafely(container, text);
      
      const thoughtDiv = container.querySelector('.thought');
      expect(thoughtDiv).toBeTruthy();
      expect(thoughtDiv.textContent).toContain('Я думаю...');
      
      // Проверяем, что обычный текст тоже на месте
      expect(container.textContent).toContain('Привет!');
      expect(container.textContent).toContain('Ответ.');
    });

    it('защищает от XSS (рендерит текст как TextNode, а не HTML)', () => {
      const container = document.createElement('div');
      const maliciousText = '<script>alert("hack")</script>';
      
      renderTextSafely(container, maliciousText);
      
      // Внутри должен быть экранированный текст, а не реальный тег script
      expect(container.innerHTML).toContain('&lt;script&gt;');
      expect(container.querySelector('script')).toBeNull();
    });
  });

  describe('showToast', () => {
    it('добавляет элемент в DOM с правильным текстом', () => {
      showToast('Тестовое сообщение');
      
      const toast = document.body.querySelector('.toast');
      expect(toast).toBeTruthy();
      expect(toast.textContent).toBe('Тестовое сообщение');
    });
  });

  describe('createMessageElement', () => {
    it('создает контейнер с именем отправителя и возвращает контейнер для текста', () => {
      const chatContainer = document.createElement('div');
      const resultContainer = createMessageElement('ИИ', 'ai', chatContainer);

      // Проверяем, что сообщение добавилось в чат
      const messageElement = chatContainer.querySelector('.message.ai');
      expect(messageElement).toBeTruthy();
      
      // Проверяем, что имя отправителя есть в strong
      const strong = messageElement.querySelector('strong');
      expect(strong.textContent).toBe('ИИ: ');
      
      // Проверяем, что вернулся контейнер для текста
      expect(resultContainer).toBeInstanceOf(HTMLDivElement);
      expect(resultContainer.className).toBe('');
    });
  });
});
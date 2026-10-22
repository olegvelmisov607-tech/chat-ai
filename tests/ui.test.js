// tests/ui.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { 
  renderTextSafely, 
  updateSendButtonState, 
  showToast, 
  createMessageElement,
  appendStaticMessage // <--- Добавлен импорт
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

    it('защищает от XSS (вырезает script-теги)', () => {
      const container = document.createElement('div');
      const maliciousText = '<script>alert("hack")</script>';
      
      renderTextSafely(container, maliciousText);
      
      // Проверяем, что тега script нет в DOM
      expect(container.querySelector('script')).toBeNull();
      
      // Проверяем, что текст "alert("hack")" остался, но как обычный текст
      // (или удалился вместе с тегом, в зависимости от реализации DOMPurify)
      expect(container.textContent).not.toContain('<script>');
    });

    // --- ТЕСТЫ ДЛЯ БЛОКОВ КОДА И MARKDOWN ---

    it('должен создавать блок кода с кнопкой копирования при наличии ```', () => {
      const container = document.createElement('div');
      const text = 'Вот код:\n```javascript\nconsole.log("hello");\n```';
      
      renderTextSafely(container, text);
      
      // Проверяем, что создался блок кода
      const codeWrapper = container.querySelector('.code-wrapper');
      expect(codeWrapper).toBeTruthy();
      
      // Проверяем, что внутри есть тег pre и code
      const pre = codeWrapper.querySelector('pre');
      expect(pre).toBeTruthy();
      
      // Проверяем кнопку копирования
      const copyBtn = codeWrapper.querySelector('.copy-code-btn');
      expect(copyBtn).toBeTruthy();
      expect(copyBtn.textContent).toBe('Копировать');
    });

    it('должен корректно обрабатывать незакрытый блок кода (стриминг)', () => {
      const container = document.createElement('div');
      // Блок кода открыт, но не закрыт (эмуляция стриминга)
      const text = 'Вот код:\n```javascript\nconsole.log("hell';
      
      renderTextSafely(container, text);
      
      // Обертка с кнопкой не должна создаваться, пока блок не закрыт
      expect(container.querySelector('.code-wrapper')).toBeNull();
      
      // Но тег pre и code должны быть
      const pre = container.querySelector('pre');
      expect(pre).toBeTruthy();
      expect(pre.textContent).toContain('console.log');
    });

    it('должен обрабатывать Markdown (жирный текст)', () => {
      const container = document.createElement('div');
      const text = 'Это **важный** текст.';
      
      renderTextSafely(container, text);
      
      // Проверяем, что текст отрендерился (в тестах marked просто возвращает текст, 
      // но мы проверяем, что он прошел через наш контейнер)
      expect(container.textContent).toContain('Это важный текст.');
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

  // --- НОВЫЙ ТЕСТ ДЛЯ ДОБИВАНИЯ ПОКРЫТИЯ ---
  describe('appendStaticMessage', () => {
    it('должен добавлять сообщение в контейнер чата', () => {
      const chatContainer = document.createElement('div');
      
      appendStaticMessage('Вы', 'Тестовое сообщение', 'user', null, chatContainer);
      
      const message = chatContainer.querySelector('.message.user');
      expect(message).toBeTruthy();
      expect(message.textContent).toContain('Вы: ');
      expect(message.textContent).toContain('Тестовое сообщение');
    });
  });
});
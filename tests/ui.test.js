// tests/ui.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  renderTextSafely, 
  updateSendButtonState, 
  showToast, 
  createMessageElement,
  appendStaticMessage,
  renderSources // <--- ДОБАВЛЕН ИМПОРТ
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
      
      expect(container.textContent).toContain('Привет!');
      expect(container.textContent).toContain('Ответ.');
    });

    it('защищает от XSS (вырезает script-теги)', () => {
      const container = document.createElement('div');
      const maliciousText = '<script>alert("hack")</script>';
      
      renderTextSafely(container, maliciousText);
      
      expect(container.querySelector('script')).toBeNull();
      expect(container.textContent).not.toContain('<script>');
    });

    it('должен создавать блок кода с кнопкой копирования при наличии ```', () => {
      const container = document.createElement('div');
      const text = 'Вот код:\n```javascript\nconsole.log("hello");\n```';
      
      renderTextSafely(container, text);
      
      const codeWrapper = container.querySelector('.code-wrapper');
      expect(codeWrapper).toBeTruthy();
      
      const pre = codeWrapper.querySelector('pre');
      expect(pre).toBeTruthy();
      
      const copyBtn = codeWrapper.querySelector('.copy-code-btn');
      expect(copyBtn).toBeTruthy();
      expect(copyBtn.textContent).toBe('Копировать');

      // --- ИСПРАВЛЕННЫЙ БЛОК С МОКОМ КЛИПБОРДА ---
      const writeTextMock = vi.fn();
      
      // Используем Object.defineProperty, чтобы обойти ограничение "только для чтения"
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        configurable: true,
        writable: true
      });
      
      copyBtn.click(); // Имитируем клик
      expect(writeTextMock).toHaveBeenCalledWith('console.log("hello");\n');
      expect(copyBtn.textContent).toBe('Скопировано!');
    });

    it('должен корректно обрабатывать незакрытый блок кода (стриминг)', () => {
      const container = document.createElement('div');
      const text = 'Вот код:\n```javascript\nconsole.log("hell';
      
      renderTextSafely(container, text);
      
      expect(container.querySelector('.code-wrapper')).toBeNull();
      const pre = container.querySelector('pre');
      expect(pre).toBeTruthy();
      expect(pre.textContent).toContain('console.log');
    });

    it('должен обрабатывать Markdown (жирный текст)', () => {
      const container = document.createElement('div');
      const text = 'Это **важный** текст.';
      
      renderTextSafely(container, text);
      
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

      const messageElement = chatContainer.querySelector('.message.ai');
      expect(messageElement).toBeTruthy();
      
      const strong = messageElement.querySelector('strong');
      expect(strong.textContent).toBe('ИИ: ');
      
      expect(resultContainer).toBeInstanceOf(HTMLDivElement);
      expect(resultContainer.className).toBe('');
    });
  });

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

  // --- НОВЫЕ ТЕСТЫ ДЛЯ ИСТОЧНИКОВ (RENDER SOURCES) ---
  describe('renderSources', () => {
    it('не должен рендерить ничего при пустом массиве или null', () => {
      const container = document.createElement('div');
      
      renderSources(container, []);
      renderSources(container, null);
      
      expect(container.innerHTML).toBe('');
      expect(container.querySelector('.sources-container')).toBeNull();
    });

    it('должен корректно рендерить карточки источников с фавиконками', () => {
      const container = document.createElement('div');
      const mockSources = [
        { url: 'https://www.gismeteo.ru/weather', title: 'Gismeteo: Погода' },
        { url: 'https://yandex.ru/pogoda', title: null } // Без title, чтобы покрыть fallback
      ];

      renderSources(container, mockSources);

      const wrapper = container.querySelector('.sources-container');
      expect(wrapper).toBeTruthy();
      expect(wrapper.querySelector('.sources-title').textContent).toBe('Источники');

      const cards = container.querySelectorAll('.source-card');
      expect(cards.length).toBe(2);

      // Проверка первой карточки
      const firstCard = cards[0];
      expect(firstCard.href).toBe('https://www.gismeteo.ru/weather');
      expect(firstCard.querySelector('.source-domain').textContent).toBe('gismeteo.ru');
      expect(firstCard.querySelector('.source-title').textContent).toBe('Gismeteo: Погода');
      expect(firstCard.querySelector('.source-favicon').src).toContain('domain=gismeteo.ru');

      // Проверка второй карточки (fallback на URL вместо title)
      const secondCard = cards[1];
      expect(secondCard.querySelector('.source-domain').textContent).toBe('yandex.ru');
      expect(secondCard.querySelector('.source-title').textContent).toBe('https://yandex.ru/pogoda');
    });

    it('должен удалять старый блок источников при повторном рендере', () => {
      const container = document.createElement('div');
      const mockSources = [{ url: 'https://test.com', title: 'Test' }];
      
      renderSources(container, mockSources);
      expect(container.querySelectorAll('.sources-container').length).toBe(1);

      renderSources(container, mockSources);
      // Старый блок должен быть удален, остаться только один
      expect(container.querySelectorAll('.sources-container').length).toBe(1);
    });

    it('должен безопасно обрабатывать кривые URL (catch block)', () => {
      const container = document.createElement('div');
      const badSources = [
        { url: 'not-a-valid-url', title: 'Битая ссылка' }
      ];

      // Не должно выбросить исключение
      expect(() => renderSources(container, badSources)).not.toThrow();
      
      const card = container.querySelector('.source-card');
      // Fallback из catch-блока должен установить домен как 'Сайт'
      expect(card.querySelector('.source-domain').textContent).toBe('Сайт');
    });
  });
});
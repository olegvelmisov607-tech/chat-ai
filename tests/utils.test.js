import { describe, it, expect } from 'vitest';
import { getFriendlyErrorMessage, formatTime } from '../src/utils.js';

describe('utils.js', () => {
  describe('getFriendlyErrorMessage', () => {
    it('возвращает правильное сообщение для известных кодов', () => {
      expect(getFriendlyErrorMessage('HTTP_401', 'raw')).toBe('Неверный API-ключ DeepSeek. Проверьте настройки.');
      expect(getFriendlyErrorMessage('HTTP_429', 'raw')).toBe('Слишком много запросов. Подождите немного.');
    });

    it('возвращает общее сообщение для неизвестных ошибок 5xx', () => {
      expect(getFriendlyErrorMessage('HTTP_502', 'raw')).toBe('Ошибка на стороне облачного сервиса.');
    });

    it('возвращает rawMessage, если код неизвестен', () => {
      expect(getFriendlyErrorMessage('UNKNOWN_CODE', 'Что-то пошло не так')).toBe('Что-то пошло не так');
    });

    it('возвращает сообщение по умолчанию, если нет ни кода, ни rawMessage', () => {
      expect(getFriendlyErrorMessage('UNKNOWN', '')).toBe('Неизвестная ошибка. Переключено на локальную модель.');
    });
  });

  describe('formatTime', () => {
    it('форматирует время в формате ЧЧ:ММ', () => {
      // Создаем фиксированную дату: 15 мая 2024, 14:05
      const mockDate = new Date(2024, 4, 15, 14, 5);
      
      // В русской локали это должно быть "14:05"
      const result = formatTime(mockDate);
      
      expect(result).toBe('14:05');
    });
  });
});
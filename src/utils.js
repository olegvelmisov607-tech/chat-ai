
/**
 * Переводит коды ошибок и технические сообщения в понятный для пользователя текст.
 * @param {string} code - Код ошибки (например, HTTP_401 или fetch failed)
 * @param {string} rawMessage - Исходное сообщение об ошибке
 * @returns {string} Понятный текст ошибки
 */
export function getFriendlyErrorMessage(code, rawMessage) {
  const errorMap = {
    'fetch failed': 'Нет соединения с сервером. Проверьте интернет.',
    'HTTP_401': 'Неверный API-ключ DeepSeek. Проверьте настройки.',
    'HTTP_402': 'Закончились средства на балансе DeepSeek. Переключаюсь на локальную модель.',
    'HTTP_429': 'Слишком много запросов. Подождите немного.',
    'HTTP_500': 'Ошибка на сервере DeepSeek. Попробуйте позже.',
    'HTTP_503': 'Сервис DeepSeek временно недоступен.',
  };
  
  if (errorMap[code]) return errorMap[code];
  if (code.startsWith('HTTP_5')) return 'Ошибка на стороне облачного сервиса.';
  
  return rawMessage || 'Неизвестная ошибка. Переключено на локальную модель.';
}

/**
 * Форматирует текущее время (можно использовать для логов или UI)
 */
export function formatTime(date = new Date()) {
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
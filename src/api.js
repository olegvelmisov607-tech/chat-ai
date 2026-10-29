/**
 * SSE-транспорт чата (fallback, когда WebSocket недоступен).
 * Возвращает асинхронный генератор распарсенных JSON-чанков.
 *
 * @param {Object} params
 * @param {Array<Object>} params.messagesContext - История сообщений (OpenAI-формат).
 * @param {string} params.model - Идентификатор модели ('qwen', 'vision', ...).
 * @param {number} params.temperature - Температура генерации 0..1.
 * @param {AbortSignal} [params.signal] - Сигнал отмены fetch.
 * @param {string} params.generationId - UUID генерации (нужен бэкенду для синхронизации).
 * @returns {AsyncGenerator<Object, void, unknown>}
 */
export async function* streamChatAPI({ messagesContext, model, temperature, signal, generationId }) {
  const authToken = localStorage.getItem('chat_auth_token') || 'dev-secret-token';

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}` 
    },
    body: JSON.stringify({ 
      messages: messagesContext, 
      model: model,
      temperature: temperature,
      generationId
    }),
    signal // fetch сам прервёт запрос при abort
  });

  if (response.status === 401) {
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    throw new Error(`Network response was not ok: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Парсим SSE-поток: события разделены \n\n, полезная нагрузка — после "data: ".
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop(); // последний элемент может быть неполным — оставляем на следующий цикл

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.replace('data: ', '').trim();
      if (jsonStr === '[DONE]') return;
      
      try {
        const parsed = JSON.parse(jsonStr);
        yield parsed; 
      } catch (err) {
        // Невалидный чанк (например, разрезанный между пакетами) — пропускаем.
        console.warn('[AI Chat] Ошибка парсинга чанка:', err);
      }
    }
  }
}

/**
 * Стриминг «умного поиска» (генеративный поиск Yandex Search API).
 * @param {Object} params
 * @param {string} params.query - Поисковый запрос.
 * @returns {AsyncGenerator<Object, void, unknown>}
 */
export async function* streamSearchAPI({ query }) {
  const authToken = localStorage.getItem('chat_auth_token') || 'dev-secret-token';

  const response = await fetch('/api/search', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}` 
    },
    body: JSON.stringify({ query })
  });

  if (!response.ok) throw new Error(`Network response was not ok: ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.replace('data: ', '').trim();
      if (jsonStr === '[DONE]') return;
      
      try {
        yield JSON.parse(jsonStr);
      } catch (err) {
        console.warn('[Search API] Ошибка парсинга:', err);
      }
    }
  }
}

/**
 * Получает статус бюджета облачных запросов.
 * Возвращает безопасный дефолт при сетевой ошибке, чтобы UI не падал.
 * @returns {Promise<{used:number, limit:number, remaining:number, allowed:boolean}>}
 */
export async function fetchBudgetStatus() {
  try {
    const res = await fetch('/api/budget');
    return await res.json();
  } catch {
    return { used: 0, limit: 0, allowed: true };
  }
}
/**
 * Отправляет запрос к бэкенду и возвращает асинхронный генератор чанков (SSE).
 * 
 * @param {Object} params - Параметры запроса.
 * @param {Array<Object>} params.messagesContext - История сообщений в формате OpenAI.
 * @param {string} params.model - Идентификатор выбранной модели (например, 'qwen', 'vision').
 * @param {number} params.temperature - Температура генерации (креативность) от 0 до 1.
 * @returns {AsyncGenerator<Object, void, unknown>} Асинхронный генератор, возвращающий распарсенные JSON-чанки.
 */
export async function* streamChatAPI({ messagesContext, model, temperature }) {
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
      temperature: temperature // <-- ДОБАВЛЕНО
    })
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
        const parsed = JSON.parse(jsonStr);
        yield parsed; 
      } catch (err) {
        console.warn('[AI Chat] Ошибка парсинга чанка:', err);
      }
    }
  }
}
//умный поиск (генеративный поиск от Yanddex search API)
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

//Бюджет
export async function fetchBudgetStatus() {
  try {
    const res = await fetch('/api/budget');
    return await res.json();
  } catch {
    return { used: 0, limit: 0, allowed: true };
  }
}
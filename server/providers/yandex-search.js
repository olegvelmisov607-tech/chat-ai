// server/providers/yandex-search.js

/**
 * Yandex Search API отвечает единым JSON — эмулируем SSE для единообразия с LLM-провайдерами.
 * @param {string} text
 */
async function* emulateStream(text) {
  if (!text) return;
  const chunks = text.match(/\S+\s*/g) || [text];
  for (const chunk of chunks) {
    yield { type: 'content', text: chunk };
    await new Promise(r => setTimeout(r, 15)); // скорость печати
  }
}

/**
 * Генеративный поиск Yandex Search API.
 * Возвращает чанки: {type:'sources',data} (один раз) и {type:'content',text}.
 *
 * @param {Object} params
 * @param {string} params.query
 * @param {string} params.folderId - Yandex Cloud folder ID
 * @param {string} params.apiKey   - Api-Key сервисного аккаунта
 * @param {AbortSignal} [params.signal]
 */
export async function* streamYandexSearch({ query, folderId, apiKey, signal }) {
  const response = await fetch('https://searchapi.api.cloud.yandex.net/v2/gen/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Api-Key ${apiKey}`
    },
    body: JSON.stringify({
      messages: [{ content: query, role: 'ROLE_USER' }],
      folderId: folderId,
      fixMisspell: true,
      enableRichStructuredAnswer: true // более читаемый ответ
    }),
    signal
  });

  if (!response.ok) {
    const err = new Error(`Yandex Search HTTP_${response.status}`);
    err.status = response.status;
    throw err;
  }

  // Yandex возвращает массив результатов, нам нужен первый.
  const data = await response.json();
  const result = data[0]; 
  
  if (!result || !result.message || !result.message.content) {
    yield { type: 'error', message: 'Пустой ответ от поиска' };
    return;
  }

  // Источники отдаём ПЕРЕД текстом — UI сохранит их и отрисует после стрима.
  // Берём только те, что модель реально использовала (used: true).
  const usedSources = result.sources?.filter(s => s.used) || [];
  if (usedSources.length > 0) {
    yield { type: 'sources', data: usedSources }; 
  }

  yield* emulateStream(result.message.content);
}
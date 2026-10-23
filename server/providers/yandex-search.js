// server/providers/yandex-search.js

//'эмулирования SSE (что бы отдать синхронный JSON полученный от Yandex )
async function* emulateStream(text) {
  if (!text) return;
  // Разбиваем на слова для эффекта печати
  const chunks = text.match(/\S+\s*/g) || [text];
  for (const chunk of chunks) {
    yield { type: 'content', text: chunk };
    await new Promise(r => setTimeout(r, 15)); // Скорость печати
  }
}

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
      enableRichStructuredAnswer: true // Дает более красивый ответ
    }),
    signal
  });

  if (!response.ok) {
    const err = new Error(`Yandex Search HTTP_${response.status}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  
  // data — это массив, берем первый элемент
  const result = data[0]; 
  
  if (!result || !result.message || !result.message.content) {
    yield { type: 'error', message: 'Пустой ответ от поиска' };
    return;
  }

  // 1. Отправляем источники ПЕРЕД текстом (или после, как захотите в UI)
  // В нашем UI пока нет блока для источников, поэтому можно просто отправить их как спец-событие.
  const usedSources = result.sources?.filter(s => s.used) || [];
  if (usedSources.length > 0) {
    yield { type: 'sources', data: usedSources }; 
  }

  // 2. Эмулируем стрим текста
  yield* emulateStream(result.message.content);
}
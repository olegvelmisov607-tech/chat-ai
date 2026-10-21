// server/providers/openai-compat.js

// Вспомогательная функция для эмуляции стриминга (когда stream: false)
async function* emulateStream(text) {
  if (!text) return;
  const chunks = text.match(/\S+\s*/g) || [text];
  for (const chunk of chunks) {
    yield { type: 'content', text: chunk };
    await new Promise(r => setTimeout(r, 20)); 
  }
}

export async function* streamOpenAICompat({ baseUrl, apiKey, model, messages, temperature, signal }) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  // Проверяем, есть ли изображения в сообщениях (OpenAI-формат)
  const hasImages = messages.some(m => 
    Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')
  );

  // Для Vision-моделей принудительно отключаем нативный стриминг
  const useStream = !hasImages;

  const requestBody = {
    model,
    messages,
    stream: useStream
  };

  // ВАЖНО: Если это Ollama (порт 11434), не передаем temperature, 
  // чтобы избежать ошибок 400/500 на локальных моделях.
  const isOllama = baseUrl.includes('11434');
  
  if (!isOllama) {
    requestBody.temperature = temperature !== undefined ? temperature : 0.7;
  }

  const bodyString = JSON.stringify(requestBody);

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: bodyString,
    signal
  });

  if (!res.ok) {
    // Читаем ответ от Ollama, чтобы понять причину
    let errDetails = '';
    try {
      const errJson = await res.json();
      errDetails = JSON.stringify(errJson);
    } catch (e) {
      // ignore
    }
    const err = new Error(`HTTP_${res.status} ${errDetails}`);
    err.status = res.status;
    throw err;
  }

  // ВЕТКА 1: Эмуляция стриминга (Vision)
  if (!useStream) {
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const reasoning = data.choices?.[0]?.message?.reasoning_content || '';
    
    if (reasoning) yield { type: 'reasoning', text: reasoning };
    yield* emulateStream(content);
    return;
  }

  // ВЕТКА 2: Нативный стриминг (Текст)
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const dataStr = trimmed.slice(6);
      if (dataStr === '[DONE]') return;

      try {
        const data = JSON.parse(dataStr);
        const delta = data.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.reasoning_content) {
          yield { type: 'reasoning', text: delta.reasoning_content };
        }
        if (delta.content) {
          yield { type: 'content', text: delta.content };
        }
      } catch {
        // Игнорируем неполные чанки
      }
    }
  }
}
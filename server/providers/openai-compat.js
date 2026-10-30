// server/providers/openai-compat.js
import { emulateStream } from './utils.js';

/**
 * Универсальный клиент OpenAI-совместимого API (Ollama, DeepSeek и т.п.).
 * Возвращает асинхронный генератор чанков:
 *   {type:'content',text} | {type:'reasoning',text} | {type:'tool_call',toolCall}
 *
 * @param {Object} params
 * @param {string} params.baseUrl - Например, http://localhost:11434/v1
 * @param {string|null} params.apiKey
 * @param {string} params.model
 * @param {Array<Object>} params.messages
 * @param {number} params.temperature
 * @param {AbortSignal} [params.signal]
 * @param {Array<Object>} [params.tools] - OpenAI-формат инструментов.
 */
export async function* streamOpenAICompat({ 
  baseUrl, apiKey, model, messages, temperature, signal, tools 
}) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  // Vision-модели (Ollama) не поддерживают нативный стриминг с изображениями — эмулируем.
  const hasImages = messages.some(m => 
    Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')
  );

  const useStream = !hasImages;

  const requestBody = {
    model,
    messages,
    stream: useStream
  };

  if (tools && tools.length > 0) {
    requestBody.tools = tools;
  }

  // Ollama не принимает temperature — иначе 400/500. ⚠️ Хак, но работает.
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
    let errDetails = '';
    try {
      const errJson = await res.json();
      errDetails = JSON.stringify(errJson);
    } catch { /* ignore */ }
    const err = new Error(`HTTP_${res.status} ${errDetails}`);
    err.status = res.status;
    throw err;
  }

  // --- ВЕТКА 1: не-стриминговый ответ (Vision) ---
  if (!useStream) {
    const data = await res.json();
    const message = data.choices?.[0]?.message || {};
    
    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const tc of message.tool_calls) {
        yield { type: 'tool_call', toolCall: tc };
      }
      return;
    }

    if (message.reasoning_content) yield { type: 'reasoning', text: message.reasoning_content };
    // ✅ Используем общую утилиту с задержкой 20мс
    yield* emulateStream(message.content || '', 20);
    return;
  }

  // --- ВЕТКА 2: нативный SSE-стриминг ---
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  // OpenAI шлёт tool_calls фрагментами: сначала id+name, потом arguments по кусочкам.
  // Поэтому собираем один текущий tool_call и отдаём его целиком в конце.
  let currentToolCall = null;

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
      
      if (dataStr === '[DONE]') {
        if (currentToolCall) yield { type: 'tool_call', toolCall: currentToolCall };
        return;
      }

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
        
        if (delta.tool_calls && delta.tool_calls.length > 0) {
          const tc = delta.tool_calls[0]; // обычно одна функция за вызов
          
          if (tc.id) {
            // Начало нового tool_call
            currentToolCall = {
              id: tc.id,
              type: 'function',
              function: { 
                name: tc.function.name, 
                arguments: tc.function.arguments || '' 
              }
            };
          } else if (currentToolCall && tc.function?.arguments) {
            // Дописываем аргументы фрагментами
            currentToolCall.function.arguments += tc.function.arguments;
          }
        }
      } catch {
        // Неполный/битый чанк — нормально для стриминга, просто ждём следующий.
      }
    }
  }
}
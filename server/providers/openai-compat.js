export async function* streamOpenAICompat({ baseUrl, apiKey, model, messages, signal }) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const bodyString = JSON.stringify({ model, messages, stream: true });

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: bodyString,
    signal
  });

  if (!res.ok) {
    const err = new Error(`HTTP_${res.status}`);
    err.status = res.status;
    throw err;
  }

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
      //console.log(`[RAW CHUNK] ${line}`);
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
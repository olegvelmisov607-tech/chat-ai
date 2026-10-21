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
      temperature: temperature
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
        yield parsed; // Отдаем распарсенный чанк наверх в app.js
      } catch (err) {
        console.warn('[AI Chat] Ошибка парсинга чанка:', err);
      }
    }
  }
}
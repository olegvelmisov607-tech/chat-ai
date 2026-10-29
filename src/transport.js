// src/transport.js
import { streamChatAPI } from './api.js';

export async function* streamChat({ messagesContext, model, temperature, generationId, signal }) {
  const authToken = localStorage.getItem('chat_auth_token') || 'dev-secret-token';
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws?token=${authToken}&clientId=${generationId}`;

  let ws;
  let wsOpened = false;

  try {
    // Пытаемся открыть WS с таймаутом в 2 секунды
    ws = new WebSocket(wsUrl);
    
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('WS timeout'));
      }, 2000);

      ws.onopen = () => {
        clearTimeout(timeout);
        wsOpened = true;
        resolve();
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('WS error'));
      };
    });

    // Если дошли сюда — WS открыт. Отправляем запрос.
    ws.send(JSON.stringify({ 
      type: 'chat_start', 
      generationId, 
      messages: messagesContext, 
      model, 
      temperature 
    }));

    // Очередь сообщений (WS работает на событиях, а нам нужен async iterator)
    const queue = [];
    let done = false;
    let error = null;

    ws.onmessage = (e) => {
      if (e.data === '[DONE]') {
        done = true;
        return;
      }
      try {
        queue.push(JSON.parse(e.data));
      } catch (err) { /* empty */ }
    };

    ws.onclose = () => { done = true; };
    ws.onerror = (e) => { error = e; done = true; };

    // Слушаем сигнал отмены (STOP)
    if (signal) {
      signal.addEventListener('abort', () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'chat_stop', generationId }));
        }
        ws.close();
        done = true;
      });
    }

    // Читаем очередь
    while (!done || queue.length > 0) {
      if (queue.length > 0) {
        yield queue.shift();
      } else {
        await new Promise(r => setTimeout(r, 10));
      }
    }

    if (error) throw error;

  } catch (err) {
    console.warn('[Transport] WS не удался, переход на SSE:', err.message);
    // Если WS упал ДО открытия — идем в SSE
    if (!wsOpened) {
      yield* streamChatAPI({ messagesContext, model, temperature, signal, generationId });
    } else {
      // Если WS уже был открыт, но потом упал — это ошибка, пробрасываем дальше
      throw err;
    }
  }
}
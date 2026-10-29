import { streamChatAPI } from './api.js';

/**
 * Возвращает постоянный ID устройства из localStorage.
 * Если ID ещё нет — генерирует UUID и сохраняет.
 * @returns {string} userId
 */
function getUserId() {
  let userId = localStorage.getItem('chat_user_id');
  if (!userId) {
    userId = crypto.randomUUID();
    localStorage.setItem('chat_user_id', userId);
  }
  return userId;
}

/**
 * Основной транспорт чата: WebSocket с автоматическим fallback на SSE.
 * Возвращает асинхронный генератор чанков в том же формате, что и SSE-ветка.
 *
 * @param {Object} params
 * @param {Array<Object>} params.messagesContext - История сообщений (формат OpenAI).
 * @param {string} params.model - Идентификатор модели.
 * @param {number} params.temperature - Температура генерации.
 * @param {string} params.generationId - UUID текущей генерации (для синхронизации вкладок).
 * @param {AbortSignal} [params.signal] - Сигнал отмены.
 * @returns {AsyncGenerator<Object, void, unknown>}
 */
export async function* streamChat({ messagesContext, model, temperature, generationId, signal }) {
  const authToken = localStorage.getItem('chat_auth_token') || 'dev-secret-token';
  const userId = getUserId();
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws?token=${authToken}&clientId=${userId}`;

  let ws;
  let wsOpened = false;

  try {
    ws = new WebSocket(wsUrl);
    
    // Ждём открытия WS с таймаутом 2с. Если не успели — считаем, что WS недоступен.
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

    ws.send(JSON.stringify({ 
      type: 'chat_start', 
      generationId, 
      messages: messagesContext, 
      model, 
      temperature 
    }));

    // Очередь чанков: WS-события приходят асинхронно, а генератор должен отдавать их по одному.
    const queue = [];
    let done = false;
    let error = null;

    ws.onmessage = (e) => {
      if (e.data === '[DONE]') {
        done = true;
        return;
      }
      try {
        const data = JSON.parse(e.data);
        
        // --- СИНХРОНИЗАЦИЯ МЕЖДУ ВКЛАДКАМИ/УСТРОЙСТВАМИ ---
        // Эти события не являются частью ответа модели — они лишь уведомляют UI.
        if (data.type === 'generation_started') {
          window.dispatchEvent(new CustomEvent('sync_generation_started', { detail: data }));
          return; 
        }
        
        if (data.type === 'generation_stopped') {
          window.dispatchEvent(new CustomEvent('sync_generation_stopped', { detail: data }));
          
          // Если STOP пришёл для НАШЕЙ генерации (нажали на другом устройстве) — обрываем локально.
          if (data.generationId === generationId && signal && !signal.aborted) {
            console.log('[Sync] Получен STOP для нашей генерации из другой вкладки');
            ws.close();
            done = true;
            error = new DOMException('Aborted by sync', 'AbortError');
            return;
          }
          return;
        }

        queue.push(data);
      } catch (err) { /* пустой catch: невалидный JSON в WS — просто игнорируем чанк */ }
    };

    ws.onclose = () => { done = true; };
    ws.onerror = (e) => { error = e; done = true; };

    // Подписка на AbortSignal: при отмене отправляем chat_stop на сервер и закрываем WS.
    if (signal) {
      signal.addEventListener('abort', () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'chat_stop', generationId }));
        }
        ws.close();
        done = true;
      });
    }

    // Цикл «выдачи» чанков: пока WS не закрыт или очередь не пуста.
    // ⚠️ Busy-wait на 10мс — простое решение, но в идеале заменить на Promise-очередь.
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
    // Fallback на SSE имеет смысл ТОЛЬКО если WS вообще не открылся.
    // Если WS открылся, но потом упал — это уже реальная ошибка, пробрасываем.
    if (!wsOpened) {
      yield* streamChatAPI({ messagesContext, model, temperature, signal, generationId });
    } else {
      throw err;
    }
  }
}
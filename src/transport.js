import { streamChatAPI } from './api.js';

// Постоянный ID пользователя (устройства) из localStorage
function getUserId() {
  let userId = localStorage.getItem('chat_user_id');
  if (!userId) {
    userId = crypto.randomUUID();
    localStorage.setItem('chat_user_id', userId);
  }
  return userId;
}

export async function* streamChat({ messagesContext, model, temperature, generationId, signal }) {
  const authToken = localStorage.getItem('chat_auth_token') || 'dev-secret-token';
  const userId = getUserId();
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws?token=${authToken}&clientId=${userId}`;

  let ws;
  let wsOpened = false;

  try {
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

    ws.send(JSON.stringify({ 
      type: 'chat_start', 
      generationId, 
      messages: messagesContext, 
      model, 
      temperature 
    }));

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
        
        // --- СИНХРОНИЗАЦИЯ: Пробрасываем события в UI ---
        if (data.type === 'generation_started') {
          window.dispatchEvent(new CustomEvent('sync_generation_started', { detail: data }));
          return; 
        }
        
        if (data.type === 'generation_stopped') {
          window.dispatchEvent(new CustomEvent('sync_generation_stopped', { detail: data }));
          
          // Если это наша генерация, принудительно обрываем её
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
      } catch (err) { /* empty */ }
    };

    ws.onclose = () => { done = true; };
    ws.onerror = (e) => { error = e; done = true; };

    if (signal) {
      signal.addEventListener('abort', () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'chat_stop', generationId }));
        }
        ws.close();
        done = true;
      });
    }

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
    if (!wsOpened) {
      yield* streamChatAPI({ messagesContext, model, temperature, signal, generationId });
    } else {
      throw err;
    }
  }
}
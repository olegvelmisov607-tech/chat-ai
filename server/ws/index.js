import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'url';
import { config } from '../config.js';
import { streamWithFallback } from '../fallback.js';
import { budget } from '../budget.js';

export function initWebSocketServer(httpServer, { generationBus }) {
  const wss = new WebSocketServer({ server: httpServer, path: config.ws.path });
  const activeGenerations = new Map();

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const clientId = url.searchParams.get('clientId') || 'unknown';

    if (token !== config.authToken) {
      ws.close(4401, 'Unauthorized');
      return;
    }

    console.log(`[WS] Клиент подключен: ${clientId}`);

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());

        // --- ОБРАБОТКА СТАРТА ГЕНЕРАЦИИ ---
        if (message.type === 'chat_start') {
          const { generationId, messages, model, temperature } = message;
          
          const abortController = new AbortController();
          activeGenerations.set(generationId, { abortController, clientId });

          // Проверяем, не нажали ли STOP до того, как мы начали (race condition)
          const alreadyStopped = await generationBus.isAlreadyStopped(generationId);
          if (alreadyStopped) {
            ws.send(JSON.stringify({ type: 'system_alert', message: 'Генерация была отменена.' }));
            activeGenerations.delete(generationId);
            return;
          }

          // --- ПРОВЕРКА БЮДЖЕТА (ТОЛЬКО ЧТЕНИЕ, БЕЗ СПИСАНИЯ) ---
          let forceLocal = false;
          if (!budget.canUseCloud()) {
            forceLocal = true;
            ws.send(JSON.stringify({ 
              type: 'system_alert', 
              message: `⚠️ Дневной лимит поисковых запросов (${config.budget.dailyLimit}) исчерпан. Работаю на основе своих знаний.` 
            }));
          }

          // Регистрируем в шине, чтобы прилетевший STOP из Redis сработал
          generationBus.register(generationId, () => {
            abortController.abort();
          });

          try {
            // Запускаем стриминг
            for await (const chunk of streamWithFallback({
              messages,
              model,
              temperature,
              signal: abortController.signal,
              forceLocal
            })) {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(chunk));
              }
            }
            if (ws.readyState === WebSocket.OPEN) ws.send('[DONE]');
          } catch (err) {
            if (err.name === 'AbortError') {
               console.log(`[WS] Генерация ${generationId} остановлена.`);
               if (ws.readyState === WebSocket.OPEN) {
                 ws.send(JSON.stringify({ type: 'system_alert', message: '⏹️ Генерация остановлена.' }));
                 ws.send('[DONE]');
               }
            } else {
               console.error('[WS] Ошибка генерации:', err);
               if (ws.readyState === WebSocket.OPEN) {
                 ws.send(JSON.stringify({ type: 'error', message: err.message }));
                 ws.send('[DONE]');
               }
            }
          } finally {
            activeGenerations.delete(generationId);
            generationBus.unregister(generationId);
          }
        }

        // Обработка команды STOP
        if (message.type === 'chat_stop') {
          const { generationId } = message;
          await generationBus.publishStop(generationId);
          
          if (activeGenerations.has(generationId)) {
            const { abortController } = activeGenerations.get(generationId);
            abortController.abort();
            activeGenerations.delete(generationId);
          }
        }

      } catch (e) {
        console.error('[WS] Ошибка парсинга:', e);
      }
    });

    ws.on('close', () => {
      console.log(`[WS] Клиент отключен: ${clientId}`);
      for (const [genId, gen] of activeGenerations.entries()) {
        if (gen.clientId === clientId) {
          gen.abortController.abort();
          activeGenerations.delete(genId);
        }
      }
    });
  });

  console.log(`[WS] WebSocket сервер запущен на ${config.ws.path}`);
  return wss;
}
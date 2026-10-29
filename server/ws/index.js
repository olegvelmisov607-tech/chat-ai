// server/ws/index.js
import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'url';
import { config } from '../config.js';
import { streamWithFallback } from '../fallback.js';
import { budget } from '../budget.js';

/**
 * Поднимает WebSocket-сервер поверх существующего HTTP-сервера.
 * Отвечает за:
 *  - аутентификацию по token из query-строки;
 *  - регистрацию сокетов по clientId (для синхронизации вкладок/устройств);
 *  - приём chat_start / chat_stop;
 *  - стриминг чанков модели обратно в сокет.
 *
 *  @param {Object} httpServer - HTTP-сервер Node.js
 *  @param {Object} deps - Зависимости
 *  @param {Object} deps.generationBus - Шина событий генерации
 * @returns {WebSocketServer}
 */
export function initWebSocketServer(httpServer, { generationBus }) {
  const wss = new WebSocketServer({ server: httpServer, path: config.ws.path });
  
  // generationId -> { abortController, clientId, ws }
  // Нужна, чтобы по chat_stop найти и прервать нужную генерацию.
  const activeGenerations = new Map();

  // clientId -> Set<WebSocket>
  // Один пользователь может иметь несколько вкладок/устройств — все они получают
  // события generation_started / generation_stopped.
  const userSockets = new Map();

  /**
   * Рассылает событие всем сокетам пользователя, КРОМЕ инициатора.
   * @param {string} clientId
   * @param {WebSocket} excludeWs - сокет, который не должен получить событие (он и так знает)
   * @param {Object} eventData
   */
  const broadcastToUser = (clientId, excludeWs, eventData) => {
    const sockets = userSockets.get(clientId);
    if (sockets) {
      for (const socket of sockets) {
        if (socket !== excludeWs && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(eventData));
        }
      }
    }
  };

  wss.on('connection', (ws, req) => {
    // Парсим query-строку. base 'http://localhost' — заглушка, нужна только для URL API.
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const clientId = url.searchParams.get('clientId') || 'unknown';

    if (token !== config.authToken) {
      // 4401 — кастомный код закрытия (401 Unauthorized в HTTP-семантике).
      ws.close(4401, 'Unauthorized');
      return;
    }

    console.log(`[WS] Клиент подключен: ${clientId}`);

    // Регистрируем сокет в "комнате" пользователя.
    if (!userSockets.has(clientId)) {
      userSockets.set(clientId, new Set());
    }
    userSockets.get(clientId).add(ws);

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());

        // --- ЗАПУСК ГЕНЕРАЦИИ ---
        if (message.type === 'chat_start') {
          const { generationId, messages, model, temperature } = message;
          
          const abortController = new AbortController();
          activeGenerations.set(generationId, { abortController, clientId, ws });

          // Сообщаем другим вкладкам: "началась генерация у пользователя X".
          broadcastToUser(clientId, ws, { 
            type: 'generation_started', 
            generationId 
          });

          // Race-condition guard: пользователь мог нажать STOP ещё ДО того,
          // как генерация реально стартовала (например, на другом устройстве).
          const alreadyStopped = await generationBus.isAlreadyStopped(generationId);
          if (alreadyStopped) {
            ws.send(JSON.stringify({ type: 'system_alert', message: 'Генерация была отменена.' }));
            activeGenerations.delete(generationId);
            return;
          }

          // Если бюджет исчерпан — предупреждаем и работаем только локально.
          let forceLocal = false;
          if (!budget.canUseCloud()) {
            forceLocal = true;
            ws.send(JSON.stringify({ 
              type: 'system_alert', 
              message: `⚠️ Дневной лимит поисковых запросов (${config.budget.dailyLimit}) исчерпан. Работаю на основе своих знаний.` 
            }));
          }

          // Регистрируем обработчик STOP в шине — чтобы другие поды/вкладки
          // могли прервать именно эту генерацию.
          generationBus.register(generationId, () => {
            abortController.abort();
          });

          try {
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
            // Маркер конца стрима (фронт ждёт именно эту строку).
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
            
            // Сообщаем другим вкладкам: "генерация завершена".
            broadcastToUser(clientId, ws, { 
              type: 'generation_stopped', 
              generationId 
            });
          }
        }

        // --- ОСТАНОВКА ГЕНЕРАЦИИ (возможно, с другого устройства) ---
        if (message.type === 'chat_stop') {
          const { generationId } = message;
          
          // Публикуем STOP в шину: его получат ВСЕ поды, включая тот,
          // на котором реально идёт генерация.
          await generationBus.publishStop(generationId);
          
          // Если генерация идёт на ЭТОМ поде — прерываем локально.
          // (На других подах это сделает подписчик шины.)
          if (activeGenerations.has(generationId)) {
            const { abortController } = activeGenerations.get(generationId);
            abortController.abort();
            activeGenerations.delete(generationId);
          }

          broadcastToUser(clientId, ws, { 
            type: 'generation_stopped', 
            generationId 
          });
        }

      } catch (e) {
        console.error('[WS] Ошибка парсинга:', e);
      }
    });

    ws.on('close', () => {
      console.log(`[WS] Клиент отключен: ${clientId}`);
      
      // Убираем сокет из комнаты пользователя.
      if (userSockets.has(clientId)) {
        userSockets.get(clientId).delete(ws);
        if (userSockets.get(clientId).size === 0) {
          userSockets.delete(clientId);
        }
      }

      // ⚠️ Если клиент отключился посреди генерации — прерываем ВСЕ его генерации.
      // Это правильно для одного устройства, но при синхронизации между вкладками
      // может быть неожиданно: закрытие одной вкладки убьёт генерацию в другой.
      // Пока это осознанный компромисс — просто имейте в виду.
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
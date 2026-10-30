// server/ws/index.js
import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'url';
import { config } from '../config.js';
import { streamWithFallback } from '../fallback.js';
import { budget } from '../budget.js';
import { ConnectionManager } from './connection-manager.js';

export function initWebSocketServer(httpServer, { generationBus }) {
  const wss = new WebSocketServer({ server: httpServer, path: config.ws.path });
  const connManager = new ConnectionManager();
  
  // generationId -> { abortController, clientId, ws }
  const activeGenerations = new Map();

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const clientId = url.searchParams.get('clientId') || 'unknown';
    const role = url.searchParams.get('role') || 'client'; // 🆕 роль (client/operator)

    if (token !== config.authToken) {
      ws.close(4401, 'Unauthorized');
      return;
    }

    console.log(`[WS] Подключен ${role}: ${clientId}`);

    // Регистрируем в ConnectionManager
    if (role === 'client') {
      connManager.addUserSocket(clientId, ws);
    }
    // Для оператора пока не регистрируем в комнату, ждем события call_operator

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());

        // --- ЗАПУСК ГЕНЕРАЦИИ ---
        if (message.type === 'chat_start') {
          const { generationId, messages, model, temperature } = message;
          
          const abortController = new AbortController();
          activeGenerations.set(generationId, { abortController, clientId, ws });

          // Синхронизация: сообщаем другим вкладкам
          connManager.broadcastToUser(clientId, ws, { 
            type: 'generation_started', 
            generationId 
          });

          const alreadyStopped = await generationBus.isAlreadyStopped(generationId);
          if (alreadyStopped) {
            ws.send(JSON.stringify({ type: 'system_alert', message: 'Генерация была отменена.' }));
            activeGenerations.delete(generationId);
            return;
          }

          let forceLocal = false;
          if (!budget.canUseCloud()) {
            forceLocal = true;
            ws.send(JSON.stringify({ 
              type: 'system_alert', 
              message: `⚠️ Дневной лимит поисковых запросов (${config.budget.dailyLimit}) исчерпан. Работаю на основе своих знаний.` 
            }));
          }

          generationBus.register(generationId, () => {
            abortController.abort();
          });

          try {
            for await (const chunk of streamWithFallback({
              messages, model, temperature, signal: abortController.signal, forceLocal
            })) {
              if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(chunk));
            }
            if (ws.readyState === WebSocket.OPEN) ws.send('[DONE]');
          } catch (err) {
            if (err.name === 'AbortError') {
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
            connManager.broadcastToUser(clientId, ws, { 
              type: 'generation_stopped', 
              generationId 
            });
          }
        }

        // --- ОСТАНОВКА ГЕНЕРАЦИИ ---
        if (message.type === 'chat_stop') {
          const { generationId } = message;
          await generationBus.publishStop(generationId);
          
          if (activeGenerations.has(generationId)) {
            const { abortController } = activeGenerations.get(generationId);
            abortController.abort();
            activeGenerations.delete(generationId);
          }

          connManager.broadcastToUser(clientId, ws, { 
            type: 'generation_stopped', 
            generationId 
          });
        }

        // 🆕 ЗАГЛУШКА ДЛЯ ОПЕРАТОРА (реализуем позже)
        if (message.type === 'operator_join') {
          const { roomId } = message;
          connManager.addOperatorToRoom(roomId, ws);
          connManager.broadcastToRoom(roomId, { type: 'operator_joined', roomId });
        }

      } catch (e) {
        console.error('[WS] Ошибка парсинга:', e);
      }
    });

    ws.on('close', () => {
      console.log(`[WS] Отключен ${role}: ${clientId}`);
      
      if (role === 'client') {
        connManager.removeUserSocket(clientId, ws);
      }
      
      // Прерываем генерации, инициированные этим сокетом
      for (const [genId, gen] of activeGenerations.entries()) {
        if (gen.clientId === clientId && gen.ws === ws) {
          gen.abortController.abort();
          activeGenerations.delete(genId);
          connManager.broadcastToUser(clientId, null, { 
            type: 'generation_stopped', 
            generationId: genId 
          });
        }
      }
    });
  });

  console.log(`[WS] WebSocket сервер запущен на ${config.ws.path}`);
  return wss;
}
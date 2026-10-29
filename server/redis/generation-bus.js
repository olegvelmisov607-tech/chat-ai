// server/redis/generation-bus.js
//
// Шина событий для управления генерациями между подами/вкладками.
// Контракт одинаковый для обоих режимов (in-memory и Redis), поэтому
// вызывающий код (ws/index.js) не знает, какой режим активен.
//
// API:
//   register(generationId, onStop)  — подписаться на STOP конкретной генерации
//   unregister(generationId)        — отписаться (при завершении)
//   publishStop(generationId)       — опубликовать STOP (вызывается из chat_stop)
//   isAlreadyStopped(generationId)  — проверка race-condition: не остановили ли уже

const CONTROL_CHANNEL = 'gen:control';

/**
 * @param {{pub:any, sub:any, cache:any}|null} redisClients
 *   null → in-memory-режим (одно приложение, без Redis).
 * @returns {{
 *   register: (generationId:string, onStop:()=>void) => void,
 *   unregister: (generationId:string) => void,
 *   publishStop: (generationId:string) => Promise<void>,
 *   isAlreadyStopped: (generationId:string) => Promise<boolean>
 * }}
 */
export function createGenerationBus(redisClients) {
  // ==========================================
  // ВЕТКА 1: БЕЗ REDIS (In-Memory Fallback)
  // ==========================================
  if (!redisClients) {
    console.log('[Bus] Работаем в режиме In-Memory (без Redis)');
    
    const localHandlers = new Map();
    // Эмуляция TTL из Redis: храним id остановленных генераций 60 секунд,
    // чтобы запоздавший chat_start не запустился после STOP.
    const stoppedIds = new Set();

    return {
      register(generationId, onStop) {
        localHandlers.set(generationId, onStop);
      },
      unregister(generationId) {
        localHandlers.delete(generationId);
      },
      async publishStop(generationId) {
        stoppedIds.add(generationId);
        setTimeout(() => stoppedIds.delete(generationId), 60000);

        // В in-memory режиме STOP сразу применяется локально.
        if (localHandlers.has(generationId)) {
          console.log(`[Bus In-Memory] STOP для генерации: ${generationId}`);
          localHandlers.get(generationId)();
        }
      },
      async isAlreadyStopped(generationId) {
        return stoppedIds.has(generationId);
      }
    };
  }

  // ==========================================
  // ВЕТКА 2: С REDIS (Pub/Sub)
  // ==========================================
  const { pub, sub, cache } = redisClients;
  const localHandlers = new Map();

  // Подписываемся на ОДИН общий канал. Все поды получают все STOP-события,
  // но реагируют только те, у кого есть локальный обработчик для этого generationId.
  sub.subscribe(CONTROL_CHANNEL, (message) => {
    try {
      const { generationId, action } = JSON.parse(message);
      if (action === 'stop' && localHandlers.has(generationId)) {
        console.log(`[Bus] Received STOP for generation: ${generationId}`);
        localHandlers.get(generationId)();
      }
    } catch (e) {
      console.error('[Bus] Failed to parse message', e);
    }
  });

  return {
    register(generationId, onStop) {
      localHandlers.set(generationId, onStop);
    },
    unregister(generationId) {
      localHandlers.delete(generationId);
    },
    async publishStop(generationId) {
      // 1. Ставим флаг с TTL 60с — это guard от race-condition:
      //    если chat_start придёт ПОСЛЕ stop, isAlreadyStopped() вернёт true.
      await cache.set(`gen:${generationId}:stop`, '1', { EX: 60 });

      // 2. Публикуем STOP в канал — его получат все поды, включая тот,
      //    на котором реально идёт генерация.
      await pub.publish(CONTROL_CHANNEL, JSON.stringify({ generationId, action: 'stop' }));
      console.log(`[Bus] Published STOP for generation: ${generationId}`);
    },
    async isAlreadyStopped(generationId) {
      const exists = await cache.exists(`gen:${generationId}:stop`);
      return exists === 1;
    }
  };
}
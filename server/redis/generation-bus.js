const CONTROL_CHANNEL = 'gen:control';

export function createGenerationBus(redisClients) {
  // ==========================================
  // ВЕТКА 1: БЕЗ REDIS (In-Memory Fallback)
  // ==========================================
  if (!redisClients) {
    console.log('[Bus] Работаем в режиме In-Memory (без Redis)');
    
    const localHandlers = new Map();
    const stoppedIds = new Set(); // Эмуляция TTL

    return {
      register(generationId, onStop) {
        localHandlers.set(generationId, onStop);
      },
      unregister(generationId) {
        localHandlers.delete(generationId);
      },
      async publishStop(generationId) {
        // Запоминаем, что генерация остановлена (на 60 сек)
        stoppedIds.add(generationId);
        setTimeout(() => stoppedIds.delete(generationId), 60000);

        // Вызываем локальный обработчик, если он есть
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

  // Подписываемся на общий канал управления
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
      // Race-condition guard: ставим флаг на 60 секунд
      await cache.set(`gen:${generationId}:stop`, '1', { EX: 60 });
      // Публикуем событие во все поды
      await pub.publish(CONTROL_CHANNEL, JSON.stringify({ generationId, action: 'stop' }));
      console.log(`[Bus] Published STOP for generation: ${generationId}`);
    },
    async isAlreadyStopped(generationId) {
      const exists = await cache.exists(`gen:${generationId}:stop`);
      return exists === 1;
    }
  };
}
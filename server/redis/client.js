// server/redis/client.js
import { createClient } from 'redis';
import { config } from '../config.js';

/**
 * Создаёт три Redis-клиента (pub/sub/cache) ИЛИ возвращает null,
 * если Redis не настроен/недоступен. В этом случае весь проект
 * автоматически переходит на in-memory-режим (см. generation-bus.js).
 *
 * Почему три клиента:
 *  - pub   — публикация сообщений в каналы;
 *  - sub   — подписка (в node-redis подписанный клиент нельзя использовать для команд);
 *  - cache — обычные GET/SET/EXISTS для TTL-флагов.
 *
 * @returns {Promise<Object|null>} Объект с клиентами Redis или null
 */
export async function createRedisClients() {
  // Явное отключение Redis через .env (REDIS_URL=none).
  if (!config.redis.url || config.redis.url === 'none') {
    console.log('[Redis] Работаем без Redis (in-memory mode)');
    return null;
  }

  const pub = createClient({ 
    url: config.redis.url,
    // Ограничиваем количество попыток переподключения, чтобы приложение
    // не висело в ожидании мёртвого Redis.
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > 2) return new Error('Redis connection failed');
        return 1000; // ждём 1 секунду между попытками
      }
    }
  });
  
  // duplicate() создаёт независимое соединение с теми же настройками.
  const sub = pub.duplicate();
  const cache = pub.duplicate();

  // Во время connect клиенты могут сыпать ошибками — глушим их,
  // чтобы не засорять лог при штатном fallback'е.
  let isConnecting = true;
  const silentErrorHandler = (err) => {
    if (!isConnecting) {
      console.error('[Redis Error]', err.message);
    }
  };

  pub.on('error', silentErrorHandler);
  sub.on('error', silentErrorHandler);
  cache.on('error', silentErrorHandler);

  try {
    await Promise.all([pub.connect(), sub.connect(), cache.connect()]);
    isConnecting = false;
    console.log('[Redis] Clients connected successfully');
    return { pub, sub, cache };
  } catch (err) {
    isConnecting = false;
    console.warn('[Redis] Не удалось подключиться. Работаем в in-memory mode.');
    
    // Важно: закрываем клиенты, иначе они будут спамить reconnect-попытками.
    try {
      await pub.disconnect();
      await sub.disconnect();
      await cache.disconnect();
    } catch (e) {
      // Игнорируем ошибки при закрытии — мы уже в fallback'е.
    }
    
    return null;
  }
}
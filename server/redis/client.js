import { createClient } from 'redis';
import { config } from '../config.js';

export async function createRedisClients() {
  // Если в .env явно указано отключить Redis
  if (!config.redis.url || config.redis.url === 'none') {
    console.log('[Redis] Работаем без Redis (in-memory mode)');
    return null;
  }

  const pub = createClient({ 
    url: config.redis.url,
    // Отключаем автоматические переподключения, чтобы не спамить в консоль
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > 2) return new Error('Redis connection failed');
        return 1000; // ждем 1 секунду и пробуем снова (максимум 2 раза)
      }
    }
  });
  
  const sub = pub.duplicate();
  const cache = pub.duplicate();

  // Временная заглушка для ошибок, чтобы не спамили во время connect
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
    
    // Важно: закрываем клиенты, чтобы они не спамили
    try {
      await pub.disconnect();
      await sub.disconnect();
      await cache.disconnect();
    } catch (e) {
      // Игнорируем ошибки при закрытии
    }
    
    return null; // Возвращаем null, чтобы generation-bus перешел в in-memory
  }
}
import { createClient } from 'redis';
import { config } from '../config.js';

export async function createRedisClients() {
  const pub = createClient({ url: config.redis.url });
  const sub = pub.duplicate();
  const cache = pub.duplicate();

  // Обработка ошибок, чтобы упавший Redis не убивал Node.js процесс
  pub.on('error', (err) => console.error('[Redis Pub Error]', err.message));
  sub.on('error', (err) => console.error('[Redis Sub Error]', err.message));
  cache.on('error', (err) => console.error('[Redis Cache Error]', err.message));

  // Подключаемся параллельно
  await Promise.all([
    pub.connect(),
    sub.connect(),
    cache.connect()
  ]);

  console.log('[Redis] Clients connected successfully');
  return { pub, sub, cache };
}
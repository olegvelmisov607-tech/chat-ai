// server.js
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';

// Инфраструктура
import { createRedisClients } from './redis/client.js';
import { createGenerationBus } from './redis/generation-bus.js';
import { mcpManager } from './mcp-manager.js';
import { initWebSocketServer } from './ws/index.js';
import { createRouter } from './http/router.js';

// Роуты
import { handleChat } from './routes/chat.js';
import { handleBudget } from './routes/budget.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME_TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'
};

async function bootstrap() {
  // 1. Redis
  const redisClients = await createRedisClients();
  const generationBus = createGenerationBus(redisClients);

  // 2. MCP
  try {
    const sandboxPath = process.env.MCP_SANDBOX_PATH || 'C:\\temp';
    if (!fs.existsSync(sandboxPath)) fs.mkdirSync(sandboxPath, { recursive: true });
    await mcpManager.connectServer(
      'filesystem', 'npx', ['-y', '@modelcontextprotocol/server-filesystem', sandboxPath]
    );
  } catch (err) {
    console.warn('[MCP] Не удалось подключить MCP-сервер:', err.message);
  }

  // 3. Роутер
  const router = createRouter();
  router.add('POST', '/api/chat', handleChat);
  router.add('GET', '/api/budget', handleBudget);

  // 4. HTTP-сервер
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Пробуем роутер
    const handled = await router.handle(req, res);
    if (handled) return;

    // Статика (SPA)
    const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    // ✅ ИСПРАВЛЕНО: поднимаемся на уровень выше из папки server/ в корень проекта
    const filePath = path.join(__dirname, '..', 'dist', urlPath);
    const ext = path.extname(filePath);

    fs.readFile(filePath, (err, content) => {
      if (err) {
        if (!ext) {
          // ✅ ИСПРАВЛЕНО: здесь тоже поднимаемся на уровень выше
          fs.readFile(path.join(__dirname, '..', 'dist', 'index.html'), (err2, content2) => {
            if (err2) { res.writeHead(404); res.end('Not Found'); }
            else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(content2, 'utf-8'); }
          });
          return;
        }
        res.writeHead(404); res.end('404 Not Found');
      } else {
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(content, 'utf-8');
      }
    });
  });

  // 5. WebSocket
  initWebSocketServer(server, { generationBus });

  // 6. Graceful shutdown
  const shutdown = async () => {
    console.log('Завершение работы...');
    await mcpManager.disconnectAll().catch(() => {});
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  server.listen(config.port, () => {
    console.log(`Сервер запущен: http://localhost:${config.port}`);
  });
}

bootstrap().catch(err => {
  console.error('Критическая ошибка при запуске:', err);
  process.exit(1);
});
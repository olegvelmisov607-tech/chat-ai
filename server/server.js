import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { streamWithFallback } from './fallback.js';
import { initWebSocketServer } from './ws/index.js';
import { budget } from './budget.js';

import { createRedisClients } from './redis/client.js';
import { createGenerationBus } from './redis/generation-bus.js';
import { mcpManager } from './mcp-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

// --- RATE LIMITER (в памяти, per-IP) ---
// ⚠️ При нескольких подах счётчики не разделяются — для production нужен Redis.
const ipRequestCounts = new Map();

/**
 * Проверяет, не превысил ли IP лимит запросов за окно.
 * @param {string} ip
 * @returns {boolean} true, если нужно вернуть 429
 */
function isRateLimited(ip) {
  const now = Date.now();
  const windowStart = now - config.rateLimitWindowMs;
  
  if (!ipRequestCounts.has(ip)) {
    ipRequestCounts.set(ip, []);
  }
  
  // Оставляем только запросы внутри окна + текущий.
  const requests = ipRequestCounts.get(ip).filter(timestamp => timestamp > windowStart);
  requests.push(now);
  ipRequestCounts.set(ip, requests);
  
  return requests.length > config.rateLimitMaxRequests;
}

/** Инициализация всего приложения: Redis, MCP, HTTP, WS. */
async function bootstrap() {
  // 1. Redis (или in-memory fallback — createRedisClients сам решит).
  const redisClients = await createRedisClients();
  const generationBus = createGenerationBus(redisClients);

  // 2. MCP: подключаем ДО старта HTTP, чтобы инструменты были готовы к первому запросу.
  try {
    const sandboxPath = process.env.MCP_SANDBOX_PATH || 'C:\\temp';
    
    if (!fs.existsSync(sandboxPath)) {
      fs.mkdirSync(sandboxPath, { recursive: true });
    }
    
    await mcpManager.connectServer(
      'filesystem', 
      'npx', 
      ['-y', '@modelcontextprotocol/server-filesystem', sandboxPath]
    );
  } catch (err) {
    // MCP необязателен: без него чат работает, просто без инструментов.
    console.warn('[MCP] Не удалось подключить MCP-сервер (возможно, нет npx):', err.message);
  }

  const server = http.createServer(async (req, res) => {
    // CORS — упрощённый, для локальной разработки.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // --- GET /api/budget: статус дневного лимита ---
    if (req.url === '/api/budget' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(budget.getStatus()));
      return;
    }

    // --- POST /api/chat: основной SSE-эндпоинт ---
    if (req.url === '/api/chat' && req.method === 'POST') {
      const clientIp = req.socket.remoteAddress || 'unknown';
      if (isRateLimited(clientIp)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Too Many Requests. Please wait a minute.' }));
        return;
      }

      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];

      if (!token || token !== config.authToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized. Invalid or missing token.' }));
        return;
      }

      // Читаем тело с защитой от слишком больших payload.
      let body = '';
      let size = 0;

      req.on('data', chunk => {
        size += chunk.length;
        if (size > config.maxBodySize) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload Too Large' }));
          req.destroy();
          return;
        }
        body += chunk;
      });

      req.on('end', async () => {
        try {
          const { messages, model, temperature } = JSON.parse(body);

          // Определяем, есть ли изображение в последнем сообщении — для роутинга на vision.
          const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
          const hasImages = lastUserMessage && 
                            Array.isArray(lastUserMessage.content) && 
                            lastUserMessage.content.some(c => c.type === 'image_url');

          const routingModel = hasImages ? 'vision' : model;

          // Для не-vision сообщений "сплющиваем" массив content в строку (Ollama так надёжнее).
          let finalMessages = messages;
          if (!hasImages) {
            finalMessages = messages.map(m => {
              if (Array.isArray(m.content)) {
                const textParts = m.content.filter(c => c.type === 'text').map(c => c.text).join(' ');
                return { role: m.role, content: textParts };
              }
              return m;
            });
          }

          // Заголовки SSE.
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no' // отключаем буферизацию в nginx
          });

          // Проверка бюджета — ТОЛЬКО чтение, списание происходит внутри fallback.js.
          let forceLocal = false;
          if (!budget.canUseCloud()) {
            forceLocal = true;
            res.write(`data: ${JSON.stringify({ 
              type: 'system_alert', 
              message: `⚠️ Дневной лимит поисковых запросов (${config.budget.dailyLimit}) исчерпан. Работаю на основе своих знаний.` 
            })}\n\n`);
          }

          // Стримим чанки в формате SSE.
          for await (const chunk of streamWithFallback({ 
            messages: finalMessages, 
            model: routingModel, 
            temperature,
            signal: req.signal,
            forceLocal
          })) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          
          res.write('data: [DONE]\n\n');
          res.end();
        } catch (error) {
          console.error('[Server Error]', error);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
          } else {
            res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
            res.end();
          }
        }
      });
      return;
    }

    // --- Статика: dist/ (с SPA-fallback на index.html) ---
    let filePath = path.join(__dirname, '..', 'dist', req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        if (!ext) {
          // SPA: любой путь без расширения → index.html (клиентский роутинг).
          fs.readFile(path.join(__dirname, '..', 'dist', 'index.html'), (err2, content2) => {
            if (err2) {
              res.writeHead(404); res.end('Not Found');
            } else {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(content2, 'utf-8');
            }
          });
          return;
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content, 'utf-8');
      }
    });
  });

  initWebSocketServer(server, { generationBus });

  server.listen(config.port, () => {
    console.log(`Сервер запущен: http://localhost:${config.port}`);
  });
}

bootstrap().catch(err => {
  console.error('Критическая ошибка при запуске:', err);
  process.exit(1);
});
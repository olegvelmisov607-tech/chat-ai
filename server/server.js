import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { streamWithFallback } from './fallback.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

// --- RATE LIMITER ---
const ipRequestCounts = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const windowStart = now - config.rateLimitWindowMs;
  
  if (!ipRequestCounts.has(ip)) {
    ipRequestCounts.set(ip, []);
  }
  
  const requests = ipRequestCounts.get(ip).filter(timestamp => timestamp > windowStart);
  requests.push(now);
  ipRequestCounts.set(ip, requests);
  
  return requests.length > config.rateLimitMaxRequests;
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/api/chat' && req.method === 'POST') {
    // 1. Проверка Rate Limit
    const clientIp = req.socket.remoteAddress || 'unknown';
    if (isRateLimited(clientIp)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too Many Requests. Please wait a minute.' }));
      return;
    }

    // 2. Проверка токена
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token || token !== config.authToken) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized. Invalid or missing token.' }));
      return;
    }

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

        // Проверяем наличие картинки ТОЛЬКО в последнем сообщении пользователя
        const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
        const hasImages = lastUserMessage && 
                          Array.isArray(lastUserMessage.content) && 
                          lastUserMessage.content.some(c => c.type === 'image_url');

        const routingModel = hasImages ? 'vision' : model;

        // ИСПРАВЛЕНИЕ: Если выбрана НЕ Vision-модель, удаляем картинки из истории, 
        // чтобы текстовые модели (qwen, deepseek-r1) не падали с ошибкой 500.
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

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no'
        });

        for await (const chunk of streamWithFallback({ 
          messages: finalMessages, // Передаем очищенную историю
          model: routingModel, 
          temperature,
          signal: req.signal 
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

  // Раздача статики
  let filePath = path.join(__dirname, '..', 'dist', req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      // SPA-роутинг
      if (!ext) {
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

server.listen(config.port, () => {
  console.log(`Сервер запущен: http://localhost:${config.port}`);
});
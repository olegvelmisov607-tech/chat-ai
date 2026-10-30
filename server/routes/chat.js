// server/routes/chat.js
import { config } from '../config.js';
import { streamWithFallback } from '../fallback.js';
import { budget } from '../budget.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { readJsonBody } from '../middleware/body-parser.js';

export async function handleChat(req, res) {
  if (rateLimit(req, res)) return;
  if (!requireAuth(req, res)) return;

  const payload = await readJsonBody(req, res);
  if (!payload) return;

  try {
    const { messages, model, temperature } = payload;

    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    const hasImages = lastUserMessage &&
                      Array.isArray(lastUserMessage.content) &&
                      lastUserMessage.content.some(c => c.type === 'image_url');

    const routingModel = hasImages ? 'vision' : model;

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

    let forceLocal = false;
    if (!budget.canUseCloud()) {
      forceLocal = true;
      res.write(`data: ${JSON.stringify({
        type: 'system_alert',
        message: `⚠️ Дневной лимит поисковых запросов (${config.budget.dailyLimit}) исчерпан. Работаю на основе своих знаний.`
      })}\n\n`);
    }

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
    console.error('[Chat Route Error]', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
      res.end();
    }
  }
}
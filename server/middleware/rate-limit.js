// server/middleware/rate-limit.js
import { config } from '../config.js';

// ⚠️ In-memory: при нескольких подах счётчики не разделяются.
const ipRequestCounts = new Map();

export function rateLimit(req, res) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowStart = now - config.rateLimitWindowMs;

  if (!ipRequestCounts.has(ip)) ipRequestCounts.set(ip, []);

  const requests = ipRequestCounts.get(ip).filter(t => t > windowStart);
  requests.push(now);
  ipRequestCounts.set(ip, requests);

  if (requests.length > config.rateLimitMaxRequests) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Too Many Requests. Please wait a minute.' }));
    return true;
  }
  return false;
}
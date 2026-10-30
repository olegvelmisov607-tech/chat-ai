// server/middleware/body-parser.js
import { config } from '../config.js';

export function readJsonBody(req, res) {
  return new Promise((resolve) => {
    let body = '';
    let size = 0;
    let aborted = false;

    req.on('data', chunk => {
      if (aborted) return;
      size += chunk.length;
      if (size > config.maxBodySize) {
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload Too Large' }));
        req.destroy();
        resolve(null);
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      if (aborted) return;
      try {
        resolve(JSON.parse(body));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        resolve(null);
      }
    });

    req.on('error', () => {
      if (!aborted) resolve(null);
    });
  });
}
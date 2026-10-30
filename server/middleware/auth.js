// server/middleware/auth.js
import { config } from '../config.js';

export function requireAuth(req, res) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token || token !== config.authToken) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized. Invalid or missing token.' }));
    return false;
  }
  return true;
}
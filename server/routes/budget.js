// server/routes/budget.js
import { budget } from '../budget.js';

export async function handleBudget(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(budget.getStatus()));
}
// server/budget.js
import { config } from './config.js';

export const budget = {
  date: new Date().toDateString(),
  cloudRequests: 0,
  resetIfNewDay() {
    const today = new Date().toDateString();
    if (this.date !== today) {
      this.date = today;
      this.cloudRequests = 0;
      console.log('[Budget] Новый день, счётчик сброшен');
    }
  },
  canUseCloud() {
    this.resetIfNewDay();
    if (!config.budget.enabled) return true;
    return this.cloudRequests < config.budget.dailyLimit;
  },
  recordRequest() {
    this.cloudRequests++;
    console.log(`[Budget] Облачных запросов сегодня: ${this.cloudRequests}/${config.budget.dailyLimit}`);
  },
  getStatus() {
    this.resetIfNewDay();
    return { 
      used: this.cloudRequests, 
      limit: config.budget.dailyLimit, 
      remaining: Math.max(0, config.budget.dailyLimit - this.cloudRequests),
      allowed: this.canUseCloud() 
    };
  }
};
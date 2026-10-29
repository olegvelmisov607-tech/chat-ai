// server/budget.js
import { config } from './config.js';

/**
 * Простой дневной счётчик облачных запросов (в памяти процесса).
 * ⚠️ При нескольких подах/рестартах счётчик не синхронизируется —
 * для production нужен Redis (см. generation-bus.js как пример).
 * @type {{date:string, cloudRequests:number, resetIfNewDay:Function, canUseCloud:Function, recordRequest:Function, getStatus:Function}}
 */
export const budget = {
  date: new Date().toDateString(),
  cloudRequests: 0,

  /** Сбрасывает счётчик при смене календарного дня. */
  resetIfNewDay() {
    const today = new Date().toDateString();
    if (this.date !== today) {
      this.date = today;
      this.cloudRequests = 0;
      console.log('[Budget] Новый день, счётчик сброшен');
    }
  },

  /** @returns {boolean} — можно ли ещё тратить облачные запросы. */
  canUseCloud() {
    this.resetIfNewDay();
    if (!config.budget.enabled) return true;
    return this.cloudRequests < config.budget.dailyLimit;
  },

  /** Фиксирует один потраченный облачный запрос. */
  recordRequest() {
    this.cloudRequests++;
    console.log(`[Budget] Облачных запросов сегодня: ${this.cloudRequests}/${config.budget.dailyLimit}`);
  },

  /**
   * @returns {{used:number, limit:number, remaining:number, allowed:boolean}}
   */
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
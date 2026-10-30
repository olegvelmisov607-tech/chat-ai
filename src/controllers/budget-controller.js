// src/controllers/budget-controller.js
import { fetchBudgetStatus } from '../api.js';

export class BudgetController {
  constructor(indicatorElement) {
    this.indicator = indicatorElement;
  }

  async updateUI() {
    if (!this.indicator) return;
    try {
      const status = await fetchBudgetStatus();
      this.indicator.textContent = `☁️ ${status.used}/${status.limit}`;
      this.indicator.title = `Осталось облачных запросов сегодня: ${status.remaining}`;
      
      if (!status.allowed) {
        this.indicator.style.background = 'rgba(255, 0, 0, 0.3)';
        this.indicator.title = 'Лимит исчерпан. Работает локальная модель.';
      } else {
        this.indicator.style.background = 'rgba(255, 255, 255, 0.1)';
      }
    } catch (e) {
      console.warn('Не удалось загрузить статус бюджета');
    }
  }
}
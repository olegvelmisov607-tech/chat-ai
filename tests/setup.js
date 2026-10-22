// tests/setup.js
import 'fake-indexeddb/auto';
import { vi } from 'vitest';

vi.mock('highlight.js', () => ({
  default: { highlight: (code) => ({ value: code }) }
}));

// Улучшенный мок marked (возвращает HTML как есть)
vi.mock('marked', () => ({
  marked: {
    parse: (text) => text 
  }
}));

// Улучшенный мок DOMPurify (имитируем реальную очистку)
vi.mock('dompurify', () => ({
  default: {
    sanitize: (html) => {
      // Простая имитация: удаляем теги script
      return html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gm, '');
    }
  }
}));
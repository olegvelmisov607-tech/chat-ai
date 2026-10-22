// tests/setup.js
import 'fake-indexeddb/auto';
import { vi } from 'vitest';

vi.mock('highlight.js', () => ({
  default: { highlight: (code) => ({ value: code }) }
}));

// Улучшенный мок marked (имитируем базовый Markdown)
vi.mock('marked', () => ({
  marked: {
    parse: (text) => {
      // Простейшая имитация Markdown: заменяем **текст** на <strong>текст</strong>
      return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    }
  }
}));

// Улучшенный мок DOMPurify
vi.mock('dompurify', () => ({
  default: {
    sanitize: (html) => {
      // Удаляем только теги script
      return html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gm, '');
    }
  }
}));
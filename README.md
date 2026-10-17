# Local AI SPA+PWA Chat Client

Современное автономное веб-приложение (SPA/PWA) для работы с локальными большими языковыми моделями через API **Ollama**. Архитектура построена на базе **чистого клиентского JavaScript (Vanilla ES Modules)** без использования сторонних UI-фреймворков, и нативного **Node.js** на бэкенде.

## 🚀 Основной стек технологий
* **Frontend:** Vanilla JS (ES6+ Modules), HTML5, CSS3.
* **Backend:** Node.js (HTTP, Streams API).
* **Сборка и Качество:** Webpack 5, ESLint v9+.
* **PWA & Офлайн:** Service Worker API, Web App Manifest.
* **Data & Streaming:** Fetch / ReadableStream (SSE), IndexedDB API.
* **Тестирование:** Playwright (E2E).

## 🛠️ Быстрый старт
```bash
npm install
npx playwright install
npm run test:e2e
```

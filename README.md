[![CI Pipeline](https://github.com/olegvelmisov607-tech/chat-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/olegvelmisov607-tech/chat-ai/actions/workflows/ci.yml) ![](https://img.shields.io/badge/Coverage-71%25-5A7302.svg?prefix=$coverage$)
# Local AI SPA+PWA Chat Client 🚀

Современное автономное веб-приложение (SPA/PWA) для работы с большими языковыми моделями (DeepSeek Cloud, Yandex Cloud и локальная Ollama). Архитектура построена на **чистом JavaScript (Vanilla ES6+) без использования UI-фреймворков** и **нативном Node.js** на бэкенде.

Проект создан как учебный полигон (pet-project) уровня Middle+ для демонстрации современных подходов к веб-разработке: от Agentic Workflow (Tool Calling) и MCP до мультимодальности (Vision), распределенной синхронизации через WebSocket/Redis и продвинутых браузерных API.

## ✨ Ключевые особенности

* **WebSocket с Fallback на SSE:** Основной транспорт для стриминга — WebSocket (с поддержкой STOP-генерации и синхронизации вкладок). Если браузер/прокси не поддерживает WS, происходит автоматический фолбэк на Server-Sent Events (SSE).
* **Синхронизация между вкладками и устройствами (Full State Sync):** Благодаря WebSocket и Redis Pub/Sub, если вы запустили генерацию на одном устройстве (или вкладке), на другом появится баннер «Генерация идет на другом устройстве», а кнопка STOP будет работать удаленно.
* **Model Context Protocol (MCP):** Локальная Qwen (через Ollama) получает «руки» в виде MCP-серверов. В проекте интегрирован `@modelcontextprotocol/server-filesystem`, позволяющий модели безопасно читать и записывать файлы в песочнице (`C:\temp` или `sandbox`).
* **AI Agent (Tool Calling / Function Calling):** Бэкенд передает модели описание инструмента `web_search` и динамических MCP-инструментов. Модель (облачная или локальная) **самостоятельно решает**, когда ей нужны свежие данные или доступ к файлам. 
* **Контроль бюджета (Cost Control):** Серверный «Budget Guard» (настраивается через `.env`). Бюджет списывается **только** за реальные вызовы Yandex Search API. Если лимит исчерпан, сервер отключает платный поиск и отправляет системное уведомление.
* **Graceful Degradation (Cloud → Local):** Если облако недоступно (нет интернета, ошибка `402/5xx`, таймаут), бэкенд включает Circuit Breaker и мгновенно переключается на локальную Ollama.
* **In-Memory Fallback (Работа без Redis):** Проект может работать без Docker/Redis. Если Redis недоступен, сервер автоматически переключается на локальную шину событий (In-Memory EventBus) для синхронизации вкладок в пределах одного пода.
* **Мультимодальность (Vision):** Поддержка отправки изображений через скрепку, Drag-n-Drop или вставку из буфера. Бэкенд автоматически определяет наличие картинки и перенаправляет запрос на локальную Vision-модель (например, `gemma3:12b`).
* **Picture-in-Picture (PiP):** Благодаря Document PiP API (Chrome 116+) интерфейс чата можно вынести в отдельное плавающее окно.
* **Системные уведомления (Notification API):** Оповещения ОС о завершении генерации или исчерпании бюджета.
* **Умный UI (Gemini-style):** Источники рендерятся в виде красивых карточек с фавиконками сайтов, доменом и заголовком.
* **Безопасный Reasoning:** Кастомный парсер тегов `<think>` безопасно рендерит «рассуждения» модели без уязвимости XSS.
* **SSR & SEO:** Сервер определяет поисковых ботов по `User-Agent` и отдает им готовый HTML с микроразметкой Schema.org.
* **Security (Auth & Rate Limit):** Защита локального инференса от несанкционированного доступа (Bearer Token) и DDoS (in-memory Rate Limiter на базе IP).
* **PWA & Offline Mode:** Web App Manifest и Service Worker (Cache-first) для работы без сети и установки приложения.

## 🛠️ Стек технологий

* **Frontend:** Vanilla JS (ES6+ Modules), HTML5, CSS3, PWA (Service Worker), Document PiP API, Notification API, WebSocket API, BroadcastChannel (в планах).
* **Backend:** Node.js (нативный модуль `http`, Streams API, SSE), WebSocket (`ws`), Redis (Pub/Sub), MCP SDK.
* **AI API:** OpenAI-совместимый API (DeepSeek Cloud + Ollama).
* **Сборка и Качество:** Webpack 5, Webpack Dev Server (HMR & Live Reload), ESLint v9 (Flat Config).
* **Тестирование:** Playwright (E2E с мокированием сетевых запросов, тестами UI-состояний и Vision-запросов).
* **Инфраструктура:** Docker Compose (Redis + RedisInsight).
* **AI Agent Harness:** Настроены MCP-серверы (Filesystem, Puppeteer, GitHub) и кастомные Skills для GigaCode.

## 📐 Архитектура и Бизнес-логика

**1. Обработка запросов и Tool Calling (Agentic Workflow):**
* Клиент устанавливает WebSocket-соединение (или использует SSE) и отправляет `chat_start`.
* Бэкенд проверяет **дневной бюджет** (Budget Guard). Если лимит превышен — принудительно включает локальный режим и отключает поиск.
* Бэкенд пробует Облако (DeepSeek) с переданным инструментом `web_search` и MCP-инструментами.
* Если модель решает искать — бэкенд вызывает Yandex GenSearch, отдает данные модели для формирования финального ответа и возвращает клиенту стрим + источники.
* Если модель вызывает MCP-инструмент (например, `write_file`), бэкенд перенаправляет вызов в MCP-сервер, получает результат и отдает его модели для второго прохода.

**2. Синхронизация (Full State Sync):**
* Каждое устройство/браузер имеет постоянный `userId` (в `localStorage`).
* При старте генерации сервер рассылает событие `generation_started` всем сокетам этого `userId` (кроме инициатора).
* При нажатии STOP или завершении генерации сервер рассылает `generation_stopped`. Если событие приходит на другую вкладку, она прерывает свой `AbortController`.

**3. Каскадный Fallback (Graceful Degradation):**
* Если облако отдает `401/403` — возвращаем ошибку авторизации.
* Если сеть недоступна или `402 (Insufficient Balance)` — включаем Circuit Breaker.
* Запрос автоматически уходит в локальную Ollama. Локальная модель также **умеет вызывать `web_search`**, если бюджет еще не исчерпан, но мы упали в fallback из-за сбоя сети.

**4. Обработка изображений (Vision):**
* Клиент отправляет Base64-картинку.
* Бэкенд подменяет модель на `vision`, запрос уходит в Ollama (`gemma3:12b`).
* `openai-compat.js` отключает стриминг, ждет полный ответ и эмулирует SSE-поток.

## 📸 Скриншоты

### Десктопный вид (Роутинг между Vision и текстовой моделью)
![Десктопный вид](docs/desktop.png)

### Мобильный вид (Адаптивная верстка)
<img src="docs/mobile.png" width="300" alt="Мобильный вид">

### Picture-in-Picture (Отдельное окно)
![Picture-in-Picture](docs/pip.png)

## 🚀 Быстрый старт и Разработка

1. Установите зависимости:
   `npm install`

2. Создайте файл `.env` в корне проекта:
   ```env
   PORT=3000
   AUTH_TOKEN=super-secret-token
   
   # Облачная LLM (DeepSeek)
   DEEPSEEK_API_KEY=sk-ваш_ключ
   DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
   
   # Локальная LLM (Ollama)
   OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
   
   # Yandex Search API (для Tool Calling)
   YANDEX_SEARCH_API_KEY=ваш_ключ_со_скоупом_yc.search-api.execute
   YANDEX_FOLDER_ID=ваш_folder_id

   # Контроль бюджета (Budget Guard)
   DAILY_CLOUD_LIMIT=5
   BUDGET_ENABLED=true

   # Redis (опционально, для синхронизации между подами)
   REDIS_URL=redis://127.0.0.1:6379
   
3. Убедитесь, что Ollama запущена и модели скачаны (для текста: `qwen3:8b` или `deepseek-r1:7b`, для картинок: `gemma3:12b`).

4. **Режим разработки (HMR + Live Reload):**
   Откройте **два терминала**:
   * Терминал 1 (Бэкенд): `npm run dev:server`
   * Терминал 2 (Фронтенд): `npm run dev`
   Приложение откроется на `http://localhost:8080`.

5. **Production сборка:**
   `npm run build`
   `npm start`
   Приложение будет доступно на `http://localhost:3000`.

## 🔒 Безопасность и Деплой (Production)

Для выкатывания в интернет (на белый IP) настоятельно рекомендуется использовать **Nginx как Reverse Proxy**:
* Настройте SSL (Let's Encrypt / certbot).
* Отключите буферизацию (`proxy_buffering off`) для SSE-эндпоинта `/api/chat`, чтобы стриминг работал корректно.
* Ограничьте `limit_req` на уровне Nginx для защиты от DDoS.

## 🧪 Тестирование

E2E-тесты написаны на Playwright. Они **мокают** сетевые запросы, поэтому для их прохождения не требуется запущенная Ollama или API-ключ.

Тесты покрывают:
* Роутинг между экранами.
* Блокировку кнопки «Отправить» (когда нет текста и картинок).
* Загрузку картинки, появление превью и активацию кнопки.
* Полный цикл отправки картинки (с моком ответа от Vision-модели).
* Переключение температуры.
* Наличие кнопок PiP и уведомлений.
* Работу чекбокса «Авто-PiP».
* Запрос разрешения на уведомления.
* Синхронизацию STOP между вкладками (через WS)

Запуск:
`npm run test:e2e`

## 🔍 Как проверить SSR

Чтобы увидеть, что отдается поисковым ботам, выполните в терминале:
`curl -A "Googlebot" http://localhost:3000/`
Вы увидите чистый HTML с метатегами и микроразметкой. Для обычного пользователя в браузере отдается интерактивный SPA-клиент.

## 📂 Структура проекта (Ключевые модули)

* `server/ws/index.js` — WebSocket сервер, обработка `chat_start` / `chat_stop`, синхронизация вкладок.
* `server/fallback.js` — Логика выбора модели, Tool Calling (Web Search + MCP).
* `server/mcp-manager.js` — Клиент для подключения к MCP-серверам (Filesystem).
* `server/redis/` — Клиенты Redis и `generationBus` (с In-Memory фолбэком).
* `src/transport.js` — Абстракция транспорта (WebSocket ↔ SSE Fallback).
* `src/app.js` — UI-логика, обработка событий синхронизации (`sync_generation_started` / `stopped`).
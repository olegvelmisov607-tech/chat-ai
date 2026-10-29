// server/ssr.js
//
// SSR-заглушка: отдаёт поисковым ботам и соцсетям осмысленный HTML
// с историей чата и микроразметкой. Пользователи же получают SPA из dist/.
//
// ⚠️ ВАЖНО: это демонстрационный файл. В текущем виде он НЕ безопасен
// для production — см. комментарии с ⚠️ внутри (XSS, отсутствие экранирования,
// захардкоженный og:image). Разбор этих мест — хорошее упражнение для ученика.

/**
 * Рендерит серверный HTML для краулеров.
 *
 * @returns {string} готовый HTML-документ
 */
export function renderSSR() {
  // ⚠️ Для демо данные захардкожены. В реальном проекте здесь:
  //   - запрос к БД/Redis за последними N сообщениями;
  //   - либо чтение из того же источника, что и клиентская история.
  // Пока это просто иллюстрация формата.
  const messages = [
    { role: 'user', content: 'Привет! Как дела?' },
    { role: 'assistant', content: 'Привет! Я локальная ИИ-модель Qwen. Отлично, готов помочь с кодом!' },
    { role: 'user', content: 'Помоги написать SSR на Node.js' },
    { role: 'assistant', content: 'Конечно! Для этого нужно проверить User-Agent и отдать HTML.' }
  ];

  // JSON-LD (Schema.org) — структурированные данные для поисковиков.
  // Помогает Google/Yandex понять, что это за приложение, и показать rich-snippet.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    'name': 'Local AI PWA Chat Client',
    'description': 'Автономный SPA+PWA клиент для локальных ИИ-моделей.',
    'applicationCategory': 'DeveloperApplication',
    'operatingSystem': 'Any'
  };

  return `
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <title>Local AI Chat - Локальные модели</title>
      <meta name="description" content="Автономный чат с локальными нейросетями (Qwen, DeepSeek) через Ollama. Работает офлайн благодаря PWA.">
      
      <!-- Open Graph (превью в Telegram / соцсетях) -->
      <meta property="og:title" content="Local AI Chat">
      <meta property="og:description" content="Общайтесь с локальными ИИ-моделями прямо в браузере.">
      <meta property="og:type" content="website">
      <!-- ⚠️ Внешняя картинка с чужого CDN: в проде нужен свой ассет,
           иначе превью отвалится, если flaticon заблокирован/сменит URL. -->
      <meta property="og:image" content="https://cdn-icons-png.flaticon.com/512/1698/1698535.png">
      
      <!-- Микроразметка Schema.org (SEO) -->
      <script type="application/ld+json">
        ${JSON.stringify(jsonLd)}
      </script>

      <!-- Инлайн-стили: SSR-страница должна быть самодостаточной,
           без внешних CSS-запросов (краулеры не всегда их грузят). -->
      <style>
        body { font-family: sans-serif; background: #f4f6f9; color: #333; margin: 0; padding: 20px; }
        .container { max-width: 800px; margin: auto; background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        .msg { margin-bottom: 15px; padding: 10px 15px; border-radius: 8px; }
        .user { background: #e3f2fd; text-align: right; }
        .ai { background: #f5f5f5; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Local AI Chat</h1>
        <p>Этот текст видят поисковые боты. Пользователи видят интерактивное приложение.</p>
        <div id="messages">
          ${messages.map(m => `
            <div class="msg ${m.role === 'user' ? 'user' : 'ai'}">
              <!-- ⚠️ XSS-ЛОВУШКА: m.content вставляется как есть.
                   Если сообщение придёт из БД и будет содержать <script>,
                   краулер/бот его выполнит (или сохранит в индекс).
                   В проде — обязательно escapeHtml(m.content). -->
              <strong>${m.role === 'user' ? 'Вы' : 'Qwen'}:</strong> ${m.content}
            </div>
          `).join('')}
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Экранирует спецсимволы HTML. Нужна для безопасной вставки
 * пользовательских строк (сообщений, имён) в SSR-шаблон.
 *
 * ⚠️ Пока НЕ используется в renderSSR() — это следующее упражнение:
 * применить её к m.content и к sender. Оставлена как «заготовка»,
 * чтобы было куда двигаться.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}
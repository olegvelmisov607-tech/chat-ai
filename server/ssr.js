export function renderSSR() {
  // Для демо мы эмулируем данные. 
  // В реальном проекте здесь можно сделать запрос к БД (например, вытащить последние 5 сообщений).
  const messages = [
    { role: 'user', content: 'Привет! Как дела?' },
    { role: 'assistant', content: 'Привет! Я локальная ИИ-модель Qwen. Отлично, готов помочь с кодом!' },
    { role: 'user', content: 'Помоги написать SSR на Node.js' },
    { role: 'assistant', content: 'Конечно! Для этого нужно проверить User-Agent и отдать HTML.' }
  ];

  // Генерируем JSON-LD (Микроразметка для поисковиков)
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
      
      <!-- Open Graph (для Telegram / соцсетей) -->
      <meta property="og:title" content="Local AI Chat">
      <meta property="og:description" content="Общайтесь с локальными ИИ-моделями прямо в браузере.">
      <meta property="og:type" content="website">
      <meta property="og:image" content="https://cdn-icons-png.flaticon.com/512/1698/1698535.png">
      
      <!-- Микроразметка Schema.org (SEO) -->
      <script type="application/ld+json">
        ${JSON.stringify(jsonLd)}
      </script>

      <!-- Стили для красивого отображения в боте (без внешних зависимостей) -->
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
              <strong>${m.role === 'user' ? 'Вы' : 'Qwen'}:</strong> ${m.content}
            </div>
          `).join('')}
        </div>
      </div>
    </body>
    </html>
  `;
}
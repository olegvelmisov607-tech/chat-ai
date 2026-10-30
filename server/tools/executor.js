// server/tools/executor.js
import { config } from '../config.js';
import { budget } from '../budget.js';
import { mcpManager } from '../mcp-manager.js';
import { streamYandexSearch } from '../providers/yandex-search.js';

/**
 * Выполняет вызов инструмента (Tool Call).
 * Возвращает объект с результатом и возможными побочными эффектами (sources, alert).
 * 
 * @param {Object} toolCallData - Данные вызова от модели (id, function.name, function.arguments)
 * @param {AbortSignal} signal
 * @returns {Promise<{resultText: string, sources: Array, alert: string}>}
 */
export async function executeTool(toolCallData, signal) {
  const toolName = toolCallData.function.name;
  let args = {};
  
  try {
    args = JSON.parse(toolCallData.function.arguments);
  } catch (e) {
    // Модель может прислать невалидный JSON — работаем с пустыми аргументами.
  }

  let resultText = '';
  let sources = [];
  let alert = '';

  if (toolName === 'web_search') {
    // --- ЛОГИКА ПОИСКА С БЮДЖЕТОМ ---
    if (!budget.canUseCloud()) {
      return { 
        resultText: 'Поиск недоступен (дневной лимит исчерпан).', 
        sources: [], 
        alert: '⚠️ Дневной лимит поисковых запросов исчерпан. Отвечаю из своих знаний.' 
      };
    }

    budget.recordRequest();
    console.log(`[Budget] Потрачен 1 поисковый запрос. Остаток: ${budget.getStatus().remaining}`);

    const query = args.query || 'unknown';
    alert = `🔍 Ищу в интернете: "${query}"...`;

    try {
      for await (const sChunk of streamYandexSearch({
        query, 
        folderId: config.yandexSearch.folderId, 
        apiKey: config.yandexSearch.apiKey, 
        signal
      })) {
        if (sChunk.type === 'sources') sources = sChunk.data;
        if (sChunk.type === 'content') resultText += sChunk.text;
      }
    } catch (e) {
      resultText = `Ошибка поиска: ${e.message}`;
    }

  } else {
    // --- ЛОГИКА MCP-ИНСТРУМЕНТОВ ---
    alert = `🛠️ Выполняю ${toolName}...`;
    try {
      resultText = await mcpManager.callTool(toolName, args);
    } catch (err) {
      resultText = `Ошибка MCP: ${err.message}`;
    }
  }

  return { resultText, sources, alert };
}
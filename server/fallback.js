import { config, modelMap } from './config.js';
import { streamOpenAICompat } from './providers/openai-compat.js';
import { streamYandexSearch } from './providers/yandex-search.js';

const TOOLS = [{
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Ищет актуальную информацию в интернете. Используй, если нужны свежие данные, новости или ты не уверен в ответе.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Поисковый запрос' }
      },
      required: ['query']
    }
  }
}];

let cloudFailures = 0;
const FAILS_TO_OPEN = 2;
let breakerOpenUntil = 0;

export async function* streamWithFallback({ model, messages, temperature, signal, forceLocal = false }) {
  const mapping = modelMap[model] || modelMap['qwen'];
  
  const isCloudSupported = mapping.cloud !== null;
  const isCloudAvailable = !forceLocal && isCloudSupported && Date.now() > breakerOpenUntil && !!config.deepseek.apiKey;

  async function* runLLM(baseUrl, apiKey, llmModel, msgs, allowTools = true) {
    let toolCallData = null;
    let hasYieldedContent = false;

    for await (const chunk of streamOpenAICompat({
      baseUrl, apiKey, model: llmModel, messages: msgs, temperature, signal,
      tools: allowTools ? TOOLS : undefined 
    })) {
      if (chunk.type === 'tool_call') {
        toolCallData = chunk.toolCall;
        break; 
      }
      if (chunk.type === 'content' || chunk.type === 'reasoning') {
        hasYieldedContent = true;
        yield chunk;
      }
    }

    if (toolCallData) {
      let query = 'unknown';
      try {
        query = JSON.parse(toolCallData.function.arguments).query;
      } catch (e) {
        // JSON parse failed, query stays as default value
      }

      yield { type: 'system_alert', message: `🔍 Ищу в интернете: "${query}"...` };

      let searchResultText = '';
      let searchSources = [];
      
      try {
        for await (const sChunk of streamYandexSearch({
          query, folderId: config.yandexSearch.folderId, apiKey: config.yandexSearch.apiKey, signal
        })) {
          if (sChunk.type === 'sources') searchSources = sChunk.data;
          if (sChunk.type === 'content') searchResultText += sChunk.text;
        }
      } catch (e) {
        searchResultText = `Ошибка поиска: ${e.message}`;
      }

      if (searchSources.length > 0) {
        yield { type: 'sources', data: searchSources };
      }

      // ВАЖНО: Добавляем строгий системный промпт для ВТОРОГО прохода
      const secondMessages = [
        ...msgs,
        { role: 'assistant', content: null, tool_calls: [toolCallData] },
        { 
          role: 'system', 
          content: 'Вот результаты поиска в интернете. Твоя задача — внимательно прочитать их и написать краткий, прямой ответ пользователю. Выведи конкретные факты (например, температуру воздуха, погодные условия). НЕ ПИШИ инструкции, НЕ ПИШИ ссылки на сайты (система покажет их отдельно), НЕ ГОВОРИ "я могу найти". Просто возьми данные из текста ниже и ответь ими.' 
        },
        { role: 'tool', tool_call_id: toolCallData.id, content: searchResultText }
      ];

      // Второй проход (tools = false, чтобы не зациклилась)
      yield* runLLM(baseUrl, apiKey, llmModel, secondMessages, false); 
      return;
    }

    if (hasYieldedContent) return;
  }

  // 1. Пробуем Облако
  if (isCloudAvailable) {
    try {
      yield* runLLM(config.deepseek.baseUrl, config.deepseek.apiKey, mapping.cloud, messages, true);
      cloudFailures = 0;
      return;
    } catch (err) {
      if (err.status === 401 || err.status === 403) throw err;
      cloudFailures++;
      if (cloudFailures >= FAILS_TO_OPEN) breakerOpenUntil = Date.now() + 30000;
      
      yield { type: 'system_alert', message: `⚠️ Облако недоступно (${err.message}). Переход на локальную модель.` };
    }
  }

  // 2. Локальная модель (Ollama)
  yield { type: 'model_info', modelName: mapping.local };
  
  let localMessages = [...messages];
  
  if (forceLocal) {
    localMessages.unshift({
      role: 'system',
      content: 'КРИТИЧЕСКОЕ ПРАВИЛО: Доступ к интернету ЗАБЛОКИРОВАН (лимит). Отвечай только на основе своих знаний. Если нужны свежие данные (погода), скажи: "Извините, дневной лимит запросов к интернету исчерпан". КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать URL-адреса или названия сайтов.'
    });
  } else {
    localMessages.unshift({
      role: 'system',
      content: 'ВНИМАНИЕ: Ты — агент с доступом в интернет. Если пользователь спрашивает о погоде, новостях или актуальных данных, ты ОБЯЗАН немедленно вызвать инструмент web_search. НЕ ПЫТАЙСЯ отвечать из своих знаний и НЕ ПИШИ ссылки на сайты. Просто вызови инструмент.'
    });
  }

  try {
    yield* runLLM(config.ollama.baseUrl, null, mapping.local, localMessages, !forceLocal);
  } catch (err) {
    yield { type: 'error', message: `Ошибка локальной модели: ${err.message}` };
  }
}
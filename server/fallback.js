import { config, modelMap } from './config.js';
import { streamOpenAICompat } from './providers/openai-compat.js';
import { streamYandexSearch } from './providers/yandex-search.js';
import { budget } from './budget.js';
import { mcpManager } from './mcp-manager.js';

/**
 * Базовые (не-MCP) инструменты, доступные любой модели.
 * MCP-инструменты добавляются динамически в streamWithFallback().
 */
const BASE_TOOLS = [{
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Ищет актуальную информацию в интернете. Используй ТОЛЬКО если пользователь спрашивает о погоде, новостях, курсах валют, или событиях после 2024 года. НЕ ИСПОЛЬЗУЙ для простых вопросов, математики, программирования или приветствий.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Поисковый запрос' }
      },
      required: ['query']
    }
  }
}];

// --- Circuit Breaker для облака: после N подряд ошибок перестаём его дёргать на 30с ---
let cloudFailures = 0;
const FAILS_TO_OPEN = 2;
let breakerOpenUntil = 0;

/**
 * Основная функция маршрутизации: пробует облако (DeepSeek), при неудаче — локальную (Ollama).
 * Обрабатывает tool calling (web_search + MCP) с повторным проходом модели для ответа.
 *
 * @param {Object} params
 * @param {string} params.model
 * @param {Array<Object>} params.messages
 * @param {number} params.temperature
 * @param {AbortSignal} [params.signal]
 * @param {boolean} [params.forceLocal=false] - Принудительно локальную (например, бюджет исчерпан).
 */
export async function* streamWithFallback({ model, messages, temperature, signal, forceLocal = false }) {
  const mapping = modelMap[model] || modelMap['qwen'];
  
  const isCloudSupported = mapping.cloud !== null;
  const isCloudAvailable = !forceLocal && isCloudSupported && Date.now() > breakerOpenUntil && !!config.deepseek.apiKey;

  // MCP-инструменты запрашиваем у менеджера (он агрегирует все подключённые серверы).
  const mcpTools = await mcpManager.getAllToolsAsOpenAI();
  const ALL_TOOLS = [...BASE_TOOLS, ...mcpTools];

  /**
   * Внутренний генератор: один "проход" модели + обработка tool_call, если он случился.
   * @param {string} baseUrl
   * @param {string|null} apiKey
   * @param {string} llmModel
   * @param {Array<Object>} msgs
   * @param {boolean} [allowTools=true]
   */
  async function* runLLM(baseUrl, apiKey, llmModel, msgs, allowTools = true) {
    let toolCallData = null;
    let hasYieldedContent = false;

    for await (const chunk of streamOpenAICompat({
      baseUrl, apiKey, model: llmModel, messages: msgs, temperature, signal,
      tools: allowTools ? ALL_TOOLS : undefined 
    })) {
      if (chunk.type === 'tool_call') {
        // Модель решила вызвать инструмент — прерываем стрим и обрабатываем вызов.
        toolCallData = chunk.toolCall;
        break; 
      }
      if (chunk.type === 'content' || chunk.type === 'reasoning') {
        hasYieldedContent = true;
        yield chunk;
      }
    }

    // --- ОБРАБОТКА TOOL CALL ---
    if (toolCallData) {
      const toolName = toolCallData.function.name;
      let args = {};
      try {
        args = JSON.parse(toolCallData.function.arguments);
      } catch (e) {
        // Модель может прислать невалидный JSON — работаем с пустыми аргументами.
      }

      let toolResultText = '';
      let shouldCallSearch = false;

      if (toolName === 'web_search') {
        shouldCallSearch = true;
      } else {
        // Всё остальное считаем MCP-инструментом (read_file, write_file и т.д.)
        yield { type: 'system_alert', message: `🛠️ Выполняю ${toolName}...` };
        try {
          toolResultText = await mcpManager.callTool(toolName, args);
        } catch (err) {
          toolResultText = `Ошибка MCP: ${err.message}`;
        }
      }

      if (shouldCallSearch) {
        // --- ПОИСК С БЮДЖЕТОМ ---
        if (!budget.canUseCloud()) {
          yield { type: 'system_alert', message: '⚠️ Дневной лимит поисковых запросов исчерпан. Отвечаю из своих знаний.' };
          
          // Второй проход БЕЗ инструментов: модель должна ответить из своих знаний.
          const secondMessages = [
            ...msgs,
            { role: 'assistant', content: null, tool_calls: [toolCallData] },
            { role: 'system', content: 'Поиск недоступен (лимит). Ответь на основе своих знаний.' }
          ];
          yield* runLLM(baseUrl, apiKey, llmModel, secondMessages, false);
          return;
        }

        budget.recordRequest();
        console.log(`[Budget] Потрачен 1 поисковый запрос. Остаток: ${budget.getStatus().remaining}`);

        const query = args.query || 'unknown';
        yield { type: 'system_alert', message: `🔍 Ищу в интернете: "${query}"...` };

        let searchSources = [];
        try {
          for await (const sChunk of streamYandexSearch({
            query, folderId: config.yandexSearch.folderId, apiKey: config.yandexSearch.apiKey, signal
          })) {
            if (sChunk.type === 'sources') searchSources = sChunk.data;
            if (sChunk.type === 'content') toolResultText += sChunk.text;
          }
        } catch (e) {
          toolResultText = `Ошибка поиска: ${e.message}`;
        }

        if (searchSources.length > 0) {
          yield { type: 'sources', data: searchSources };
        }
      }

      // --- ВТОРОЙ ПРОХОД: отдаём модели результат инструмента ---
      // ВАЖНО: инструменты отключены (false) — модель не должна зациклиться на новых вызовах.
      const secondMessages = [
        ...msgs,
        { role: 'assistant', content: null, tool_calls: [toolCallData] },
        { 
          role: 'system', 
          content: shouldCallSearch 
            ? 'Вот результаты поиска в интернете. Твоя задача — внимательно прочитать их и написать краткий, прямой ответ пользователю. Выведи конкретные факты. НЕ ПИШИ инструкции, НЕ ПИШИ ссылки на сайты (система покажет их отдельно). Просто возьми данные из текста ниже и ответь ими.'
            : `Вот результат выполнения инструмента ${toolName}. Используй его для ответа пользователю.`
        },
        { role: 'tool', tool_call_id: toolCallData.id, content: toolResultText }
      ];

      yield* runLLM(baseUrl, apiKey, llmModel, secondMessages, false); 
      return;
    }

    if (hasYieldedContent) return;
  }

  // --- 1. Пробуем облако ---
  if (isCloudAvailable) {
    try {
      yield* runLLM(config.deepseek.baseUrl, config.deepseek.apiKey, mapping.cloud, messages, true);
      cloudFailures = 0; // успех — сбрасываем breaker
      return;
    } catch (err) {
      if (err.name === 'AbortError') throw err; 
      if (err.status === 401 || err.status === 403) throw err; // авторизация — не наша проблема

      cloudFailures++;
      if (cloudFailures >= FAILS_TO_OPEN) breakerOpenUntil = Date.now() + 30000;
      
      yield { type: 'system_alert', message: `⚠️ Облако недоступно (${err.message}). Переход на локальную модель.` };
    }
  }

  // --- 2. Локальная модель (Ollama) ---
  yield { type: 'model_info', modelName: mapping.local };
  
  let localMessages = [...messages];
  
  if (forceLocal) {
    // Бюджет исчерпан: жёстко запрещаем модели упоминать интернет.
    localMessages.unshift({
      role: 'system',
      content: 'КРИТИЧЕСКОЕ ПРАВИЛО: Доступ к интернету ЗАБЛОКИРОВАН (лимит). Отвечай только на основе своих знаний. Если нужны свежие данные (погода), скажи: "Извините, дневной лимит запросов к интернету исчерпан". КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать URL-адреса или названия сайтов.'
    });
  } else {
    localMessages.unshift({
      role: 'system',
      content: `Ты — умный ИИ-ассистент. У тебя есть доступ к инструментам (поиск, файловая система и т.д.).
      
ВАЖНО: НЕ ИСПОЛЬЗУЙ теги <think> в своих ответах. Пиши обычным текстом.
      
ПРАВИЛА ИСПОЛЬЗОВАНИЯ ПОИСКА:
1. НИКОГДА не вызывай web_search, если пользователь просто здоровается, пишет бессмысленный набор букв/цифр (например, "123", "привет") или задает вопрос, на который ты точно знаешь ответ из своих знаний (например, "сколько будет 2+2", "напиши код на Python").
2. ОБЯЗАТЕЛЬНО вызывай web_search, если пользователь спрашивает про:
   - Погоду (сегодня, завтра, сейчас).
   - Новости (что случилось, последние события).
   - Курсы валют, акции.
   - Любые события, которые произошли после твоего последнего обновления (2024 год).
3. Если ты сомневаешься, нужен ли поиск, сначала попробуй ответить своими знаниями. И только если не уверен — вызывай инструмент.

Отвечай кратко, по делу, на русском языке.`
    });
  }

  // --- ЯДЕРНЫЙ ВАРИАНТ: для Qwen инструменты передаём только если запрос "серьёзный" ---
  // Причина: локальная модель при виде инструментов пытается вызвать их даже на "привет".
  const lastUserMsg = messages[messages.length - 1];
  const userText = typeof lastUserMsg.content === 'string' ? lastUserMsg.content : '';
  const searchTriggers = /(погод|новост|курс|доллар|евро|сейчас|сегодня|завтра|пробк|авари|трафик|происшеств|что случилось)/i;
  const hasTrigger = searchTriggers.test(userText);
  const allowToolsForLocal = !forceLocal && (userText.length > 15 || hasTrigger);

  try {
    yield* runLLM(config.ollama.baseUrl, null, mapping.local, localMessages, allowToolsForLocal);
  } catch (err) {
    if (err.name === 'AbortError') throw err; 
    yield { type: 'error', message: `Ошибка локальной модели: ${err.message}` };
  }
}
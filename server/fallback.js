// server/fallback.js
import { config, modelMap } from './config.js';
import { getProvider } from './providers/registry.js';
import { mcpManager } from './mcp-manager.js';
import { executeTool } from './tools/executor.js';

/**
 * Базовые (не-MCP) инструменты, доступные любой модели.
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

// --- Circuit Breaker для облака ---
let cloudFailures = 0;
const FAILS_TO_OPEN = 2;
let breakerOpenUntil = 0;

/**
 * Основная функция маршрутизации: пробует облако, при неудаче — локальную.
 * Обрабатывает tool calling (web_search + MCP) с повторным проходом модели.
 */
export async function* streamWithFallback({ model, messages, temperature, signal, forceLocal = false }) {
  const mapping = modelMap[model] || modelMap['qwen'];
  
  const isCloudSupported = mapping.cloud !== null;
  const isCloudAvailable = !forceLocal && isCloudSupported && Date.now() > breakerOpenUntil && !!config.deepseek.apiKey;

  // MCP-инструменты запрашиваем у менеджера
  const mcpTools = await mcpManager.getAllToolsAsOpenAI();
  const ALL_TOOLS = [...BASE_TOOLS, ...mcpTools];

  /**
   * Внутренний генератор: один "проход" модели + обработка tool_call.
   */
  async function* runLLM(providerName, llmModel, msgs, allowTools = true) {
    let toolCallData = null;
    let hasYieldedContent = false;

    const provider = getProvider(providerName);
    
    for await (const chunk of provider.stream({
      model: llmModel, 
      messages: msgs, 
      temperature, 
      signal,
      tools: allowTools ? ALL_TOOLS : undefined 
    })) {
      if (chunk.type === 'tool_call') {
        toolCallData = chunk.toolCall;
        break; // Прерываем стрим, чтобы обработать инструмент
      }
      if (chunk.type === 'content' || chunk.type === 'reasoning') {
        hasYieldedContent = true;
        yield chunk;
      }
    }

    // --- ОБРАБОТКА TOOL CALL ---
    if (toolCallData) {
      const { resultText, sources, alert } = await executeTool(toolCallData, signal);
      
      if (alert) yield { type: 'system_alert', message: alert };
      if (sources.length > 0) yield { type: 'sources', data: sources };

      // --- ВТОРОЙ ПРОХОД: отдаём модели результат инструмента ---
      const secondMessages = [
        ...msgs,
        { role: 'assistant', content: null, tool_calls: [toolCallData] },
        { 
          role: 'system', 
          content: toolCallData.function.name === 'web_search'
            ? 'Вот результаты поиска в интернете. Твоя задача — внимательно прочитать их и написать краткий, прямой ответ пользователю. Выведи конкретные факты. НЕ ПИШИ инструкции, НЕ ПИШИ ссылки на сайты (система покажет их отдельно). Просто возьми данные из текста ниже и ответь ими.'
            : `Вот результат выполнения инструмента ${toolCallData.function.name}. Используй его для ответа пользователю.`
        },
        { role: 'tool', tool_call_id: toolCallData.id, content: resultText }
      ];

      yield* runLLM(providerName, llmModel, secondMessages, false); 
      return;
    }

    if (hasYieldedContent) return;
  }

  // --- 1. Пробуем облако ---
  if (isCloudAvailable) {
    try {
      yield* runLLM('deepseek', mapping.cloud, messages, true);
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
  const lastUserMsg = messages[messages.length - 1];
  const userText = typeof lastUserMsg.content === 'string' ? lastUserMsg.content : '';
  const searchTriggers = /(погод|новост|курс|доллар|евро|сейчас|сегодня|завтра|пробк|авари|трафик|происшеств|что случилось)/i;
  const hasTrigger = searchTriggers.test(userText);
  const allowToolsForLocal = !forceLocal && (userText.length > 15 || hasTrigger);

  try {
    yield* runLLM('ollama', mapping.local, localMessages, allowToolsForLocal);
  } catch (err) {
    if (err.name === 'AbortError') throw err; 
    yield { type: 'error', message: `Ошибка локальной модели: ${err.message}` };
  }
}
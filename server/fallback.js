import { config, modelMap } from './config.js';
import { streamOpenAICompat } from './providers/openai-compat.js';
import { streamYandexSearch } from './providers/yandex-search.js';
import { budget } from './budget.js'; // <-- ИМПОРТ БЮДЖЕТА

const TOOLS = [{
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

let cloudFailures = 0;
const FAILS_TO_OPEN = 2;
let breakerOpenUntil = 0;

export async function* streamWithFallback({ model, messages, temperature, signal, forceLocal = false }) {
  const mapping = modelMap[model] || modelMap['qwen'];
  
  const isCloudSupported = mapping.cloud !== null;
  // Бюджет больше не влияет на доступность облака, только на доступность поиска
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
        // ignore
      }

      // --- СПИСЫВАЕМ БЮДЖЕТ ТОЛЬКО ЗДЕСЬ, ПЕРЕД РЕАЛЬНЫМ ПОИСКОМ ---
      if (!budget.canUseCloud()) {
        // Если бюджета нет, но модель все равно дернула поиск
        yield { type: 'system_alert', message: '⚠️ Дневной лимит поисковых запросов исчерпан. Отвечаю из своих знаний.' };
        
        const secondMessages = [
          ...msgs,
          { role: 'assistant', content: null, tool_calls: [toolCallData] },
          { role: 'system', content: 'Поиск недоступен (лимит). Ответь на основе своих знаний.' }
        ];
        yield* runLLM(baseUrl, apiKey, llmModel, secondMessages, false);
        return;
      }

      budget.recordRequest(); // Списываем 1 запрос к Яндексу
      console.log(`[Budget] Потрачен 1 поисковый запрос. Остаток: ${budget.getStatus().remaining}`);

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

      const secondMessages = [
        ...msgs,
        { role: 'assistant', content: null, tool_calls: [toolCallData] },
        { 
          role: 'system', 
          content: 'Вот результаты поиска в интернете. Твоя задача — внимательно прочитать их и написать краткий, прямой ответ пользователю. Выведи конкретные факты (например, температуру воздуха, погодные условия). НЕ ПИШИ инструкции, НЕ ПИШИ ссылки на сайты (система покажет их отдельно), НЕ ГОВОРИ "я могу найти". Просто возьми данные из текста ниже и ответь ими.' 
        },
        { role: 'tool', tool_call_id: toolCallData.id, content: searchResultText }
      ];

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
      if (err.name === 'AbortError') throw err; 

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
      content: `Ты — умный ИИ-ассистент. У тебя есть доступ к инструменту web_search (поиск в интернете).
      
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

  // --- ЯДЕРНЫЙ ВАРИАНТ: Проверка на триггерные слова ---
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
import { config, modelMap } from './config.js';
import { streamOpenAICompat } from './providers/openai-compat.js';

let cloudFailures = 0;
const FAILS_TO_OPEN = 2;
let breakerOpenUntil = 0;

// ДОБАВЛЕНО: temperature в аргументах
export async function* streamWithFallback({ model, messages, temperature, signal }) {
  const mapping = modelMap[model] || modelMap['qwen'];
  const isCloudAvailable = Date.now() > breakerOpenUntil && !!config.deepseek.apiKey;

  if (isCloudAvailable) {
    try {
      yield* streamOpenAICompat({
        baseUrl: config.deepseek.baseUrl,
        apiKey: config.deepseek.apiKey,
        model: mapping.cloud,
        messages,
        temperature, // ДОБАВЛЕНО
        signal
      });
      cloudFailures = 0;
      return;
    } catch (err) {
      if (err.status === 401 || err.status === 403) throw err;
      
      cloudFailures++;
      if (cloudFailures >= FAILS_TO_OPEN) {
        breakerOpenUntil = Date.now() + 30000;
        console.warn('[Fallback] Cloud circuit breaker opened for 30s');
      }
      
      console.warn(`[Fallback] Cloud failed (${err.message}). Switching to local...`);
      
      let reason = 'Облачный API временно недоступен.';
      if (err.message === 'fetch failed') {
        reason = 'Нет соединения с интернетом или серверы DeepSeek заблокированы.';
      } else if (err.message === 'HTTP_402' || err.message === 'HTTP_400') {
        reason = 'Проблема с балансом или ключом DeepSeek.';
      } else if (err.message === 'HTTP_429') {
        reason = 'Превышен лимит запросов к DeepSeek.';
      } else if (err.message.startsWith('HTTP_5')) {
        reason = 'Ошибка на стороне серверов DeepSeek.';
      }

      yield { type: 'system_alert', message: `${reason} Переключено на локальную модель.` };
      
      yield* streamOpenAICompat({
        baseUrl: config.ollama.baseUrl,
        apiKey: null,
        model: mapping.local,
        messages,
        temperature, // ДОБАВЛЕНО
        signal
      });
      return;
    }
  } else {
      let reason = !config.deepseek.apiKey 
        ? 'API-ключ DeepSeek не найден.' 
        : 'Серверы DeepSeek временно недоступны (сработал Circuit Breaker).';
      yield { type: 'system_alert', message: `${reason} Переключено на локальную модель.` };
  }

  yield* streamOpenAICompat({
    baseUrl: config.ollama.baseUrl,
    apiKey: null,
    model: mapping.local,
    messages,
    temperature, // ДОБАВЛЕНО
    signal
  });
}
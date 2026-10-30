// server/providers/registry.js
import { streamOpenAICompat } from './openai-compat.js';
import { streamYandexSearch } from './yandex-search.js';

const providers = new Map();

export function registerProvider(name, provider) {
  providers.set(name, provider);
}

export function getProvider(name) {
  const p = providers.get(name);
  if (!p) throw new Error(`Provider "${name}" not registered`);
  return p;
}

export function listProviders() {
  return [...providers.keys()];
}

// --- Регистрация твоих текущих провайдеров ---

// 1. DeepSeek (Облако)
registerProvider('deepseek', {
  name: 'deepseek',
  stream: (params) => streamOpenAICompat({
    baseUrl: process.env.DEEPSEEK_BASE_URL,
    apiKey: process.env.DEEPSEEK_API_KEY,
    ...params
  })
});

// 2. Ollama (Локальная)
registerProvider('ollama', {
  name: 'ollama',
  stream: (params) => streamOpenAICompat({
    baseUrl: process.env.OLLAMA_BASE_URL,
    apiKey: null,
    ...params
  })
});

// 3. Yandex Search (Поиск)
registerProvider('yandex-search', {
  name: 'yandex-search',
  stream: (params) => streamYandexSearch({
    query: params.messages.at(-1).content,
    folderId: process.env.YANDEX_FOLDER_ID,
    apiKey: process.env.YANDEX_SEARCH_API_KEY,
    signal: params.signal
  })
});
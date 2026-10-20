import 'dotenv/config.js';

export const config = {
  port: process.env.PORT || 3000,
  maxBodySize: 15 * 1024 * 1024, // 15MB лимит (Base64 картинки весят много)
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  },
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1',
  },
};

export const modelMap = {
  'qwen': {
    cloud: 'deepseek-chat',
    local: 'qwen3:8b'
  },
  'deepseek-r1': {
    cloud: 'deepseek-reasoner',
    local: 'deepseek-r1:7b'
  },
  // ДОБАВЛЕНО: Специальный ключ для Vision (картинки)
  'vision': {
    cloud: null, // DeepSeek не поддерживает картинки
    local: 'gemma3:12b' // Твоя локальная Vision-модель
  }
};
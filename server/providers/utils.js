// server/providers/utils.js

/**
 * DRY принцип
 * Эмулирует стриминг для ответов, пришедших единым JSON.
 * Разбивает текст на "слова" и отдаёт по одному — чтобы UI печатал плавно.
 * @param {string} text
 * @param {number} [delay=20] - Задержка между словами (мс)
 */
export async function* emulateStream(text, delay = 20) {
  if (!text) return;
  const chunks = text.match(/\S+\s*/g) || [text];
  for (const chunk of chunks) {
    yield { type: 'content', text: chunk };
    await new Promise(r => setTimeout(r, delay)); 
  }
}
// src/ui/renderer.js
//
// Отвечает ТОЛЬКО за безопасный рендеринг текста в DOM.
// Не знает про пузыри сообщений, тосты, кнопки.
//
// Ключевая идея безопасности: ЛЮБОЙ текст от модели или пользователя
// проходит через DOMPurify перед вставкой в DOM.

import hljs from 'highlight.js';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Парсит текст на смесь markdown и ```code-блоков``` и добавляет результат в target.
 * @param {HTMLElement} target
 * @param {string} text
 */
function appendTextWithCode(target, text) {
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)(```|$)/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // --- 1. Текст ДО code-блока ---
    const textBefore = text.substring(lastIndex, match.index);
    if (textBefore) {
      const html = marked.parse(textBefore);
      const cleanHtml = DOMPurify.sanitize(html);
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = cleanHtml;
      while (tempDiv.firstChild) {
        target.appendChild(tempDiv.firstChild);
      }
    }

    // --- 2. Сам code-блок ---
    const language = match[1] || 'javascript';
    const code = match[2];
    const isClosed = match[3] === '```';

    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');

    if (isClosed) {
      try {
        const highlighted = hljs.highlight(code, { language }).value;
        codeEl.innerHTML = highlighted;
        codeEl.className = `hljs language-${language}`;
      } catch {
        codeEl.textContent = code;
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'code-wrapper';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-code-btn';
      copyBtn.textContent = 'Копировать';
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(code);
        copyBtn.textContent = 'Скопировано!';
        setTimeout(() => copyBtn.textContent = 'Копировать', 2000);
      };

      pre.appendChild(codeEl);
      wrapper.appendChild(copyBtn);
      wrapper.appendChild(pre);
      target.appendChild(wrapper);
    } else {
      codeEl.textContent = code;
      codeEl.className = `hljs language-${language}`;
      pre.appendChild(codeEl);
      target.appendChild(pre);
    }
    
    lastIndex = codeBlockRegex.lastIndex;
    if (!isClosed) break;
  }

  // --- 3. Текст ПОСЛЕ последнего code-блока ---
  const textAfter = text.substring(lastIndex);
  if (textAfter) {
    const html = marked.parse(textAfter);
    const cleanHtml = DOMPurify.sanitize(html);
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = cleanHtml;
    while (tempDiv.firstChild) {
      target.appendChild(tempDiv.firstChild);
    }
  }
}

/**
 * Безопасно рендерит сообщение в контейнер.
 * @param {HTMLElement} container
 * @param {string} text
 * @param {string|null} [imageBase64]
 */
export function renderTextSafely(container, text, imageBase64 = null) {
  container.innerHTML = '';
  
  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'message-content';
  container.appendChild(contentWrapper);

  if (imageBase64) {
    const img = document.createElement('img');
    img.src = imageBase64;
    contentWrapper.appendChild(img);
  }

  if (!text) return;

  const parts = text.split(/(<\/?think>)/g);
  let currentTarget = contentWrapper;

  parts.forEach(part => {
    if (part === '<think>') {
      const thoughtDiv = document.createElement('div');
      thoughtDiv.className = 'thought';
      const strong = document.createElement('strong');
      strong.textContent = 'Рассуждение:';
      thoughtDiv.appendChild(strong);
      thoughtDiv.appendChild(document.createElement('br'));
      currentTarget = thoughtDiv;
      contentWrapper.appendChild(thoughtDiv); 
    } else if (part === '</think>') {
      currentTarget = contentWrapper;
    } else if (part) {
      appendTextWithCode(currentTarget, part);
    }
  });
}
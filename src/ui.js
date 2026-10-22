// src/ui.js
import hljs from 'highlight.js';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Хелпер для парсинга текста и поиска блоков кода
function appendTextWithCode(target, text) {
  // Регулярка ищет ```язык ... код ... ```
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)(```|$)/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Добавляем обычный текст (с Markdown) до блока кода
    const textBefore = text.substring(lastIndex, match.index);
    if (textBefore) {
      // --- МАГИЯ MARKDOWN ---
      const html = marked.parse(textBefore);
      const cleanHtml = DOMPurify.sanitize(html);
      
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = cleanHtml;
      
      while (tempDiv.firstChild) {
        target.appendChild(tempDiv.firstChild);
      }
    }

    const language = match[1] || 'javascript';
    const code = match[2];
    const isClosed = match[3] === '```';

    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');

    if (isClosed) {
      // Блок закрыт — подсвечиваем синтаксис
      try {
        const highlighted = hljs.highlight(code, { language }).value;
        codeEl.innerHTML = highlighted;
        codeEl.className = `hljs language-${language}`;
      } catch (e) {
        codeEl.textContent = code;
      }

      // Создаем обертку и кнопку "Копировать"
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
      // Блок еще не закрыт (идет стриминг) — выводим как обычный текст
      codeEl.textContent = code;
      codeEl.className = `hljs language-${language}`;
      pre.appendChild(codeEl);
      target.appendChild(pre);
    }
    
    lastIndex = codeBlockRegex.lastIndex;
    
    // Если блок не закрыт, прерываем цикл и ждем следующий чанк
    if (!isClosed) break;
  }

  // Добавляем остаток текста после последнего блока кода
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

  // Парсим теги <think>
  const parts = text.split(/(<\/?think>)/g);
  let isThought = false;
  let currentTarget = contentWrapper;

  parts.forEach(part => {
    if (part === '<think>') {
      isThought = true;
      const thoughtDiv = document.createElement('div');
      thoughtDiv.className = 'thought';
      const strong = document.createElement('strong');
      strong.textContent = 'Рассуждение:';
      thoughtDiv.appendChild(strong);
      thoughtDiv.appendChild(document.createElement('br'));
      currentTarget = thoughtDiv;
      contentWrapper.appendChild(thoughtDiv); 
    } else if (part === '</think>') {
      isThought = false;
      currentTarget = contentWrapper;
    } else if (part) {
      // Внутри каждого куска ищем блоки кода и Markdown
      appendTextWithCode(currentTarget, part);
    }
  });
}

export function createMessageElement(sender, className, chatMessagesContainer) {
  const messageElement = document.createElement('div');
  messageElement.className = `message ${className}`;
  
  const label = document.createElement('strong');
  label.textContent = `${sender}: `;
  messageElement.appendChild(label);

  const textContainer = document.createElement('div');
  messageElement.appendChild(textContainer);

  chatMessagesContainer.appendChild(messageElement);
  chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
  return textContainer;
}

export function appendStaticMessage(sender, text, className, imageBase64 = null, chatMessagesContainer) {
  const textContainer = createMessageElement(sender, className, chatMessagesContainer);
  renderTextSafely(textContainer, text, imageBase64);
  chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

// --- УВЕДОМЛЕНИЯ (TOAST) ---
export function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 100);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// --- УПРАВЛЕНИЕ КНОПКОЙ ОТПРАВКИ ---
export function updateSendButtonState(userInput, sendBtn, hasImage) {
  const hasText = userInput.value.trim().length > 0;
  sendBtn.disabled = !(hasText || hasImage);
}
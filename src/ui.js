// src/ui.js
import hljs from 'highlight.js';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

function appendTextWithCode(target, text) {
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)(```|$)/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
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

export function updateSendButtonState(userInput, sendBtn, hasImage) {
  const hasText = userInput.value.trim().length > 0;
  sendBtn.disabled = !(hasText || hasImage);
}

// --- ИСТОЧНИКИ В СТИЛЕ GEMINI ---
export function renderSources(container, sources) {
  if (!sources || sources.length === 0) return;

  const oldSources = container.querySelector('.sources-container');
  if (oldSources) oldSources.remove();

  const sourcesWrapper = document.createElement('div');
  sourcesWrapper.className = 'sources-container';

  const title = document.createElement('div');
  title.className = 'sources-title';
  title.textContent = 'Источники';
  sourcesWrapper.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'sources-grid';

  sources.forEach(s => {
    const a = document.createElement('a');
    a.href = s.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'source-card';

    let domain = '';
    try {
      domain = new URL(s.url).hostname.replace('www.', '');
    } catch (e) {
      domain = 'Сайт';
    }

    const favicon = document.createElement('img');
    favicon.className = 'source-favicon';
    favicon.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    favicon.alt = '';
    
    const info = document.createElement('div');
    info.className = 'source-info';
    
    const domainEl = document.createElement('span');
    domainEl.className = 'source-domain';
    domainEl.textContent = domain;
    
    const titleEl = document.createElement('span');
    titleEl.className = 'source-title';
    titleEl.textContent = DOMPurify.sanitize(s.title || s.url);

    info.appendChild(domainEl);
    info.appendChild(titleEl);

    a.appendChild(favicon);
    a.appendChild(info);
    grid.appendChild(a);
  });

  sourcesWrapper.appendChild(grid);
  container.appendChild(sourcesWrapper);
}

/**
 * Переключает кнопку отправки в режим STOP (во время генерации)
 * или возвращает в обычный режим.
 */
export function toggleSendButtonToStop(sendBtn, isGenerating) {
  if (isGenerating) {
    sendBtn.disabled = false; // Разблокируем, чтобы можно было нажать
    sendBtn.classList.add('is-stop');
    
    // Меняем текст/иконки
    const btnText = sendBtn.querySelector('.btn-text');
    const btnIcon = sendBtn.querySelector('.btn-icon');
    const btnIconStop = sendBtn.querySelector('.btn-icon-stop');
    
    if (btnText) btnText.textContent = 'Остановить';
    if (btnIcon) btnIcon.style.display = 'none';
    if (btnIconStop) btnIconStop.style.display = 'block';
  } else {
    sendBtn.classList.remove('is-stop');
    
    const btnText = sendBtn.querySelector('.btn-text');
    const btnIcon = sendBtn.querySelector('.btn-icon');
    const btnIconStop = sendBtn.querySelector('.btn-icon-stop');
    
    if (btnText) btnText.textContent = 'Отправить';
    // Восстанавливаем иконку (на мобилках покажется ➤, на десктопе скроется стилями)
    if (btnIcon) btnIcon.style.display = 'block'; 
    if (btnIconStop) btnIconStop.style.display = 'none';
    
    // Кнопка вернет свою обычную блокировку через updateSendButtonState
  }
}
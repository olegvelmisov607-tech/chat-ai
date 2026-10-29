// src/ui.js
//
// Слой отображения: рендер сообщений (markdown + code + reasoning), тосты,
// карточки источников, состояние кнопки отправки.
//
// Ключевая идея безопасности: ЛЮБОЙ текст от модели или пользователя
// проходит через DOMPurify перед вставкой в DOM. Мы не используем innerHTML
// напрямую на «сырых» строках — только на уже очищенном HTML.

import hljs from 'highlight.js';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Парсит текст на смесь markdown и ```code-блоков``` и добавляет результат в target.
 *
 * Зачем не просто `marked.parse(text)`:
 *  - нужна подсветка кода через highlight.js;
 *  - нужна кнопка «Копировать» у каждого блока;
 *  - незакрытый ``` (стриминг ещё идёт) должен отображаться как обычный <pre>,
 *    а не ломать весь остальной рендер.
 *
 * @param {HTMLElement} target - контейнер, куда добавлять узлы
 * @param {string} text - сырой текст от модели
 */
function appendTextWithCode(target, text) {
  // Регулярка ищет ```lang\n...``` ИЛИ ```lang\n...<конец строки> (незакрытый блок).
  // ⚠️ Ловушка: `(\w*)` не матчит языки с дефисом/плюсом (c++, objective-c, c#),
  // а `([\s\S]*?)` ленивая — на очень больших текстах может быть медленной.
  // Для учебного проекта ок, для прода — нормальный парсер (markdown-it с плагином).
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)(```|$)/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // --- 1. Текст ДО code-блока: рендерим как markdown ---
    const textBefore = text.substring(lastIndex, match.index);
    if (textBefore) {
      const html = marked.parse(textBefore);
      const cleanHtml = DOMPurify.sanitize(html);
      
      // Создаём временный div, чтобы «рассыпать» очищенный HTML в target
      // без потери обработчиков (здесь их нет, но паттерн полезный).
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = cleanHtml;
      
      while (tempDiv.firstChild) {
        target.appendChild(tempDiv.firstChild);
      }
    }

    // --- 2. Сам code-блок ---
    const language = match[1] || 'javascript';
    const code = match[2];
    const isClosed = match[3] === '```'; // закрыт ли блок (важно при стриминге)

    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');

    if (isClosed) {
      // Закрытый блок: подсвечиваем и добавляем кнопку «Копировать».
      try {
        const highlighted = hljs.highlight(code, { language }).value;
        // ⚠️ innerHTML здесь безопасен, потому что highlight.js экранирует
        // спецсимволы и возвращает только <span class="hljs-...">.
        // Но это ЕДИНСТВЕННОЕ место, где мы кладём innerHTML без DOMPurify —
        // важно, чтобы это оставалось осознанным решением, а не привычкой.
        codeEl.innerHTML = highlighted;
        codeEl.className = `hljs language-${language}`;
      } catch {
        // Неизвестный язык — просто текст без подсветки.
        codeEl.textContent = code;
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'code-wrapper';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-code-btn';
      copyBtn.textContent = 'Копировать';
      copyBtn.onclick = () => {
        // ⚠️ navigator.clipboard требует secure context (https или localhost).
        // На http://192.168.x.x не сработает — стоит добавить fallback
        // через document.execCommand('copy') или хотя бы показать ошибку.
        navigator.clipboard.writeText(code);
        copyBtn.textContent = 'Скопировано!';
        setTimeout(() => copyBtn.textContent = 'Копировать', 2000);
      };

      pre.appendChild(codeEl);
      wrapper.appendChild(copyBtn);
      wrapper.appendChild(pre);
      target.appendChild(wrapper);
    } else {
      // Незакрытый блок (стриминг ещё идёт): просто <pre> с текстом.
      // Кнопку «Копировать» не показываем — код ещё не дописан.
      codeEl.textContent = code;
      codeEl.className = `hljs language-${language}`;
      pre.appendChild(codeEl);
      target.appendChild(pre);
    }
    
    lastIndex = codeBlockRegex.lastIndex;
    // Если блок не закрыт — останавливаемся: всё, что после, уже часть кода.
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
 *
 * Поддерживает:
 *  - изображение (base64) над текстом;
 *  - markdown + code-блоки;
 *  - блоки <think>...</think> — рендерятся отдельным блоком «Рассуждение».
 *
 * @param {HTMLElement} container - куда рендерить (обычно textContainer из createMessageElement)
 * @param {string} text - сырой текст сообщения
 * @param {string|null} [imageBase64] - data-URL изображения, если есть
 */
export function renderTextSafely(container, text, imageBase64 = null) {
  // Полная перерисовка контейнера. При стриминге это вызывается на каждый чанк —
  // ⚠️ неэффективно (пересоздаём весь DOM), но просто и предсказуемо.
  // Для длинных ответов стоит подумать о диффе или инкрементальном апдейте.
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

  // Разбиваем текст на сегменты «внутри think» и «вне think».
  // split с capturing group возвращает сами разделители в массиве —
  // это позволяет одним проходом переключать target.
  const parts = text.split(/(<\/?think>)/g);
  let currentTarget = contentWrapper;

  parts.forEach(part => {
    if (part === '<think>') {
      // Открываем блок рассуждения.
      const thoughtDiv = document.createElement('div');
      thoughtDiv.className = 'thought';
      const strong = document.createElement('strong');
      strong.textContent = 'Рассуждение:';
      thoughtDiv.appendChild(strong);
      thoughtDiv.appendChild(document.createElement('br'));
      currentTarget = thoughtDiv;
      contentWrapper.appendChild(thoughtDiv); 
    } else if (part === '</think>') {
      // Закрываем — возвращаемся в основной контейнер.
      currentTarget = contentWrapper;
    } else if (part) {
      // Обычный сегмент: рендерим markdown+code в текущий target.
      appendTextWithCode(currentTarget, part);
    }
  });
}

/**
 * Создаёт «пустой» пузырь сообщения (label + textContainer) и добавляет его в чат.
 *
 * @param {string} sender - имя отправителя («Вы», «Qwen», ...)
 * @param {'user'|'ai'} className - CSS-класс для стилей пузыря
 * @param {HTMLElement} chatMessagesContainer
 * @returns {HTMLElement} textContainer — контейнер, в который потом рендерить текст
 */
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

/**
 * Создаёт сообщение и сразу рендерит в него текст/картинку.
 * Удобно для истории из IndexedDB и для мгновенной отрисовки своего сообщения.
 */
export function appendStaticMessage(sender, text, className, imageBase64 = null, chatMessagesContainer) {
  const textContainer = createMessageElement(sender, className, chatMessagesContainer);
  renderTextSafely(textContainer, text, imageBase64);
  chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

/**
 * Показывает всплывающий тост на 4 секунды.
 * @param {string} message
 */
export function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  // textContent — безопасно, пользовательский/серверный текст не интерпретируется как HTML.
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 100); // даём браузеру отрисовать стартовое состояние
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300); // ждём окончания CSS-анимации
  }, 4000);
}

/**
 * Блокирует/разблокирует кнопку «Отправить» в зависимости от наличия текста/картинки.
 * НЕ учитывает режим STOP — это отдельная функция toggleSendButtonToStop.
 */
export function updateSendButtonState(userInput, sendBtn, hasImage) {
  const hasText = userInput.value.trim().length > 0;
  sendBtn.disabled = !(hasText || hasImage);
}

// ============================================================
// ИСТОЧНИКИ (карточки в стиле Gemini)
// ============================================================

/**
 * Рисует блок источников поиска под сообщением.
 * Если блок уже был — заменяет его (защита от дублей при повторных вызовах).
 *
 * @param {HTMLElement} container
 * @param {Array<{url:string, title:string}>} sources
 */
export function renderSources(container, sources) {
  if (!sources || sources.length === 0) return;

  // Удаляем предыдущий блок, если он был (например, при повторном вызове).
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
    // rel="noopener noreferrer" — обязателен для target="_blank":
    // защищает от того, что открытая страница получит доступ к window.opener.
    a.rel = 'noopener noreferrer';
    a.className = 'source-card';

    let domain = '';
    try {
      domain = new URL(s.url).hostname.replace('www.', '');
    } catch (e) {
      // Невалидный URL — показываем заглушку.
      domain = 'Сайт';
    }

    // Фавиконка через Google S2. ⚠️ Внешний запрос: в проде лучше
    // проксировать через свой бэкенд или кешировать локально.
    const favicon = document.createElement('img');
    favicon.className = 'source-favicon';
    favicon.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    favicon.alt = '';
    
    const info = document.createElement('div');
    info.className = 'source-info';
    
    const domainEl = document.createElement('span');
    domainEl.className = 'source-domain';
    // textContent — безопасно, экранирование не нужно.
    domainEl.textContent = domain;
    
    const titleEl = document.createElement('span');
    titleEl.className = 'source-title';
    // ⚠️ Здесь DOMPurify.sanitize(...) НА СТРОКЕ, а потом textContent.
    // Это избыточно: textContent сам экранирует. Если хотели рендерить HTML
    // из title — надо было innerHTML + sanitize. Сейчас sanitize просто
    // «съедает» HTML-теги, превращая title в plain text. Работает, но
    // вводит в заблуждение — лучше оставить голый textContent.
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

// ============================================================
// КНОПКА SEND ↔ STOP
// ============================================================

/**
 * Переключает кнопку отправки в режим STOP (во время генерации)
 * или возвращает в обычный режим.
 *
 * @param {HTMLButtonElement} sendBtn
 * @param {boolean} isGenerating
 */
export function toggleSendButtonToStop(sendBtn, isGenerating) {
  if (isGenerating) {
    // ⚠️ Важно: принудительно разблокируем кнопку. Иначе disabled=true
    // (выставленный updateSendButtonState при пустом инпуте) не даст нажать STOP.
    sendBtn.disabled = false;
    sendBtn.classList.add('is-stop');
    
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
    // Восстанавливаем иконку (на мобилках покажется ➤, на десктопе скроется стилями).
    if (btnIcon) btnIcon.style.display = 'block'; 
    if (btnIconStop) btnIconStop.style.display = 'none';
    
    // ⚠️ Здесь кнопка остаётся enabled до следующего вызова updateSendButtonState.
    // Если инпут пуст — на долю секунды кнопка кликабельна без смысла.
    // Не баг, но стоит помнить: эта функция НЕ отвечает за валидацию,
    // только за визуальное состояние.
  }
}
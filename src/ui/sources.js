// src/ui/sources.js
//
// Отвечает ТОЛЬКО за рендеринг карточек источников.
// ⚠️ Исправлен баг: убран избыточный DOMPurify.sanitize перед textContent.

/**
 * Рисует блок источников поиска под сообщением.
 * @param {HTMLElement} container
 * @param {Array<{url:string, title:string}>} sources
 */
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
    // ✅ Исправлено: textContent сам экранирует, sanitize не нужен.
    titleEl.textContent = s.title || s.url;

    info.appendChild(domainEl);
    info.appendChild(titleEl);

    a.appendChild(favicon);
    a.appendChild(info);
    grid.appendChild(a);
  });

  sourcesWrapper.appendChild(grid);
  container.appendChild(sourcesWrapper);
}
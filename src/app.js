// src/app.js
//
// Точка входа клиентского SPA. Отвечает за:
//  - инициализацию IndexedDB, вложений, уведомлений, PiP;
//  - хеш-роутинг между экранами (#chat / #settings);
//  - отправку сообщений и стриминг ответа (SSE/WS через transport.js);
//  - синхронизацию состояния генерации между вкладками/устройствами;
//  - PWA-установку и регистрацию Service Worker.
//
// ⚠️ Файл намеренно «толстый»: в учебном проекте это ок, но в проде
// логику синхронизации и отправки сообщения стоит вынести в отдельные модули
// (например, chat-controller.js и sync-controller.js).

import 'highlight.js/styles/atom-one-dark.css';
import './style.css';
import { initDB, saveMessage, getAllMessages } from './db.js';
import { initAttachments, getAttachedImage, clearAttachment } from './attachments.js';
import {
   renderTextSafely,
   createMessageElement, 
   appendStaticMessage, 
   showToast,
   updateSendButtonState, 
   renderSources,
   toggleSendButtonToStop
} from './ui.js';
import { fetchBudgetStatus } from './api.js'; 
import { streamChat } from './transport.js'; 
import { initNotifications, showSystemNotification } from './features/notifications.js';
import { initPiP } from './features/pip.js';

// ============================================================
// СОСТОЯНИЕ МОДУЛЯ
// ============================================================

/**
 * Соединение с IndexedDB, открывается в DOMContentLoaded.
 * @type {IDBDatabase|null}
 */
let dbInstance = null;

// Флаги, чтобы не спамить пользователя одинаковыми уведомлениями за сессию.
// ⚠️ hasShownFallbackAlert объявлен, но НИГДЕ не используется — «мёртвая» переменная.
// Либо удалить, либо задействовать (например, при первом fallback на локальную модель).
let hasShownFallbackAlert = false;
let hasShownBudgetNotification = false;

/** @type {AbortController|null} — текущая ЛОКАЛЬНАЯ генерация (запущенная в этой вкладке) */
let currentAbortController = null;

/** @type {string|null} — ID генерации, запущенной на ДРУГОМ устройстве/вкладке */
let remoteGenerationId = null;

// ============================================================
// DOM-ССЫЛКИ
// ============================================================
// Собираем один раз при загрузке модуля. Если какого-то элемента нет в HTML —
// соответствующая логика ниже аккуратно пропускается (проверки на null).

const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const chatMessages = document.getElementById('chat-messages');
const modelSelect = document.getElementById('model-select');
const tempSlider = document.getElementById('temperature-slider');
const tempValue = document.getElementById('temp-value');
const sendBtn = document.getElementById('send-btn');
const previewImg = document.getElementById('image-preview');
const removeImageBtn = document.getElementById('remove-image-btn');
const budgetIndicator = document.getElementById('budget-indicator');
const syncBanner = document.getElementById('sync-banner');

// ============================================================
// РОУТИНГ (простой хеш-роутер)
// ============================================================
// Никаких библиотек: два экрана, переключение по hash. Для SPA с 2-3 экранами
// этого достаточно; при росте — React Router / wouter / собственный парсер.

const routes = {
  '#chat': () => switchScreen('screen-chat'),
  '#settings': () => switchScreen('screen-settings'),
};

/**
 * Показывает один экран и скрывает остальные.
 * @param {string} screenId
 */
function switchScreen(screenId) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.toggle('active', screen.id === screenId);
  });
}

function handleRoute() {
  const hash = window.location.hash || '#chat';
  if (routes[hash]) routes[hash]();
}

window.addEventListener('hashchange', handleRoute);

// ============================================================
// БЮДЖЕТ (индикатор в шапке)
// ============================================================

/**
 * Загружает статус бюджета с бэкенда и обновляет индикатор.
 * Ошибки сети не критичны — просто оставляем старый текст.
 */
async function updateBudgetUI() {
  if (!budgetIndicator) return;
  try {
    const status = await fetchBudgetStatus();
    budgetIndicator.textContent = `☁️ ${status.used}/${status.limit}`;
    budgetIndicator.title = `Осталось облачных запросов сегодня: ${status.remaining}`;
    
    if (!status.allowed) {
      budgetIndicator.style.background = 'rgba(255, 0, 0, 0.3)';
      budgetIndicator.title = 'Лимит исчерпан. Работает локальная модель.';
    } else {
      budgetIndicator.style.background = 'rgba(255, 255, 255, 0.1)';
    }
  } catch (e) {
    console.warn('Не удалось загрузить статус бюджета');
  }
}

// ============================================================
// UI-СЛУШАТЕЛИ (ввод, вложение, температура)
// ============================================================

// Кнопка "Отправить" активна, если есть текст ИЛИ прикреплённое изображение.
userInput.addEventListener('input', () => updateSendButtonState(userInput, sendBtn, !!getAttachedImage()));

// MutationObserver на <img id="image-preview">: attachments.js меняет src
// при выборе/очистке изображения, а мы хотим реагировать на это без тесной связи.
if (previewImg) {
  const observer = new MutationObserver(() => {
    updateSendButtonState(userInput, sendBtn, !!getAttachedImage());
  });
  observer.observe(previewImg, { attributes: true, attributeFilter: ['src'] });
}

if (removeImageBtn) {
  removeImageBtn.addEventListener('click', () => {
    // setTimeout(0) — даём attachments.js сначала отработать свой обработчик,
    // и только потом пересчитываем состояние кнопки.
    // ⚠️ Хрупко: порядок обработчиков — неявный контракт. Надёжнее —
    // событие 'attachment:changed', которое шлёт сам attachments.js.
    setTimeout(() => updateSendButtonState(userInput, sendBtn, !!getAttachedImage()), 0);
  });
}

if (tempSlider && tempValue) {
  tempSlider.addEventListener('input', (e) => {
    tempValue.textContent = e.target.value;
  });
}

updateSendButtonState(userInput, sendBtn, !!getAttachedImage());

initAttachments();
initNotifications();
initPiP();

// ============================================================
// СИНХРОНИЗАЦИЯ UI МЕЖДУ ВКЛАДКАМИ/УСТРОЙСТВАМИ
// ============================================================
// transport.js диспатчит эти CustomEvent'ы, когда WS получает broadcast
// от сервера (generation_started / generation_stopped).

window.addEventListener('sync_generation_started', (e) => {
  const { generationId } = e.detail;
  console.log('[Sync] Генерация началась на другом устройстве', generationId);
  remoteGenerationId = generationId;
  
  if (syncBanner) syncBanner.classList.remove('hidden');
  
  // Показываем кнопку STOP, чтобы можно было остановить удалённую генерацию.
  // Если у нас уже идёт СВОЯ — не трогаем кнопку (она и так STOP).
  if (!currentAbortController) {
    toggleSendButtonToStop(sendBtn, true);
  }
});

window.addEventListener('sync_generation_stopped', (e) => {
  const { generationId } = e.detail;
  console.log('[Sync] Генерация остановлена на другом устройстве', generationId);
  
  // Реагируем только на «свою» удалённую генерацию.
  if (remoteGenerationId === generationId) {
    remoteGenerationId = null;
    if (syncBanner) syncBanner.classList.add('hidden');
    
    if (!currentAbortController) {
      toggleSendButtonToStop(sendBtn, false);
      updateSendButtonState(userInput, sendBtn, !!getAttachedImage());
    }
  }
});

// ============================================================
// ОТПРАВКА СООБЩЕНИЯ И СТРИМИНГ ОТВЕТА
// ============================================================
//
// Главный сценарий. Три режима нажатия на кнопку:
//   1) идёт ЛОКАЛЬНАЯ генерация  → кнопка = STOP → abort()
//   2) идёт УДАЛЁННАЯ генерация  → кнопка = STOP → шлём chat_stop на сервер
//   3) ничего не идёт            → кнопка = SEND → обычная отправка
//
// ⚠️ Гонка состояний: между проверкой currentAbortController и созданием
// нового контроллера может теоретически прийти sync-событие. На практике
// маловероятно, но для «взрослого» кода стоит либо блокировать форму,
// либо использовать единый state-machine (idle / local / remote).

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  // --- Режим 1: останавливаем свою генерацию ---
  if (currentAbortController) {
    currentAbortController.abort();
    return;
  }

  // --- Режим 2: просим сервер остановить удалённую генерацию ---
  // ⚠️ Дублирование логики подключения из transport.js: тот же wsUrl,
  // тот же токен, тот же clientId. Кандидат на вынос в helper openControlSocket().
  if (remoteGenerationId) {
    const authToken = localStorage.getItem('chat_auth_token') || 'dev-secret-token';
    const userId = localStorage.getItem('chat_user_id');
    const wsUrl = `ws://${window.location.host}/ws?token=${authToken}&clientId=${userId}`;
    const tempWs = new WebSocket(wsUrl);
    
    tempWs.onopen = () => {
      tempWs.send(JSON.stringify({ type: 'chat_stop', generationId: remoteGenerationId }));
      tempWs.close();
    };
    return;
  }
  
  // --- Режим 3: обычная отправка ---
  const imageBase64 = getAttachedImage(); 
  const text = userInput.value.trim();
  
  // Пустое сообщение без картинки отправлять нечего.
  // dbInstance может быть null, если IndexedDB не открылась — тогда не шлём.
  if ((!text && !imageBase64) || !dbInstance) return;

  const selectedModel = modelSelect.value;
  const temperature = tempSlider ? parseFloat(tempSlider.value) : 0.7;
  userInput.value = '';

  // 1. Оптимистично рисуем сообщение пользователя и сохраняем в историю.
  appendStaticMessage('Вы', text, 'user', imageBase64, chatMessages);
  await saveMessage(dbInstance, { sender: 'Вы', text, className: 'user', imageBase64 });
  
  clearAttachment(); 
  updateSendButtonState(userInput, sendBtn, false);

  // 2. Собираем ВСЮ историю в контекст модели (формат OpenAI).
  //    Изображения превращаются в массив content с image_url.
  //    ⚠️ Каждый раз отправляем ВСЮ историю — при длинном чате это дорого
  //    по токенам и памяти. Стоит ограничить последними N сообщениями
  //    (например, slice(-20)) или сделать суммаризацию.
  const allMessages = await getAllMessages(dbInstance);
  const messagesContext = allMessages.map(m => {
    let content = m.text;
    if (m.imageBase64) {
      content = [
        { type: 'text', text: m.text || 'Опиши это изображение' },
        { type: 'image_url', image_url: { url: m.imageBase64 } }
      ];
    }
    return {
      role: m.className === 'user' ? 'user' : 'assistant',
      content: content
    };
  });

  // 3. Создаём «пузырь» для ответа ИИ и готовим аккумуляторы.
  let aiName = selectedModel === 'qwen' ? 'Qwen' : 'DeepSeek';
  const aiContainer = createMessageElement(aiName, 'ai', chatMessages);
  
  let fullAIResponse = '';   // основной текст ответа
  let fullReasoning = '';    // reasoning_content (chain-of-thought) — оборачиваем в <think>
  let searchSources = null;  // источники поиска, придут ДО текста

  const abortController = new AbortController();
  currentAbortController = abortController;
  const generationId = crypto.randomUUID();

  toggleSendButtonToStop(sendBtn, true);

  try {
    // 4. Стриминг: streamChat сам решает, WS или SSE (fallback внутри transport.js).
    for await (const parsed of streamChat({ 
      messagesContext, 
      model: selectedModel, 
      temperature,
      generationId,
      signal: abortController.signal
    })) {
      // --- Сервер сообщил, какая модель реально отвечает ---
      // (fallback мог переключить облако → локальную)
      if (parsed.type === 'model_info') {
        aiName = parsed.modelName;
        const label = aiContainer.parentElement.querySelector('strong');
        if (label) label.textContent = `${aiName}: `;
      } 
      
      // --- Системное уведомление (бюджет, MCP-вызов и т.п.) ---
      else if (parsed.type === 'system_alert') {
        showToast(parsed.message);
        
        // Системное уведомление о бюджете — один раз за сессию.
        if (parsed.message.includes('лимит облачных запросов') && !hasShownBudgetNotification) {
          showSystemNotification(
            'Бюджет исчерпан 💸', 
            'Дневной лимит облачных запросов закончился. Переключаюсь на локальную модель.'
          );
          hasShownBudgetNotification = true;
        }
      } 
      
      // --- Ошибка от сервера/модели ---
      // ⚠️ return внутри try: finally отработает и вернёт кнопку в SEND,
      // но частичный ответ, уже нарисованный в aiContainer, сохранится в БД?
      // Нет — saveMessage ниже пропустится. Значит, частичный ответ
      // отобразится, но НЕ попадёт в историю. Для учебного проекта ок,
      // но лучше сохранять частичный результат перед return.
      else if (parsed.type === 'error') {
        showToast(`⚠️ ${parsed.message}`);
        aiContainer.textContent = `Ошибка: ${parsed.message}`;
        return;
      } 
      
      // --- Источники поиска (приходят один раз, ДО текста) ---
      else if (parsed.type === 'sources') {
        searchSources = parsed.data;
      } 
      
      // --- Reasoning (chain-of-thought) ---
      else if (parsed.type === 'reasoning') {
        fullReasoning += parsed.text;
        renderTextSafely(aiContainer, `<think>${fullReasoning}</think>${fullAIResponse}`);
        chatMessages.scrollTop = chatMessages.scrollHeight;
      } 
      
      // --- Основной текст ответа ---
      else if (parsed.type === 'content') {
        fullAIResponse += parsed.text;
        if (fullReasoning) {
          renderTextSafely(aiContainer, `<think>${fullReasoning}</think>${fullAIResponse}`);
        } else {
          renderTextSafely(aiContainer, fullAIResponse);
        }
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    }

    // 5. После завершения стрима: финальный рендер источников + сохранение в историю.
    let textToSave = fullReasoning ? `<think>${fullReasoning}</think>\n${fullAIResponse}` : fullAIResponse;
    
    if (searchSources && searchSources.length > 0) {
      renderSources(aiContainer, searchSources);
      textToSave += '\n\n**Источники:**\n' + searchSources.map(s => `- [${s.title}](${s.url})`).join('\n');
    }

    await saveMessage(dbInstance, { sender: aiName, text: textToSave, className: 'ai' });
    
    // Обновляем индикатор бюджета (поиск мог потратить квоту).
    updateBudgetUI();

  } catch (err) {
    // --- Отмена (локальная или из другой вкладки) ---
    if (err.name === 'AbortError') {
       console.log('[AI Chat] Генерация остановлена (локально или из другой вкладки)');
       if (!fullAIResponse && !fullReasoning) {
          aiContainer.textContent = '⏹️ Генерация остановлена.';
       }
       // ⚠️ Здесь тоже return — частичный ответ не сохранится в БД.
       return;
    }

    // --- Прочие ошибки: различаем по тексту сообщения ---
    console.error('[AI Chat] Критическая ошибка:', err);
    if (err.message === 'Unauthorized') {
       aiContainer.textContent = 'Ошибка авторизации. Проверьте токен.';
    } else if (err.message.includes('fetch failed') || err.message.includes('Network response')) {
       aiContainer.textContent = 'Нет соединения с локальным сервером (Node.js).';
       showToast('Сервер Node.js недоступен!');
    } else {
       aiContainer.textContent = 'Произошла непредвиденная ошибка.';
       showToast('Ошибка приложения');
    }
  } finally {
    // Всегда сбрасываем состояние кнопки — даже если была ошибка или отмена.
    currentAbortController = null;
    toggleSendButtonToStop(sendBtn, false);
    updateSendButtonState(userInput, sendBtn, !!getAttachedImage());
  }
});

// ============================================================
// ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ СТРАНИЦЫ
// ============================================================

window.addEventListener('DOMContentLoaded', async () => {
  handleRoute();
  updateBudgetUI();

  // Открываем IndexedDB и восстанавливаем историю сообщений.
  try {
    dbInstance = await initDB();
    const history = await getAllMessages(dbInstance);
    history.forEach(msg => {
      appendStaticMessage(msg.sender, msg.text, msg.className, msg.imageBase64, chatMessages);
    });
  } catch (err) {
    console.error('[AI Chat] Ошибка IndexedDB:', err);
  }

  // Service Worker: только в production.
  // В dev — снимаем регистрацию, чтобы SW не кешировал старые бандлы и не мешал HMR.
  if ('serviceWorker' in navigator) {
    if (process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(err => console.error('[SW]', err));
    } else {
      navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
    }
  }
  
  updateSendButtonState(userInput, sendBtn, !!getAttachedImage());
});

// ============================================================
// PWA: КАСТОМНАЯ КНОПКА УСТАНОВКИ
// ============================================================
//
// Браузер шлёт beforeinstallprompt, когда приложение можно установить.
// Мы перехватываем событие (preventDefault), сохраняем deferredPrompt
// и показываем свою кнопку. По клику вызываем prompt() — это откроет
// нативный диалог установки.

let deferredPrompt;
const installBtn = document.getElementById('install-btn');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn) installBtn.style.display = 'block';
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') installBtn.style.display = 'none';
    // ⚠️ deferredPrompt обнуляем в любом случае — повторно prompt()
    // на том же объекте уже не сработает (по спецификации).
    deferredPrompt = null;
  });
}
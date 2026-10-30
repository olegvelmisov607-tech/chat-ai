// src/app.js
// Точка входа клиентского SPA. Отвечает ТОЛЬКО за bootstrap:
//  - инициализацию IndexedDB, вложений, уведомлений, PiP;
//  - хеш-роутинг между экранами;
//  - создание и связывание контроллеров (Chat, Budget, Sync);
//  - PWA-установку и Service Worker.

import 'highlight.js/styles/atom-one-dark.css';
import './style.css';
import { initDB, getAllMessages } from './db.js';
import { initAttachments, getAttachedImage } from './attachments.js';
import { appendStaticMessage, updateSendButtonState, toggleSendButtonToStop } from './ui.js';
import { initNotifications } from './features/notifications.js';
import { initPiP } from './features/pip.js';

import { ChatController } from './controllers/chat-controller.js';
import { BudgetController } from './controllers/budget-controller.js';

// ============================================================
// DOM-ССЫЛКИ
// ============================================================
const elements = {
  form: document.getElementById('chat-form'),
  input: document.getElementById('user-input'),
  messagesContainer: document.getElementById('chat-messages'),
  modelSelect: document.getElementById('model-select'),
  tempSlider: document.getElementById('temperature-slider'),
  tempValue: document.getElementById('temp-value'),
  sendBtn: document.getElementById('send-btn'),
  previewImg: document.getElementById('image-preview'),
  removeImageBtn: document.getElementById('remove-image-btn'),
  budgetIndicator: document.getElementById('budget-indicator'),
  syncBanner: document.getElementById('sync-banner'),
};

// ============================================================
// РОУТИНГ
// ============================================================
const routes = {
  '#chat': () => switchScreen('screen-chat'),
  '#settings': () => switchScreen('screen-settings'),
};

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
// ИНИЦИАЛИЗАЦИЯ
// ============================================================
window.addEventListener('DOMContentLoaded', async () => {
  handleRoute();

  // 1. Бюджет
  const budgetController = new BudgetController(elements.budgetIndicator);
  await budgetController.updateUI();

  // 2. IndexedDB + восстановление истории
  let dbInstance = null;
  try {
    dbInstance = await initDB();
    const history = await getAllMessages(dbInstance);
    history.forEach(msg => {
      appendStaticMessage(msg.sender, msg.text, msg.className, msg.imageBase64, elements.messagesContainer);
    });
  } catch (err) {
    console.error('[AI Chat] Ошибка IndexedDB:', err);
  }

  // 3. Вложения и фичи
  initAttachments();
  initNotifications();
  initPiP();

  // 4. Слушатели для кнопки и температуры (чистый UI)
  elements.input.addEventListener('input', () => 
    updateSendButtonState(elements.input, elements.sendBtn, !!getAttachedImage())
  );

  if (elements.previewImg) {
    const observer = new MutationObserver(() => {
      updateSendButtonState(elements.input, elements.sendBtn, !!getAttachedImage());
    });
    observer.observe(elements.previewImg, { attributes: true, attributeFilter: ['src'] });
  }

  if (elements.removeImageBtn) {
    elements.removeImageBtn.addEventListener('click', () => {
      setTimeout(() => updateSendButtonState(elements.input, elements.sendBtn, !!getAttachedImage()), 0);
    });
  }

  if (elements.tempSlider && elements.tempValue) {
    elements.tempSlider.addEventListener('input', (e) => {
      elements.tempValue.textContent = e.target.value;
    });
  }

  // 5. Синхронизация (пока в виде заглушки, так как мы отключили её в transport.js)
  // В будущем вынесем в SyncController, а пока просто слушаем события.
  let remoteGenerationId = null;
  let currentAbortController = null;

  window.addEventListener('sync_generation_started', (e) => {
    const { generationId } = e.detail;
    remoteGenerationId = generationId;
    if (elements.syncBanner) elements.syncBanner.classList.remove('hidden');
    if (!currentAbortController) toggleSendButtonToStop(elements.sendBtn, true);
  });

  window.addEventListener('sync_generation_stopped', (e) => {
    const { generationId } = e.detail;
    if (generationId === null || remoteGenerationId === generationId) {
      remoteGenerationId = null;
      if (elements.syncBanner) elements.syncBanner.classList.add('hidden');
      if (!currentAbortController) {
        toggleSendButtonToStop(elements.sendBtn, false);
        updateSendButtonState(elements.input, elements.sendBtn, !!getAttachedImage());
      }
    }
  });

  // 6. ChatController
  const chatController = new ChatController({
    db: dbInstance,
    elements,
    budgetController, // <--- добавили
    onGenerationStart: () => { currentAbortController = chatController.currentAbortController; },
    onGenerationEnd: () => { currentAbortController = null; }
  });
  
  chatController.init();

  // 7. Service Worker
    if ('serviceWorker' in navigator) {
      // Проверяем, localhost ли это
      const isLocalhost = Boolean(
        window.location.hostname === 'localhost' ||
        window.location.hostname === '[::1]' ||
        window.location.hostname.match(/^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/)
      );

      if (isLocalhost) {
        // На localhost ВСЕГДА убиваем SW, чтобы не мешал HMR и сборке
        navigator.serviceWorker.getRegistrations().then(regs => {
          regs.forEach(r => r.unregister());
          console.log('[SW] Service Worker отключен на localhost');
        });
      } else if (process.env.NODE_ENV === 'production') {
        // На проде — регистрируем
        navigator.serviceWorker.register('/sw.js').catch(err => console.error('[SW]', err));
      }
    }

  updateSendButtonState(elements.input, elements.sendBtn, !!getAttachedImage());
});

// ============================================================
// PWA: КАСТОМНАЯ КНОПКА УСТАНОВКИ
// ============================================================
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
    deferredPrompt = null;
  });
}
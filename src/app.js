import './style.css';
import { initDB, saveMessage, getAllMessages } from './db.js';
import { getAttachedImage, clearAttachment } from './attachments.js';
import { renderTextSafely, createMessageElement, appendStaticMessage, showToast, updateSendButtonState } from './ui.js';
import { streamChatAPI } from './api.js';
import { initNotifications, showSystemNotification } from './features/notifications.js';
import { initPiP } from './features/pip.js';

let dbInstance = null;
let hasShownFallbackAlert = false;

// --- DOM ЭЛЕМЕНТЫ ---
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const chatMessages = document.getElementById('chat-messages');
const modelSelect = document.getElementById('model-select');
const tempSlider = document.getElementById('temperature-slider');
const tempValue = document.getElementById('temp-value');
const sendBtn = document.getElementById('send-btn');
const previewImg = document.getElementById('image-preview');
const removeImageBtn = document.getElementById('remove-image-btn');

// --- РОУТИНГ ---
const routes = {
  '#chat': () => switchScreen('screen-chat'),
  '#settings': () => switchScreen('screen-settings'),
};

/**
 * Переключает активный экран (SPA-роутинг).
 * @param {string} screenId - ID DOM-элемента экрана (например, 'screen-chat').
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

// --- UI EVENTS ---
userInput.addEventListener('input', () => updateSendButtonState(userInput, sendBtn, !!getAttachedImage()));

if (previewImg) {
  const observer = new MutationObserver(() => {
    updateSendButtonState(userInput, sendBtn, !!getAttachedImage());
  });
  observer.observe(previewImg, { attributes: true, attributeFilter: ['src'] });
}

if (removeImageBtn) {
  removeImageBtn.addEventListener('click', () => {
    setTimeout(() => updateSendButtonState(userInput, sendBtn, !!getAttachedImage()), 0);
  });
}

if (tempSlider && tempValue) {
  tempSlider.addEventListener('input', (e) => {
    tempValue.textContent = e.target.value;
  });
}

updateSendButtonState(userInput, sendBtn, !!getAttachedImage());

// --- ИНИЦИАЛИЗАЦИЯ ФИЧ ---
initNotifications();
initPiP();

// --- ОТПРАВКА СООБЩЕНИЙ ---
/**
 * Главный обработчик отправки сообщения.
 * Собирает контекст, отправляет запрос через API, обрабатывает SSE-стрим и обновляет UI.
 * 
 * @param {Event} e - Событие submit формы.
 * @returns {Promise<void>}
 */
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const imageBase64 = getAttachedImage(); 
  const text = userInput.value.trim();
  
  if ((!text && !imageBase64) || !dbInstance) return;

  const selectedModel = modelSelect.value;
  const temperature = tempSlider ? parseFloat(tempSlider.value) : 0.7;
  userInput.value = '';

  // 1. Отрисовка и сохранение сообщения пользователя
  appendStaticMessage('Вы', text, 'user', imageBase64, chatMessages);
  await saveMessage(dbInstance, { sender: 'Вы', text, className: 'user', imageBase64 });
  
  clearAttachment(); 
  updateSendButtonState(userInput, sendBtn, false);

  // 2. Формирование контекста
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

  // 3. Создание блока для ответа ИИ
  let aiName = selectedModel === 'qwen' ? 'Qwen' : 'DeepSeek';
  const aiContainer = createMessageElement(aiName, 'ai', chatMessages);
  
  let fullAIResponse = '';
  let fullReasoning = '';

  try {
    // 4. Чтение стрима
    for await (const parsed of streamChatAPI({ messagesContext, model: selectedModel, temperature })) {
      if (parsed.type === 'model_info') {
        aiName = parsed.modelName;
        const label = aiContainer.parentElement.querySelector('strong');
        if (label) label.textContent = `${aiName}: `;
      } else if (parsed.type === 'system_alert') {
        if (!hasShownFallbackAlert) {
          showToast(parsed.message);
          hasShownFallbackAlert = true;
        }
      } else if (parsed.type === 'error') {
        showToast(`⚠️ ${parsed.message}`);
        aiContainer.textContent = `Ошибка: ${parsed.message}`;
        return;
      } else if (parsed.type === 'reasoning') {
        fullReasoning += parsed.text;
        renderTextSafely(aiContainer, `<think>${fullReasoning}</think>${fullAIResponse}`);
        chatMessages.scrollTop = chatMessages.scrollHeight;
      } else if (parsed.type === 'content') {
        fullAIResponse += parsed.text;
        if (fullReasoning) {
          renderTextSafely(aiContainer, `<think>${fullReasoning}</think>${fullAIResponse}`);
        } else {
          renderTextSafely(aiContainer, fullAIResponse);
        }
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    }

    // 5. Сохранение ответа
    const textToSave = fullReasoning ? `<think>${fullReasoning}</think>\n${fullAIResponse}` : fullAIResponse;
    await saveMessage(dbInstance, { sender: aiName, text: textToSave, className: 'ai' });
    
    showSystemNotification();

  } catch (err) {
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
  }
});

// --- BOOTSTRAP ---
window.addEventListener('DOMContentLoaded', async () => {
  handleRoute();
  try {
    dbInstance = await initDB();
    const history = await getAllMessages(dbInstance);
    history.forEach(msg => {
      appendStaticMessage(msg.sender, msg.text, msg.className, msg.imageBase64, chatMessages);
    });
  } catch (err) {
    console.error('[AI Chat] Ошибка IndexedDB:', err);
  }

  if ('serviceWorker' in navigator) {
    if (process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(err => console.error('[SW]', err));
    } else {
      navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
    }
  }
  
  updateSendButtonState(userInput, sendBtn, !!getAttachedImage());
});

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
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

let dbInstance = null;
let hasShownFallbackAlert = false;
let hasShownBudgetNotification = false;

// Контроллер для текущей генерации
let currentAbortController = null;

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

initAttachments();
initNotifications();
initPiP();

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  // --- Если идет генерация, кнопка работает как STOP ---
  if (currentAbortController) {
    currentAbortController.abort();
    return;
  }
  
  const imageBase64 = getAttachedImage(); 
  const text = userInput.value.trim();
  
  if ((!text && !imageBase64) || !dbInstance) return;

  const selectedModel = modelSelect.value;
  const temperature = tempSlider ? parseFloat(tempSlider.value) : 0.7;
  userInput.value = '';

  appendStaticMessage('Вы', text, 'user', imageBase64, chatMessages);
  await saveMessage(dbInstance, { sender: 'Вы', text, className: 'user', imageBase64 });
  
  clearAttachment(); 
  updateSendButtonState(userInput, sendBtn, false);

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

  let aiName = selectedModel === 'qwen' ? 'Qwen' : 'DeepSeek';
  const aiContainer = createMessageElement(aiName, 'ai', chatMessages);
  
  let fullAIResponse = '';
  let fullReasoning = '';
  let searchSources = null;

  const abortController = new AbortController();
  currentAbortController = abortController;
  const generationId = crypto.randomUUID();

  // Переключаем кнопку в режим STOP
  toggleSendButtonToStop(sendBtn, true);

  try {
    for await (const parsed of streamChat({ 
      messagesContext, 
      model: selectedModel, 
      temperature,
      generationId,
      signal: abortController.signal
    })) {
      if (parsed.type === 'model_info') {
        aiName = parsed.modelName;
        const label = aiContainer.parentElement.querySelector('strong');
        if (label) label.textContent = `${aiName}: `;
       } else if (parsed.type === 'system_alert') {
        showToast(parsed.message);
        
        if (parsed.message.includes('лимит облачных запросов') && !hasShownBudgetNotification) {
          showSystemNotification(
            'Бюджет исчерпан 💸', 
            'Дневной лимит облачных запросов закончился. Переключаюсь на локальную модель.'
          );
          hasShownBudgetNotification = true;
        }
      } else if (parsed.type === 'error') {
        showToast(`⚠️ ${parsed.message}`);
        aiContainer.textContent = `Ошибка: ${parsed.message}`;
        return;
      } else if (parsed.type === 'sources') {
        searchSources = parsed.data;
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

    let textToSave = fullReasoning ? `<think>${fullReasoning}</think>\n${fullAIResponse}` : fullAIResponse;
    
    if (searchSources && searchSources.length > 0) {
      renderSources(aiContainer, searchSources);
      textToSave += '\n\n**Источники:**\n' + searchSources.map(s => `- [${s.title}](${s.url})`).join('\n');
    }

    await saveMessage(dbInstance, { sender: aiName, text: textToSave, className: 'ai' });
    
    updateBudgetUI();

  } catch (err) {
    if (err.name === 'AbortError') {
       console.log('[AI Chat] Генерация остановлена пользователем');
       if (!fullAIResponse && !fullReasoning) {
          aiContainer.textContent = '⏹️ Генерация остановлена.';
       }
       return;
    }

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
    currentAbortController = null;
    
    // Возвращаем кнопку в обычный режим
    toggleSendButtonToStop(sendBtn, false);
    // Обновляем состояние (вдруг поле пустое, тогда кнопка снова заблокируется)
    updateSendButtonState(userInput, sendBtn, !!getAttachedImage());
  }
});

window.addEventListener('DOMContentLoaded', async () => {
  handleRoute();
  updateBudgetUI();

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
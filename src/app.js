import './style.css';
import { initDB, saveMessage, getAllMessages } from './db.js';
import { getAttachedImage, clearAttachment } from './attachments.js';

let dbInstance = null;

// Флаг для контроля показа тоста Fallback
let hasShownFallbackAlert = false;

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

const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const chatMessages = document.getElementById('chat-messages');
const modelSelect = document.getElementById('model-select');

// Элементы управления температурой
const tempSlider = document.getElementById('temperature-slider');
const tempValue = document.getElementById('temp-value');
const sendBtn = document.getElementById('send-btn');

// --- УВЕДОМЛЕНИЯ ---
const notifyBtn = document.getElementById('notify-btn');

// Проверяем статус при загрузке
if ('Notification' in window) {
  if (Notification.permission === 'granted') {
    notifyBtn.classList.add('active');
    notifyBtn.title = 'Уведомления включены';
  }
} else if (notifyBtn) {
  notifyBtn.style.display = 'none'; // Скрываем, если браузер не поддерживает
}

// Обработчик клика по колокольчику
if (notifyBtn) {
  notifyBtn.addEventListener('click', async () => {
    if (!('Notification' in window)) return;
    
    if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        notifyBtn.classList.add('active');
        notifyBtn.title = 'Уведомления включены';
        new Notification('Уведомления включены!', { body: 'Теперь вы узнаете, когда ИИ ответит.' });
      }
    } else {
      new Notification('Уведомления уже включены', { body: 'Всё работает!' });
    }
  });
}

// Функция показа системного уведомления
function showSystemNotification() {
  if (document.hidden && Notification.permission === 'granted') {
    new Notification('Ответ готов!', { 
      body: 'ИИ закончил генерацию ответа в чате.',
      icon: '/icon-192.png' 
    });
  }
}

// --- ФУНКЦИИ ВВОДА И ОТПРАВКИ ---
function updateSendButtonState() {
  const hasText = userInput.value.trim().length > 0;
  const hasImage = !!getAttachedImage();
  sendBtn.disabled = !(hasText || hasImage);
}

userInput.addEventListener('input', updateSendButtonState);

const previewImg = document.getElementById('image-preview');
if (previewImg) {
  const observer = new MutationObserver(() => {
    updateSendButtonState();
  });
  observer.observe(previewImg, { attributes: true, attributeFilter: ['src'] });
}

const removeImageBtn = document.getElementById('remove-image-btn');
if (removeImageBtn) {
  removeImageBtn.addEventListener('click', () => {
    setTimeout(updateSendButtonState, 0);
  });
}

updateSendButtonState();

if (tempSlider && tempValue) {
  tempSlider.addEventListener('input', (e) => {
    tempValue.textContent = e.target.value;
  });
}

function renderTextSafely(container, text, imageBase64 = null) {
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
  let isThought = false;
  let currentSpan = null;

  parts.forEach(part => {
    if (part === '<think>') {
      isThought = true;
      const thoughtDiv = document.createElement('div');
      thoughtDiv.className = 'thought';
      const strong = document.createElement('strong');
      strong.textContent = 'Рассуждение:';
      thoughtDiv.appendChild(strong);
      thoughtDiv.appendChild(document.createElement('br'));
      currentSpan = thoughtDiv;
      contentWrapper.appendChild(thoughtDiv); 
    } else if (part === '</think>') {
      isThought = false;
      currentSpan = null;
    } else if (part) {
      const target = isThought && currentSpan ? currentSpan : contentWrapper; 
      target.appendChild(document.createTextNode(part));
    }
  });
}

function createMessageElement(sender, className) {
  const messageElement = document.createElement('div');
  messageElement.className = `message ${className}`;
  
  const label = document.createElement('strong');
  label.textContent = `${sender}: `;
  messageElement.appendChild(label);

  const textContainer = document.createElement('div');
  messageElement.appendChild(textContainer);

  chatMessages.appendChild(messageElement);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return textContainer;
}

function appendStaticMessage(sender, text, className, imageBase64 = null) {
  const textContainer = createMessageElement(sender, className);
  renderTextSafely(textContainer, text, imageBase64);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showToast(message) {
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

function getFriendlyErrorMessage(code, rawMessage) {
  const errorMap = {
    'fetch failed': 'Нет соединения с сервером. Проверьте интернет.',
    'HTTP_401': 'Неверный API-ключ DeepSeek. Проверьте настройки.',
    'HTTP_402': 'Закончились средства на балансе DeepSeek. Переключаюсь на локальную модель.',
    'HTTP_429': 'Слишком много запросов. Подождите немного.',
    'HTTP_500': 'Ошибка на сервере DeepSeek. Попробуйте позже.',
    'HTTP_503': 'Сервис DeepSeek временно недоступен.',
  };
  if (errorMap[code]) return errorMap[code];
  if (code.startsWith('HTTP_5')) return 'Ошибка на стороне облачного сервиса.';
  return rawMessage || 'Неизвестная ошибка. Переключено на локальную модель.';
}

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const imageBase64 = getAttachedImage(); 
  const text = userInput.value.trim();
  
  if ((!text && !imageBase64) || !dbInstance) return;

  const selectedModel = modelSelect.value;
  userInput.value = '';

  appendStaticMessage('Вы', text, 'user', imageBase64);
  await saveMessage(dbInstance, { sender: 'Вы', text, className: 'user', imageBase64 });
  
  clearAttachment(); 
  updateSendButtonState(); 

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
  const aiContainer = createMessageElement(aiName, 'ai');
  
  let fullAIResponse = '';
  let fullReasoning = '';

  try {
    console.log('[AI Chat] Отправка запроса на сервер...');
    
    const temperature = tempSlider ? parseFloat(tempSlider.value) : 0.7;
    const authToken = localStorage.getItem('chat_auth_token') || 'dev-secret-token';

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}` 
      },
      body: JSON.stringify({ 
        messages: messagesContext, 
        model: selectedModel,
        temperature: temperature
      })
    });

    if (response.status === 401) {
      showToast('Ошибка авторизации. Введите токен в консоли: localStorage.setItem("chat_auth_token", "ваш_токен")');
      throw new Error('Unauthorized');
    }

    if (!response.ok) throw new Error(`Network response was not ok: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.replace('data: ', '').trim();
        if (jsonStr === '[DONE]') break;
        
        try {
          const parsed = JSON.parse(jsonStr);
          
          if (parsed.type === 'model_info') {
            aiName = parsed.modelName;
            const label = aiContainer.parentElement.querySelector('strong');
            if (label) label.textContent = `${aiName}: `;
          } else if (parsed.type === 'system_alert') {
            console.warn('[AI Chat] Fallback сработал:', parsed.message);
            if (!hasShownFallbackAlert) {
              showToast(parsed.message);
              hasShownFallbackAlert = true;
            }
          } else if (parsed.type === 'error') {
            console.error(`[AI Chat] Ошибка от сервера: ${parsed.message}`);
            const friendlyText = getFriendlyErrorMessage(parsed.message, parsed.message);
            showToast(`⚠️ ${friendlyText}`);
            aiContainer.textContent = `Ошибка: ${friendlyText}`;
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
        } catch (err) {
          console.warn('[AI Chat] Ошибка парсинга чанка:', err);
        }
      }
    }

    const textToSave = fullReasoning ? `<think>${fullReasoning}</think>\n${fullAIResponse}` : fullAIResponse;
    await saveMessage(dbInstance, { sender: aiName, text: textToSave, className: 'ai' });
    console.log('[AI Chat] Ответ успешно сохранен в IndexedDB');
    
    // ДОБАВЛЕНО: Показываем уведомление
    showSystemNotification();

  } catch (err) {
    console.error('[AI Chat] Критическая ошибка соединения:', err);
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
       aiContainer.textContent = 'Нет соединения с локальным сервером (Node.js). Проверьте, запущен ли он.';
       showToast('Сервер Node.js недоступен!');
    } else if (err.message === 'Unauthorized') {
       aiContainer.textContent = 'Ошибка авторизации. Проверьте токен.';
    } else {
       aiContainer.textContent = 'Произошла непредвиденная ошибка.';
       showToast('Ошибка приложения');
    }
  }
});

// --- PICTURE-IN-PICTURE ---
const pipBtn = document.getElementById('pip-btn');
const autoPipToggle = document.getElementById('auto-pip-toggle');
let pipWindow = null;

const screenChat = document.getElementById('screen-chat');

async function openPiP() {
  if (!('documentPictureInPicture' in window)) {
    if (autoPipToggle) autoPipToggle.checked = false;
    showToast('Ваш браузер не поддерживает Picture-in-Picture (нужен Chrome 116+)');
    return;
  }

  if (pipWindow) return;

  try {
    pipWindow = await documentPictureInPicture.requestWindow({
      width: 450,
      height: 600,
    });

    const styles = [...document.styleSheets];
    for (const styleSheet of styles) {
      const style = document.createElement('style');
      try {
        style.textContent = [...styleSheet.cssRules].map(rule => rule.cssText).join('');
      } catch {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = styleSheet.href;
        pipWindow.document.head.appendChild(link);
        continue;
      }
      pipWindow.document.head.appendChild(style);
    }

    const baseStyle = document.createElement('style');
    baseStyle.textContent = `
      body { background: var(--bg-color); height: 100vh; display: flex; flex-direction: column; padding: 10px; overflow: hidden; margin: 0; }
      #screen-chat { display: flex; flex-direction: column; height: 100%; }
    `;
    pipWindow.document.head.appendChild(baseStyle);

    pipWindow.document.body.appendChild(screenChat); 
    
    if (pipBtn) {
      pipBtn.textContent = '🔙';
      pipBtn.title = 'Вернуть в основное окно';
    }

    pipWindow.document.getElementById('user-input').focus();

    pipWindow.addEventListener('pagehide', () => {
      document.getElementById('app').appendChild(screenChat);
      
      if (pipBtn) {
        pipBtn.textContent = '🪟';
        pipBtn.title = 'Вынести в отдельное окно';
      }
      pipWindow = null;
      
      document.getElementById('user-input').focus();
    });

  } catch (error) {
    console.error('Ошибка PiP:', error);
    if (autoPipToggle && autoPipToggle.checked) {
      autoPipToggle.checked = false;
      showToast('Браузер заблокировал автоматическое открытие. Нажмите 🪟 вручную.');
    }
  }
}

if (pipBtn) {
  pipBtn.addEventListener('click', async () => {
    if (pipWindow) {
      pipWindow.close();
    } else {
      await openPiP();
    }
  });
}

document.addEventListener('visibilitychange', async () => {
  if (autoPipToggle && autoPipToggle.checked) {
    if (document.visibilityState === 'hidden' && !pipWindow) {
      await openPiP();
    }
  }
});

window.addEventListener('DOMContentLoaded', async () => {
  handleRoute();
  try {
    dbInstance = await initDB();
    const history = await getAllMessages(dbInstance);
    history.forEach(msg => {
      appendStaticMessage(msg.sender, msg.text, msg.className, msg.imageBase64);
    });
    console.log('[AI Chat] История успешно загружена из IndexedDB');
  } catch (err) {
    console.error('[AI Chat] Не удалось загрузить историю из IndexedDB', err);
  }

  if ('serviceWorker' in navigator) {
    if (process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js')
        .then(() => console.log('[AI Chat] Service Worker зарегистрирован (prod)'))
        .catch(err => console.error('[AI Chat] Ошибка SW:', err));
    } else {
      navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for(let registration of registrations) {
          registration.unregister();
          console.log('[AI Chat] Старый Service Worker удален (dev mode)');
        }
      });
    }
  }
  
  updateSendButtonState();
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
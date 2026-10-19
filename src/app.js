import './style.css';
import { initDB, saveMessage, getAllMessages } from './db.js';

let dbInstance = null;

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

// Безопасный рендеринг текста с поддержкой тегов <think>
function renderTextSafely(container, text) {
  container.innerHTML = ''; // Очищаем контейнер перед перерисовкой
  
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
      container.appendChild(thoughtDiv);
    } else if (part === '</think>') {
      isThought = false;
      currentSpan = null;
    } else if (part) {
      const target = isThought && currentSpan ? currentSpan : container;
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

function appendStaticMessage(sender, text, className) {
  const textContainer = createMessageElement(sender, className);
  if (className === 'ai') {
    renderTextSafely(textContainer, text);
  } else {
    textContainer.textContent = text;
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Всплывающее уведомление (Toast)
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

// Маппинг технических ошибок в user-friendly сообщения
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
  const text = userInput.value.trim();
  if (!text || !dbInstance) return;

  const selectedModel = modelSelect.value;
  userInput.value = '';

  // Отрисовка и сохранение сообщения пользователя
  appendStaticMessage('Вы', text, 'user');
  await saveMessage(dbInstance, { sender: 'Вы', text, className: 'user' });

  // Формируем контекст (всю историю) для отправки на сервер
  const allMessages = await getAllMessages(dbInstance);
  const messagesContext = allMessages.map(m => ({
    role: m.className === 'user' ? 'user' : 'assistant',
    content: m.text
  }));

  const aiName = selectedModel === 'qwen' ? 'Qwen' : 'DeepSeek';
  const aiContainer = createMessageElement(aiName, 'ai');
  
  let fullAIResponse = '';
  let fullReasoning = '';

  try {
    console.log('[AI Chat] Отправка запроса на сервер...');
    
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messagesContext, model: selectedModel })
    });

    if (!response.ok) throw new Error(`Network response was not ok: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop(); // Оставляем неполную строку

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.replace('data: ', '').trim();
        if (jsonStr === '[DONE]') break;
        
        try {
          const parsed = JSON.parse(jsonStr);
          
          if (parsed.type === 'system_alert') {
            console.warn('[AI Chat] Fallback сработал:', parsed.message);
            showToast(parsed.message);
          } else if (parsed.type === 'error') {
            console.error(`[AI Chat] Ошибка от сервера: ${parsed.message}`);
            
            const friendlyText = getFriendlyErrorMessage(parsed.message, parsed.message);
            showToast(`⚠️ ${friendlyText}`);
            aiContainer.textContent = `Ошибка: ${friendlyText}`;
            
            return; // Прерываем цикл, так как это фатальная ошибка
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

    // Сохраняем в БД итоговый ответ
    const textToSave = fullReasoning ? `<think>${fullReasoning}</think>\n${fullAIResponse}` : fullAIResponse;
    await saveMessage(dbInstance, { sender: aiName, text: textToSave, className: 'ai' });
    console.log('[AI Chat] Ответ успешно сохранен в IndexedDB');

  } catch (err) {
    console.error('[AI Chat] Критическая ошибка соединения:', err);
    
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
       aiContainer.textContent = 'Нет соединения с локальным сервером (Node.js). Проверьте, запущен ли он.';
       showToast('Сервер Node.js недоступен!');
    } else {
       aiContainer.textContent = 'Произошла непредвиденная ошибка.';
       showToast('Ошибка приложения');
    }
  }
});

window.addEventListener('DOMContentLoaded', async () => {
  handleRoute();
  try {
    dbInstance = await initDB();
    const history = await getAllMessages(dbInstance);
    history.forEach(msg => {
      appendStaticMessage(msg.sender, msg.text, msg.className);
    });
    console.log('[AI Chat] История успешно загружена из IndexedDB');
  } catch (err) {
    console.error('[AI Chat] Не удалось загрузить историю из IndexedDB', err);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(() => console.log('[AI Chat] Service Worker зарегистрирован'))
      .catch(err => console.error('[AI Chat] Ошибка SW:', err));
  }
});

let deferredPrompt;
const installBtn = document.getElementById('install-btn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.style.display = 'block';
});
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') installBtn.style.display = 'none';
  deferredPrompt = null;
});
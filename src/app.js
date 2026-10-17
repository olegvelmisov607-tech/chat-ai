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

function formatAIResponse(text) {
  if (!text) return '';
  let formatted = text;
  if (formatted.includes('<think>') && !formatted.includes('</think>')) {
    formatted = `${formatted.replace(/<think>/g, '<span class="thought"><strong>Рассуждение:</strong><br>')}</span>`;
  } else {
    formatted = formatted
      .replace(/<think>/g, '<span class="thought"><strong>Рассуждение:</strong><br>')
      .replace(/<\/think>/g, '</span>');
  }
  return formatted;
}

function createMessageElement(sender, className) {
  const messageElement = document.createElement('div');
  messageElement.className = `message ${className}`;
  
  const label = document.createElement('strong');
  label.textContent = `${sender}: `;
  messageElement.appendChild(label);

  const textSpan = document.createElement('span');
  messageElement.appendChild(textSpan);

  chatMessages.appendChild(messageElement);
  return textSpan;
}

function appendStaticMessage(sender, text, className) {
  const textSpan = createMessageElement(sender, className);
  if (className === 'ai') {
    textSpan.innerHTML = formatAIResponse(text);
  } else {
    textSpan.textContent = text;
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text || !dbInstance) return;

  const selectedModel = modelSelect.value;
  userInput.value = '';

  appendStaticMessage('Вы', text, 'user');
  await saveMessage(dbInstance, { sender: 'Вы', text, className: 'user' });

  const aiName = selectedModel === 'qwen' ? 'Qwen' : 'DeepSeek';
  const aiTextSpan = createMessageElement(aiName, 'ai');
  let fullAIResponse = '';

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text, model: selectedModel })
    });

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
        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.response) {
            fullAIResponse += parsed.response;
            aiTextSpan.innerHTML = formatAIResponse(fullAIResponse);
            chatMessages.scrollTop = chatMessages.scrollHeight;
          }
        } catch {
          // Игнорируем ошибки парсинга
        }
      }
    }

    await saveMessage(dbInstance, { sender: aiName, text: fullAIResponse, className: 'ai' });

  } catch {
    aiTextSpan.textContent = 'Ошибка соединения с сервером.';
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
  } catch (err) {
    console.error('Не удалось загрузить историю из IndexedDB', err);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(() => console.log('Service Worker зарегистрирован'))
      .catch(err => console.error('Ошибка SW:', err));
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
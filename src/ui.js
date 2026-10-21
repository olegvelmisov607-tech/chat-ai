// --- ФУНКЦИИ ОТРИСОВКИ СООБЩЕНИЙ ---
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

// --- УВЕДОМЛЕНИЯ (TOAST) ---
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

// --- УПРАВЛЕНИЕ КНОПКОЙ ОТПРАВКИ ---
export function updateSendButtonState(userInput, sendBtn, hasImage) {
  const hasText = userInput.value.trim().length > 0;
  sendBtn.disabled = !(hasText || hasImage);
}
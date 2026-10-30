// src/ui/messages.js
//
// Отвечает ТОЛЬКО за создание DOM-структуры сообщений.
// Не знает про рендеринг текста (делегирует в renderer.js).

import { renderTextSafely } from './renderer.js';

/**
 * Создаёт «пустой» пузырь сообщения (label + textContainer).
 * @param {string} sender
 * @param {'user'|'ai'|'operator'} className
 * @param {HTMLElement} chatMessagesContainer
 * @returns {HTMLElement} textContainer
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
 */
export function appendStaticMessage(sender, text, className, imageBase64 = null, chatMessagesContainer) {
  const textContainer = createMessageElement(sender, className, chatMessagesContainer);
  renderTextSafely(textContainer, text, imageBase64);
  chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}
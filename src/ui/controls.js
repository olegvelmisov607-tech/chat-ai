// src/ui/controls.js
//
// Отвечает ТОЛЬКО за состояние UI-контролов (кнопка отправки).
// Не знает про сообщения или рендеринг.

/**
 * Блокирует/разблокирует кнопку «Отправить».
 */
export function updateSendButtonState(userInput, sendBtn, hasImage) {
  const hasText = userInput.value.trim().length > 0;
  sendBtn.disabled = !(hasText || hasImage);
}

/**
 * Переключает кнопку отправки в режим STOP.
 */
export function toggleSendButtonToStop(sendBtn, isGenerating) {
  if (isGenerating) {
    sendBtn.disabled = false;
    sendBtn.classList.add('is-stop');
    
    const btnText = sendBtn.querySelector('.btn-text');
    const btnIcon = sendBtn.querySelector('.btn-icon');
    const btnIconStop = sendBtn.querySelector('.btn-icon-stop');
    
    if (btnText) btnText.textContent = 'Остановить';
    if (btnIcon) btnIcon.style.display = 'none';
    if (btnIconStop) btnIconStop.style.display = 'block';
  } else {
    sendBtn.classList.remove('is-stop');
    
    const btnText = sendBtn.querySelector('.btn-text');
    const btnIcon = sendBtn.querySelector('.btn-icon');
    const btnIconStop = sendBtn.querySelector('.btn-icon-stop');
    
    if (btnText) btnText.textContent = 'Отправить';
    if (btnIcon) btnIcon.style.display = 'block'; 
    if (btnIconStop) btnIconStop.style.display = 'none';
  }
}
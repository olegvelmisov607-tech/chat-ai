// src/controllers/chat-controller.js

import { saveMessage, getAllMessages } from '../db.js';
import { getAttachedImage, clearAttachment } from '../attachments.js';
import { 
  createMessageElement, 
  appendStaticMessage, 
  showToast, 
  updateSendButtonState, 
  toggleSendButtonToStop,
  renderSources,
  renderTextSafely
} from '../ui.js';
import { streamChat } from '../transport.js';

export class ChatController {
  /**
   * @param {Object} deps
   * @param {IDBDatabase} deps.db - Соединение с IndexedDB
   * @param {Object} deps.elements - DOM-ссылки (form, input, messagesContainer, sendBtn, modelSelect, tempSlider)
   * @param {BudgetController} deps.budgetController - Контроллер бюджета (Dependency Injection)
   * @param {Function} [deps.onGenerationStart] - Колбэк для синхронизации
   * @param {Function} [deps.onGenerationEnd] - Колбэк для синхронизации
   */
  constructor({ db, elements, budgetController, onGenerationStart, onGenerationEnd }) {
    this.db = db;
    this.elements = elements;
    this.budgetController = budgetController; // <--- Сохраняем зависимость
    this.onGenerationStart = onGenerationStart;
    this.onGenerationEnd = onGenerationEnd;
    
    this.currentAbortController = null;
  }

  init() {
    const { form, input, sendBtn } = this.elements;

    // Слушаем ввод, чтобы активировать/деактивировать кнопку
    input.addEventListener('input', () => {
      updateSendButtonState(input, sendBtn, !!getAttachedImage());
    });

    // Обработка сабмита формы
    form.addEventListener('submit', (e) => this.handleSubmit(e));

    // Инициализация состояния кнопки при старте
    updateSendButtonState(input, sendBtn, !!getAttachedImage());
  }

  async handleSubmit(e) {
    e.preventDefault();
    const { input, messagesContainer, modelSelect, tempSlider, sendBtn } = this.elements;

    // 1. Если идет генерация — останавливаем
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      return;
    }

    const imageBase64 = getAttachedImage();
    const text = input.value.trim();

    if ((!text && !imageBase64) || !this.db) return;

    const selectedModel = modelSelect.value;
    const temperature = tempSlider ? parseFloat(tempSlider.value) : 0.7;
    input.value = '';

    // 2. Отрисовка сообщения пользователя
    appendStaticMessage('Вы', text, 'user', imageBase64, messagesContainer);
    await saveMessage(this.db, { sender: 'Вы', text, className: 'user', imageBase64 });
    
    clearAttachment();
    updateSendButtonState(input, sendBtn, false);

    // 3. Подготовка контекста
    const allMessages = await getAllMessages(this.db);
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

    // 4. Отрисовка пузыря для ИИ
    let aiName = selectedModel === 'qwen' ? 'Qwen' : 'DeepSeek';
    const aiContainer = createMessageElement(aiName, 'ai', messagesContainer);
    
    let fullAIResponse = '';
    let fullReasoning = '';
    let searchSources = null;

    this.currentAbortController = new AbortController();
    const generationId = crypto.randomUUID();

    toggleSendButtonToStop(sendBtn, true);
    
    // Уведомляем "внешний мир", что мы начали
    if (this.onGenerationStart) this.onGenerationStart(generationId);

    try {
      // 5. Стриминг
      for await (const parsed of streamChat({ 
        messagesContext, 
        model: selectedModel, 
        temperature,
        generationId,
        signal: this.currentAbortController.signal
      })) {
        
        if (parsed.type === 'model_info') {
          aiName = parsed.modelName;
          const label = aiContainer.parentElement.querySelector('strong');
          if (label) label.textContent = `${aiName}: `;
        } 
        else if (parsed.type === 'system_alert') {
          showToast(parsed.message);
        } 
        else if (parsed.type === 'error') {
          showToast(`⚠️ ${parsed.message}`);
          aiContainer.textContent = `Ошибка: ${parsed.message}`;
          return;
        } 
        else if (parsed.type === 'sources') {
          searchSources = parsed.data;
        } 
        else if (parsed.type === 'reasoning') {
          fullReasoning += parsed.text;
          renderTextSafely(aiContainer, `<think>${fullReasoning}</think>${fullAIResponse}`);
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        } 
        else if (parsed.type === 'content') {
          fullAIResponse += parsed.text;
          if (fullReasoning) {
            renderTextSafely(aiContainer, `<think>${fullReasoning}</think>${fullAIResponse}`);
          } else {
            renderTextSafely(aiContainer, fullAIResponse);
          }
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
      }

      // 6. Сохранение
      let textToSave = fullReasoning ? `<think>${fullReasoning}</think>\n${fullAIResponse}` : fullAIResponse;
      
      if (searchSources && searchSources.length > 0) {
        renderSources(aiContainer, searchSources);
        textToSave += '\n\n**Источники:**\n' + searchSources.map(s => `- [${s.title}](${s.url})`).join('\n');
      }

      await saveMessage(this.db, { sender: aiName, text: textToSave, className: 'ai' });
      
      // ✅ Обновляем бюджет через внедренный контроллер
      if (this.budgetController) {
        await this.budgetController.updateUI();
      }

    } catch (err) {
      if (err.name === 'AbortError') {
         console.log('[Chat] Генерация остановлена');
         if (!fullAIResponse && !fullReasoning) {
            aiContainer.textContent = '⏹️ Генерация остановлена.';
         }
         return;
      }
      console.error('[Chat] Ошибка:', err);
      if (err.message === 'Unauthorized') {
         aiContainer.textContent = 'Ошибка авторизации. Проверьте токен.';
      } else {
         aiContainer.textContent = 'Произошла непредвиденная ошибка.';
         showToast('Ошибка приложения');
      }
    } finally {
      this.currentAbortController = null;
      toggleSendButtonToStop(sendBtn, false);
      updateSendButtonState(input, sendBtn, !!getAttachedImage());
      
      if (this.onGenerationEnd) this.onGenerationEnd(generationId);
    }
  }
}
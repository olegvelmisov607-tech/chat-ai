// tests/attachments.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initAttachments, getAttachedImage, clearAttachment } from '../src/attachments.js';

describe('attachments.js', () => {
  let els;

  beforeEach(() => {
    // Очищаем DOM и создаем нужные элементы
    document.body.innerHTML = `
      <div id="drop-zone"></div>
      <button id="attach-btn"></button>
      <input type="file" id="file-input" />
      <div id="image-preview-container" class="hidden"></div>
      <img id="image-preview" />
      <button id="remove-image-btn"></button>
      <textarea id="user-input"></textarea>
    `;
    
    // Инициализируем модуль (навешиваем события на новые элементы)
    initAttachments();
    
    // Сохраняем ссылки для удобства
    els = {
      dropZone: document.getElementById('drop-zone'),
      attachBtn: document.getElementById('attach-btn'),
      fileInput: document.getElementById('file-input'),
      previewContainer: document.getElementById('image-preview-container'),
      previewImg: document.getElementById('image-preview'),
      removeBtn: document.getElementById('remove-image-btn'),
      textarea: document.getElementById('user-input')
    };
    
    // Сбрасываем состояние
    clearAttachment();
  });

  it('должен возвращать null, если нет вложенного изображения', () => {
    expect(getAttachedImage()).toBeNull();
  });

  it('clearAttachment должен сбрасывать состояние и скрывать превью', () => {
    els.previewImg.setAttribute('src', 'data:image/png;base64,test');
    els.previewContainer.classList.remove('hidden');

    clearAttachment();

    expect(getAttachedImage()).toBeNull();
    expect(els.previewImg.hasAttribute('src')).toBe(false);
    expect(els.previewContainer.classList.contains('hidden')).toBe(true);
  });

  it('должен открывать диалог выбора файла при клике на скрепку', () => {
    const clickSpy = vi.spyOn(els.fileInput, 'click');
    els.attachBtn.click();
    expect(clickSpy).toHaveBeenCalled();
  });

  it('должен очищать input после выбора файла', () => {
    // Создаем НАСТОЯЩИЙ файл (Blob), чтобы FileReader не падал
    const realFile = new File(['(⌐□_□)'], 'test.png', { type: 'image/png' });
    
    // Подкидываем его в input
    Object.defineProperty(els.fileInput, 'files', {
      value: [realFile],
      configurable: true
    });
    
    els.fileInput.dispatchEvent(new Event('change'));
    
    expect(els.fileInput.value).toBe('');
  });

  it('должен добавлять класс drag-over при перетаскивании', () => {
    els.dropZone.dispatchEvent(new Event('dragenter'));
    expect(els.dropZone.classList.contains('drag-over')).toBe(true);
    
    els.dropZone.dispatchEvent(new Event('dragleave'));
    expect(els.dropZone.classList.contains('drag-over')).toBe(false);
  });

  it('должен вызывать remove при клике на кнопку удаления', () => {
    els.previewContainer.classList.remove('hidden');
    els.removeBtn.click();
    expect(els.previewContainer.classList.contains('hidden')).toBe(true);
  });

it('должен показывать alert при неверном формате файла', () => {
    // В happy-dom alert может не существовать, поэтому создаем заглушку
    window.alert = () => {}; 
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    
    const badFile = new File(['hello'], 'test.txt', { type: 'text/plain' });
    
    Object.defineProperty(els.fileInput, 'files', { value: [badFile], configurable: true });
    els.fileInput.dispatchEvent(new Event('change'));

    expect(alertSpy).toHaveBeenCalledWith('Поддерживаются только изображения (JPEG, PNG, WEBP, GIF).');
    alertSpy.mockRestore();
  });

  it('должен показывать alert, если файл слишком большой', () => {
    // В happy-dom alert может не существовать, поэтому создаем заглушку
    window.alert = () => {};
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    
    const bigFile = new File(['fake'], 'big.png', { type: 'image/png' });
    Object.defineProperty(bigFile, 'size', { value: 11 * 1024 * 1024 }); // 11 MB
    
    Object.defineProperty(els.fileInput, 'files', { value: [bigFile], configurable: true });
    els.fileInput.dispatchEvent(new Event('change'));

    expect(alertSpy).toHaveBeenCalledWith('Файл слишком большой (максимум 10 МБ).');
    alertSpy.mockRestore();
  });
});
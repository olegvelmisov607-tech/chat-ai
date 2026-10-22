// --- СОСТОЯНИЕ ВЛОЖЕНИЯ ---
let attachedImageBase64 = null;

// Функция для получения актуальных DOM-элементов (ленивая инициализация)
function getElements() {
  return {
    dropZone: document.getElementById('drop-zone'),
    attachBtn: document.getElementById('attach-btn'),
    fileInput: document.getElementById('file-input'),
    previewContainer: document.getElementById('image-preview-container'),
    previewImg: document.getElementById('image-preview'),
    removeBtn: document.getElementById('remove-image-btn'),
    textarea: document.getElementById('user-input')
  };
}

// --- ИНИЦИАЛИЗАЦИЯ СЛУШАТЕЛЕЙ ---
// Вызываем эту функцию один раз при старте приложения (в app.js)
export function initAttachments() {
  const els = getElements();
  
  if (els.attachBtn) {
    els.attachBtn.addEventListener('click', () => els.fileInput.click());
  }

  if (els.fileInput) {
    els.fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) processFile(file);
      els.fileInput.value = ''; 
    });
  }

  if (els.textarea) {
    els.textarea.addEventListener('paste', (e) => {
      const items = e.clipboardData.items;
      for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
          const file = item.getAsFile();
          if (file) processFile(file);
          e.preventDefault(); 
          break;
        }
      }
    });
  }

  if (els.dropZone) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      els.dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    els.dropZone.addEventListener('dragenter', () => els.dropZone.classList.add('drag-over'));
    els.dropZone.addEventListener('dragover', () => els.dropZone.classList.add('drag-over'));
    els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('drag-over'));

    els.dropZone.addEventListener('drop', (e) => {
      els.dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        processFile(file);
      }
    });
  }

  if (els.removeBtn) {
    els.removeBtn.addEventListener('click', () => {
      clearAttachment();
    });
  }
}

// --- ОБРАБОТКА ФАЙЛА (FileReader) ---
function processFile(file) {
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB
  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const els = getElements();

  if (!ALLOWED.includes(file.type)) {
    alert('Поддерживаются только изображения (JPEG, PNG, WEBP, GIF).');
    return;
  }
  if (file.size > MAX_SIZE) {
    alert('Файл слишком большой (максимум 10 МБ).');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    attachedImageBase64 = e.target.result; 
    if (els.previewImg) els.previewImg.src = attachedImageBase64;
    if (els.previewContainer) els.previewContainer.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

// --- ЭКСПОРТ ФУНКЦИЙ ДЛЯ APP.JS ---
export function getAttachedImage() {
  return attachedImageBase64;
}

export function clearAttachment() {
  attachedImageBase64 = null;
  const els = getElements();
  if (els.previewImg) els.previewImg.removeAttribute('src'); 
  if (els.previewContainer) els.previewContainer.classList.add('hidden');
}
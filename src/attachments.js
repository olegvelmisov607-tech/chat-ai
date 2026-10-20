// --- СОСТОЯНИЕ ВЛОЖЕНИЯ ---
let attachedImageBase64 = null;

// --- DOM ЭЛЕМЕНТЫ ---
const dropZone = document.getElementById('drop-zone');
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');
const previewContainer = document.getElementById('image-preview-container');
const previewImg = document.getElementById('image-preview');
const removeBtn = document.getElementById('remove-image-btn');
const textarea = document.getElementById('user-input'); // Исправлено на user-input

// --- 1. КЛИК ПО СКРЕПКЕ ---
if (attachBtn) {
  attachBtn.addEventListener('click', () => fileInput.click());
}

// --- 2. ВЫБОР ФАЙЛА ЧЕРЕЗ ДИАЛОГ ---
if (fileInput) {
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) processFile(file);
    fileInput.value = ''; // Сброс
  });
}

// --- 3. ВСТАВКА ИЗ БУФЕРА (Ctrl+V) ---
if (textarea) {
  textarea.addEventListener('paste', (e) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) processFile(file);
        e.preventDefault(); // Не вставляем бинарный мусор в текст
        break;
      }
    }
  });
}

// --- 4. DRAG-N-DROP ---
if (dropZone) {
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  dropZone.addEventListener('dragenter', () => dropZone.classList.add('drag-over'));
  dropZone.addEventListener('dragover', () => dropZone.classList.add('drag-over'));
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));

  dropZone.addEventListener('drop', (e) => {
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      processFile(file);
    }
  });
}

// --- 5. ОБРАБОТКА ФАЙЛА (FileReader) ---
function processFile(file) {
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB
  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

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
    attachedImageBase64 = e.target.result; // data:image/jpeg;base64,...
    previewImg.src = attachedImageBase64;
    previewContainer.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

// --- 6. УДАЛЕНИЕ ПРЕВЬЮ ---
if (removeBtn) {
  removeBtn.addEventListener('click', () => {
    clearAttachment();
  });
}

// --- ЭКСПОРТ ФУНКЦИЙ ДЛЯ APP.JS ---
export function getAttachedImage() {
  return attachedImageBase64;
}

export function clearAttachment() {
  attachedImageBase64 = null;
  if (previewImg) previewImg.src = '';
  if (previewContainer) previewContainer.classList.add('hidden');
}
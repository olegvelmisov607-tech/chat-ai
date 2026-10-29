// src/db.js
// Тонкая обёртка над IndexedDB для истории чата.
// ⚠️ Обратите внимание: все функции принимают уже открытый `db`,
// а не открывают его заново — это правильно, открытие IndexedDB дорогое.

const DB_NAME = 'ChatDB';
const DB_VERSION = 1;
const STORE_NAME = 'messages';

/**
 * Открывает (или создаёт) базу IndexedDB и возвращает соединение.
 * При первом запуске создаёт object store `messages` с автоинкрементным ключом.
 *
 * @returns {Promise<IDBDatabase>}
 */
export function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    // Вызывается только при создании БД или повышении версии.
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

/**
 * Сохраняет одно сообщение в историю.
 * @param {Object} message
 * @param {string} message.sender
 * @param {string} message.text
 * @param {string} message.className
 * @param {string} [message.imageBase64] - Опционально (квадратные скобки в JSDoc означают опциональность)
 * @returns {Promise<number>} — сгенерированный id
 */
export async function saveMessage(db, message) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(message);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Возвращает ВСЮ историю сообщений.
 * ⚠️ Для больших историй это дорого — со временем стоит добавить пагинацию
 * (например, `getMessages(db, { limit, beforeId })`).
 *
 * @param {IDBDatabase} db
 * @returns {Promise<Array<Object>>}
 */
export async function getAllMessages(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
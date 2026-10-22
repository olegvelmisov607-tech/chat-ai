import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDB, saveMessage, getAllMessages } from '../src/db.js';

describe('db.js (IndexedDB)', () => {
  let db;

  // Перед каждым тестом создаем чистую базу
  beforeEach(async () => {
    db = await initDB();
  });

  // После каждого теста удаляем базу, чтобы следующий тест начался с чистого листа
  afterEach(async () => {
    if (db) {
      db.close();
      await new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase('ChatDB');
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve(); // На случай блокировки
      });
    }
  });

  it('должен инициализировать базу и создавать хранилище messages', () => {
    expect(db).toBeTruthy();
    expect(db.objectStoreNames.contains('messages')).toBe(true);
  });

  it('должен сохранять сообщение и возвращать его ID', async () => {
    const message = { sender: 'Вы', text: 'Привет!', className: 'user' };
    
    const id = await saveMessage(db, message);
    
    // IndexedDB генерирует ID автоматически (autoIncrement)
    expect(id).toBeTypeOf('number');
    expect(id).toBeGreaterThan(0);
  });

  it('должен возвращать все сохраненные сообщения в правильном порядке', async () => {
    // Сохраняем два сообщения
    await saveMessage(db, { sender: 'Вы', text: 'Первое', className: 'user' });
    await saveMessage(db, { sender: 'ИИ', text: 'Второе', className: 'ai' });
    
    const messages = await getAllMessages(db);
    
    expect(messages).toHaveLength(2);
    expect(messages[0].text).toBe('Первое');
    expect(messages[0].className).toBe('user');
    expect(messages[1].text).toBe('Второе');
    expect(messages[1].className).toBe('ai');
  });

  it('должен возвращать пустой массив, если сообщений нет', async () => {
    const messages = await getAllMessages(db);
    expect(messages).toEqual([]);
  });
});
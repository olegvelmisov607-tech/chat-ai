import { describe, it, expect, vi, beforeEach } from 'vitest';
import { streamChat } from '../src/transport.js';

describe('transport.js', () => {
  beforeEach(() => {
    // Мокаем localStorage (безопасный способ)
    localStorage.clear();
    localStorage.setItem('chat_auth_token', 'test-token');
    localStorage.setItem('chat_user_id', 'test-user');
  });

  it('должен успешно стримить данные через WebSocket', async () => {
    const mockWs = {
      readyState: 1, // OPEN
      send: vi.fn(),
      close: vi.fn(),
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
    };

    // ВАЖНО: используем function(), чтобы это был конструктор
    global.WebSocket = vi.fn().mockImplementation(function() {
      setTimeout(() => {
        if (mockWs.onopen) mockWs.onopen();
        
        setTimeout(() => {
          if (mockWs.onmessage) mockWs.onmessage({ data: JSON.stringify({ type: 'content', text: 'Hello' }) });
          if (mockWs.onmessage) mockWs.onmessage({ data: '[DONE]' });
        }, 10);
      }, 10);
      return mockWs;
    });
    global.WebSocket.OPEN = 1;

    const generator = streamChat({
      messagesContext: [],
      model: 'qwen',
      temperature: 0.7,
      generationId: 'gen-1',
      signal: new AbortController().signal,
    });

    const chunks = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ type: 'content', text: 'Hello' }]);
    expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('chat_start'));
  });

  it('должен сделать фолбэк на SSE, если WebSocket не открылся', async () => {
    // Имитируем ошибку WebSocket
    global.WebSocket = vi.fn().mockImplementation(function() {
      const mockWs = {
        readyState: 0,
        close: vi.fn(),
        onerror: null,
      };
      setTimeout(() => {
        if (mockWs.onerror) mockWs.onerror();
      }, 10);
      return mockWs;
    });

    // Мокаем fetch для SSE
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"type":"content","text":"SSE"}\n\n') })
            .mockResolvedValueOnce({ done: true }),
        }),
      },
    });

    const generator = streamChat({
      messagesContext: [],
      model: 'qwen',
      temperature: 0.7,
      generationId: 'gen-2',
      signal: new AbortController().signal,
    });

    const chunks = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ type: 'content', text: 'SSE' }]);
  });
});
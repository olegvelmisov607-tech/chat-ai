// server/mcp-manager.js
//
// Менеджер MCP-серверов. Держит пул клиентов (по имени сервера),
// агрегирует их инструменты в формат OpenAI Tools и маршрутизирует вызовы
// к нужному серверу по имени инструмента.
//
// Используется из fallback.js: getAllToolsAsOpenAI() → в системный промпт,
// callTool(name, args) → когда модель решила вызвать инструмент.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Пул MCP-клиентов и карта «инструмент → сервер».
 *
 * Жизненный цикл:
 *   new MCPManager()
 *     → connectServer(...) для каждого сервера
 *     → getAllToolsAsOpenAI() / callTool(...) в рантайме
 *     → disconnectAll() при остановке приложения
 */
export class MCPManager {
  constructor() {
    /** @type {Map<string, Client>} */
    this.clients = new Map();

    /** @type {Map<string, string>} */
    this.toolToServer = new Map();
  }

  /**
   * Подключается к MCP-серверу по stdio (запускает дочерний процесс).
   *
   * ⚠️ Побочный эффект: `connectServer` сразу делает `listTools()` и заполняет
   * `toolToServer`. Если у двух серверов окажется инструмент с одинаковым именем —
   * второй молча перезапишет первый в мапе. Для учебного проекта ок,
   * в проде стоит либо запрещать коллизии, либо неймспейсить (server:tool).
   *
   * @param {string} name - Уникальное имя сервера (например, 'filesystem').
   * @param {string} command - Команда запуска (например, 'npx').
   * @param {string[]} args - Аргументы (например, ['-y', '@modelcontextprotocol/server-filesystem', '/tmp']).
   * @returns {Promise<Array<Object>>} список инструментов, которые предоставил сервер
   */
  async connectServer(name, command, args) {
    const transport = new StdioClientTransport({ command, args });
    const client = new Client(
      { name: 'chat-app-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await client.connect(transport);
    this.clients.set(name, client);

    // Запоминаем, какой сервер владеет каким инструментом.
    // Это нужно, чтобы callTool() знал, куда маршрутизировать вызов.
    const { tools } = await client.listTools();
    for (const tool of tools) {
      this.toolToServer.set(tool.name, name);
    }

    console.log(`[MCP] Подключен сервер "${name}", инструментов: ${tools.length}`);
    return tools;
  }

  /**
   * Возвращает ВСЕ инструменты всех подключённых серверов в формате OpenAI Tools.
   *
   * ⚠️ Сейчас метод делает `listTools()` при КАЖДОМ вызове — а вызывается он
   * в fallback.js на каждый чат-запрос. Лишний round-trip к каждому MCP-серверу
   * на каждое сообщение пользователя. Логичнее кешировать список при connectServer
   * и инвалидировать только при переподключении.
   *
   * Ещё нюанс: порядок инструментов может меняться между вызовами — для локальной
   * Qwen это лишний шум в системном промпте (она чувствительна к стабильности).
   *
   * @returns {Promise<Array<{type:'function', function:{name:string, description:string, parameters:Object}}>>}
   */
  async getAllToolsAsOpenAI() {
    const allTools = [];
    for (const [name, client] of this.clients.entries()) {
      const { tools } = await client.listTools();
      for (const tool of tools) {
        allTools.push({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description || `Инструмент ${tool.name}`,
            // inputSchema в MCP уже почти в формате JSON Schema — достаточно
            // подставить как parameters. Fallback на пустой объект — для инструментов
            // без аргументов.
            parameters: tool.inputSchema || { type: 'object', properties: {} }
          }
        });
      }
    }
    return allTools;
  }

  /**
   * Вызывает инструмент на соответствующем MCP-сервере.
   *
   * ⚠️ Две ловушки harness'а:
   *  1. `result.isError` (флаг ошибки от MCP) здесь ИГНОРИРУЕТСЯ — текст ошибки
   *     вернётся как обычный успешный результат. Модель не поймёт, что вызов
   *     провалился. Решение: возвращать структурированный { ok, text } или
   *     хотя бы префикс "[ERROR]" в текст.
   *  2. Склеиваются только `text`-части. Если инструмент вернёт изображение
   *     или ресурс — они потеряются молча.
   *
   * @param {string} toolName
   * @param {Object} args
   * @returns {Promise<string>} склеенный текстовый результат
   * @throws {Error} если инструмент не найден ни на одном сервере
   */
  async callTool(toolName, args) {
    const serverName = this.toolToServer.get(toolName);
    if (!serverName) {
      throw new Error(`Инструмент "${toolName}" не найден ни на одном сервере`);
    }
    const client = this.clients.get(serverName);
    const result = await client.callTool({ name: toolName, arguments: args });

    // MCP возвращает массив контента (текст, изображения и т.д.).
    // Для простоты склеиваем только текстовые части.
    const text = result.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    return text;
  }

  /**
   * Закрывает все клиенты и очищает карты.
   * Вызывать при graceful shutdown (SIGTERM / SIGINT).
   *
   * ⚠️ Сейчас никто не вызывает disconnectAll() — при остановке сервера
   * дочерние процессы npx/серверов могут остаться висеть. Стоит добавить
   * обработчик сигналов в server.js.
   *
   * @returns {Promise<void>}
   */
  async disconnectAll() {
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
    this.toolToServer.clear();
  }
}

// Singleton: на всё приложение один менеджер.
// Подключается в server.js (bootstrap), используется в fallback.js.
export const mcpManager = new MCPManager();
// server/mcp-manager.js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export class MCPManager {
  constructor() {
    this.clients = new Map(); // serverName -> Client
    this.toolToServer = new Map(); // toolName -> serverName
  }

  /**
   * Подключается к MCP-серверу.
   * @param {string} name - Уникальное имя сервера (например, 'filesystem')
   * @param {string} command - Команда запуска (например, 'npx')
   * @param {string[]} args - Аргументы (например, ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'])
   */
  async connectServer(name, command, args) {
    const transport = new StdioClientTransport({ command, args });
    const client = new Client(
      { name: 'chat-app-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await client.connect(transport);
    this.clients.set(name, client);

    // Получаем инструменты и запоминаем, какому серверу они принадлежат
    const { tools } = await client.listTools();
    for (const tool of tools) {
      this.toolToServer.set(tool.name, name);
    }

    console.log(`[MCP] Подключен сервер "${name}", инструментов: ${tools.length}`);
    return tools;
  }

  /**
   * Возвращает все доступные инструменты в формате OpenAI Tools.
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
            parameters: tool.inputSchema || { type: 'object', properties: {} }
          }
        });
      }
    }
    return allTools;
  }

  /**
   * Вызывает инструмент на соответствующем MCP-сервере.
   */
  async callTool(toolName, args) {
    const serverName = this.toolToServer.get(toolName);
    if (!serverName) {
      throw new Error(`Инструмент "${toolName}" не найден ни на одном сервере`);
    }
    const client = this.clients.get(serverName);
    const result = await client.callTool({ name: toolName, arguments: args });
    // MCP возвращает массив контента (текст, изображения и т.д.)
    // Для простоты склеиваем текстовые части
    const text = result.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
    return text;
  }

  async disconnectAll() {
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
    this.toolToServer.clear();
  }
}

export const mcpManager = new MCPManager();
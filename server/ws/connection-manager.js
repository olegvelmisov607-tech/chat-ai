// server/ws/connection-manager.js
import { WebSocket } from 'ws';

export class ConnectionManager {
  constructor() {
    // userId -> Set<WebSocket> (для синхронизации вкладок)
    this.userSockets = new Map();
    // roomId -> { clients: Set<WebSocket>, operators: Set<WebSocket> }
    this.rooms = new Map();
  }

  // ==========================================
  // 1. ПОЛЬЗОВАТЕЛИ (Синхронизация вкладок)
  // ==========================================
  
  addUserSocket(userId, ws) {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId).add(ws);
  }

  removeUserSocket(userId, ws) {
    if (this.userSockets.has(userId)) {
      this.userSockets.get(userId).delete(ws);
      if (this.userSockets.get(userId).size === 0) {
        this.userSockets.delete(userId);
      }
    }
  }

  broadcastToUser(userId, excludeWs, data) {
    const sockets = this.userSockets.get(userId);
    if (!sockets) return;
    
    const payload = JSON.stringify(data);
    for (const socket of sockets) {
      if (socket !== excludeWs && socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    }
  }

  // ==========================================
  // 2. КОМНАТЫ (Клиент + Оператор)
  // ==========================================

  createRoom(roomId) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, { clients: new Set(), operators: new Set() });
    }
    return this.rooms.get(roomId);
  }

  addClientToRoom(roomId, ws) {
    const room = this.createRoom(roomId);
    room.clients.add(ws);
  }

  addOperatorToRoom(roomId, ws) {
    const room = this.createRoom(roomId);
    room.operators.add(ws);
  }

  removeFromRoom(roomId, ws) {
    if (!this.rooms.has(roomId)) return;
    const room = this.rooms.get(roomId);
    room.clients.delete(ws);
    room.operators.delete(ws);
    
    // Если комната пуста — удаляем
    if (room.clients.size === 0 && room.operators.size === 0) {
      this.rooms.delete(roomId);
    }
  }

  broadcastToRoom(roomId, data) {
    if (!this.rooms.has(roomId)) return;
    const room = this.rooms.get(roomId);
    const payload = JSON.stringify(data);

    // Шлем всем: и клиентам, и операторам
    for (const socket of [...room.clients, ...room.operators]) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    }
  }
}
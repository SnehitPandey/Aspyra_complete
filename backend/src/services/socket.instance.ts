import type { SocketService } from './socket.service.js';

// Simple holder for the active SocketService instance to avoid circular imports
export let socketServiceInstance: SocketService | null = null;

export function setSocketServiceInstance(svc: SocketService) {
  socketServiceInstance = svc;
}

export function getSocketServiceInstance(): SocketService | null {
  return socketServiceInstance;
}

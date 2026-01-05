/**
 * Presence Service
 * Discord-style presence system with heartbeat mechanism
 * Handles user online/offline status, activity tracking, and graceful reconnection
 */

import { Server as SocketIOServer, Socket } from 'socket.io';

// User presence state interface
interface UserPresenceState {
  userId: string;
  username: string;
  status: 'online' | 'idle' | 'dnd' | 'offline';
  activity: string | null;
  lastPing: number;
  socketId: string;
  roomId?: string;
}

// Configuration constants
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const PRESENCE_TIMEOUT = 45000; // 45 seconds
const CLEANUP_INTERVAL = 30000; // Run cleanup every 30 seconds

export class PresenceService {
  private io: SocketIOServer;
  private userPresence: Map<string, UserPresenceState>;
  private cleanupInterval: NodeJS.Timeout | null;

  constructor(io: SocketIOServer) {
    this.io = io;
    this.userPresence = new Map();
    this.cleanupInterval = null;
    this.startCleanupJob();
  }

  /**
   * Initialize presence system for a socket connection
   */
  public initializeConnection(socket: Socket): void {
    let currentUserId: string | null = null;

    // Handle presence initialization
    socket.on('presence:init', (data: { userId: string; username: string; roomId?: string }) => {
      const { userId, username, roomId } = data;
      currentUserId = userId;

      console.log(`[Presence] User ${username} (${userId}) initialized presence`);

      // Check if user already has a presence entry
      const existingPresence = this.userPresence.get(userId);
      
      // Update or create presence state
      const presenceState: UserPresenceState = {
        userId,
        username,
        status: 'online',
        activity: existingPresence?.activity || null,
        lastPing: Date.now(),
        socketId: socket.id,
        roomId: roomId || existingPresence?.roomId,
      };

      this.userPresence.set(userId, presenceState);

      // Broadcast to all clients
      this.broadcastPresenceUpdate(userId, {
        status: 'online',
        activity: presenceState.activity,
        username,
        roomId: presenceState.roomId,
      });

      // Send current presence state to newly connected user
      this.sendPresenceSnapshot(socket);
    });

    // Handle heartbeat to keep user alive
    socket.on('presence:heartbeat', () => {
      if (currentUserId && this.userPresence.has(currentUserId)) {
        const presence = this.userPresence.get(currentUserId)!;
        presence.lastPing = Date.now();
        presence.socketId = socket.id; // Update socket ID in case of reconnection
        
        console.log(`[Presence] Heartbeat from ${presence.username} (${currentUserId})`);
      }
    });

    // Handle status/activity updates
    socket.on('presence:update', (data: { status?: 'online' | 'idle' | 'dnd' | 'offline'; activity?: string | null }) => {
      if (!currentUserId || !this.userPresence.has(currentUserId)) {
        console.warn(`[Presence] Update from unknown user: ${currentUserId}`);
        return;
      }

      const presence = this.userPresence.get(currentUserId)!;
      
      // Update status if provided
      if (data.status !== undefined) {
        presence.status = data.status;
      }

      // Update activity if provided
      if (data.activity !== undefined) {
        presence.activity = data.activity;
      }

      presence.lastPing = Date.now();

      console.log(`[Presence] ${presence.username} updated: ${presence.status}${presence.activity ? ` - ${presence.activity}` : ''}`);

      // Broadcast update
      this.broadcastPresenceUpdate(currentUserId, {
        status: presence.status,
        activity: presence.activity,
        username: presence.username,
        roomId: presence.roomId,
      });
    });

    // Handle room joining (for room-specific presence)
    socket.on('presence:joinRoom', (data: { roomId: string }) => {
      if (!currentUserId || !this.userPresence.has(currentUserId)) return;

      const presence = this.userPresence.get(currentUserId)!;
      presence.roomId = data.roomId;
      presence.lastPing = Date.now();

      console.log(`[Presence] ${presence.username} joined room ${data.roomId}`);
    });

    // Handle room leaving
    socket.on('presence:leaveRoom', () => {
      if (!currentUserId || !this.userPresence.has(currentUserId)) return;

      const presence = this.userPresence.get(currentUserId)!;
      presence.roomId = undefined;
      presence.lastPing = Date.now();

      console.log(`[Presence] ${presence.username} left room`);
    });

    // Handle disconnect - DO NOT immediately mark offline
    // Let the timeout mechanism handle it for graceful reconnection
    socket.on('disconnect', (reason: string) => {
      if (currentUserId && this.userPresence.has(currentUserId)) {
        const presence = this.userPresence.get(currentUserId)!;
        console.log(`[Presence] ${presence.username} disconnected: ${reason} (waiting for timeout)`);
      }
    });
  }

  /**
   * Send current presence snapshot to a newly connected client
   */
  private sendPresenceSnapshot(socket: Socket): void {
    const snapshot: Record<string, { status: string; activity: string | null; username: string; roomId?: string }> = {};
    
    for (const [userId, presence] of this.userPresence.entries()) {
      snapshot[userId] = {
        status: presence.status,
        activity: presence.activity,
        username: presence.username,
        roomId: presence.roomId,
      };
    }

    socket.emit('presence:snapshot', snapshot);
    console.log(`[Presence] Sent snapshot with ${Object.keys(snapshot).length} users`);
  }

  /**
   * Broadcast presence update to all connected clients
   */
  private broadcastPresenceUpdate(
    userId: string,
    data: { status: string; activity: string | null; username: string; roomId?: string }
  ): void {
    this.io.emit('presence:update', {
      userId,
      ...data,
    });
  }

  /**
   * Check for stale presence and mark users as offline
   */
  private checkStalePresence(): void {
    const now = Date.now();
    let offlineCount = 0;

    for (const [userId, presence] of this.userPresence.entries()) {
      const timeSinceLastPing = now - presence.lastPing;

      // If user hasn't pinged in PRESENCE_TIMEOUT, mark as offline
      if (timeSinceLastPing > PRESENCE_TIMEOUT && presence.status !== 'offline') {
        console.log(`[Presence] ${presence.username} timed out (${timeSinceLastPing}ms since last ping)`);
        
        presence.status = 'offline';
        presence.activity = null;

        // Broadcast offline status
        this.broadcastPresenceUpdate(userId, {
          status: 'offline',
          activity: null,
          username: presence.username,
          roomId: presence.roomId,
        });

        offlineCount++;
      }
    }

    if (offlineCount > 0) {
      console.log(`[Presence] Cleanup: Marked ${offlineCount} users as offline`);
    }
  }

  /**
   * Start background cleanup job
   */
  private startCleanupJob(): void {
    console.log('[Presence] Starting cleanup job');
    
    this.cleanupInterval = setInterval(() => {
      this.checkStalePresence();
    }, CLEANUP_INTERVAL);
  }

  /**
   * Stop cleanup job
   */
  public stopCleanupJob(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('[Presence] Cleanup job stopped');
    }
  }

  /**
   * Get user presence status
   */
  public getUserPresence(userId: string): UserPresenceState | null {
    return this.userPresence.get(userId) || null;
  }

  /**
   * Check if user is online
   */
  public isUserOnline(userId: string): boolean {
    const presence = this.userPresence.get(userId);
    return presence ? presence.status !== 'offline' : false;
  }

  /**
   * Get all users in a specific room
   */
  public getUsersInRoom(roomId: string): UserPresenceState[] {
    const users: UserPresenceState[] = [];
    
    for (const presence of this.userPresence.values()) {
      if (presence.roomId === roomId && presence.status !== 'offline') {
        users.push(presence);
      }
    }

    return users;
  }

  /**
   * Get presence statistics
   */
  public getStats(): { total: number; online: number; idle: number; dnd: number; offline: number } {
    const stats = { total: 0, online: 0, idle: 0, dnd: 0, offline: 0 };

    for (const presence of this.userPresence.values()) {
      stats.total++;
      stats[presence.status]++;
    }

    return stats;
  }

  /**
   * Force a user offline (for admin purposes)
   */
  public forceOffline(userId: string): boolean {
    const presence = this.userPresence.get(userId);
    if (!presence) return false;

    presence.status = 'offline';
    presence.activity = null;

    this.broadcastPresenceUpdate(userId, {
      status: 'offline',
      activity: null,
      username: presence.username,
      roomId: presence.roomId,
    });

    return true;
  }

  /**
   * Clean up all presence data (for shutdown)
   */
  public cleanup(): void {
    this.stopCleanupJob();
    this.userPresence.clear();
    console.log('[Presence] Service cleaned up');
  }
}

// Export singleton instance (will be initialized in socket.service.ts)
let presenceServiceInstance: PresenceService | null = null;

export const initializePresenceService = (io: SocketIOServer): PresenceService => {
  if (!presenceServiceInstance) {
    presenceServiceInstance = new PresenceService(io);
  }
  return presenceServiceInstance;
};

export const getPresenceService = (): PresenceService | null => {
  return presenceServiceInstance;
};

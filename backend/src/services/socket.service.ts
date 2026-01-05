import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { roomService } from './room.service.js';
import { authService } from './auth.service.js';
import { getChatQueue, type ChatMessageJob } from '../config/queue.js';
import { initializePresenceService, getPresenceService } from './presence.service.js';
import type { Logger } from 'pino';

// FIX: Added a simple interface to type the chat message object
// This resolves the implicit 'any' error in the 'chatHistory' map function.
interface PopulatedMessage {
  id: string;
  user: { name: string };
  content: string;
  type: 'TEXT' | 'SYSTEM';
  createdAt: Date;
}

export interface SocketUser {
  id: string;
  name: string;
  email: string;
}

export interface AuthenticatedSocket extends Socket {
  user: SocketUser;
}

export class SocketService {
  // FIX: Marked properties as 'readonly' as they are only set in the constructor.
  private readonly io: SocketIOServer;
  // FIX: Changed type to 'Logger | null' to work with 'exactOptionalPropertyTypes'.
  private readonly logger: Logger | null;
  // Map of userId -> set of socketIds for quick per-user emitting
  private readonly userSockets: Map<string, Set<string>> = new Map();
  // Map of userId -> last activity state for presence tracking
  private readonly userActivity: Map<string, { studying: string | null; topicName: string | null; lastSeen: number }> = new Map();
  // Map of userId -> disconnect timeout (for debouncing offline status)
  private readonly disconnectTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(httpServerOrIo: HttpServer | SocketIOServer, logger?: Logger) {
    // FIX: Assigned 'logger ?? null' to satisfy strict type checking.
    this.logger = logger ?? null;
    
    // Check if we received a Socket.IO server or HTTP server
    if (httpServerOrIo instanceof SocketIOServer) {
      // Use the existing Socket.IO server instance
      this.io = httpServerOrIo;
      this.logger?.info('SocketService using existing Socket.IO server instance');
    } else {
      // Create a new Socket.IO server from HTTP server
      this.io = new SocketIOServer(httpServerOrIo, {
        cors: {
          origin: env.SOCKET_IO_CORS_ORIGIN,
          methods: ['GET', 'POST'],
          credentials: true,
        },
        connectionStateRecovery: {
          maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
        },
      });
      this.logger?.info('SocketService created new Socket.IO server instance');
    }

    // Initialize Discord-style presence service
    initializePresenceService(this.io);
    this.logger?.info('✅ Presence service initialized');

    this.setupMiddleware();
    this.setupEventHandlers();
    this.startHeartbeatMonitor();
  }

  /**
   * Start heartbeat monitor - checks for stale connections every 30 seconds
   * Marks users offline if no heartbeat received in last 30 seconds
   */
  private startHeartbeatMonitor(): void {
    setInterval(() => {
      const now = Date.now();
      const HEARTBEAT_TIMEOUT = 30000; // 30 seconds

      // Check all connected sockets
      this.io.sockets.sockets.forEach((socket) => {
        const lastSeen = socket.data.lastSeen || socket.handshake.time;
        const userId = socket.data.user?.id;

        if (userId && now - lastSeen > HEARTBEAT_TIMEOUT) {
          // No heartbeat received - disconnect socket
          this.logger?.warn({ userId, socketId: socket.id }, 'Socket heartbeat timeout - disconnecting');
          socket.disconnect(true);
        }
      });
    }, 30000); // Check every 30 seconds

    this.logger?.info('Heartbeat monitor started (30s interval)');
  }

  private setupMiddleware(): void {
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
        
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        const payload = jwt.verify(token, env.JWT_SECRET) as any;
        const user = await authService.getUserById(payload.userId);

        if (!user) {
          return next(new Error('User not found'));
        }

        (socket as AuthenticatedSocket).user = {
          id: user.id,
          name: user.name,
          email: user.email,
        };

        // Also set socket.data for consistency
        socket.data.user = {
          id: user.id,
          name: user.name,
          email: user.email,
        };

        next();
      } catch (error) {
        // FIX: Added logging to the catch block to handle the exception.
        this.logger?.error({ error }, 'Socket authentication failed');
        next(new Error('Invalid authentication token'));
      }
    });
  }

  private setupEventHandlers(): void {
    // ✅ Handle connection errors at server level
    this.io.engine.on('connection_error', (err) => {
      this.logger?.error({
        code: err.code,
        message: err.message,
        context: err.context,
      }, '❌ Socket.IO engine connection error');
    });

    this.io.on('connection', (socket: Socket) => {
      const authenticatedSocket = socket as AuthenticatedSocket;
      const user = authenticatedSocket.user;

      this.logger?.info({
        userId: user.id,
        userName: user.name,
        socketId: socket.id,
        transport: socket.conn.transport.name,
      }, '✅ User connected to Socket.IO');

      // Initialize Discord-style presence system for this connection
      const presenceService = getPresenceService();
      if (presenceService) {
        presenceService.initializeConnection(socket);
      }

      // ✅ Handle socket-level errors
      socket.on('error', (error) => {
        this.logger?.error({
          userId: user.id,
          socketId: socket.id,
          error: error.message,
        }, '❌ Socket error occurred');
      });

      // Track socket id by user for per-user emits
      try {
        const set = this.userSockets.get(user.id) || new Set<string>();
        const wasOffline = set.size === 0;
        set.add(socket.id);
        this.userSockets.set(user.id, set);
        
        this.logger?.info({
          userId: user.id,
          socketId: socket.id,
          socketCount: set.size,
          wasOffline,
          totalUsers: this.userSockets.size,
        }, 'User socket tracked');

        // Initialize activity state
        if (wasOffline) {
          this.userActivity.set(user.id, {
            studying: null,
            topicName: null,
            lastSeen: Date.now(),
          });
        }

        // If user just came online, broadcast presence update
        if (wasOffline) {
          // Broadcast global presence update
          this.io.emit('presenceUpdate', {
            userId: user.id,
            username: user.name,
            isOnline: true,
            timestamp: new Date().toISOString(),
          });

          // Notify study partner specifically with statusUpdate event
          this.notifyPartnerStatusChange(user.id, true);
          
          this.logger?.info({ userId: user.id }, 'User presence: ONLINE');
        }
      } catch (err) {
        this.logger?.error({ error: err }, 'Failed to track user socket');
      }

      // Handle presence initialization (client confirms ready)
      // 🔄 TWO-WAY HANDSHAKE with DEBOUNCED DISCONNECT
      socket.on('presence:init', async (data: { userId: string; partnerId?: string }) => {
        try {
          const userId = data.userId;
          const partnerId = data.partnerId;
          
          // Store partner info on socket for disconnect handling
          (socket as any).userId = userId;
          (socket as any).partnerId = partnerId;
          
          // 🧹 Clear any pending disconnect timer (user reconnected fast)
          const disconnectTimer = this.disconnectTimers.get(userId);
          if (disconnectTimer) {
            clearTimeout(disconnectTimer);
            this.disconnectTimers.delete(userId);
            this.logger?.info({ userId }, '✅ Cleared disconnect timer - user reconnected');
          }
          
          // Get current activity from room service if available
          let currentActivity: { type: string; topic?: string | null } = { type: 'idle' };
          try {
            const activity = await roomService.getUserActivity(userId);
            if (activity) {
              this.userActivity.set(userId, {
                studying: activity.studying,
                topicName: activity.topicName,
                lastSeen: Date.now(),
              });
              currentActivity = {
                type: activity.studying ? 'studying' : 'idle',
                topic: activity.topicName || activity.studying,
              };
            }
          } catch (e) {
            // Activity not available, use defaults
          }

          this.logger?.info({ 
            userId, 
            partnerId,
            socketId: socket.id 
          }, `[PRESENCE] ✅ ${userId} connected | partner ${partnerId}`);
          
          // 🔁 TWO-WAY HANDSHAKE: Notify partner + send partner's status back
          if (partnerId && this.isUserOnline(partnerId)) {
            // Partner is online - complete handshake both ways
            
            // Step 1: Tell partner that this user is online
            this.emitToUser(partnerId, 'presence:update', {
              updatedUserId: userId,
              isOnline: true,
              activity: currentActivity.type,
            });

            // 🟢 STEP 2: Send partner's status back to newly connected user
            const partnerIsOnline = this.isUserOnline(partnerId);
            const partnerActivity = this.userActivity.get(partnerId);
            const partnerActivityType = partnerActivity?.studying ? 'studying' : 'idle';
            
            this.io.to(socket.id).emit('presence:update', {
              updatedUserId: partnerId,
              isOnline: partnerIsOnline,
              activity: partnerActivityType,
            });

            console.log(`[PRESENCE] 🔁 Handshake complete between ${userId} and ${partnerId}`);
            this.logger?.info({
              userId,
              partnerId,
              bothOnline: partnerIsOnline,
            }, '[PRESENCE] Handshake complete');
          }

        } catch (error) {
          this.logger?.error({ error, userId: data.userId }, 'Error in presence:init');
        }
      });

      // Cleanup on disconnect
      socket.on('disconnect', () => {
        try {
          const userId = (socket as any).userId;
          const partnerId = (socket as any).partnerId;
          
          if (!userId) return;
          
          // ✅ STEP 1: Cancel any previous disconnect timer for this user
          // This prevents old timers from firing after user reconnects
          if (this.disconnectTimers.has(userId)) {
            clearTimeout(this.disconnectTimers.get(userId));
            this.disconnectTimers.delete(userId);
            this.logger?.info({ userId }, '[PRESENCE] Cleared previous disconnect timer');
          }
          
          // Remove this socket from userSockets
          const set = this.userSockets.get(user.id);
          if (set) {
            set.delete(socket.id);
            if (set.size === 0) {
              // User has no more active connections - start grace period
              this.userSockets.delete(user.id);
              
              console.log(`[PRESENCE] 🔌 ${userId} disconnected, starting 4s timer...`);
              this.logger?.info({ userId, partnerId, socketId: socket.id }, '[PRESENCE] Last socket disconnected');
            } else {
              // User still has other sockets - keep them online
              this.userSockets.set(user.id, set);
              this.logger?.info({ userId: user.id, remainingSockets: set.size }, '[PRESENCE] User still has other sockets');
              return; // Don't start disconnect timer if user has other sockets
            }
          }
          
          // ✅ STEP 2: Start disconnect timer (4 seconds grace period)
          const timer = setTimeout(() => {
            // 🔍 CRITICAL CHECK: User may have reconnected with a new socket
            // Compare the current socket set with what we had when disconnect fired
            const currentSet = this.userSockets.get(userId);
            
            // If user has any active sockets now, they reconnected - skip marking offline
            if (currentSet && currentSet.size > 0) {
              console.log(`[PRESENCE] 🟢 ${userId} reconnected before timeout, skipping offline`);
              this.logger?.info({ userId, currentSockets: currentSet.size }, '[PRESENCE] User reconnected during grace period');
              this.disconnectTimers.delete(userId);
              return;
            }
            
            // ✅ STEP 3: User is confirmed offline - notify partner only
            console.log(`[PRESENCE] ❌ ${userId} confirmed offline after 4s`);
            this.logger?.info({ userId }, '[PRESENCE] User confirmed offline after grace period');
            
            // Notify partner that THIS user went offline (never mark partner offline!)
            if (partnerId && this.isUserOnline(partnerId)) {
              this.emitToUser(partnerId, 'presence:update', {
                updatedUserId: userId,  // Only the disconnecting user's ID
                isOnline: false,
                activity: 'idle',
              });
              this.logger?.info({ userId, partnerId }, '[PRESENCE] Notified partner of offline status');
            }
            
            // Clean up activity cache and timer for this user only
            this.userActivity.delete(userId);
            this.disconnectTimers.delete(userId);
          }, 20000); // 20 second grace period for tab reloads
          
          this.disconnectTimers.set(userId, timer);
        } catch (err) {
          this.logger?.error({ error: err }, 'Error in disconnect handler');
        }
      });

      // Handle activity updates for presence system
      socket.on('presence:updateActivity', ({ userId, activity }: { userId: string; activity: string }) => {
        try {
          const partnerId = (socket as any).partnerId;
          
          console.log(`[PRESENCE] 🎯 ${userId} updated activity to: ${activity}`);
          
          // Update local activity cache
          const currentActivity = this.userActivity.get(userId) || { studying: null, topicName: null, lastSeen: Date.now() };
          this.userActivity.set(userId, {
            ...currentActivity,
            studying: activity === 'studying' ? 'true' : null,
            lastSeen: Date.now(),
          });
          
          // Notify partner of activity change (if partner is online)
          if (partnerId && this.isUserOnline(partnerId)) {
            this.emitToUser(partnerId, 'presence:update', {
              updatedUserId: userId,
              isOnline: true,
              activity,
            });
            this.logger?.info({ userId, partnerId, activity }, '[PRESENCE] Activity update sent to partner');
          }
        } catch (err) {
          this.logger?.error({ error: err, userId }, 'Error in presence:updateActivity');
        }
      });

      // Handle user activity updates (legacy)
      socket.on('updateActivity', async (data: { studying: string | null; topicName: string | null }) => {
        try {
          await roomService.updateUserActivity(user.id, data);
          
          // Update local activity state
          this.userActivity.set(user.id, {
            studying: data.studying,
            topicName: data.topicName,
            lastSeen: Date.now(),
          });
          
          // Broadcast activity update to all connected clients
          this.io.emit('activityUpdate', {
            userId: user.id,
            username: user.name,
            studying: data.studying,
            topicName: data.topicName,
            isOnline: true,
            timestamp: new Date().toISOString(),
          });

          // Notify study partner with specific statusUpdate event
          await this.notifyPartnerActivityChange(user.id, data.studying, data.topicName);

          this.logger?.info({
            userId: user.id,
            studying: data.studying,
            topicName: data.topicName,
          }, 'User activity updated');
        } catch (error) {
          socket.emit('error', { 
            message: error instanceof Error ? error.message : 'Failed to update activity' 
          });
        }
      });

      // Handle presence activity updates (new standardized event)
      socket.on('presence:updateActivity', async (data: { userId: string; activity: { type: 'studying' | 'idle'; topic?: string } }) => {
        try {
          const studying = data.activity.type === 'studying' ? (data.activity.topic || 'Unknown') : null;
          const topicName = data.activity.type === 'studying' ? (data.activity.topic || null) : null;

          // Save to room service
          await roomService.updateUserActivity(data.userId, { studying, topicName });
          
          // Update local activity state
          this.userActivity.set(data.userId, {
            studying,
            topicName: topicName,
            lastSeen: Date.now(),
          });

          // Notify study partner with statusUpdate event
          await this.notifyPartnerActivityChange(data.userId, studying, topicName);

          this.logger?.info({
            userId: data.userId,
            activityType: data.activity.type,
            topic: data.activity.topic,
          }, 'Presence activity updated');
        } catch (error) {
          socket.emit('error', { 
            message: error instanceof Error ? error.message : 'Failed to update activity' 
          });
        }
      });

      socket.on('joinRoom', async (data: { roomId: string }) => {
        try {
          const { roomId } = data;

          // Check if user is already in this room (prevent duplicate joins)
          const rooms = Array.from(socket.rooms);
          if (rooms.includes(roomId)) {
            this.logger?.debug({ userId: user.id, roomId }, 'User already in room, skipping join broadcast');
            
            // Still send chat history for this client
            const ChatMessage = (await import('../models/chatMessage.model.js')).ChatMessage;
            const recentMessages = await ChatMessage.find({ roomId })
              .populate('userId', 'name')
              .sort({ createdAt: -1 })
              .limit(20)
              .lean<Array<{
                _id: string;
                userId: { name: string } | null;
                content: string;
                type: 'TEXT' | 'SYSTEM' | 'EMOJI' | 'FILE';
                createdAt: Date;
              }>>();
            
            socket.emit('chatHistory', recentMessages.reverse().map((msg) => ({
              id: msg._id.toString(),
              username: msg.userId?.name ?? 'System',
              message: msg.content,
              type: msg.type,
              timestamp: msg.createdAt.toISOString(),
            })));
            
            return; // Don't broadcast join message again
          }

          // FIX: Removed 'const room =' as the variable was unused.
          // This call now acts purely as validation.
          await roomService.getRoomById(roomId, user.id);
          
          await socket.join(roomId);
          
          // Get presence BEFORE updating status to detect if it's a reconnection
          const presenceBefore = await roomService.getRoomPresence(roomId);
          const wasOnlineBefore = presenceBefore.some(p => p.id === user.id && p.isOnline);
          
          await roomService.updateUserOnlineStatus(roomId, user.id, true);
          const presence = await roomService.getRoomPresence(roomId);
          
          // Only broadcast join message if user wasn't already online (not a reconnection)
          if (!wasOnlineBefore) {
            socket.to(roomId).emit('chat:system', {
              type: 'join',
              username: user.name,
              timestamp: new Date().toISOString(),
            });
          }

          // ⚠️ DO NOT persist join/leave system messages to avoid flooding chat history
          // They are only shown in real-time and not stored permanently
          
          this.io.to(roomId).emit('roomUsers', presence);

          // Get recent chat messages
          const ChatMessage = (await import('../models/chatMessage.model.js')).ChatMessage;
          const recentMessages = await ChatMessage.find({ roomId })
            .populate('userId', 'name')
            .sort({ createdAt: -1 })
            .limit(20)
            .lean<Array<{
              _id: string;
              userId: { name: string } | null;
              content: string;
              type: 'TEXT' | 'SYSTEM' | 'EMOJI' | 'FILE';
              createdAt: Date;
            }>>();
          
          socket.emit('chatHistory', recentMessages.reverse().map((msg) => ({
            id: msg._id.toString(),
            username: msg.userId?.name ?? 'System',
            message: msg.content,
            type: msg.type,
            timestamp: msg.createdAt.toISOString(),
          })));

          this.logger?.info({
            userId: user.id,
            roomId,
            action: 'joinRoom',
          }, 'User joined room');

        } catch (error) {
          socket.emit('error', { 
            message: error instanceof Error ? error.message : 'Failed to join room' 
          });
        }
      });

      // Handle sending chat messages
      socket.on('send-message', async (data: { roomId: string; content: string; type?: string }) => {
        try {
          const { roomId, content, type = 'TEXT' } = data;
          const userId = socket.data.user?.id;

          if (!userId) {
            socket.emit('error', { message: 'User not authenticated' });
            return;
          }
          
          if (!content || !content.trim()) {
            socket.emit('error', { message: 'Message content is required' });
            return;
          }

          // Verify user is a member of the room
          const Room = (await import('../models/room.model.js')).Room;
          const room = await Room.findById(roomId);
          
          if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
          }

          const isMember = room.members.some(m => String(m.userId) === userId);
          if (!isMember) {
            socket.emit('error', { message: 'You are not a member of this room' });
            return;
          }

          // Get user details
          const User = (await import('../models/user.model.js')).User;
          const user = await User.findById(userId).select('name username avatarUrl profilePic customAvatarURL isCustomAvatar').lean();
          
          if (!user) {
            socket.emit('error', { message: 'User not found' });
            return;
          }

          // Create the chat message job
          const messageJob: ChatMessageJob = {
            roomId,
            userId,
            username: user.name,
            content: content.trim(),
            type: type as 'TEXT' | 'SYSTEM' | 'EMOJI' | 'FILE',
            timestamp: new Date().toISOString(),
          };

          // Try to add to queue for persistence
          try {
            const queue = getChatQueue();
            if (queue) {
              await queue.add('persist', messageJob);
              this.logger?.info({ roomId, userId }, 'Message queued for persistence');
            } else {
              // If queue not available, still save directly
              this.logger?.info({ roomId, userId }, 'Queue not available, saving directly');
              const ChatMessage = (await import('../models/chatMessage.model.js')).ChatMessage;
              const savedMsg = await ChatMessage.create({
                roomId,
                userId,
                content: content.trim(),
                type: type as 'TEXT' | 'SYSTEM' | 'EMOJI' | 'FILE',
                createdAt: new Date(),
              });
              this.logger?.info({ roomId, userId, messageId: savedMsg._id }, 'Message saved directly to DB');
            }
          } catch (queueError) {
            this.logger?.error({ error: queueError, roomId, userId }, 'Failed to queue/save message');
            // Fallback: Save directly to DB
            const ChatMessage = (await import('../models/chatMessage.model.js')).ChatMessage;
            const savedMsg = await ChatMessage.create({
              roomId,
              userId,
              content: content.trim(),
              type: type as 'TEXT' | 'SYSTEM' | 'EMOJI' | 'FILE',
              createdAt: new Date(),
            });
            this.logger?.info({ roomId, userId, messageId: savedMsg._id }, 'Message saved via fallback');
          }

          // Calculate avatar URL (same priority as room members)
          let avatarUrl = null;
          if (user.isCustomAvatar && user.customAvatarURL) {
            avatarUrl = user.customAvatarURL;
          } else if (user.profilePic) {
            avatarUrl = user.profilePic;
          } else if (user.avatarUrl) {
            avatarUrl = user.avatarUrl;
          }
          
          // Convert relative upload paths to full URLs for mobile clients
          if (avatarUrl && avatarUrl.startsWith('/uploads/')) {
            const env = (await import('../config/env.js')).env;
            const protocol = env.NODE_ENV === 'production' ? 'https' : 'http';
            const host = env.HOST || 'localhost';
            const port = env.NODE_ENV === 'production' ? '' : `:${env.PORT}`;
            avatarUrl = `${protocol}://${host}${port}${avatarUrl}`;
          }

          // Broadcast message to all users in the room (including sender)
          this.io.to(roomId).emit('newMessage', {
            id: Date.now().toString(), // Temporary ID
            userId: userId,
            username: user.name,
            avatar: avatarUrl,
            content: content.trim(),
            type: type,
            timestamp: new Date().toISOString(),
          });

          this.logger?.info({
            roomId,
            userId,
            username: user.name,
            contentLength: content.length,
          }, 'Chat message sent');

        } catch (error) {
          this.logger?.error({ error }, 'Failed to send message');
          socket.emit('error', { 
            message: error instanceof Error ? error.message : 'Failed to send message' 
          });
        }
      });

      // Handle typing indicator
      socket.on('chat:typing', async (data: { roomId: string; isTyping: boolean }) => {
        try {
          const { roomId, isTyping } = data;
          const userId = socket.data.user?.id;

          if (!userId) return;

          // Get user details
          const User = (await import('../models/user.model.js')).User;
          const user = await User.findById(userId).select('name').lean();
          
          if (!user) return;

          // Broadcast typing indicator to all other users in the room
          socket.to(roomId).emit('chat:typing', {
            userId,
            username: user.name,
            isTyping,
          });

          this.logger?.debug({
            roomId,
            userId,
            username: user.name,
            isTyping,
          }, 'Typing indicator broadcasted');

        } catch (error) {
          this.logger?.error({ error }, 'Failed to broadcast typing indicator');
        }
      });

      // Handle Duo Streak: Check Daily Completion
      socket.on('duo:checkDailyCompletion', async (data: { duoId?: string }) => {
        try {
          const userId = socket.data.user?.id;

          if (!userId) {
            socket.emit('error', { message: 'User not authenticated' });
            return;
          }

          // Import User model to find partner
          const { User } = await import('../models/user.model.js');
          const user = await User.findById(userId).select('partnerId').lean();

          if (!user || !user.partnerId) {
            socket.emit('error', { message: 'No study partner found' });
            return;
          }

          const partnerId = String(user.partnerId);

          // Check if both users are online
          const bothOnline = this.isUserOnline(userId) && this.isUserOnline(partnerId);

          // Import and use duo streak service
          const { duoStreakService } = await import('./duoStreak.service.js');
          const result = await duoStreakService.checkDailyCompletion(userId, partnerId, bothOnline);

          if (result.streakUpdated) {
            // SUCCESS: Streak incremented
            const payload = {
              streak: result.streak,
              date: result.date,
              calendar: Object.fromEntries(result.calendar),
            };

            // Emit to both users
            this.emitToUser(userId, 'duo:streakUpdate', payload);
            this.emitToUser(partnerId, 'duo:streakUpdate', payload);

            this.logger?.info({
              userId,
              partnerId,
              streak: result.streak,
            }, '🔥 Duo streak updated successfully');
          } else {
            // Not updated (already updated today, or conditions not met)
            socket.emit('duo:streakStatus', {
              streak: result.streak,
              canUpdate: false,
              reason: result.reason,
            });

            this.logger?.info({
              userId,
              partnerId,
              reason: result.reason,
            }, 'ℹ️ Duo streak not updated');
          }

        } catch (error) {
          this.logger?.error({ error }, 'Failed to check duo streak');
          socket.emit('error', { 
            message: error instanceof Error ? error.message : 'Failed to check streak' 
          });
        }
      });

      // ========== ENHANCED PRESENCE WITH HEARTBEAT (NEW) ==========
      
      // Client heartbeat - keeps user online
      socket.on('presence:heartbeat', async (data: { userId: string }) => {
        try {
          const { userId } = data;
          
          // Update lastSeen timestamp
          socket.data.lastSeen = Date.now();
          
          // Ensure user is marked online if multiple sockets
          const userSockets = this.userSockets.get(userId);
          if (userSockets && userSockets.size > 0) {
            // User has active sockets, mark as online
            socket.data.isOnline = true;
          }

          this.logger?.debug({ userId, socketId: socket.id }, 'Heartbeat received');
        } catch (error) {
          this.logger?.error({ error }, 'Error in presence:heartbeat');
        }
      });

      // ========== ENHANCED ROOM EVENTS (NEW) ==========
      
      // Room topic completion
      socket.on('room:topic:complete', async (data: { roomId: string; topicId: string; userId: string; timestamp: string }) => {
        try {
          const { roomId, topicId, userId, timestamp } = data;
          
          // Broadcast to all room members
          this.io.to(roomId).emit('room:topic:complete', {
            roomId,
            topicId,
            userId,
            timestamp,
          });

          this.logger?.info({ roomId, topicId, userId }, 'Room topic completed');
        } catch (error) {
          this.logger?.error({ error }, 'Error in room:topic:complete');
          socket.emit('error', { message: 'Failed to process topic completion' });
        }
      });

      // Room message
      socket.on('room:message:new', async (data: { roomId: string; userId: string; content: string }) => {
        try {
          const { roomId, userId, content } = data;
          
          // Basic validation
          if (!content || content.length > 2000) {
            socket.emit('error', { message: 'Invalid message content' });
            return;
          }

          // Broadcast to all room members (actual DB save happens in REST API)
          this.io.to(roomId).emit('room:message:new', {
            roomId,
            userId,
            content,
            timestamp: new Date().toISOString(),
          });

          this.logger?.info({ roomId, userId, contentLength: content.length }, 'Room message sent');
        } catch (error) {
          this.logger?.error({ error }, 'Error in room:message:new');
          socket.emit('error', { message: 'Failed to send message' });
        }
      });

      // Quiz request
      socket.on('room:quiz:request', async (data: { roomId: string; date: string }) => {
        try {
          const { roomId, date } = data;
          
          // Notify room members that quiz generation was requested
          this.io.to(roomId).emit('room:quiz:requested', {
            roomId,
            date,
            requestedBy: socket.data.user?.id,
            timestamp: new Date().toISOString(),
          });

          this.logger?.info({ roomId, date }, 'Quiz generation requested');
        } catch (error) {
          this.logger?.error({ error }, 'Error in room:quiz:request');
          socket.emit('error', { message: 'Failed to request quiz' });
        }
      });

      // Kanban update
      socket.on('room:kanban:update', async (data: { roomId: string; userId: string; change: any }) => {
        try {
          const { roomId, userId, change } = data;
          
          // Broadcast kanban changes to room
          this.io.to(roomId).emit('room:kanban:update', {
            roomId,
            userId,
            change,
            timestamp: new Date().toISOString(),
          });

          this.logger?.info({ roomId, userId }, 'Kanban updated');
        } catch (error) {
          this.logger?.error({ error }, 'Error in room:kanban:update');
          socket.emit('error', { message: 'Failed to update kanban' });
        }
      });

      // Focus timer: start
      socket.on('timer:session:start', async (data: { roomId: string; userId: string; sessionId: string; topicId?: string }) => {
        try {
          const { roomId, userId, sessionId, topicId } = data;
          
          // Broadcast to room that user started focus session
          this.io.to(roomId).emit('timer:session:start', {
            roomId,
            userId,
            sessionId,
            topicId,
            timestamp: new Date().toISOString(),
          });

          this.logger?.info({ roomId, userId, sessionId }, 'Focus session started');
        } catch (error) {
          this.logger?.error({ error }, 'Error in timer:session:start');
          socket.emit('error', { message: 'Failed to start timer session' });
        }
      });

      // Focus timer: pause
      socket.on('timer:session:pause', async (data: { roomId: string; userId: string; sessionId: string; elapsed: number }) => {
        try {
          const { roomId, userId, sessionId, elapsed } = data;
          
          this.io.to(roomId).emit('timer:session:pause', {
            roomId,
            userId,
            sessionId,
            elapsed,
            timestamp: new Date().toISOString(),
          });

          this.logger?.info({ roomId, userId, sessionId, elapsed }, 'Focus session paused');
        } catch (error) {
          this.logger?.error({ error }, 'Error in timer:session:pause');
          socket.emit('error', { message: 'Failed to pause timer session' });
        }
      });

      // Focus timer: stop
      socket.on('timer:session:stop', async (data: { roomId: string; userId: string; sessionId: string; elapsed: number }) => {
        try {
          const { roomId, userId, sessionId, elapsed } = data;
          
          this.io.to(roomId).emit('timer:session:stop', {
            roomId,
            userId,
            sessionId,
            elapsed,
            timestamp: new Date().toISOString(),
          });

          this.logger?.info({ roomId, userId, sessionId, elapsed }, 'Focus session stopped');
        } catch (error) {
          this.logger?.error({ error }, 'Error in timer:session:stop');
          socket.emit('error', { message: 'Failed to stop timer session' });
        }
      });

      // Handle leave room
      socket.on('leaveRoom', async (data: { roomId: string }) => {
        try {
          const { roomId } = data;
          const userId = socket.data.user?.id;

          if (!userId || !roomId) return;

          // Leave the Socket.IO room
          socket.leave(roomId);

          // Get user details for system message
          const User = (await import('../models/user.model.js')).User;
          const user = await User.findById(userId).select('name').lean();

          if (user) {
            // Broadcast system message
            socket.to(roomId).emit('chat:system', {
              type: 'leave',
              username: user.name,
              timestamp: new Date().toISOString(),
            });
          }

          this.logger?.info({
            userId,
            roomId,
            action: 'leaveRoom',
          }, 'User left room');

        } catch (error) {
          this.logger?.error({ error }, 'Failed to leave room');
        }
      });

      // ... (rest of your event handlers: setReady, disconnect)
      // The logic inside them was already solid.
    });
  }

  /**
   * Emit an event to all sockets connected for a specific userId
   */
  public emitToUser(userId: string, event: string, payload: any) {
    const sockets = this.userSockets.get(userId);
    if (!sockets || sockets.size === 0) return;
    this.logger?.info({ userId, event, socketCount: sockets.size }, 'Emitting event to user sockets');
    for (const sid of sockets) {
      this.io.to(sid).emit(event, payload);
    }
  }

  /**
   * Emit an event to all sockets in a specific room
   */
  public emitToRoom(roomId: string, event: string, payload: any) {
    this.io.to(`room:${roomId}`).emit(event, payload);
    this.logger?.info({ roomId, event }, 'Emitted event to room');
  }

  /**
   * Check if a user is currently online (has active socket connections)
   */
  public isUserOnline(userId: string): boolean {
    const sockets = this.userSockets.get(userId);
    const isOnline = sockets !== undefined && sockets.size > 0;
    this.logger?.info({
      userId,
      socketCount: sockets?.size || 0,
      isOnline,
      allUserIds: Array.from(this.userSockets.keys()),
    }, 'isUserOnline check');
    return isOnline;
  }

  /**
   * Get user's current activity state
   */
  public getUserActivityState(userId: string): { studying: string | null; topicName: string | null; lastSeen: number } | null {
    return this.userActivity.get(userId) || null;
  }

  /**
   * Notify a user's study partner about their online/offline status change
   */
  private async notifyPartnerStatusChange(userId: string, isOnline: boolean): Promise<void> {
    try {
      // Import User model to find partner
      const { User } = await import('../models/user.model.js');
      const user = await User.findById(userId).select('partnerId name').lean();
      
      if (!user || !user.partnerId) return;

      // Get current activity state
      const activity = this.userActivity.get(userId) || { studying: null, topicName: null, lastSeen: Date.now() };

      // Emit presence:update event to partner (NEW standardized event)
      // ✅ updatedUserId is the user whose state CHANGED (not the recipient)
      this.emitToUser(String(user.partnerId), 'presence:update', {
        updatedUserId: userId,  // The user whose status changed
        username: user.name,
        isOnline: isOnline,
        activity: {
          type: activity.studying ? 'studying' : 'idle',
          topic: activity.topicName || activity.studying,
        },
        lastSeen: isOnline ? Date.now() : activity.lastSeen,
        timestamp: new Date().toISOString(),
      });

      // Also emit legacy statusUpdate for backward compatibility
      this.emitToUser(String(user.partnerId), 'statusUpdate', {
        updatedUserId: userId,  // The user whose status changed
        username: user.name,
        isOnline: isOnline,
        studying: activity.studying,
        topicName: activity.topicName,
        timestamp: new Date().toISOString(),
      });

      this.logger?.info({
        updatedUserId: userId,
        notifyingPartnerId: String(user.partnerId),
        isOnline,
        activityType: activity.studying ? 'studying' : 'idle',
      }, '✅ Emitted presence:update to partner - updatedUserId=' + userId);
    } catch (error) {
      this.logger?.error({ error, userId }, 'Failed to notify partner of status change');
    }
  }

  /**
   * Notify a user's study partner about their activity change (studying/idle)
   */
  private async notifyPartnerActivityChange(userId: string, studying: string | null, topicName: string | null): Promise<void> {
    try {
      // Import User model to find partner
      const { User } = await import('../models/user.model.js');
      const user = await User.findById(userId).select('partnerId name').lean();
      
      if (!user || !user.partnerId) return;

      // Emit presence:update event to partner (NEW standardized event)
      // ✅ updatedUserId is the user whose activity CHANGED
      this.emitToUser(String(user.partnerId), 'presence:update', {
        updatedUserId: userId,  // The user whose activity changed
        username: user.name,
        isOnline: true,
        activity: {
          type: studying ? 'studying' : 'idle',
          topic: topicName || studying,
        },
        lastSeen: Date.now(),
        timestamp: new Date().toISOString(),
      });

      // Also emit legacy statusUpdate for backward compatibility
      this.emitToUser(String(user.partnerId), 'statusUpdate', {
        updatedUserId: userId,  // The user whose activity changed
        username: user.name,
        isOnline: true,
        studying: studying,
        topicName: topicName,
        timestamp: new Date().toISOString(),
      });

      this.logger?.info({
        userId,
        partnerId: String(user.partnerId),
        studying,
        topicName,
      }, 'Notified partner of activity change');
    } catch (error) {
      this.logger?.error({ error, userId }, 'Failed to notify partner of activity change');
    }
  }

  async broadcastGroupUpdate(groups: Array<{groupId: number, members: Array<{userId: string, name: string, email: string}>}>) {
    try {
      this.io.emit('groupUpdate', {
        groups: groups.map(group => ({
          groupId: group.groupId,
          members: group.members.map(member => ({
            userId: member.userId,
            name: member.name,
          })),
          memberCount: group.members.length,
        })),
        timestamp: new Date().toISOString(),
      });

      this.logger?.info({
        totalGroups: groups.length,
        totalStudents: groups.reduce((sum, group) => sum + group.members.length, 0),
      }, 'Group update broadcasted via Socket.IO');

    } catch (error) {
      this.logger?.error({ error }, 'Failed to broadcast group update');
    }
  }

  getIO(): SocketIOServer {
    return this.io;
  }

  /**
   * Cleanup method - clears all pending disconnect timers
   */
  cleanup(): void {
    this.logger?.info('Cleaning up SocketService - clearing all disconnect timers');
    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.disconnectTimers.clear();
  }
}
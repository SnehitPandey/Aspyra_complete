// backend/src/services/socketEventManager.ts
/**
 * Centralized Socket Event Manager
 * Handles all real-time events and ensures consistency across features
 */

import { Server as SocketIOServer } from 'socket.io';
import { getSocketServiceInstance } from './socket.instance.js';

interface TopicCompletePayload {
  topicId: string;
  topicTitle: string;
  userId: string;
  roomId: string;
  completedAt: Date;
}

interface ProgressUpdatePayload {
  roomId: string;
  userId: string;
  overallProgress: number;
  completedTopics: number;
  totalTopics: number;
  todayCompletedCount: number;
}

interface SessionSyncPayload {
  topicId: string;
  topicTitle?: string;
  userId: string;
  roomId: string;
  sessionId?: string;
  elapsedTime: number;
  isRunning: boolean;
  startedAt?: string;
  endedAt?: string;
  activeUsers?: string[];
}

interface KanbanUpdatePayload {
  taskId: string;
  topicId: string;
  roomId: string;
  newStatus: 'backlog' | 'todo' | 'in-progress' | 'done';
  userId: string;
}

interface StreakUpdatePayload {
  roomId: string;
  userId: string;
  partnerId?: string;
  streakDays: number;
  completedToday: boolean;
}

interface QuizUnlockPayload {
  roomId: string;
  userId: string;
  topicId: string;
  topicTitle: string;
  quizId?: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export class SocketEventManager {
  private static instance: SocketEventManager;
  
  private constructor() {}
  
  public static getInstance(): SocketEventManager {
    if (!SocketEventManager.instance) {
      SocketEventManager.instance = new SocketEventManager();
    }
    return SocketEventManager.instance;
  }

  /**
   * Emit topic completion event - triggers cascade of updates
   */
  public emitTopicComplete(payload: TopicCompletePayload): void {
    const socketService = getSocketServiceInstance();
    if (!socketService) return;

    console.log('📢 [SocketEventManager] Emitting topic:complete:', payload);
    
    socketService.emitToRoom(payload.roomId, 'topic:complete', {
      topicId: payload.topicId,
      topicTitle: payload.topicTitle,
      userId: payload.userId,
      completedAt: payload.completedAt.toISOString(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit progress update event - updates all progress displays
   */
  public emitProgressUpdate(payload: ProgressUpdatePayload): void {
    const socketService = getSocketServiceInstance();
    if (!socketService) return;

    console.log('📢 [SocketEventManager] Emitting progress:update:', payload);
    
    socketService.emitToRoom(payload.roomId, 'progress:update', {
      userId: payload.userId,
      overallProgress: Math.round(payload.overallProgress * 100) / 100,
      completedTopics: payload.completedTopics,
      totalTopics: payload.totalTopics,
      todayCompletedCount: payload.todayCompletedCount,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit session timer sync - keeps timers in sync across devices
   */
  public emitSessionTimerSync(roomId: string, data: Omit<SessionSyncPayload, 'roomId'>): void {
    const socketService = getSocketServiceInstance();
    if (!socketService) return;

    console.log('⏱️ [SocketEventManager] Emitting session:timerSync:', data);
    
    const payload: SessionSyncPayload = {
      ...data,
      roomId,
    };
    
    socketService.emitToRoom(roomId, 'session:timerSync', {
      topicId: payload.topicId,
      topicTitle: payload.topicTitle,
      userId: payload.userId,
      sessionId: payload.sessionId,
      elapsedTime: payload.elapsedTime,
      isRunning: payload.isRunning,
      startedAt: payload.startedAt,
      endedAt: payload.endedAt,
      activeUsers: payload.activeUsers || [],
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit kanban update event - syncs task board
   */
  public emitKanbanUpdate(payload: KanbanUpdatePayload): void {
    const socketService = getSocketServiceInstance();
    if (!socketService) return;

    console.log('🗂️ [SocketEventManager] Emitting kanban:update:', payload);
    
    socketService.emitToRoom(payload.roomId, 'kanban:update', {
      taskId: payload.taskId,
      topicId: payload.topicId,
      newStatus: payload.newStatus,
      userId: payload.userId,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit streak update event - updates duo streak counters
   */
  public emitStreakUpdate(payload: StreakUpdatePayload): void {
    const socketService = getSocketServiceInstance();
    if (!socketService) return;

    console.log('🔥 [SocketEventManager] Emitting streak:update:', payload);
    
    socketService.emitToRoom(payload.roomId, 'streak:update', {
      userId: payload.userId,
      partnerId: payload.partnerId,
      streakDays: payload.streakDays,
      completedToday: payload.completedToday,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit today's tasks update - refreshes daily task list
   */
  public emitTodaysTasksUpdate(roomId: string, userId: string, tasks: any[]): void {
    const socketService = getSocketServiceInstance();
    if (!socketService) return;

    console.log('📋 [SocketEventManager] Emitting today:tasks:', { roomId, userId, taskCount: tasks.length });
    
    socketService.emitToUser(userId, 'today:tasks', {
      roomId,
      tasks,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit quiz unlocked event - notifies user that quiz is available
   */
  public emitQuizUnlocked(payload: QuizUnlockPayload): void {
    const socketService = getSocketServiceInstance();
    if (!socketService) return;

    console.log('🎓 [SocketEventManager] Emitting quiz:unlocked:', payload);
    
    socketService.emitToRoom(payload.roomId, 'quiz:unlocked', {
      userId: payload.userId,
      topicId: payload.topicId,
      topicTitle: payload.topicTitle,
      quizId: payload.quizId,
      difficulty: payload.difficulty,
      timestamp: new Date().toISOString(),
    });
  }
}

// Export singleton instance
export const socketEventManager = SocketEventManager.getInstance();

// backend/src/services/partnerSync.service.ts
/**
 * Partner Sync Service
 * Real-time synchronization for duo study mode partners
 */

import { Room } from '../models/room.model.js';
import { User } from '../models/user.model.js';
import { Types } from 'mongoose';
import { socketEventManager } from './socketEventManager.js';

interface PartnerActivity {
  userId: string;
  userName: string;
  action: 'topic_complete' | 'session_start' | 'session_end' | 'quiz_complete' | 'milestone_complete';
  topicId?: string;
  topicTitle?: string;
  timestamp: Date;
}

/**
 * Notify partner about user activity
 */
export const notifyPartner = async (
  roomId: string | Types.ObjectId,
  userId: string,
  activity: PartnerActivity
): Promise<void> => {
  try {
    const room = await Room.findById(roomId).populate('members.userId', 'name avatar');
    if (!room) return;

    // Find partner (other member in duo room)
    const partner = room.members?.find((m: any) => 
      m.userId && m.userId._id.toString() !== userId
    );

    if (!partner || !partner.userId) {
      console.log('ℹ️ [PartnerSync] No partner found for notification');
      return;
    }

    const partnerId = partner.userId._id ? partner.userId._id.toString() : partner.userId.toString();
    const partnerName = (partner.userId as any).name || 'Partner';

    console.log(`🤝 [PartnerSync] Notifying partner ${partnerId} about ${activity.action}`);

    // Emit partner activity event
    socketEventManager.emitStreakUpdate({
      roomId: roomId.toString(),
      userId: partnerId,
      partnerId: userId,
      streakDays: 0, // Will be updated with actual streak
      completedToday: false,
    });

    // Emit specific activity notification
    const socketService = (await import('./socket.instance.js')).getSocketServiceInstance();
    if (socketService) {
      socketService.emitToUser(partnerId, 'partner:activity', {
        roomId: roomId.toString(),
        partnerId: userId,
        partnerName: activity.userName,
        action: activity.action,
        topicId: activity.topicId,
        topicTitle: activity.topicTitle,
        timestamp: activity.timestamp.toISOString(),
      });
    }
  } catch (error) {
    console.error('❌ [PartnerSync] Error notifying partner:', error);
  }
};

/**
 * Sync duo streak progress
 */
export const syncDuoStreak = async (
  roomId: string | Types.ObjectId,
  userId: string
): Promise<void> => {
  try {
    const room = await Room.findById(roomId).populate('members.userId', 'name');
    if (!room || !room.streaks) return;

    // Find user's streak
    const userStreak = room.streaks.find((s: any) => s.userId.toString() === userId);
    if (!userStreak) return;

    // Find partner
    const partner = room.members?.find((m: any) => 
      m.userId && m.userId._id.toString() !== userId
    );

    if (!partner) return;
    const partnerId = partner.userId._id.toString();

    // Find partner's streak
    const partnerStreak = room.streaks.find((s: any) => s.userId.toString() === partnerId);

    console.log(`🔥 [PartnerSync] Syncing duo streak - User: ${userStreak.days} days, Partner: ${partnerStreak?.days || 0} days`);

    // Emit streak update to both users
    socketEventManager.emitStreakUpdate({
      roomId: roomId.toString(),
      userId,
      partnerId,
      streakDays: userStreak.days,
      completedToday: (userStreak as any).completedToday || false,
    });

    if (partnerStreak) {
      socketEventManager.emitStreakUpdate({
        roomId: roomId.toString(),
        userId: partnerId,
        partnerId: userId,
        streakDays: partnerStreak.days,
        completedToday: (partnerStreak as any).completedToday || false,
      });
    }
  } catch (error) {
    console.error('❌ [PartnerSync] Error syncing duo streak:', error);
  }
};

/**
 * Get partner's current activity status
 */
export const getPartnerStatus = async (
  roomId: string | Types.ObjectId,
  userId: string
): Promise<any> => {
  try {
    const room = await Room.findById(roomId).populate('members.userId', 'name avatar lastActive');
    if (!room) return null;

    // Find partner
    const partner = room.members?.find((m: any) => 
      m.userId && m.userId._id.toString() !== userId
    );

    if (!partner) return null;

    const partnerId = partner.userId._id ? partner.userId._id.toString() : partner.userId.toString();
    const partnerUser = partner.userId as any;

    // Get partner's progress
    const partnerProgress = room.progress?.find((p: any) => 
      p.userId.toString() === partnerId
    );

    // Check if partner has active session
    const { FocusSession } = await import('../models/focusSession.model.js');
    const activeSession = await FocusSession.findActiveSession(partnerId, roomId);

    return {
      partnerId,
      name: partnerUser.name,
      avatar: partnerUser.avatar,
      lastActive: partnerUser.lastActive,
      isOnline: partnerUser.lastActive ? 
        (new Date().getTime() - new Date(partnerUser.lastActive).getTime()) < 5 * 60 * 1000 : false,
      completedTopics: partnerProgress?.completedTopics || 0,
      hasActiveSession: !!activeSession,
      currentTopic: activeSession ? {
        topicId: activeSession.topicId,
        topicTitle: activeSession.topicTitle,
        elapsedTime: activeSession.getCurrentElapsedTime(),
      } : null,
    };
  } catch (error) {
    console.error('❌ [PartnerSync] Error getting partner status:', error);
    return null;
  }
};

/**
 * Notify partner when user starts/ends session
 */
export const notifySessionChange = async (
  roomId: string | Types.ObjectId,
  userId: string,
  userName: string,
  action: 'start' | 'end',
  topicTitle?: string
): Promise<void> => {
  await notifyPartner(roomId, userId, {
    userId,
    userName,
    action: action === 'start' ? 'session_start' : 'session_end',
    topicTitle,
    timestamp: new Date(),
  });
};

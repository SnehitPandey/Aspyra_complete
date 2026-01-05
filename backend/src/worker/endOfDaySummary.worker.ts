// backend/src/worker/endOfDaySummary.worker.ts
/**
 * End-of-Day Summary Worker
 * Scheduled job to generate daily progress summaries for all active rooms
 * Runs every day at 23:59
 */

import cron from 'node-cron';
import { Room } from '../models/room.model.js';
import { FocusSession } from '../models/focusSession.model.js';
import { Types } from 'mongoose';
import { socketEventManager } from '../services/socketEventManager.js';
import { getSocketServiceInstance } from '../services/socket.instance.js';

let endOfDaySummaryJob: cron.ScheduledTask | null = null;

interface UserDailySummary {
  userId: string;
  userName: string;
  topicsCompleted: number;
  topicsCompletedToday: string[];
  totalFocusTime: number; // seconds
  quizzesCompleted: number;
  streakDays: number;
  progressPercentage: number;
}

interface RoomDailySummary {
  roomId: string;
  roomName: string;
  date: Date;
  userSummaries: UserDailySummary[];
  totalTopicsCompleted: number;
  totalFocusTime: number;
  averageProgress: number;
}

/**
 * Generate daily summary for a specific room
 */
const generateDailySummaryForRoom = async (roomId: Types.ObjectId): Promise<RoomDailySummary | null> => {
  try {
    const room = await Room.findById(roomId).populate('members.userId', 'name email');
    if (!room) return null;

    const roomName = (room as any).name || 'Unnamed Room';
    console.log(`📊 [EndOfDay] Generating summary for room ${roomName}`);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const userSummaries: UserDailySummary[] = [];
    let totalTopicsCompletedToday = 0;
    let totalFocusTime = 0;

    // Get total topics count
    const totalTopics = room.roadmap?.phases?.reduce((sum, phase) => {
      return sum + (phase.milestones?.reduce((mSum, milestone) => {
        return mSum + (milestone.topics?.length || 0);
      }, 0) || 0);
    }, 0) || 0;

    // Process each member
    for (const member of room.members || []) {
      const userId = member.userId._id ? member.userId._id.toString() : member.userId.toString();
      const userName = (member.userId as any).name || 'Unknown';

      // Get user's progress
      const userProgress = room.progress?.find((p: any) => p.userId.toString() === userId);
      const completedTopicsCount = userProgress?.completedTopics || 0;
      const progressPercentage = totalTopics > 0 ? (completedTopicsCount / totalTopics) * 100 : 0;

      // Get topics completed today
      const topicsCompletedToday: string[] = [];
      if (room.roadmap?.phases) {
        for (const phase of room.roadmap.phases) {
          for (const milestone of phase.milestones || []) {
            for (const topic of milestone.topics || []) {
              if (typeof topic !== 'string' && (topic as any).completedBy) {
                const completedByUser = (topic as any).completedBy.find(
                  (c: any) => c.userId.toString() === userId
                );
                if (completedByUser) {
                  const completedAt = new Date(completedByUser.completedAt);
                  if (completedAt >= today && completedAt < tomorrow) {
                    const topicTitle = typeof topic === 'string' ? topic : topic.title;
                    topicsCompletedToday.push(topicTitle);
                  }
                }
              }
            }
          }
        }
      }

      // Get focus time for today
      const sessions = await FocusSession.find({
        userId: new Types.ObjectId(userId),
        roomId: roomId,
        startedAt: { $gte: today, $lt: tomorrow },
      });

      const focusTime = sessions.reduce((sum, session) => sum + (session.elapsedTime || 0), 0);

      // Get streak info
      const userStreak = room.streaks?.find((s: any) => s.userId.toString() === userId);
      const streakDays = userStreak?.days || 0;

      // Count quizzes completed today (placeholder - would need quiz completion tracking)
      const quizzesCompleted = 0;

      userSummaries.push({
        userId,
        userName,
        topicsCompleted: completedTopicsCount,
        topicsCompletedToday,
        totalFocusTime: focusTime,
        quizzesCompleted,
        streakDays,
        progressPercentage: Math.round(progressPercentage * 100) / 100,
      });

      totalTopicsCompletedToday += topicsCompletedToday.length;
      totalFocusTime += focusTime;
    }

    const averageProgress = userSummaries.length > 0
      ? userSummaries.reduce((sum, u) => sum + u.progressPercentage, 0) / userSummaries.length
      : 0;

    const summary: RoomDailySummary = {
      roomId: roomId.toString(),
      roomName: roomName,
      date: today,
      userSummaries,
      totalTopicsCompleted: totalTopicsCompletedToday,
      totalFocusTime,
      averageProgress: Math.round(averageProgress * 100) / 100,
    };

    console.log(`✅ [EndOfDay] Summary generated for room ${roomName}:`, {
      topicsCompleted: totalTopicsCompletedToday,
      focusTime: `${Math.floor(totalFocusTime / 3600)}h ${Math.floor((totalFocusTime % 3600) / 60)}m`,
      avgProgress: `${averageProgress.toFixed(1)}%`,
    });

    return summary;
  } catch (error) {
    console.error(`❌ [EndOfDay] Error generating summary for room ${roomId}:`, error);
    return null;
  }
};

/**
 * Emit end-of-day summary to all room members
 */
const emitSummaryToRoom = (summary: RoomDailySummary): void => {
  try {
    const socketService = getSocketServiceInstance();
    if (!socketService) return;

    // Format summary message
    const message = {
      type: 'daily_summary',
      roomId: summary.roomId,
      roomName: summary.roomName,
      date: summary.date.toISOString(),
      stats: {
        topicsCompleted: summary.totalTopicsCompleted,
        totalFocusTime: summary.totalFocusTime,
        averageProgress: summary.averageProgress,
      },
      users: summary.userSummaries.map(u => ({
        userId: u.userId,
        userName: u.userName,
        topicsCompleted: u.topicsCompletedToday.length,
        focusTime: u.totalFocusTime,
        progress: u.progressPercentage,
        streak: u.streakDays,
      })),
      timestamp: new Date().toISOString(),
    };

    // Emit to all room members
    socketService.emitToRoom(summary.roomId, 'day:summary', message);

    console.log(`📤 [EndOfDay] Summary emitted to room ${summary.roomName}`);
  } catch (error) {
    console.error('❌ [EndOfDay] Error emitting summary:', error);
  }
};

/**
 * Generate and emit summaries for all active rooms
 */
const generateEndOfDaySummaries = async (): Promise<void> => {
  try {
    console.log('🌙 [EndOfDay] Starting end-of-day summary generation...');

    // Find all active rooms
    const rooms = await Room.find({
      'members': { $exists: true, $ne: [] },
    }).select('_id name');

    if (!rooms || rooms.length === 0) {
      console.log('ℹ️ [EndOfDay] No active rooms found');
      return;
    }

    console.log(`📊 [EndOfDay] Processing ${rooms.length} room(s)`);

    let summariesGenerated = 0;

    // Process each room
    for (const room of rooms) {
      const summary = await generateDailySummaryForRoom(room._id);
      
      if (summary) {
        // Emit summary to room members
        emitSummaryToRoom(summary);
        
        // Store summary in room (optional - for history)
        await Room.findByIdAndUpdate(room._id, {
          $push: {
            dailySummaries: {
              $each: [summary],
              $slice: -30, // Keep last 30 days
            },
          },
        });

        summariesGenerated++;
      }
    }

    console.log(`✅ [EndOfDay] Generated and sent ${summariesGenerated} summaries`);
  } catch (error) {
    console.error('❌ [EndOfDay] Error during summary generation:', error);
  }
};

/**
 * Start the end-of-day summary cron job
 * Runs every day at 23:59
 */
export const startEndOfDaySummaryJob = (): void => {
  if (endOfDaySummaryJob) {
    console.log('⚠️ End-of-day summary job is already running');
    return;
  }

  // Run every day at 23:59: 59 23 * * *
  endOfDaySummaryJob = cron.schedule('59 23 * * *', async () => {
    await generateEndOfDaySummaries();
  });

  console.log('✅ End-of-day summary cron job started (runs daily at 23:59)');
};

/**
 * Stop the end-of-day summary cron job
 */
export const stopEndOfDaySummaryJob = (): void => {
  if (endOfDaySummaryJob) {
    endOfDaySummaryJob.stop();
    endOfDaySummaryJob = null;
    console.log('🛑 End-of-day summary cron job stopped');
  }
};

/**
 * Run end-of-day summary immediately (for testing or manual trigger)
 */
export const runEndOfDaySummaryNow = async (): Promise<void> => {
  console.log('🚀 [EndOfDay] Running immediate summary generation...');
  await generateEndOfDaySummaries();
};

/**
 * Get summary for specific room and date
 */
export const getSummaryForRoom = async (
  roomId: string,
  date?: Date
): Promise<RoomDailySummary | null> => {
  return generateDailySummaryForRoom(new Types.ObjectId(roomId));
};

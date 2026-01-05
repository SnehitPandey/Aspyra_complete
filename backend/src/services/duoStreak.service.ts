import { Types } from 'mongoose';
import DuoStreak, { IDuoStreak } from '../models/duoStreak.model.js';
import { User } from '../models/user.model.js';
import { Room } from '../models/room.model.js';
import { createError } from '../middleware/errorHandler.js';

export class DuoStreakService {
  /**
   * Get or create a duo streak document for a pair of users
   */
  async getOrCreateDuoStreak(user1Id: string, user2Id: string): Promise<IDuoStreak> {
    const id1 = new Types.ObjectId(user1Id);
    const id2 = new Types.ObjectId(user2Id);

    // Sort IDs to ensure consistent order (bidirectional match)
    const [sortedId1, sortedId2] = id1.toString() < id2.toString() ? [id1, id2] : [id2, id1];

    let duoStreak = await DuoStreak.findOne({
      user1Id: sortedId1,
      user2Id: sortedId2,
    });

    if (!duoStreak) {
      duoStreak = new DuoStreak({
        user1Id: sortedId1,
        user2Id: sortedId2,
        streak: 0,
        lastCompletedDate: null,
        calendar: new Map(),
      });
      await duoStreak.save();
    }

    return duoStreak;
  }

  /**
   * Get duo streak by either user ID
   */
  async getDuoStreakByUserId(userId: string): Promise<IDuoStreak | null> {
    const id = new Types.ObjectId(userId);

    const duoStreak = await DuoStreak.findOne({
      $or: [{ user1Id: id }, { user2Id: id }],
    });

    return duoStreak;
  }

  /**
   * Check if both users have completed all their "Today's Tasks"
   */
  async checkBothUsersCompletedTasks(user1Id: string, user2Id: string): Promise<boolean> {
    const user1Complete = await this.hasUserCompletedAllTasks(user1Id);
    const user2Complete = await this.hasUserCompletedAllTasks(user2Id);

    console.log(`📊 Task completion check:`, {
      user1Id,
      user1Complete,
      user2Id,
      user2Complete,
    });

    return user1Complete && user2Complete;
  }

  /**
   * Check if a user has completed all their tasks for today
   * Uses the today's tasks endpoint logic to determine completion
   */
  private async hasUserCompletedAllTasks(userId: string): Promise<boolean> {
    const id = new Types.ObjectId(userId);

    // Get all user's active rooms
    const rooms = await Room.find({
      'members.userId': id,
      status: { $in: ['PREPARING', 'ONGOING'] },
    });

    if (rooms.length === 0) {
      // No active rooms = no tasks = considered complete
      return true;
    }

    // ✨ NEW: Check if today's tasks are completed instead of ALL milestones
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday
    
    for (const room of rooms) {
      if (!room.roadmap || !room.roadmap.phases) continue;
      
      // Find active milestone (current milestone user is working on)
      const member = room.members.find(m => m.userId.toString() === userId);
      if (!member || !member.progress) continue;
      
      const currentPhaseIndex = member.progress.currentPhase || 0;
      const currentMilestoneIndex = member.progress.currentMilestone || 0;
      
      const phase = room.roadmap.phases[currentPhaseIndex];
      if (!phase) continue;
      
      const milestone = phase.milestones[currentMilestoneIndex];
      if (!milestone || milestone.completed) continue;
      
      // Check if this milestone has tasks scheduled for today
      const scheduledTopics = milestone.topics?.filter((topic: any) => {
        if (!topic.scheduledDays || topic.scheduledDays.length === 0) return false;
        return topic.scheduledDays.includes(dayOfWeek);
      }) || [];
      
      // If there are scheduled topics for today, check if they're all completed
      if (scheduledTopics.length > 0) {
        const allScheduledCompleted = scheduledTopics.every((topic: any) => {
          return topic.status === 'completed' || topic.completed === true;
        });
        
        if (!allScheduledCompleted) {
          console.log(`❌ User ${userId} has uncompleted scheduled topics in room ${room._id}`);
          return false;
        }
      }
    }

    // All today's scheduled tasks are completed
    console.log(`✅ User ${userId} has completed all today's tasks`);
    return true;
  }

  /**
   * Check daily completion and update streak
   * Called when tasks are marked complete or via socket event
   */
  async checkDailyCompletion(
    user1Id: string,
    user2Id: string,
    bothOnline: boolean
  ): Promise<{
    streakUpdated: boolean;
    streak: number;
    date: string;
    calendar: Map<string, 'completed' | 'missed'>;
    reason?: string;
  }> {
    const today: string = new Date().toISOString().split('T')[0]!; // YYYY-MM-DD
    const duoStreak = await this.getOrCreateDuoStreak(user1Id, user2Id);

    // Prevent duplicate increment on same day
    if (duoStreak.lastCompletedDate === today) {
      console.log(`⏭️ Streak already updated today (${today})`);
      return {
        streakUpdated: false,
        streak: duoStreak.streak,
        date: today,
        calendar: duoStreak.calendar,
        reason: 'Already updated today',
      };
    }

    // Check if both users completed their tasks
    const bothCompleted = await this.checkBothUsersCompletedTasks(user1Id, user2Id);

    if (bothCompleted && bothOnline) {
      // SUCCESS: Increment streak
      duoStreak.streak += 1;
      duoStreak.lastCompletedDate = today;
      duoStreak.calendar.set(today, 'completed');
      await duoStreak.save();

      console.log(`✅ Duo streak updated! New streak: ${duoStreak.streak}`);

      return {
        streakUpdated: true,
        streak: duoStreak.streak,
        date: today,
        calendar: duoStreak.calendar,
      };
    } else {
      // FAILURE: Conditions not met
      const reason = !bothCompleted
        ? 'One or both users have incomplete tasks'
        : 'Both users must be online';

      console.log(`❌ Streak not updated: ${reason}`);

      return {
        streakUpdated: false,
        streak: duoStreak.streak,
        date: today,
        calendar: duoStreak.calendar,
        reason,
      };
    }
  }

  /**
   * Reset streak to 0 (called when a day is missed)
   */
  async resetStreak(user1Id: string, user2Id: string, date: string): Promise<IDuoStreak> {
    const duoStreak = await this.getOrCreateDuoStreak(user1Id, user2Id);

    duoStreak.streak = 0;
    duoStreak.calendar.set(date, 'missed');
    await duoStreak.save();

    console.log(`💔 Duo streak reset to 0 on ${date}`);

    return duoStreak;
  }

  /**
   * Check if a streak was missed (for cron job)
   * Returns true if streak should be reset
   */
  async shouldResetStreak(duoStreak: IDuoStreak): Promise<boolean> {
    const today: string = new Date().toISOString().split('T')[0]!;
    const yesterday: string = new Date(Date.now() - 86400000).toISOString().split('T')[0]!;

    // If last completed date is not yesterday or today, streak is broken
    if (duoStreak.lastCompletedDate !== today && duoStreak.lastCompletedDate !== yesterday) {
      return true;
    }

    // If yesterday was missed (not in calendar or marked as missed)
    const yesterdayStatus = duoStreak.calendar.get(yesterday);
    if (!yesterdayStatus || yesterdayStatus === 'missed') {
      return true;
    }

    return false;
  }

  /**
   * Get all duo streaks (for cron job)
   */
  async getAllDuoStreaks(): Promise<IDuoStreak[]> {
    return await DuoStreak.find({});
  }

  /**
   * Get streak info by user ID
   */
  async getStreakInfo(userId: string): Promise<{
    exists: boolean;
    streak: number;
    lastCompletedDate: string | null;
    calendar: Record<string, 'completed' | 'missed'>;
    partnerId?: string;
  }> {
    const duoStreak = await this.getDuoStreakByUserId(userId);

    if (!duoStreak) {
      return {
        exists: false,
        streak: 0,
        lastCompletedDate: null,
        calendar: {},
      };
    }

    // Convert Map to plain object for JSON response
    const calendarObj: Record<string, 'completed' | 'missed'> = {};
    duoStreak.calendar.forEach((value, key) => {
      calendarObj[key] = value;
    });

    // Get partner ID
    const partnerId = duoStreak.getPartnerId(userId);

    return {
      exists: true,
      streak: duoStreak.streak,
      lastCompletedDate: duoStreak.lastCompletedDate,
      calendar: calendarObj,
      partnerId: partnerId?.toString(),
    };
  }
}

export const duoStreakService = new DuoStreakService();

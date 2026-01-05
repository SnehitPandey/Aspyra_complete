// backend/src/worker/dailyTaskGeneration.worker.ts
/**
 * Daily Task Generation Worker
 * Scheduled job to automatically generate daily tasks from roadmap topics
 * Runs every day at 00:00 (midnight)
 */

import cron from 'node-cron';
import { Room } from '../models/room.model.js';
import { socketEventManager } from '../services/socketEventManager.js';
import { Types } from 'mongoose';

let dailyTaskJob: cron.ScheduledTask | null = null;

/**
 * Generate daily tasks for a specific room
 */
const generateDailyTasksForRoom = async (roomId: Types.ObjectId): Promise<number> => {
  try {
    const room = await Room.findById(roomId);
    if (!room || !room.roadmap?.phases) {
      return 0;
    }

    console.log(`📋 [DailyTasks] Generating tasks for room ${roomId}`);

    let tasksGenerated = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Iterate through roadmap to find today's topics
    for (const phase of room.roadmap.phases) {
      if (!phase.milestones) continue;

      for (const milestone of phase.milestones) {
        if (!milestone.topics || !milestone.endDate) continue;

        // Check if this milestone is due today or overdue
        const dueDate = new Date(milestone.endDate);
        dueDate.setHours(0, 0, 0, 0);

        if (dueDate <= today) {
          // Generate tasks for incomplete topics in this milestone
          for (const topic of milestone.topics) {
            const topicTitle = typeof topic === 'string' ? topic : topic.title;
            const topicId = typeof topic === 'object' && (topic as any)._id 
              ? (topic as any)._id.toString() 
              : topicTitle;

            // Check if topic is already completed
            const isCompleted = typeof topic === 'object' && 
              (topic as any).completedBy && 
              Array.isArray((topic as any).completedBy) &&
              (topic as any).completedBy.length > 0;

            if (!isCompleted) {
              // Emit today's task event for this topic
              socketEventManager.emitKanbanUpdate({
                taskId: topicId,
                topicId: topicId,
                roomId: roomId.toString(),
                newStatus: dueDate < today ? 'todo' : 'backlog',
                userId: 'system',
              });

              tasksGenerated++;
            }
          }
        }
      }
    }

    if (tasksGenerated > 0) {
      console.log(`✅ [DailyTasks] Generated ${tasksGenerated} task(s) for room ${roomId}`);
    } else {
      console.log(`ℹ️ [DailyTasks] No new tasks to generate for room ${roomId}`);
    }

    return tasksGenerated;
  } catch (error) {
    console.error(`❌ [DailyTasks] Error generating tasks for room ${roomId}:`, error);
    return 0;
  }
};

/**
 * Generate daily tasks for all active rooms
 */
const generateDailyTasksForAllRooms = async (): Promise<void> => {
  try {
    console.log('🌅 [DailyTasks] Starting daily task generation for all rooms...');

    // Find all active rooms (rooms with members and roadmap)
    const rooms = await Room.find({
      'roadmap.phases': { $exists: true, $ne: [] },
      'members': { $exists: true, $ne: [] },
    }).select('_id name');

    if (!rooms || rooms.length === 0) {
      console.log('ℹ️ [DailyTasks] No active rooms found');
      return;
    }

    console.log(`📊 [DailyTasks] Found ${rooms.length} active room(s)`);

    let totalTasksGenerated = 0;

    // Process each room
    for (const room of rooms) {
      const count = await generateDailyTasksForRoom(room._id);
      totalTasksGenerated += count;
    }

    console.log(`✅ [DailyTasks] Daily task generation complete. Total tasks generated: ${totalTasksGenerated}`);
  } catch (error) {
    console.error('❌ [DailyTasks] Error during daily task generation:', error);
  }
};

/**
 * Start the daily task generation cron job
 * Runs every day at 00:00 (midnight)
 */
export const startDailyTaskGenerationJob = (): void => {
  if (dailyTaskJob) {
    console.log('⚠️ Daily task generation job is already running');
    return;
  }

  // Run every day at 00:00: 0 0 * * *
  dailyTaskJob = cron.schedule('0 0 * * *', async () => {
    await generateDailyTasksForAllRooms();
  });

  console.log('✅ Daily task generation cron job started (runs daily at 00:00)');
};

/**
 * Stop the daily task generation cron job
 */
export const stopDailyTaskGenerationJob = (): void => {
  if (dailyTaskJob) {
    dailyTaskJob.stop();
    dailyTaskJob = null;
    console.log('🛑 Daily task generation cron job stopped');
  }
};

/**
 * Run daily task generation immediately (for testing or manual trigger)
 */
export const runDailyTaskGenerationNow = async (): Promise<void> => {
  console.log('🚀 [DailyTasks] Running immediate daily task generation...');
  await generateDailyTasksForAllRooms();
};

/**
 * Generate tasks for a specific room (API endpoint helper)
 */
export const generateTasksForRoom = async (roomId: string): Promise<number> => {
  return generateDailyTasksForRoom(new Types.ObjectId(roomId));
};

// backend/src/services/kanban.service.ts
/**
 * Kanban Auto-Management Service
 * Automatically manages task board based on topic completion and roadmap progress
 */

import { Room } from '../models/room.model.js';
import { Types } from 'mongoose';
import { socketEventManager } from './socketEventManager.js';

interface KanbanTask {
  id: string;
  title: string;
  topicId: string;
  milestoneId?: string;
  status: 'backlog' | 'todo' | 'in-progress' | 'done';
  priority: 'low' | 'medium' | 'high';
  dueDate?: Date;
  completedAt?: Date;
  assignedTo?: string[];
}

/**
 * Sync Kanban board with roadmap progress
 * Auto-generates tasks from incomplete topics
 */
export const syncKanbanWithRoadmap = async (roomId: string | Types.ObjectId): Promise<number> => {
  try {
    const room = await Room.findById(roomId);
    if (!room || !room.roadmap?.phases) {
      return 0;
    }

    console.log(`📊 [Kanban] Syncing board with roadmap for room ${roomId}`);

    let tasksCreated = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Initialize kanban board if it doesn't exist
    if (!(room as any).kanban) {
      (room as any).kanban = {
        backlog: [],
        todo: [],
        inProgress: [],
        done: [],
      };
    }

    // Get all existing task IDs
    const kanban = (room as any).kanban;
    const existingTaskIds = new Set([
      ...(kanban.backlog || []).map((t: any) => t.id || t.topicId),
      ...(kanban.todo || []).map((t: any) => t.id || t.topicId),
      ...(kanban.inProgress || []).map((t: any) => t.id || t.topicId),
      ...(kanban.done || []).map((t: any) => t.id || t.topicId),
    ]);

    // Iterate through roadmap
    for (const phase of room.roadmap.phases) {
      if (!phase.milestones) continue;

      for (const milestone of phase.milestones) {
        if (!milestone.topics) continue;

        const milestoneEndDate = milestone.endDate ? new Date(milestone.endDate) : null;
        if (milestoneEndDate) milestoneEndDate.setHours(0, 0, 0, 0);

        for (const topic of milestone.topics) {
          const topicTitle = typeof topic === 'string' ? topic : topic.title;
          const topicId = typeof topic === 'object' && (topic as any)._id 
            ? (topic as any)._id.toString() 
            : topicTitle;

          // Skip if task already exists
          if (existingTaskIds.has(topicId)) continue;

          // Check if topic is completed
          const isCompleted = typeof topic === 'object' && 
            (topic as any).completedBy && 
            Array.isArray((topic as any).completedBy) &&
            (topic as any).completedBy.length > 0;

          if (isCompleted) {
            // Add to done column
            (kanban.done as any).push({
              id: topicId,
              topicId,
              title: topicTitle,
              milestoneId: milestone.id || milestone.title,
              status: 'done',
              priority: 'medium',
              completedAt: new Date(),
            });
          } else {
            // Determine status based on due date
            let status: 'backlog' | 'todo' | 'in-progress' = 'backlog';
            let priority: 'low' | 'medium' | 'high' = 'medium';

            if (milestoneEndDate) {
              const daysUntilDue = Math.floor((milestoneEndDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
              
              if (daysUntilDue < 0) {
                // Overdue
                status = 'todo';
                priority = 'high';
              } else if (daysUntilDue <= 7) {
                // Due within a week
                status = 'todo';
                priority = 'high';
              } else if (daysUntilDue <= 30) {
                // Due within a month
                status = 'todo';
                priority = 'medium';
              }
            }

            // Add to appropriate column
            (kanban[status] as any).push({
              id: topicId,
              topicId,
              title: topicTitle,
              milestoneId: milestone.id || milestone.title,
              status,
              priority,
              dueDate: milestoneEndDate,
            });
          }

          tasksCreated++;
        }
      }
    }

    if (tasksCreated > 0) {
      room.markModified('kanban');
      await room.save();

      console.log(`✅ [Kanban] Created ${tasksCreated} task(s) for room ${roomId}`);

      // Emit event to refresh kanban board
      socketEventManager.emitKanbanUpdate({
        taskId: 'kanban-sync',
        topicId: 'sync',
        roomId: roomId.toString(),
        newStatus: 'todo',
        userId: 'system',
      });
    }

    return tasksCreated;
  } catch (error) {
    console.error(`❌ [Kanban] Error syncing board for room ${roomId}:`, error);
    return 0;
  }
};

/**
 * Move task to done when topic is completed
 */
export const moveTaskToDone = async (
  roomId: string | Types.ObjectId,
  topicId: string,
  userId: string
): Promise<boolean> => {
  try {
    const room = await Room.findById(roomId);
    if (!room || !(room as any).kanban) {
      return false;
    }

    const kanban = (room as any).kanban;
    let taskMoved = false;

    // Search for task in all columns
    for (const column of ['backlog', 'todo', 'inProgress'] as const) {
      const tasks = kanban[column] as any[];
      const taskIndex = tasks?.findIndex((t: any) => 
        t.id === topicId || t.topicId === topicId || t.title === topicId
      );

      if (taskIndex !== undefined && taskIndex >= 0) {
        // Remove from current column
        const task = tasks.splice(taskIndex, 1)[0];
        
        // Update task status
        task.status = 'done';
        task.completedAt = new Date();
        
        // Add to done column
        if (!kanban.done) kanban.done = [];
        (kanban.done as any).push(task);
        
        taskMoved = true;
        break;
      }
    }

    if (taskMoved) {
      room.markModified('kanban');
      await room.save();

      console.log(`✅ [Kanban] Moved task ${topicId} to done for room ${roomId}`);

      // Emit event
      socketEventManager.emitKanbanUpdate({
        taskId: topicId,
        topicId,
        roomId: roomId.toString(),
        newStatus: 'done',
        userId,
      });

      return true;
    }

    return false;
  } catch (error) {
    console.error(`❌ [Kanban] Error moving task to done:`, error);
    return false;
  }
};

/**
 * Get Kanban board for room
 */
export const getKanbanBoard = async (roomId: string | Types.ObjectId): Promise<any> => {
  try {
    const room = await Room.findById(roomId).select('kanban');
    if (!room) return null;

    return (room as any).kanban || {
      backlog: [],
      todo: [],
      inProgress: [],
      done: [],
    };
  } catch (error) {
    console.error(`❌ [Kanban] Error fetching board:`, error);
    return null;
  }
};

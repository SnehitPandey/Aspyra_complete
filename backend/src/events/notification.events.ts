import { notificationService } from '../services/notification.service.js';
import type { Logger } from 'pino';

export class NotificationEvents {
  private logger?: Logger;

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  // User joins room - notify host
  async onUserJoinedRoom(data: { roomId: string; hostId: string; userName: string; userId: string }): Promise<void> {
    try {
      await notificationService.createNotification({
        userId: data.hostId,
        type: 'ROOM_JOINED',
        title: 'New Room Member',
        message: `${data.userName} joined your room`,
        payload: {
          roomId: data.roomId,
          joinedUserId: data.userId,
          joinedUserName: data.userName,
        },
      });

      this.logger?.info({ roomId: data.roomId, hostId: data.hostId }, 'Room join notification sent');
    } catch (error) {
      this.logger?.error({ error, data }, 'Failed to send room join notification');
    }
  }

  // Teacher uploads note - notify channel followers (if implemented)
  async onNoteUploaded(data: { channelId: string; teacherId: string; noteTitle: string; noteId: string }): Promise<void> {
    try {
      // For now, we'll just log this - in a full implementation, 
      // you'd get channel followers and notify them
      await notificationService.createNotification({
        userId: data.teacherId, // Notify teacher for now
        type: 'NOTE_UPLOADED',
        title: 'Note Uploaded Successfully',
        message: `Your note "${data.noteTitle}" has been uploaded`,
        payload: {
          channelId: data.channelId,
          noteId: data.noteId,
          noteTitle: data.noteTitle,
        },
      });

      this.logger?.info({ channelId: data.channelId, noteId: data.noteId }, 'Note upload notification sent');
    } catch (error) {
      this.logger?.error({ error, data }, 'Failed to send note upload notification');
    }
  }

  // Task assigned to user
  async onTaskAssigned(data: { taskId: string; assigneeId: string; assignerName: string; taskTitle: string }): Promise<void> {
    try {
      await notificationService.createNotification({
        userId: data.assigneeId,
        type: 'TASK_ASSIGNED',
        title: 'New Task Assigned',
        message: `${data.assignerName} assigned you a task: "${data.taskTitle}"`,
        payload: {
          taskId: data.taskId,
          taskTitle: data.taskTitle,
          assignerName: data.assignerName,
        },
      });

      this.logger?.info({ taskId: data.taskId, assigneeId: data.assigneeId }, 'Task assignment notification sent');
    } catch (error) {
      this.logger?.error({ error, data }, 'Failed to send task assignment notification');
    }
  }
}

// Export singleton instance
export const notificationEvents = new NotificationEvents();

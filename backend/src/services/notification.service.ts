import { Notification, type INotification } from '../models/notification.model.js';
import type { Document } from 'mongoose';
import { createError } from '../middleware/errorHandler.js';

export interface CreateNotificationData {
  userId: string;
  type: 'ROOM_INVITE' | 'TASK_ASSIGNED' | 'NOTE_UPLOADED' | 'ROOM_JOINED' | 'QUIZ_GENERATED' | 'GROUP_ASSIGNED';
  title: string;
  message?: string;
  payload?: Record<string, any>;
}

export class NotificationService {
  // Create a new notification
  async createNotification(data: CreateNotificationData): Promise<INotification & Document> {
    const notification = new Notification({
      userId: data.userId,
      type: data.type,
      title: data.title,
      message: data.message,
      payload: data.payload || {},
      read: false,
      createdAt: new Date()
    });
    return await notification.save();
  }

  // Bulk create notifications
  async createBulkNotifications(notifications: CreateNotificationData[]): Promise<void> {
    const bulkData = notifications.map(notif => ({
      userId: notif.userId,
      type: notif.type,
      title: notif.title,
      message: notif.message,
      payload: notif.payload || {},
      read: false,
      createdAt: new Date()
    }));
    await Notification.insertMany(bulkData);
  }

  // Get user notifications with pagination
  async getUserNotifications(userId: string, page: number = 1, limit: number = 20): Promise<{
    notifications: (INotification & Document)[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      unreadCount: number;
    };
  }> {
    const skip = (page - 1) * limit;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      Notification.countDocuments({ userId }),
      Notification.countDocuments({ userId, read: false })
    ]);

    return {
      notifications,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        unreadCount
      }
    };
  }

  // Mark notifications as read
  async markAsRead(notificationIds: string[], userId: string): Promise<number> {
    const result = await Notification.updateMany(
      { _id: { $in: notificationIds }, userId },
      { $set: { read: true } }
    );
    return result.modifiedCount;
  }

  // Mark all notifications as read
  async markAllRead(userId: string): Promise<number> {
    const result = await Notification.updateMany(
      { userId, read: false },
      { $set: { read: true } }
    );
    return result.modifiedCount;
  }

  // Delete old notifications (e.g., cleanup)
  async deleteOldNotifications(daysOld = 30): Promise<number> {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    const result = await Notification.deleteMany({
      createdAt: { $lt: cutoff },
      read: true
    });
    return result.deletedCount ?? 0;
  }
}

export const notificationService = new NotificationService();

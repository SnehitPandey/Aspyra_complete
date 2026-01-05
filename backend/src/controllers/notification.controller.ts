import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { notificationService } from '../services/notification.service.js';
import { createError } from '../middleware/errorHandler.js';

// Validation schemas
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const markReadSchema = z.object({
  notificationIds: z.array(z.string().uuid()).min(1).max(100),
});

export class NotificationController {
  // Get user's notifications
  async getNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      // Validate pagination
      const validationResult = paginationSchema.safeParse(req.query);
      if (!validationResult.success) {
        const errorMessage = validationResult.error.errors
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        throw createError(`Validation error: ${errorMessage}`, 400);
      }

      const { page, limit } = validationResult.data;
      const result = await notificationService.getUserNotifications(req.user.id, page, limit);

      res.status(200).json({
        success: true,
        notifications: result.notifications.map(notification => ({
          id: notification.id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          payload: notification.payload,
          read: notification.read,
          createdAt: notification.createdAt.toISOString(),
        })),
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  // Mark notifications as read
  async markAsRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      // Validate input
      const validationResult = markReadSchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorMessage = validationResult.error.errors
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        throw createError(`Validation error: ${errorMessage}`, 400);
      }

      const { notificationIds } = validationResult.data;
      const updatedCount = await notificationService.markAsRead(notificationIds, req.user.id);

      res.status(200).json({
        success: true,
        message: `${updatedCount} notifications marked as read`,
        updatedCount,
      });
    } catch (error) {
      next(error);
    }
  }

  // Mark all notifications as read
  async markAllAsRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const updatedCount = await notificationService.markAllRead(req.user.id);

      res.status(200).json({
        success: true,
        message: `${updatedCount} notifications marked as read`,
        updatedCount,
      });
    } catch (error) {
      next(error);
    }
  }
}

// Export singleton instance
export const notificationController = new NotificationController();

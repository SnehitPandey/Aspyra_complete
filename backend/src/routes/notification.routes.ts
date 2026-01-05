import { Router } from 'express';
import { notificationController } from '../controllers/notification.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = Router();

// All notification routes require authentication
router.use(authenticateToken);

// Get user notifications
router.get('/', notificationController.getNotifications.bind(notificationController));

// Mark specific notifications as read
router.post('/mark-read', notificationController.markAsRead.bind(notificationController));

// Mark all notifications as read
router.post('/mark-all-read', notificationController.markAllAsRead.bind(notificationController));

export { router as notificationRouter };

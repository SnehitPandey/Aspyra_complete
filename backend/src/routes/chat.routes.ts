import { Router } from 'express';
import { chatController } from '../controllers/chat.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = Router();

// All chat routes require authentication
router.use(authenticateToken);

// Get chat history for a room
router.get('/:roomId/messages', chatController.getRoomMessages.bind(chatController));

// Get message statistics for a room
router.get('/:roomId/stats', chatController.getRoomMessageStats.bind(chatController));

export { router as chatRouter };

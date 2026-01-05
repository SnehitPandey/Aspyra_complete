import { Router } from 'express';
import { duoStreakController } from '../controllers/duoStreak.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = Router();

// GET /api/duo-streak - Get current duo streak
router.get('/', authenticateToken, duoStreakController.getStreak.bind(duoStreakController));

// POST /api/duo-streak/check - Manually trigger streak check
router.post('/check', authenticateToken, duoStreakController.checkStreak.bind(duoStreakController));

export default router;

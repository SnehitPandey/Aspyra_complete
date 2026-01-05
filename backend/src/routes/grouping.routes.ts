import { Router } from 'express';
import { groupingController } from '../controllers/grouping.controller.js';
import { authenticateToken, requireAdmin, requireModerator } from '../middleware/auth.middleware.js';
import { aiRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Profile embedding routes (users can embed their own profiles)
router.post('/embed-profile', aiRateLimiter, groupingController.embedProfile.bind(groupingController));
router.get('/embedding/:userId', groupingController.getEmbeddingStatus.bind(groupingController));

// Student grouping routes (admin/moderator only)
router.post('/group-students', aiRateLimiter, requireModerator, groupingController.groupStudents.bind(groupingController));

// Admin-only stats
router.get('/stats', requireAdmin, groupingController.getEmbeddingStats.bind(groupingController));

export { router as groupingRouter };

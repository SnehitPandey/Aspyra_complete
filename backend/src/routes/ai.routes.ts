import { Router } from 'express';
import { aiController } from '../controllers/ai.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { aiRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Apply rate limiting to all AI routes
router.use(aiRateLimiter);

// All AI routes require authentication
router.use(authenticateToken);

// AI endpoints
router.post('/roadmap', aiController.generateRoadmap.bind(aiController));
router.post('/quiz', aiController.generateQuiz.bind(aiController));
router.post('/room-summary', aiController.generateRoomSummary.bind(aiController));
router.post('/text', aiController.generateText.bind(aiController));

export { router as aiRouter };

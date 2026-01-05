import express from 'express';
import { contentController } from '../controllers/content.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// POST /api/content/generate - Generate content for a topic
router.post('/generate', contentController.generateContent);

export default router;

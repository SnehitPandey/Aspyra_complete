// backend/src/routes/focusSession.routes.ts
/**
 * Focus Session Routes
 * Endpoints for timer session persistence and sync
 */

import express from 'express';
import {
  startFocusSession,
  pulseFocusSession,
  endFocusSession,
  getActiveSession,
  pauseFocusSession,
  cleanupStaleSessions,
} from '../controllers/focusSession.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Get active session for user in room (for resume on load)
router.get('/:roomId/session/active', getActiveSession);

// Start new focus session
router.post('/:roomId/session/start', startFocusSession);

// Send heartbeat pulse (called every 30s from frontend)
router.post('/:roomId/session/:sessionId/pulse', pulseFocusSession);

// Pause session
router.post('/:roomId/session/:sessionId/pause', pauseFocusSession);

// End focus session
router.post('/:roomId/session/:sessionId/end', endFocusSession);

// Cleanup stale sessions (admin/cron endpoint)
router.post('/admin/sessions/cleanup', cleanupStaleSessions);

export default router;

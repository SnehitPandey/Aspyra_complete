/**
 * Enhanced Room Routes - New endpoints for robust Room system
 * Handles: roadmap timeline, progress tracking, chat, quiz, kanban, focus timer
 */
import { Router } from 'express';
import { roomEnhancedController } from '../controllers/room-enhanced.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = Router();

// ========== ROOM DETAILS ==========
// GET /api/rooms/:roomId - Get full room (excludes large arrays by default)
router.get(
  '/:roomId',
  authenticateToken,
  roomEnhancedController.getRoomDetails.bind(roomEnhancedController)
);

// ========== ROADMAP TIMELINE ==========
// POST /api/rooms/:roomId/roadmap/apply-timeline
router.post(
  '/:roomId/roadmap/apply-timeline',
  authenticateToken,
  roomEnhancedController.applyTimeline.bind(roomEnhancedController)
);

// GET /api/rooms/:roomId/roadmap
router.get(
  '/:roomId/roadmap',
  authenticateToken,
  roomEnhancedController.getRoadmap.bind(roomEnhancedController)
);

// GET /api/rooms/:roomId/todays-tasks
router.get(
  '/:roomId/todays-tasks',
  authenticateToken,
  roomEnhancedController.getTodaysTasks.bind(roomEnhancedController)
);

// PATCH /api/rooms/:roomId/roadmap/topic/:topicId/complete
router.patch(
  '/:roomId/roadmap/topic/:topicId/complete',
  authenticateToken,
  roomEnhancedController.completeTopicForUser.bind(roomEnhancedController)
);

// ========== PROGRESS & STREAK ==========
// GET /api/rooms/:roomId/progress/:userId
router.get(
  '/:roomId/progress/:userId',
  authenticateToken,
  roomEnhancedController.getUserProgress.bind(roomEnhancedController)
);

// POST /api/rooms/:roomId/progress/:userId/update
router.post(
  '/:roomId/progress/:userId/update',
  authenticateToken,
  roomEnhancedController.updateUserProgress.bind(roomEnhancedController)
);

// ========== CHAT ==========
// GET /api/rooms/:roomId/messages?limit=50
router.get(
  '/:roomId/messages',
  authenticateToken,
  roomEnhancedController.getMessages.bind(roomEnhancedController)
);

// POST /api/rooms/:roomId/messages
router.post(
  '/:roomId/messages',
  authenticateToken,
  roomEnhancedController.postMessage.bind(roomEnhancedController)
);

// ========== QUIZ ==========
// POST /api/rooms/:roomId/quizzes/generate
router.post(
  '/:roomId/quizzes/generate',
  authenticateToken,
  roomEnhancedController.generateQuiz.bind(roomEnhancedController)
);

// POST /api/rooms/:roomId/quizzes/:quizId/submit
router.post(
  '/:roomId/quizzes/:quizId/submit',
  authenticateToken,
  roomEnhancedController.submitQuiz.bind(roomEnhancedController)
);

// GET /api/rooms/:roomId/quizzes
router.get(
  '/:roomId/quizzes',
  authenticateToken,
  roomEnhancedController.getQuizzes.bind(roomEnhancedController)
);

// ========== KANBAN ==========
// GET /api/rooms/:roomId/kanban/:userId
router.get(
  '/:roomId/kanban/:userId',
  authenticateToken,
  roomEnhancedController.getKanbanBoard.bind(roomEnhancedController)
);

// PATCH /api/rooms/:roomId/kanban/:userId/move
router.patch(
  '/:roomId/kanban/:userId/move',
  authenticateToken,
  roomEnhancedController.moveKanbanTask.bind(roomEnhancedController)
);

// ========== FOCUS TIMER ==========
// POST /api/rooms/:roomId/focus/start
router.post(
  '/:roomId/focus/start',
  authenticateToken,
  roomEnhancedController.startFocusSession.bind(roomEnhancedController)
);

// POST /api/rooms/:roomId/focus/:sessionId/pulse
router.post(
  '/:roomId/focus/:sessionId/pulse',
  authenticateToken,
  roomEnhancedController.pulseFocusSession.bind(roomEnhancedController)
);

// POST /api/rooms/:roomId/focus/:sessionId/end
router.post(
  '/:roomId/focus/:sessionId/end',
  authenticateToken,
  roomEnhancedController.endFocusSession.bind(roomEnhancedController)
);

export { router as roomEnhancedRouter };

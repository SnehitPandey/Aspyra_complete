import { Router } from 'express';
import { roomController } from '../controllers/room.controller.js';
import { roomEnhancedController } from '../controllers/room-enhanced.controller.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.middleware.js';

const router = Router();

// Protected routes (require authentication)
router.get('/my-rooms', authenticateToken, roomController.getUserRooms.bind(roomController));
router.get('/my-study-topics', authenticateToken, roomController.getUserStudyTopics.bind(roomController));
router.get('/todays-tasks', authenticateToken, roomController.getTodaysTasks.bind(roomController));
router.get('/check-limit', authenticateToken, roomController.checkRoomLimit.bind(roomController)); // Check room limit
router.get('/public', optionalAuth, roomController.getPublicRooms.bind(roomController)); // Get public rooms
router.post('/', authenticateToken, roomController.createRoom.bind(roomController));
router.post('/join', authenticateToken, roomController.joinRoom.bind(roomController));
router.post('/:roomId/leave', authenticateToken, roomController.leaveRoom.bind(roomController));
router.post('/:roomId/ready', authenticateToken, roomController.toggleReady.bind(roomController));

// User activity tracking
router.post('/activity/update', authenticateToken, roomController.updateUserActivity.bind(roomController));
router.post('/activity/batch', authenticateToken, roomController.getUsersActivities.bind(roomController));

// ✨ NEW: Task and milestone management
router.post('/topic/status', authenticateToken, roomController.updateTopicStatus.bind(roomController));
router.get('/:roomId/active-milestone', authenticateToken, roomController.getActiveMilestone.bind(roomController));
router.patch('/:roomId/milestone/:milestoneId/topic/:topicIndex/complete', authenticateToken, roomController.completeTopicAndUpdateProgress.bind(roomController));
router.post('/:roomId/fix-dates', authenticateToken, roomController.fixRoomDates.bind(roomController));

// AI-powered features
router.post('/:roomId/roadmap/generate', authenticateToken, roomController.generateRoomRoadmap.bind(roomController));
router.post('/:roomId/quiz/generate', authenticateToken, roomEnhancedController.generateQuiz.bind(roomEnhancedController));
router.put('/:roomId/progress', authenticateToken, roomController.updateProgress.bind(roomController));

// Kanban board endpoints
router.get('/:roomId/kanban/:userId', authenticateToken, roomEnhancedController.getKanbanBoard.bind(roomEnhancedController));
router.patch('/:roomId/kanban/:userId/move', authenticateToken, roomEnhancedController.moveKanbanTask.bind(roomEnhancedController));
router.delete('/:roomId/kanban/:userId/reset', authenticateToken, roomController.resetKanbanBoard.bind(roomController));

// Semi-protected routes (optional authentication for public rooms)
router.get('/:roomId', optionalAuth, roomController.getRoomById.bind(roomController));

export { router as roomRouter };

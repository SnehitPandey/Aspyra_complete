// backend/src/routes/dailyTask.routes.ts
/**
 * Daily Task Routes
 * Endpoints for daily task generation and management
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { runDailyTaskGenerationNow, generateTasksForRoom } from '../worker/dailyTaskGeneration.worker.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Manually trigger daily task generation for all rooms (admin)
router.post('/admin/daily-tasks/generate', async (req, res) => {
  try {
    await runDailyTaskGenerationNow();
    res.status(200).json({
      success: true,
      message: 'Daily task generation triggered successfully',
    });
  } catch (error) {
    console.error('[DailyTasks] Error triggering generation:', error);
    res.status(500).json({ error: 'Failed to trigger daily task generation' });
  }
});

// Generate daily tasks for a specific room
router.post('/:roomId/daily-tasks/generate', async (req, res) => {
  try {
    const { roomId } = req.params;
    const count = await generateTasksForRoom(roomId);
    
    res.status(200).json({
      success: true,
      message: `Generated ${count} daily task(s)`,
      tasksGenerated: count,
    });
  } catch (error) {
    console.error('[DailyTasks] Error generating tasks for room:', error);
    res.status(500).json({ error: 'Failed to generate daily tasks' });
  }
});

export default router;

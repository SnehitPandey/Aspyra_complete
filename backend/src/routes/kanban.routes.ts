// backend/src/routes/kanban.routes.ts
/**
 * Kanban Routes
 * Endpoints for kanban board management
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { syncKanbanWithRoadmap, getKanbanBoard } from '../services/kanban.service.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Get kanban board for room
router.get('/:roomId/kanban', async (req, res): Promise<any> => {
  try {
    const { roomId } = req.params;
    const board = await getKanbanBoard(roomId);
    
    if (!board) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    return res.status(200).json({
      success: true,
      kanban: board,
    });
  } catch (error) {
    console.error('[Kanban] Error fetching board:', error);
    res.status(500).json({ error: 'Failed to fetch kanban board' });
  }
});

// Sync kanban board with roadmap
router.post('/:roomId/kanban/sync', async (req, res) => {
  try {
    const { roomId } = req.params;
    const tasksCreated = await syncKanbanWithRoadmap(roomId);
    
    res.status(200).json({
      success: true,
      message: `Synced kanban board with roadmap`,
      tasksCreated,
    });
  } catch (error) {
    console.error('[Kanban] Error syncing board:', error);
    res.status(500).json({ error: 'Failed to sync kanban board' });
  }
});

export default router;

// backend/src/routes/summary.routes.ts
/**
 * Summary Routes
 * Endpoints for daily summary generation and retrieval
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { runEndOfDaySummaryNow, getSummaryForRoom } from '../worker/endOfDaySummary.worker.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Manually trigger end-of-day summary for all rooms (admin)
router.post('/admin/summary/generate', async (req, res): Promise<any> => {
  try {
    await runEndOfDaySummaryNow();
    return res.status(200).json({
      success: true,
      message: 'End-of-day summary generation triggered successfully',
    });
  } catch (error) {
    console.error('[Summary] Error triggering generation:', error);
    return res.status(500).json({ error: 'Failed to trigger summary generation' });
  }
});

// Get daily summary for a specific room
router.get('/:roomId/summary', async (req, res): Promise<any> => {
  try {
    const { roomId } = req.params;
    const summary = await getSummaryForRoom(roomId);
    
    if (!summary) {
      return res.status(404).json({ error: 'Summary not found' });
    }
    
    return res.status(200).json({
      success: true,
      summary,
    });
  } catch (error) {
    console.error('[Summary] Error fetching summary:', error);
    return res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

export default router;

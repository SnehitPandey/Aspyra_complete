// backend/src/routes/partner.routes.ts
/**
 * Partner Routes
 * Endpoints for duo mode partner synchronization
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { getPartnerStatus } from '../services/partnerSync.service.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Get partner's current status
router.get('/:roomId/partner/status', async (req, res): Promise<any> => {
  try {
    const { roomId } = req.params;
    const userId = (req.user as any)?.id || (req.user as any)?._id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const partnerStatus = await getPartnerStatus(roomId, userId.toString());
    
    if (!partnerStatus) {
      return res.status(404).json({ error: 'Partner not found' });
    }
    
    return res.status(200).json({
      success: true,
      partner: partnerStatus,
    });
  } catch (error) {
    console.error('[Partner] Error fetching partner status:', error);
    res.status(500).json({ error: 'Failed to fetch partner status' });
  }
});

export default router;

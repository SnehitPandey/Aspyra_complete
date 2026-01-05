import { Router } from 'express';
import { shareController } from '../controllers/share.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

/**
 * Connect Routes - Alias for share routes with alternative naming
 * 
 * These routes provide the same functionality as /api/share/* but with
 * the naming convention: /api/connect/*
 */
const router = Router();

/**
 * POST /api/connect/generate
 * Generate an invite link for the current user
 * 
 * Creates a one-time inviteCode and returns a shareable link
 * Response: { success: true, link: string, token: string, expiresAt: Date }
 */
router.post('/generate', authenticateToken, (req, res, next) => 
  shareController.createShare(req, res, next)
);

/**
 * POST /api/connect/use
 * Accept an invite and connect two users as study partners
 * 
 * Body: { token: string } OR { inviteCode: string }
 * - Validates the invite code/token
 * - Links both users bidirectionally (sets partnerId on both)
 * - Clears the inviteCode from inviter
 * - Emits Socket.IO 'partnerConnected' event to both users
 * 
 * Response: { success: true, partner: User, message: string }
 */
router.post('/use', authenticateToken, (req, res, next) => 
  shareController.redeemShare(req, res, next)
);

/**
 * POST /api/connect/remove
 * Disconnect from current study partner
 * 
 * Clears partnerId from both users and emits 'partnerDisconnected' event
 * Response: { success: true, message: string }
 */
router.post('/remove', authenticateToken, (req, res, next) => 
  shareController.removePartner(req, res, next)
);

export default router;

import { Router } from 'express';
import { shareController } from '../controllers/share.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = Router();

// Create share link (authenticated)
router.post('/create', authenticateToken, (req, res, next) => shareController.createShare(req, res, next));

// Redeem share link (authenticated)
router.post('/redeem', authenticateToken, (req, res, next) => shareController.redeemShare(req, res, next));

// Get current user's partner (authenticated)
router.get('/partner', authenticateToken, (req, res, next) => shareController.getPartner(req, res, next));

// Remove partner connection (authenticated)
router.post('/remove', authenticateToken, (req, res, next) => shareController.removePartner(req, res, next));

// Public inspect (must be last to avoid conflicts)
router.get('/:token', (req, res, next) => shareController.getLink(req, res, next));

export default router;

import { Router } from 'express';
import { userController } from '../controllers/user.controller.js';
import { shareController } from '../controllers/share.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = Router();

/**
 * GET /api/user/partner
 * Fetch connected study partner for logged-in user
 * 
 * Returns partner's public profile (id, name, email, avatarUrl)
 * Response: { success: true, partner: User | null }
 */
router.get('/partner', authenticateToken, (req, res, next) => 
  shareController.getPartner(req, res, next)
);

/**
 * GET /api/users/username/:username
 * Public: Get full public profile by username
 * 
 * Returns: { success: true, user: { name, username, bio, avatarUrl, studyTopics, stats, etc. } }
 */
router.get('/username/:username', (req, res, next) => userController.getPublicProfileByUsername(req, res, next));

/**
 * GET /api/users/:id
 * Public: Get public profile for any user by ID
 * 
 * Returns: { success: true, user: { id, name, profilePic, avatarUrl } }
 */
router.get('/:id', (req, res, next) => userController.getPublicProfile(req, res, next));

export default router;

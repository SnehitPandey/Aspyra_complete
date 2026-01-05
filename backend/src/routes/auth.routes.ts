import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { uploadAvatar, uploadResume } from '../middleware/upload.middleware.js';

const router = Router();

// Public routes
router.post('/register', authController.register.bind(authController));
router.post('/login', authController.login.bind(authController));
router.post('/refresh', authController.refresh.bind(authController));
router.post('/logout', authController.logout.bind(authController));

// OTP-based authentication routes
router.post('/otp/send', authController.sendOTP.bind(authController));
router.post('/otp/verify', authController.verifyOTP.bind(authController));
router.post('/otp/resend', authController.resendOTP.bind(authController));

// Google OAuth routes
router.get('/google', authController.googleAuth.bind(authController));
router.get('/google/callback', authController.googleCallback.bind(authController));

// Protected route for testing authentication
router.get('/me', authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: req.user,
  });
});

// Profile management routes
router.patch('/profile', authenticateToken, authController.updateProfile.bind(authController));
router.post('/avatar', authenticateToken, uploadAvatar, authController.uploadAvatarHandler.bind(authController));
router.delete('/avatar', authenticateToken, authController.deleteAvatarHandler.bind(authController));
router.post('/resume', authenticateToken, uploadResume, authController.uploadResumeHandler.bind(authController));
router.post('/password', authenticateToken, authController.changePassword.bind(authController));
router.delete('/account', authenticateToken, authController.deleteAccount.bind(authController));

export { router as authRouter };

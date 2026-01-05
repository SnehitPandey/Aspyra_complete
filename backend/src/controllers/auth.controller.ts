import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service.js';
import { createError } from '../middleware/errorHandler.js';
import passport from '../config/passport.js';
import { getFileUrl, deleteFile } from '../middleware/upload.middleware.js';
import path from 'path';
import { env } from '../config/env.js';

// Validation schemas
const registerSchema = z.object({
  email: z.string().email('Invalid email format').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  name: z.string().min(1, 'Name is required').max(100),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

// OTP validation schemas
const sendOTPSchema = z.object({
  email: z.string().email('Invalid email format').max(255),
  purpose: z.enum(['LOGIN', 'SIGNUP']),
});

const verifyOTPSchema = z.object({
  email: z.string().email('Invalid email format').max(255),
  code: z.string().length(6, 'OTP code must be 6 digits'),
  purpose: z.enum(['LOGIN', 'SIGNUP']),
  name: z.string().min(1, 'Name is required').max(100).optional(),
});

// Response interfaces
interface AuthResponse {
  success: boolean;
  user: {
    id: string;
    email: string;
    name: string;
    username?: string;
    bio?: string;
    avatarUrl?: string;
    resumeUrl?: string;
    socialLinks?: {
      github?: string;
      linkedin?: string;
      twitter?: string;
      website?: string;
    };
    role: string;
    createdAt: string;
  };
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
}

interface LogoutResponse {
  success: boolean;
  message: string;
}

export class AuthController {
  // Register new user
  async register(req: Request, res: Response<AuthResponse>, next: NextFunction): Promise<void> {
    try {
      // Validate request body
      const validatedData = registerSchema.parse(req.body);

      // Register user
      const { user, tokens } = await authService.register(validatedData);

      // Set refresh token in httpOnly cookie
      res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      // Send response
      res.status(201).json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          username: user.username,
          bio: user.bio,
          avatarUrl: user.avatarUrl,
          socialLinks: user.socialLinks,
          role: user.role,
          createdAt: user.createdAt.toISOString(),
        },
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationError = createError(
          `Validation error: ${error.errors.map(e => e.message).join(', ')}`, 
          400
        );
        return next(validationError);
      }
      next(error);
    }
  }

  // Login user
  async login(req: Request, res: Response<AuthResponse>, next: NextFunction): Promise<void> {
    try {
      // Validate request body
      const validatedData = loginSchema.parse(req.body);

      // Login user
      const { user, tokens } = await authService.login(validatedData);

      // Set refresh token in httpOnly cookie
      res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      // Send response
      res.status(200).json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          username: user.username,
          bio: user.bio,
          avatarUrl: user.avatarUrl,
          socialLinks: user.socialLinks,
          role: user.role,
          createdAt: user.createdAt.toISOString(),
        },
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationError = createError(
          `Validation error: ${error.errors.map(e => e.message).join(', ')}`, 
          400
        );
        return next(validationError);
      }
      next(error);
    }
  }

  // Refresh tokens
  async refresh(req: Request, res: Response<AuthResponse>, next: NextFunction): Promise<void> {
    try {
      // Get refresh token from cookie or body
      const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

      if (!refreshToken) {
        throw createError('Refresh token is required', 400);
      }

      // Validate refresh token format
      refreshTokenSchema.parse({ refreshToken });

      // Refresh tokens
      const { user, tokens } = await authService.refreshTokens(refreshToken);

      // Set new refresh token in httpOnly cookie
      res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      // Send response
      res.status(200).json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          createdAt: user.createdAt.toISOString(),
        },
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationError = createError(
          `Validation error: ${error.errors.map(e => e.message).join(', ')}`, 
          400
        );
        return next(validationError);
      }
      next(error);
    }
  }

  // Logout user
  async logout(req: Request, res: Response<LogoutResponse>, next: NextFunction): Promise<void> {
    try {
      // Get refresh token from cookie or body
      const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

      if (refreshToken) {
        await authService.logout(refreshToken);
      }

      // Clear refresh token cookie
      res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
      });

      // Send response
      res.status(200).json({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  // Google OAuth - Initiate authentication
  googleAuth(req: Request, res: Response, next: NextFunction): void {
    passport.authenticate('google', {
      scope: ['profile', 'email'],
      session: false,
    })(req, res, next);
  }

  // Google OAuth - Callback handler
  googleCallback(req: Request, res: Response, next: NextFunction): void {
    console.log('🔄 Google callback controller triggered');
    passport.authenticate('google', { session: false }, async (err: any, user: any) => {
      try {
        console.log('📦 Passport authenticate result:', { 
          hasError: !!err, 
          hasUser: !!user,
          errorMessage: err?.message 
        });

        if (err || !user) {
          console.error('❌ Google auth failed:', err?.message || 'No user returned');
          // Redirect to frontend with error
          return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=google_auth_failed`);
        }

        console.log('✅ User authenticated, generating tokens...');
        // Fetch the actual user document from database
        const User = (await import('../models/user.model.js')).User;
        const userDoc = await User.findById(user.id);
        
        if (!userDoc) {
          console.error('❌ User document not found');
          return res.redirect(`${env.FRONTEND_URL}/login?error=user_not_found`);
        }

        // Generate tokens for the user
        const tokens = await authService.generateTokens(userDoc);

        console.log('🍪 Setting refresh token cookie...');
        // Set refresh token in httpOnly cookie
        res.cookie('refreshToken', tokens.refreshToken, {
          httpOnly: true,
          secure: env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        });

        // Redirect to frontend with access token
        const redirectUrl = `${env.FRONTEND_URL}/auth/callback?token=${tokens.accessToken}`;
        console.log('🚀 Redirecting to:', redirectUrl);
        res.redirect(redirectUrl);
      } catch (error) {
        console.error('❌ Google callback error:', error);
        res.redirect(`${env.FRONTEND_URL}/login?error=auth_error`);
      }
    })(req, res, next);
  }

  // Update user profile
  async updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }

      const { name, username, bio, socialLinks } = req.body;
      
      const User = (await import('../models/user.model.js')).User;
      const user = await User.findById(userId);
      
      if (!user) {
        throw createError('User not found', 404);
      }

      // Update fields
      if (name) user.name = name;
      if (username) user.username = username;
      if (bio !== undefined) user.bio = bio;
      if (socialLinks) user.socialLinks = socialLinks;

      await user.save();

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          username: user.username,
          bio: user.bio,
          socialLinks: user.socialLinks,
          avatarUrl: user.avatarUrl,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // Upload avatar handler
  async uploadAvatarHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }

      if (!req.file) {
        throw createError('No file uploaded', 400);
      }

      const User = (await import('../models/user.model.js')).User;
      const user = await User.findById(userId);
      
      if (!user) {
        throw createError('User not found', 404);
      }

      // Delete old custom avatar if exists
      if (user.customAvatarURL && user.isCustomAvatar) {
        try {
          const oldPath = path.join(process.cwd(), 'uploads', user.customAvatarURL.replace('/uploads/', ''));
          deleteFile(oldPath);
        } catch (error) {
          console.warn('Failed to delete old avatar:', error);
        }
      }

      // Update user with new custom avatar URL
      const avatarUrl = getFileUrl(req, req.file.path);
      user.customAvatarURL = avatarUrl;
      user.isCustomAvatar = true; // Mark that user has uploaded custom avatar
      user.avatarUrl = avatarUrl; // Update legacy field for backward compatibility
      await user.save();

      // Debug logging
      console.log('🖼️ Avatar Upload Debug:');
      console.log('  - Uploaded file path:', req.file.path);
      console.log('  - Generated customAvatarURL:', avatarUrl);
      console.log('  - isCustomAvatar:', user.isCustomAvatar);
      console.log('  - Request protocol:', req.protocol);
      console.log('  - Request host:', req.get('host'));
      console.log('  - User customAvatarURL in DB:', user.customAvatarURL);

      const responsePayload = {
        success: true,
        avatarUrl,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          username: user.username,
          bio: user.bio,
          avatarUrl: user.avatarUrl,
          socialLinks: user.socialLinks,
        },
      };

      console.log('  - Response payload:', JSON.stringify(responsePayload, null, 2));

      res.json(responsePayload);
    } catch (error) {
      // Clean up uploaded file if error occurs
      if (req.file) {
        deleteFile(req.file.path);
      }
      next(error);
    }
  }

  // Upload resume handler
  async uploadResumeHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }

      if (!req.file) {
        throw createError('No file uploaded', 400);
      }

      const User = (await import('../models/user.model.js')).User;
      const user = await User.findById(userId);
      
      if (!user) {
        throw createError('User not found', 404);
      }

      // Delete old resume if exists
      if (user.resumeUrl) {
        const oldPath = path.join(process.cwd(), 'uploads', user.resumeUrl.replace('/uploads/', ''));
        deleteFile(oldPath);
      }

  // Update user with new resume URL
  const resumeUrl = getFileUrl(req, req.file.path);
      user.resumeUrl = resumeUrl;
      await user.save();

      res.json({
        success: true,
        resumeUrl,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          username: user.username,
          bio: user.bio,
          avatarUrl: user.avatarUrl,
          resumeUrl: user.resumeUrl,
          socialLinks: user.socialLinks,
        },
      });
    } catch (error) {
      // Clean up uploaded file if error occurs
      if (req.file) {
        deleteFile(req.file.path);
      }
      next(error);
    }
  }

  // Change password
  async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }

      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        throw createError('Current password and new password are required', 400);
      }

      if (newPassword.length < 8) {
        throw createError('New password must be at least 8 characters', 400);
      }

      const User = (await import('../models/user.model.js')).User;
      const user = await User.findById(userId);
      
      if (!user) {
        throw createError('User not found', 404);
      }

      // Verify current password
      const isValid = await user.comparePassword(currentPassword);
      if (!isValid) {
        throw createError('Current password is incorrect', 401);
      }

      // Update password
      user.password = newPassword;
      await user.save();

      res.json({
        success: true,
        message: 'Password updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  // Delete custom avatar (revert to default profile pic)
  async deleteAvatarHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }

      const User = (await import('../models/user.model.js')).User;
      const user = await User.findById(userId);
      
      if (!user) {
        throw createError('User not found', 404);
      }

      // Delete custom avatar file if exists
      if (user.customAvatarURL && user.isCustomAvatar) {
        try {
          const avatarPath = path.join(process.cwd(), 'uploads', user.customAvatarURL.replace('/uploads/', ''));
          deleteFile(avatarPath);
        } catch (error) {
          console.warn('Failed to delete avatar file:', error);
        }
      }

      // Revert to default profile picture (Google or Gravatar)
      user.customAvatarURL = undefined;
      user.isCustomAvatar = false;
      // Update legacy avatarUrl to show profile pic (Google/Gravatar)
      user.avatarUrl = user.profilePic;
      await user.save();

      console.log('🗑️  Custom avatar deleted, reverted to:', user.profilePic);

      res.json({
        success: true,
        message: 'Custom avatar deleted successfully',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          username: user.username,
          bio: user.bio,
          avatarUrl: user.avatarUrl, // Will show profilePic now
          profilePic: user.profilePic,
          isCustomAvatar: user.isCustomAvatar,
          socialLinks: user.socialLinks,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // Delete account
  async deleteAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }

      const { password } = req.body;

      if (!password) {
        throw createError('Password is required to delete account', 400);
      }

      const User = (await import('../models/user.model.js')).User;
      const user = await User.findById(userId);
      
      if (!user) {
        throw createError('User not found', 404);
      }

      // Verify password
      const isValid = await user.comparePassword(password);
      if (!isValid) {
        throw createError('Password is incorrect', 401);
      }

      // Delete user
      await User.findByIdAndDelete(userId);

      res.json({
        success: true,
        message: 'Account deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  // ============ OTP-based Authentication Methods ============

  /**
   * Send OTP for login or signup
   */
  async sendOTP(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validatedData = sendOTPSchema.parse(req.body);

      await authService.sendOTP(validatedData.email, validatedData.purpose);

      res.status(200).json({
        success: true,
        message: 'OTP sent successfully to your email',
        email: validatedData.email,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationError = createError(
          `Validation error: ${error.errors.map(e => e.message).join(', ')}`,
          400
        );
        return next(validationError);
      }
      next(error);
    }
  }

  /**
   * Verify OTP and authenticate user
   */
  async verifyOTP(req: Request, res: Response<AuthResponse>, next: NextFunction): Promise<void> {
    try {
      const validatedData = verifyOTPSchema.parse(req.body);

      // For SIGNUP, name is required
      if (validatedData.purpose === 'SIGNUP' && !validatedData.name) {
        throw createError('Name is required for signup', 400);
      }

      const { user, tokens, isNewUser } = await authService.verifyOTP(
        validatedData.email,
        validatedData.code,
        validatedData.purpose,
        validatedData.name ? { name: validatedData.name } : undefined
      );

      // Set refresh token in httpOnly cookie
      res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      // Send response
      res.status(isNewUser ? 201 : 200).json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          username: user.username,
          bio: user.bio,
          avatarUrl: user.avatarUrl,
          socialLinks: user.socialLinks,
          role: user.role,
          createdAt: user.createdAt.toISOString(),
        },
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationError = createError(
          `Validation error: ${error.errors.map(e => e.message).join(', ')}`,
          400
        );
        return next(validationError);
      }
      next(error);
    }
  }

  /**
   * Resend OTP
   */
  async resendOTP(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validatedData = sendOTPSchema.parse(req.body);

      await authService.resendOTP(validatedData.email, validatedData.purpose);

      res.status(200).json({
        success: true,
        message: 'New OTP sent successfully to your email',
        email: validatedData.email,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationError = createError(
          `Validation error: ${error.errors.map(e => e.message).join(', ')}`,
          400
        );
        return next(validationError);
      }
      next(error);
    }
  }
}

// Export singleton instance
export const authController = new AuthController();

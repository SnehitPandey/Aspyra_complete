import type { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';
import { createError } from './errorHandler.js';

// JWT Authentication Middleware
export const authenticateToken = async (
  req: Request, 
  res: Response, 
  next: NextFunction
): Promise<void> => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null;

    if (!token) {
      throw createError('Access token is required', 401);
    }

    // Verify token
    const payload = authService.verifyAccessToken(token);

    // Get user from database
    const user = await authService.getUserById(payload.userId);

    if (!user) {
      throw createError('User not found', 401);
    }

    // Attach user to request
    req.user = {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      username: user.username,
      bio: user.bio,
      role: user.role,
      avatarUrl: user.avatarUrl,
      resumeUrl: user.resumeUrl,
      socialLinks: user.socialLinks,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
    next();
  } catch (error) {
    next(error);
  }
};

// Optional authentication middleware (doesn't throw error if no token)
export const optionalAuth = async (
  req: Request, 
  res: Response, 
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null;

    if (token) {
      const payload = authService.verifyAccessToken(token);
      const user = await authService.getUserById(payload.userId);
      
      if (user) {
        req.user = {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          username: user.username,
          bio: user.bio,
          role: user.role,
          avatarUrl: user.avatarUrl,
          resumeUrl: user.resumeUrl,
          socialLinks: user.socialLinks,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        };
      }
    }
    
    next();
  } catch (error) {
    // For optional auth, we continue even if token is invalid
    next();
  }
};

// Role-based authorization middleware
export const requireRole = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(createError('Insufficient permissions', 403));
    }

    next();
  };
};

// Admin-only middleware
export const requireAdmin = requireRole(['ADMIN']);

// Moderator or Admin middleware
export const requireModerator = requireRole(['ADMIN', 'MODERATOR']);

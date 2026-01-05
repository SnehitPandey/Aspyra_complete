import type { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';
import { roomService } from '../services/room.service.js';
import { createError } from '../middleware/errorHandler.js';
import { User } from '../models/user.model.js';

class UserController {
  async getPublicProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      if (!id) throw createError('User id required', 400);

      const user = await authService.getUserById(id);
      if (!user) throw createError('User not found', 404);

      // Return only public fields
      res.json({
        success: true,
        user: {
          id: user.id || user._id,
          name: user.name,
          profilePic: user.profilePic || null,
          avatarUrl: user.avatarUrl || null,
          isCustomAvatar: !!user.isCustomAvatar,
        }
      });
    } catch (err) {
      next(err);
    }
  }

  async getPublicProfileByUsername(req: Request, res: Response, next: NextFunction) {
    try {
      const { username } = req.params;
      if (!username) throw createError('Username required', 400);

      // Find user by username (strip @ if provided)
      const cleanUsername = username.startsWith('@') ? username.slice(1) : username;
      const user = await User.findOne({ username: cleanUsername });
      
      if (!user) throw createError('User not found', 404);

      // Get user's study topics
      const topics = await roomService.getUserStudyTopics(user._id.toString());

      // Calculate avatar URL with priority
      let avatarUrl = null;
      if (user.isCustomAvatar && user.customAvatarURL) {
        avatarUrl = user.customAvatarURL;
      } else if (user.profilePic) {
        avatarUrl = user.profilePic;
      } else if (user.avatarUrl) {
        avatarUrl = user.avatarUrl;
      }

      // Return public profile data
      res.json({
        success: true,
        user: {
          name: user.name,
          username: user.username ? `@${user.username}` : null,
          bio: user.bio || null,
          avatarUrl,
          hasCustomAvatar: !!user.isCustomAvatar,
          joinedDate: user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : null,
          resumeUrl: user.resumeUrl || null,
          socialLinks: user.socialLinks || {},
          studyTopics: {
            ongoing: topics.ongoing,
            completed: topics.completed,
          },
          // TODO: Add real stats from database
          stats: {
            currentStreak: 0,
            longestStreak: 0,
            completedLessons: 0,
          }
        }
      });
    } catch (err) {
      next(err);
    }
  }
}

export const userController = new UserController();

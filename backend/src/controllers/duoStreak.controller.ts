import { Request, Response, NextFunction } from 'express';
import { duoStreakService } from '../services/duoStreak.service.js';
import { createError } from '../middleware/errorHandler.js';

export class DuoStreakController {
  /**
   * GET /api/duo-streak
   * Get current duo streak for authenticated user
   */
  async getStreak(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const streakInfo = await duoStreakService.getStreakInfo(req.user.id);

      res.status(200).json({
        success: true,
        data: streakInfo,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/duo-streak/check
   * Manually trigger streak check (alternative to Socket.IO event)
   */
  async checkStreak(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const { partnerId, bothOnline } = req.body;

      if (!partnerId) {
        throw createError('partnerId is required', 400);
      }

      const result = await duoStreakService.checkDailyCompletion(
        req.user.id,
        partnerId,
        bothOnline ?? true
      );

      res.status(200).json({
        success: true,
        data: {
          streakUpdated: result.streakUpdated,
          streak: result.streak,
          date: result.date,
          calendar: Object.fromEntries(result.calendar),
          reason: result.reason,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const duoStreakController = new DuoStreakController();

/**
 * Debug Routes - Monitoring and debugging endpoints
 */
import { Router, Request, Response } from 'express';
import { Room } from '../models/room.model.js';
import { getPresenceService } from '../services/presence.service.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = Router();

// GET /debug/presence?userId=:userId
router.get('/presence', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.query;
    const presenceService = getPresenceService();

    if (!presenceService) {
      res.status(503).json({
        success: false,
        error: 'Presence service not initialized',
      });
      return;
    }

    if (userId) {
      const presence = presenceService.getUserPresence(userId as string);
      res.status(200).json({
        success: true,
        presence,
      });
      return;
    }

    // Return all presence data
    res.status(200).json({
      success: true,
      message: 'Provide ?userId=<id> to query specific user presence',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /debug/presence/:userId - Get specific user presence status
router.get('/presence/:userId', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      res.status(400).json({
        success: false,
        error: 'userId parameter required',
      });
      return;
    }
    
    const presenceService = getPresenceService();

    if (!presenceService) {
      res.status(503).json({
        success: false,
        error: 'Presence service not initialized',
      });
      return;
    }

    const presence = presenceService.getUserPresence(userId);
    
    res.status(200).json({
      success: true,
      userId,
      presence,
      isOnline: (presence as any)?.isOnline || false,
      activity: (presence as any)?.activity || null,
      lastSeen: (presence as any)?.lastSeen || null,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /debug/room/:roomId/state
router.get('/room/:roomId/state', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId } = req.params;

    const room = await Room.findById(roomId)
      .populate('hostId', 'name email')
      .populate('members.userId', 'name email')
      .lean();

    if (!room) {
      res.status(404).json({
        success: false,
        error: 'Room not found',
      });
      return;
    }

    // Calculate stats
    const stats = {
      totalMembers: room.members.length,
      totalMessages: room.messages?.length || 0,
      totalQuizzes: room.quizzes?.length || 0,
      totalMilestones: room.roadmap?.phases.flatMap(p => p.milestones).length || 0,
      progressData: room.progressData,
      focusSessions: room.focusSessions?.length || 0,
      streaks: room.streaks?.map(s => ({
        userId: s.userId,
        days: s.days,
        lastUpdated: s.lastUpdated,
      })) || [],
    };

    res.status(200).json({
      success: true,
      room: {
        _id: room._id,
        code: room.code,
        title: room.title,
        status: room.status,
        startDate: room.startDate,
        endDate: room.endDate,
        totalDays: room.totalDays,
      },
      stats,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export { router as debugRouter };

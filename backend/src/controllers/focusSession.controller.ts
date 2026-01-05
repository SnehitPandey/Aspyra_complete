// backend/src/controllers/focusSession.controller.ts
/**
 * Focus Session Controller
 * Handles timer session persistence and cross-device synchronization
 */

import { Request, Response } from 'express';
import { FocusSession } from '../models/focusSession.model.js';
import { Room } from '../models/room.model.js';
import { User } from '../models/user.model.js';
import { Types } from 'mongoose';
import { socketEventManager } from '../services/socketEventManager.js';
import { notifySessionChange } from '../services/partnerSync.service.js';

// Start a new focus session
export const startFocusSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId } = req.params;
    const userId = (req.user as any)?.id || (req.user as any)?._id;
    const { topicId, topicTitle, milestoneId, deviceId } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!topicId || !topicTitle || !deviceId) {
      res.status(400).json({ error: 'Missing required fields: topicId, topicTitle, deviceId' });
      return;
    }

    if (!roomId) {
      res.status(400).json({ error: 'Missing roomId' });
      return;
    }

    console.log(`[FocusSession] Starting session for user ${userId} in room ${roomId}, topic ${topicTitle}`);

    // Check if there's already an active session
    const existingSession = await FocusSession.findActiveSession(userId, roomId);
    
    if (existingSession) {
      // End the existing session first
      existingSession.isRunning = false;
      existingSession.endedAt = new Date();
      existingSession.elapsedTime = existingSession.getCurrentElapsedTime();
      await existingSession.save();
      
      console.log(`[FocusSession] Ended existing session ${existingSession._id}`);
    }

    // Create new session
    const newSession = new FocusSession({
      userId: new Types.ObjectId(userId.toString()),
      roomId: new Types.ObjectId(roomId),
      topicId,
      topicTitle,
      milestoneId: milestoneId || undefined,
      deviceId,
      startedAt: new Date(),
      lastPulseAt: new Date(),
      elapsedTime: 0,
      isRunning: true,
      pausedDuration: 0,
    });

    await newSession.save();

    console.log(`[FocusSession] Created new session ${newSession._id}`);

    // Notify partner about session start
    const user = await User.findById(userId).select('name');
    if (user) {
      await notifySessionChange(roomId, userId.toString(), user.name, 'start', topicTitle);
    }

    // Emit socket event to sync across devices
    socketEventManager.emitSessionTimerSync(roomId, {
      userId: userId.toString(),
      sessionId: newSession._id.toString(),
      topicId,
      topicTitle,
      elapsedTime: 0,
      isRunning: true,
      startedAt: newSession.startedAt.toISOString(),
    });

    res.status(201).json({
      success: true,
      session: {
        _id: newSession._id,
        topicId: newSession.topicId,
        topicTitle: newSession.topicTitle,
        milestoneId: newSession.milestoneId,
        startedAt: newSession.startedAt,
        elapsedTime: newSession.elapsedTime,
        isRunning: newSession.isRunning,
      },
    });
  } catch (error) {
    console.error('[FocusSession] Error starting session:', error);
    res.status(500).json({ error: 'Failed to start focus session' });
  }
};

// Send heartbeat pulse to keep session alive
export const pulseFocusSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, sessionId } = req.params;
    const userId = (req.user as any)?.id || (req.user as any)?._id;
    const { elapsedTime } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!roomId) {
      res.status(400).json({ error: 'Missing roomId' });
      return;
    }

    const session = await FocusSession.findById(sessionId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Verify ownership
    if (session.userId.toString() !== userId.toString()) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    if (!session.isRunning) {
      res.status(400).json({ error: 'Session is not running' });
      return;
    }

    // Update session
    session.lastPulseAt = new Date();
    if (typeof elapsedTime === 'number' && elapsedTime >= 0) {
      session.elapsedTime = elapsedTime;
    }

    await session.save();

    // Emit socket event for real-time sync
    socketEventManager.emitSessionTimerSync(roomId, {
      userId: userId.toString(),
      sessionId: session._id.toString(),
      topicId: session.topicId,
      topicTitle: session.topicTitle,
      elapsedTime: session.elapsedTime,
      isRunning: session.isRunning,
      startedAt: session.startedAt.toISOString(),
    });

    res.status(200).json({
      success: true,
      session: {
        _id: session._id,
        elapsedTime: session.elapsedTime,
        lastPulseAt: session.lastPulseAt,
      },
    });
  } catch (error) {
    console.error('[FocusSession] Error pulsing session:', error);
    res.status(500).json({ error: 'Failed to pulse session' });
  }
};

// End a focus session
export const endFocusSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, sessionId } = req.params;
    const userId = (req.user as any)?.id || (req.user as any)?._id;
    const { elapsedTime } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!roomId) {
      res.status(400).json({ error: 'Missing roomId' });
      return;
    }

    const session = await FocusSession.findById(sessionId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Verify ownership
    if (session.userId.toString() !== userId.toString()) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // End session
    session.isRunning = false;
    session.endedAt = new Date();
    
    if (typeof elapsedTime === 'number' && elapsedTime >= 0) {
      session.elapsedTime = elapsedTime;
    } else {
      session.elapsedTime = session.getCurrentElapsedTime();
    }

    await session.save();

    console.log(`[FocusSession] Ended session ${sessionId}, total time: ${session.elapsedTime}s`);

    // Notify partner about session end
    const user = await User.findById(userId).select('name');
    if (user) {
      await notifySessionChange(roomId, userId.toString(), user.name, 'end', session.topicTitle);
    }

    // Emit socket event
    socketEventManager.emitSessionTimerSync(roomId, {
      userId: userId.toString(),
      sessionId: session._id.toString(),
      topicId: session.topicId,
      topicTitle: session.topicTitle,
      elapsedTime: session.elapsedTime,
      isRunning: false,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt.toISOString(),
    });

    res.status(200).json({
      success: true,
      session: {
        _id: session._id,
        elapsedTime: session.elapsedTime,
        endedAt: session.endedAt,
      },
    });
  } catch (error) {
    console.error('[FocusSession] Error ending session:', error);
    res.status(500).json({ error: 'Failed to end session' });
  }
};

// Resume/Get active session
export const getActiveSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId } = req.params;
    const userId = (req.user as any)?.id || (req.user as any)?._id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!roomId) {
      res.status(400).json({ error: 'Missing roomId' });
      return;
    }

    const session = await FocusSession.findActiveSession(userId, roomId);

    if (!session) {
      res.status(200).json({
        success: true,
        session: null,
      });
      return;
    }

    // Check if session is stale (no pulse for 30+ minutes)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    
    if (session.lastPulseAt < thirtyMinutesAgo) {
      // Auto-end stale session
      session.isRunning = false;
      session.endedAt = new Date();
      session.elapsedTime = session.getCurrentElapsedTime();
      await session.save();

      console.log(`[FocusSession] Auto-ended stale session ${session._id}`);

      res.status(200).json({
        success: true,
        session: null,
      });
      return;
    }

    // Return active session for resume
    res.status(200).json({
      success: true,
      session: {
        _id: session._id,
        topicId: session.topicId,
        topicTitle: session.topicTitle,
        milestoneId: session.milestoneId,
        startedAt: session.startedAt,
        lastPulseAt: session.lastPulseAt,
        elapsedTime: session.getCurrentElapsedTime(),
        isRunning: session.isRunning,
      },
    });
  } catch (error) {
    console.error('[FocusSession] Error getting active session:', error);
    res.status(500).json({ error: 'Failed to get active session' });
  }
};

// Pause a session
export const pauseFocusSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, sessionId } = req.params;
    const userId = (req.user as any)?.id || (req.user as any)?._id;
    const { elapsedTime } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const session = await FocusSession.findById(sessionId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (session.userId.toString() !== userId.toString()) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    session.pausedAt = new Date();
    if (typeof elapsedTime === 'number' && elapsedTime >= 0) {
      session.elapsedTime = elapsedTime;
    }
    await session.save();

    res.status(200).json({
      success: true,
      session: {
        _id: session._id,
        pausedAt: session.pausedAt,
        elapsedTime: session.elapsedTime,
      },
    });
  } catch (error) {
    console.error('[FocusSession] Error pausing session:', error);
    res.status(500).json({ error: 'Failed to pause session' });
  }
};

// Cleanup stale sessions (for scheduled task)
export const cleanupStaleSessions = async (req: Request, res: Response): Promise<void> => {
  try {
    const count = await FocusSession.cleanupStaleSessions();
    
    console.log(`[FocusSession] Cleaned up ${count} stale sessions`);

    res.status(200).json({
      success: true,
      cleanedCount: count,
    });
  } catch (error) {
    console.error('[FocusSession] Error cleaning up stale sessions:', error);
    res.status(500).json({ error: 'Failed to cleanup stale sessions' });
  }
};

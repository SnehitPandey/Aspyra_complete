import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Room } from '../models/room.model.js';
import { roomService } from '../services/room.service.js';
import { aiService } from '../services/ai.service.js';
import { createError } from '../middleware/errorHandler.js';

// Validation schemas
const createRoomSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100),
  description: z.string().max(500).optional(),
  tags: z.array(z.string()).min(1, 'At least one tag is required').max(10, 'Maximum 10 tags allowed'),
  skillLevel: z.enum(['Beginner', 'Intermediate', 'Advanced']).default('Beginner'),
  maxSeats: z.number().int().min(2).max(20).optional(),
  generateRoadmap: z.boolean().optional().default(true),
  durationDays: z.number().int().min(1).max(365).optional(), // Duration in days (1-365 days)
});

const joinRoomSchema = z.object({
  code: z.string().length(6, 'Room code must be 6 characters'),
});

export class RoomController {
  // Helper method to generate roadmap asynchronously
  private async generateRoadmapAsync(roomId: string, input: {
    goal: string;
    tags: string[];
    skillLevel: 'Beginner' | 'Intermediate' | 'Advanced';
    durationWeeks?: number;
  }): Promise<void> {
    try {
      console.log(`🤖 [ROADMAP GENERATION START] Room ${roomId}`);
      console.log('   Input:', { goal: input.goal, durationWeeks: input.durationWeeks });
      
      const roadmap = await aiService.generateRoadmap(input);
      console.log('   ✅ AI roadmap generated, calling updateRoomRoadmap...');
      
      await roomService.updateRoomRoadmap(roomId, roadmap);
      console.log(`🎉 [ROADMAP GENERATION COMPLETE] Room ${roomId}`);
    } catch (error) {
      console.error(`❌ [ROADMAP GENERATION FAILED] Room ${roomId}:`, error);
      throw error;
    }
  }

  // Create new room
  async createRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      // Validate request body
      const validatedData = createRoomSchema.parse(req.body);

      // Create room
      const room = await roomService.createRoom(req.user.id, {
        title: validatedData.title,
        description: validatedData.description,
        tags: validatedData.tags,
        maxSeats: validatedData.maxSeats,
        durationDays: validatedData.durationDays,
      });

      // Send response immediately - don't wait for roadmap generation
      res.status(201).json({
        success: true,
        room: {
          id: room._id.toString(),
          code: room.code,
          title: room.title,
          description: room.description,
          tags: room.tags,
          hostId: room.hostId.toString(),
          status: room.status,
          maxSeats: room.maxSeats,
          memberCount: room.members.length,
          roadmap: undefined, // Will be generated asynchronously
          startDate: room.startDate,
          endDate: room.endDate,
          createdAt: room.createdAt,
        },
        message: validatedData.generateRoadmap ? 'Room created. Roadmap is being generated...' : 'Room created successfully',
      });

      // Generate roadmap asynchronously (don't await)
      if (validatedData.generateRoadmap && validatedData.tags.length > 0) {
        // Calculate durationWeeks from durationDays (default to 4 weeks if not provided)
        const durationWeeks = validatedData.durationDays 
          ? Math.ceil(validatedData.durationDays / 7) 
          : 4;
        
        // Fire and forget - generate roadmap in background
        this.generateRoadmapAsync(room._id.toString(), {
          goal: validatedData.title,
          tags: validatedData.tags,
          skillLevel: validatedData.skillLevel,
          durationWeeks: durationWeeks,
        }).catch((error: any) => {
          console.error('Background roadmap generation failed:', error);
        });
      }
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

  // Join room by code
  async joinRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      // Validate request body
      const validatedData = joinRoomSchema.parse(req.body);

      // Join room
      const room = await roomService.joinRoom(req.user.id, validatedData);

      // Send response
      res.status(200).json({
        success: true,
        room: {
          id: room._id.toString(),
          code: room.code,
          title: room.title,
          hostId: room.hostId.toString(),
          status: room.status,
          maxSeats: room.maxSeats,
          memberCount: room.members.length,
          members: room.members.map((member: any) => ({
            id: member.userId?.toString() || '',
            name: member.userId?.name || 'Unknown',
            role: member.role,
            ready: member.ready,
            joinedAt: member.joinedAt,
          })),
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

  // Leave room
  async leaveRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const { roomId } = req.params;
      if (!roomId) {
        throw createError('Room ID is required', 400);
      }

  // Note: roomService.leaveRoom expects (roomId, userId)
  await roomService.leaveRoom(roomId, req.user.id);

      res.status(200).json({
        success: true,
        message: 'Left room successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  // Get room details
  async getRoomById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      if (!roomId) {
        throw createError('Room ID is required', 400);
      }
      const userId = req.user?.id || '';

      const room = await roomService.getRoomById(roomId, userId);

      // ✨ Calculate average progress from all active members
      const activeMembers = room.members.filter(m => 
        m.accepted === true || m.role === 'HOST' || m.role === 'CO_HOST'
      );
      
      let totalProgress = 0;
      activeMembers.forEach(member => {
        if (member.progress && member.progress.progressPercentage) {
          totalProgress += member.progress.progressPercentage;
        }
      });
      
      const averageProgress = activeMembers.length > 0 
        ? Math.round(totalProgress / activeMembers.length)
        : 0;

      console.log(`📊 Room ${roomId} averageProgress: ${averageProgress}% (${totalProgress}/${activeMembers.length} members)`);

      res.status(200).json({
        success: true,
        room: {
          id: room._id.toString(),
          code: room.code,
          title: room.title,
          description: room.description,
          tags: room.tags,
          hostId: room.hostId.toString(),
          status: room.status,
          maxSeats: room.maxSeats,
          memberCount: room.members.length,
          averageProgress: averageProgress, // ✅ INCLUDE AVERAGE PROGRESS
          completionRate: averageProgress, // ✅ FALLBACK NAME
          members: room.members.map((member: any) => ({
            id: member.userId?.toString() || '',
            name: member.userId?.name || 'Unknown',
            avatar: member.userId?.avatar,
            role: member.role,
            ready: member.ready,
            joinedAt: member.joinedAt,
            progress: member.progress,
          })),
          roadmap: room.roadmap,
          startDate: room.startDate,
          endDate: room.endDate,
          createdAt: room.createdAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // Toggle ready state
  async toggleReady(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const { roomId } = req.params;
      if (!roomId) {
        throw createError('Room ID is required', 400);
      }

  // Note: roomService.toggleReady expects (roomId, userId)
  const ready = await roomService.toggleReady(roomId, req.user.id);

      res.status(200).json({
        success: true,
        ready,
        message: ready ? 'User is ready' : 'User is not ready',
      });
    } catch (error) {
      next(error);
    }
  }

  // Get user's rooms
  async getUserRooms(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      // Get user's rooms
      const rooms = await roomService.getUserRooms(req.user.id);

      // Format response
      res.status(200).json({
        success: true,
        rooms: rooms.map((room: any) => ({
          id: room._id.toString(),
          code: room.code,
          title: room.title,
          hostId: room.hostId?._id?.toString() || room.hostId?.toString(),
          hostName: room.hostId?.name || 'Unknown',
          status: room.status,
          maxSeats: room.maxSeats,
          memberCount: room.members.length,
          roadmap: room.roadmap, // Include roadmap data for today's tasks
          createdAt: room.createdAt,
          updatedAt: room.updatedAt,
        })),
      });
    } catch (error) {
      next(error);
    }
  }

  // Check user's room count and limit status
  async checkRoomLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const roomCount = await roomService.getUserRoomCount(req.user.id);
      const maxRooms = 5; // Free plan limit
      const canCreate = roomCount < maxRooms;

      console.log(`🔍 Room limit check for user ${req.user.id}:`, {
        roomCount,
        maxRooms,
        canCreate,
        remainingSlots: Math.max(0, maxRooms - roomCount)
      });

      res.status(200).json({
        success: true,
        data: {
          currentRooms: roomCount,
          maxRooms: maxRooms,
          canCreate: canCreate,
          remainingSlots: Math.max(0, maxRooms - roomCount)
        }
      });
    } catch (error) {
      next(error);
    }
  }

  // Get user's study topics categorized by status
  async getUserStudyTopics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      // Get categorized study topics
      const topics = await roomService.getUserStudyTopics(req.user.id);

      res.status(200).json({
        success: true,
        topics,
      });
    } catch (error) {
      next(error);
    }
  }

  // Generate roadmap for room
  async generateRoomRoadmap(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const { roomId } = req.params;
      if (!roomId) {
        throw createError('Room ID is required', 400);
      }

      // Get room details
      const room = await roomService.getRoomById(roomId, req.user.id);

      // Check if room has required data
      if (!room.tags || room.tags.length === 0) {
        throw createError('Room must have tags to generate a roadmap', 400);
      }

      // Calculate duration in weeks from room's start and end dates
      let durationWeeks = 12; // Default fallback
      if (room.startDate && room.endDate) {
        const startDate = new Date(room.startDate);
        const endDate = new Date(room.endDate);
        const durationDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        durationWeeks = Math.max(2, Math.ceil(durationDays / 7)); // Minimum 2 weeks
      }

      // Generate roadmap
      const roadmap = await aiService.generateRoadmap({
        goal: room.title,
        tags: room.tags,
        skillLevel: 'Beginner', // Default, could be added to room model
        durationWeeks,
      });

      // Update room with roadmap
      const updatedRoom = await roomService.updateRoomRoadmap(roomId, roadmap);

      res.status(200).json({
        success: true,
        roadmap: updatedRoom.roadmap,
      });
    } catch (error) {
      next(error);
    }
  }

  // Generate quiz for room
  async generateRoomQuiz(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const { roomId } = req.params;
      const { topic, difficulty, count } = req.body;

      if (!roomId) {
        throw createError('Room ID is required', 400);
      }

      // Get room and member progress
      const room = await roomService.getRoomById(roomId, req.user.id);
      const member = room.members.find((m: any) => m.userId._id.toString() === req.user?.id);

      if (!member) {
        throw createError('Not a member of this room', 403);
      }

      // Determine current milestone if progress exists
      let currentMilestone: string | undefined;
      let completedTopics: string[] = [];

      if (member.progress && room.roadmap) {
        const currentPhase = room.roadmap.phases[member.progress.currentPhase];
        if (currentPhase && currentPhase.milestones[member.progress.currentMilestone]) {
          const milestone = currentPhase.milestones[member.progress.currentMilestone];
          if (milestone) {
            currentMilestone = milestone.title;
          }
        }

        // Get completed topics from completed milestones
        member.progress.completedMilestones?.forEach((milestoneId: string) => {
          room.roadmap?.phases.forEach(phase => {
            const milestone = phase.milestones.find(m => m.id === milestoneId);
            if (milestone) {
              // Handle both string and object topic formats
              const topicTitles = milestone.topics.map(t => 
                typeof t === 'string' ? t : t.title
              );
              completedTopics.push(...topicTitles);
            }
          });
        });
      }

      // Generate quiz
      const quiz = await aiService.generateQuiz({
        topic: topic || room.title,
        currentMilestone,
        difficulty,
        count,
        userProgress: {
          completedTopics,
          currentPhase: member.progress?.currentPhase,
        },
      });

      res.status(200).json({
        success: true,
        quiz,
      });
    } catch (error) {
      next(error);
    }
  }

  // Update member progress
  async updateProgress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const { roomId } = req.params;
      const { currentPhase, currentMilestone, completedMilestones } = req.body;

      if (!roomId) {
        throw createError('Room ID is required', 400);
      }

      // Update progress
      const room = await roomService.updateMemberProgress(roomId, req.user.id, {
        currentPhase,
        currentMilestone,
        completedMilestones,
      });

      // Find updated member
      const member = room.members.find((m: any) => m.userId._id.toString() === req.user?.id);

      res.status(200).json({
        success: true,
        progress: member?.progress,
      });
    } catch (error) {
      next(error);
    }
  }

  // Get today's tasks from all user's rooms
  async getTodaysTasks(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      // Get user's rooms
      const rooms = await roomService.getUserRooms(req.user.id);

      // Import focus session model
      const { FocusSession } = await import('../models/focusSession.model.js');

      // ✨ NEW: Use task generator to get today's tasks from active milestones
      const { generateMultiRoomTodaysTasks } = await import('../services/taskGenerator.service.js');
      const todaysTasks = generateMultiRoomTodaysTasks(rooms, new Date(), 10);

      // ✨ CALCULATE TIME SPENT: Get all focus sessions for user's topics
      const userId = new Types.ObjectId(req.user.id);
      const allSessions = await FocusSession.find({ 
        userId,
        endedAt: { $exists: true } // Only completed sessions
      }).select('topicId topicTitle elapsedTime');

      // Create a map of topicTitle => total time spent (in seconds)
      const timeSpentMap: Record<string, number> = {};
      allSessions.forEach(session => {
        const key = session.topicTitle || session.topicId;
        if (!timeSpentMap[key]) timeSpentMap[key] = 0;
        timeSpentMap[key] += session.elapsedTime || 0;
      });

      // Helper function to format time
      const formatTime = (seconds: number): string => {
        if (seconds < 60) return `${seconds}s`;
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
      };

      // If no tasks from new logic, fallback to showing all uncompleted milestones
      let tasks = todaysTasks;
      
      if (tasks.length === 0) {
        // Fallback: Show first uncompleted milestone from each room
        const fallbackTasks: any[] = [];
        
        rooms.forEach((room: any) => {
          if (room.roadmap && room.roadmap.phases) {
            for (const phase of room.roadmap.phases) {
              for (const milestone of phase.milestones) {
                if (!milestone.completed) {
                  // Calculate time spent for this milestone's topics
                  let totalTimeSpent = 0;
                  if (milestone.topics && Array.isArray(milestone.topics)) {
                    milestone.topics.forEach((topic: any) => {
                      const topicTitle = typeof topic === 'string' ? topic : topic.title;
                      totalTimeSpent += timeSpentMap[topicTitle] || 0;
                    });
                  }

                  fallbackTasks.push({
                    id: `${room._id.toString()}-${milestone.id}`,
                    title: milestone.title,
                    description: milestone.description,
                    roomName: room.title,
                    roomId: room._id.toString(),
                    estimatedHours: milestone.estimatedHours || 1,
                    milestone: milestone.title,
                    topics: milestone.topics || [],
                    status: 'pending',
                    timeSpent: formatTime(totalTimeSpent),
                  });
                  break; // Only first uncompleted milestone per room
                }
              }
            }
          } else if (room.customRoadmap && Array.isArray(room.customRoadmap)) {
            const firstUncompleted = room.customRoadmap.find((m: any) => !m.completed);
            if (firstUncompleted) {
              // Calculate time spent for custom roadmap topics
              let totalTimeSpent = 0;
              if (firstUncompleted.topics && Array.isArray(firstUncompleted.topics)) {
                firstUncompleted.topics.forEach((topic: any) => {
                  const topicTitle = typeof topic === 'string' ? topic : topic.title;
                  totalTimeSpent += timeSpentMap[topicTitle] || 0;
                });
              }

              fallbackTasks.push({
                id: `${room._id.toString()}-${firstUncompleted.id}`,
                title: firstUncompleted.title,
                description: firstUncompleted.description,
                roomName: room.title,
                roomId: room._id.toString(),
                estimatedHours: firstUncompleted.estimatedHours || 1,
                milestone: firstUncompleted.title,
                topics: firstUncompleted.topics || [],
                status: 'pending',
                timeSpent: formatTime(totalTimeSpent),
              });
            }
          }
        });
        
        tasks = fallbackTasks.slice(0, 10);
      } else {
        // ✨ ADD TIME SPENT to generated today's tasks
        tasks = todaysTasks.map((task: any) => {
          let totalTimeSpent = 0;
          if (task.topics && Array.isArray(task.topics)) {
            task.topics.forEach((topic: any) => {
              const topicTitle = typeof topic === 'string' ? topic : topic.title;
              totalTimeSpent += timeSpentMap[topicTitle] || 0;
            });
          }
          return {
            ...task,
            timeSpent: formatTime(totalTimeSpent)
          };
        });
      }

      res.status(200).json({
        success: true,
        tasks,
        totalTasks: tasks.length,
        message: todaysTasks.length > 0 
          ? 'Tasks generated from active milestones' 
          : 'Showing first uncompleted milestone from each room',
      });
    } catch (error) {
      next(error);
    }
  }

  // Update user activity (what they're studying)
  async updateUserActivity(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const { studying, topicName } = req.body;

      await roomService.updateUserActivity(req.user.id, {
        studying: studying || null,
        topicName: topicName || null,
      });

      res.status(200).json({
        success: true,
        message: 'Activity updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  // Get users' activities (for Study Duo)
  async getUsersActivities(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const { userIds } = req.body;

      if (!Array.isArray(userIds) || userIds.length === 0) {
        throw createError('userIds array is required', 400);
      }

      const activities = await roomService.getUsersActivities(userIds);

      res.status(200).json({
        success: true,
        activities,
      });
    } catch (error) {
      next(error);
    }
  }

  // Get public rooms (for join room page)
  async getPublicRooms(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id; // Optional - if user is logged in, filter out their rooms

      const rooms = await roomService.getPublicRooms(userId);

      res.status(200).json({
        success: true,
        rooms,
        count: rooms.length,
      });
    } catch (error) {
      next(error);
    }
  }

  // ✨ NEW: Update topic completion status
  async updateTopicStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const { roomId, milestoneId, topicTitle, status } = req.body;

      if (!roomId || !milestoneId || !topicTitle || !status) {
        throw createError('roomId, milestoneId, topicTitle, and status are required', 400);
      }

      if (!['pending', 'in-progress', 'completed'].includes(status)) {
        throw createError('Invalid status. Must be pending, in-progress, or completed', 400);
      }

      const updatedRoom = await roomService.updateTopicStatus(
        roomId,
        req.user.id,
        milestoneId,
        topicTitle,
        status
      );

      res.status(200).json({
        success: true,
        message: 'Topic status updated successfully',
        room: updatedRoom,
      });
    } catch (error) {
      next(error);
    }
  }

  // ✨ NEW: Get active milestone for a room
  async getActiveMilestone(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const { roomId } = req.params;

      if (!roomId) {
        throw createError('roomId is required', 400);
      }

      const activeMilestone = await roomService.getActiveMilestone(roomId, req.user.id);

      res.status(200).json({
        success: true,
        activeMilestone,
      });
    } catch (error) {
      next(error);
    }
  }

  // ✨ NEW: Mark topic as complete and recalculate room progress
  async completeTopicAndUpdateProgress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const { roomId, milestoneId, topicIndex } = req.params;

      if (!roomId || !milestoneId || topicIndex === undefined) {
        throw createError('roomId, milestoneId, and topicIndex are required', 400);
      }

      // Update topic status in room
      const updatedRoom = await roomService.completeTopicAndRecalculateProgress(
        roomId,
        milestoneId,
        parseInt(topicIndex, 10),
        req.user.id
      );

      res.status(200).json({
        success: true,
        room: updatedRoom,
        progress: updatedRoom.progressData,
      });
    } catch (error) {
      next(error);
    }
  }

  // ✨ TEMPORARY: Fix old rooms without dates
  async fixRoomDates(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const { roomId } = req.params;
      if (!roomId) {
        throw createError('Room ID is required', 400);
      }

      const updatedRoom = await roomService.fixOldRoomDates(roomId, req.user.id);

      res.status(200).json({
        success: true,
        message: 'Room dates fixed successfully!',
        room: updatedRoom,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user's kanban board for a room
   */
  async getKanbanBoard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId, userId } = req.params;
      
      if (!req.user || req.user.id !== userId) {
        throw createError('Unauthorized', 403);
      }

      if (!roomId) {
        throw createError('Room ID is required', 400);
      }

      const room = await roomService.getRoomById(roomId, req.user!.id);
      if (!room) {
        throw createError('Room not found', 404);
      }

      // Define task type
      interface KanbanTask {
        id: string;
        title: string;
        description: string;
        estimatedHours: number;
        phase: number;
        topics: any[];
        completed: boolean;
      }

      // Generate kanban board from roadmap
      const kanban: {
        backlog: KanbanTask[];
        inProgress: KanbanTask[];
        completed: KanbanTask[];
        blocked: KanbanTask[];
      } = {
        backlog: [],
        inProgress: [],
        completed: [],
        blocked: []
      };

      // Convert roadmap milestones to kanban tasks
      if (room.roadmap && room.roadmap.phases) {
        for (const phase of room.roadmap.phases) {
          for (const milestone of phase.milestones) {
            const task: KanbanTask = {
              id: milestone.id,
              title: milestone.title,
              description: milestone.description,
              estimatedHours: milestone.estimatedHours || 1,
              phase: phase.phase,
              topics: milestone.topics || [],
              completed: milestone.completed || false,
            };

            if (milestone.completed) {
              kanban.completed.push(task);
            } else if (milestone.startDate && new Date(milestone.startDate) <= new Date()) {
              kanban.inProgress.push(task);
            } else {
              kanban.backlog.push(task);
            }
          }
        }
      }

      res.json({
        success: true,
        kanban,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Move kanban task between columns
   */
  async moveKanbanTask(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId, userId } = req.params;
      const { taskId, fromColumn, toColumn, order } = req.body;
      
      if (!req.user || req.user.id !== userId) {
        throw createError('Unauthorized', 403);
      }

      // For now, just return success - actual implementation would update the milestone status
      res.json({
        success: true,
        message: 'Task moved successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Reset kanban board to force regeneration
   */
  async resetKanbanBoard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId, userId } = req.params;
      
      if (!req.user || req.user.id !== userId) {
        throw createError('Unauthorized', 403);
      }

      const room = await Room.findById(roomId);
      if (!room) {
        throw createError('Room not found', 404);
      }

      // Remove user's board to force regeneration on next GET
      if (room.kanbanBoards) {
        room.kanbanBoards = room.kanbanBoards.filter((b: any) => b.userId.toString() !== userId);
        room.markModified('kanbanBoards');
        await room.save();
      }

      console.log('🗑️ Cleared Kanban board for user:', userId);

      res.status(200).json({
        success: true,
        message: 'Kanban board reset successfully. Refresh to regenerate.'
      });
    } catch (error) {
      next(error);
    }
  }
}

// Export singleton instance
export const roomController = new RoomController();

/**
 * Enhanced Room Controller
 * Implements robust, persistent Room features with real-time sync
 */
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Room } from '../models/room.model.js';
import { createError } from '../middleware/errorHandler.js';
import { geminiService } from '../services/gemini.service.js';
import { getSocketServiceInstance } from '../services/socket.instance.js';
import { socketEventManager } from '../services/socketEventManager.js';
import { moveTaskToDone } from '../services/kanban.service.js';
import { notifyPartner, syncDuoStreak } from '../services/partnerSync.service.js';
import { v4 as uuidv4 } from 'uuid';

// Validation schemas
const applyTimelineSchema = z.object({
  timelineMonths: z.number().int().min(1).max(24),
});

const completeTopicSchema = z.object({
  userId: z.string(),
});

const updateProgressSchema = z.object({
  completedTopicIds: z.array(z.string()),
  timeSpent: z.number().optional(),
});

const postMessageSchema = z.object({
  content: z.string().min(1).max(2000),
});

const generateQuizSchema = z.object({
  date: z.string().optional(),
  topics: z.array(z.string()).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
});

const submitQuizSchema = z.object({
  answers: z.array(z.number()),
});

const moveKanbanSchema = z.object({
  taskId: z.string(),
  fromColumn: z.enum(['backlog', 'todo', 'inProgress', 'done']),
  toColumn: z.enum(['backlog', 'todo', 'inProgress', 'done']),
  order: z.number(),
});

const startFocusSchema = z.object({
  topicId: z.string(),
  topicTitle: z.string(),
});

const pulseFocusSchema = z.object({
  elapsed: z.number(), // seconds
});

class RoomEnhancedController {
  // ========== ROOM DETAILS ==========
  
  async getRoomDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw createError('Authentication required', 401);

      const { roomId } = req.params;
      
      // Exclude large arrays by default for performance
      const room = await Room.findById(roomId)
        .select('-messages -quizzes')
        .lean();
      
      if (!room) throw createError('Room not found', 404);

      res.status(200).json({
        success: true,
        room,
      });
    } catch (error) {
      next(error);
    }
  }

  // ========== ROADMAP TIMELINE ==========
  
  async applyTimeline(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw createError('Authentication required', 401);

      const { roomId } = req.params;
      const { timelineMonths } = applyTimelineSchema.parse(req.body);

      const room = await Room.findById(roomId);
      if (!room) throw createError('Room not found', 404);

      // Calculate totalDays
      const totalDays = timelineMonths * 30;
      room.totalDays = totalDays;
      room.startDate = room.startDate || new Date();
      room.endDate = new Date(room.startDate);
      room.endDate.setDate(room.endDate.getDate() + totalDays);

      // Distribute milestones across timeline WEIGHTED by estimatedHours
      if (room.roadmap && room.roadmap.phases) {
        const startDate = new Date(room.startDate);
        let currentDate = new Date(startDate);
        
        const allMilestones = room.roadmap.phases.flatMap(phase => phase.milestones);
        
        // Calculate total estimated hours across all milestones
        const totalEstimatedHours = allMilestones.reduce((sum, m) => {
          // Default to 1 if estimatedHours not set to avoid division by zero
          return sum + (m.estimatedHours || 1);
        }, 0);

        let allocatedDays = 0;

        allMilestones.forEach((milestone, index) => {
          milestone.startDate = new Date(currentDate);
          
          // WEIGHTED DISTRIBUTION: proportional to estimatedHours
          const milestoneWeight = (milestone.estimatedHours || 1) / totalEstimatedHours;
          
          if (index === allMilestones.length - 1) {
            // Last milestone: ensure we end exactly on endDate
            milestone.durationDays = totalDays - allocatedDays;
          } else {
            milestone.durationDays = Math.floor(totalDays * milestoneWeight);
            allocatedDays += milestone.durationDays;
          }
          
          milestone.endDate = new Date(currentDate);
          milestone.endDate.setDate(milestone.endDate.getDate() + milestone.durationDays);
          currentDate = new Date(milestone.endDate);
        });
      }

      await room.save();

      res.status(200).json({
        success: true,
        message: 'Timeline applied successfully',
        room: {
          _id: room._id,
          startDate: room.startDate,
          endDate: room.endDate,
          totalDays: room.totalDays,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(createError('Validation error: ' + error.errors.map(e => e.message).join(', '), 400));
      }
      next(error);
    }
  }

  async getRoadmap(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw createError('Authentication required', 401);

      const { roomId } = req.params;
      const room = await Room.findById(roomId).select('roadmap');
      if (!room) throw createError('Room not found', 404);

      res.status(200).json({
        success: true,
        roadmap: room.roadmap,
      });
    } catch (error) {
      next(error);
    }
  }

  async completeTopicForUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw createError('Authentication required', 401);

      const { roomId, topicId } = req.params;
      const { userId } = completeTopicSchema.parse(req.body);

      console.log('🔍 completeTopicForUser DEBUG:');
      console.log('   roomId:', roomId);
      console.log('   topicId:', topicId);
      console.log('   userId:', userId);

      // Find room without transaction (transactions require replica set)
      const room = await Room.findById(roomId);
      if (!room) throw createError('Room not found', 404);

      console.log('   Room found:', room._id);
      console.log('   Has roadmap:', !!room.roadmap);
      console.log('   Has phases:', room.roadmap?.phases?.length);

      // Find topic in roadmap
      let topicFound = false;
      let completedTopicTitle = '';
      let completedMilestone: any = null;
      let topicOrder = 0;
      
      if (room.roadmap && room.roadmap.phases) {
        for (const phase of room.roadmap.phases) {
          console.log('   Checking phase:', phase.title);
          for (const milestone of phase.milestones) {
            console.log('     Checking milestone:', milestone.title);
            for (let i = 0; i < milestone.topics.length; i++) {
              const topic = milestone.topics[i];
              
              // Skip if topic is undefined
              if (!topic) continue;
              
              // Handle both string topics and object topics
              const topicTitle = typeof topic === 'string' ? topic : topic.title;
              const topicId_db = typeof topic === 'object' && (topic as any)._id ? (topic as any)._id.toString() : null;
              
              console.log('       Checking topic:', topicTitle, '| _id:', topicId_db, '| type:', typeof topic);
              console.log('       Comparing with topicId:', topicId);
              console.log('       Match by _id?', topicId_db === topicId);
              console.log('       Match by title?', topicTitle === topicId);
              
              if (topicId_db === topicId || topicTitle === topicId) {
                // Store the topic title and milestone for event emission
                completedTopicTitle = topicTitle;
                completedMilestone = milestone;
                topicOrder = i;
                
                // If topic is a string, convert it to object format
                if (typeof topic === 'string') {
                  console.log('       ⚠️ Converting string topic to object format');
                  milestone.topics[i] = {
                    title: topic,
                    status: 'completed', // ✅ SET STATUS
                    completedBy: [{
                      userId: userId,
                      completedAt: new Date(),
                    }] as any,
                    completedAt: new Date(), // ✅ SET TIMESTAMP
                  } as any;
                } else {
                  // Topic is already an object, update status and add to completedBy
                  topic.status = 'completed'; // ✅ SET STATUS
                  topic.completedAt = new Date(); // ✅ SET TIMESTAMP
                  
                  if (!topic.completedBy) topic.completedBy = [] as any;
                  const completedBy = topic.completedBy as any[];
                  if (!completedBy.some((c: any) => c.userId?.toString() === userId)) {
                    completedBy.push({
                      userId: userId,
                      completedAt: new Date(),
                    } as any);
                  }
                }
                console.log(`       ✅ Topic status set to 'completed'`);
                topicFound = true;
                break;
              }
            }
            if (topicFound) break;
          }
          if (topicFound) break;
        }
      }

      if (!topicFound) throw createError('Topic not found', 404);

      // Update progress array
      const progressIndex = room.progress?.findIndex(p => p.userId.toString() === userId) ?? -1;
      const totalTopics = room.roadmap?.phases.flatMap(p => p.milestones.flatMap(m => m.topics)).length ?? 0;
      let completedCount = 0;
      
      if (progressIndex >= 0 && room.progress && room.progress[progressIndex]) {
        room.progress[progressIndex].completedTopics += 1;
        room.progress[progressIndex].updatedAt = new Date();
        completedCount = room.progress[progressIndex].completedTopics;
      } else {
        if (!room.progress) room.progress = [];
        room.progress.push({
          userId: new Types.ObjectId(userId),
          completedTopics: 1,
          totalTopics,
          updatedAt: new Date(),
        });
        completedCount = 1;
      }

      // ⭐ UPDATE MEMBER PROGRESS (for averageProgress calculation)
      const memberIndex = room.members.findIndex(m => m.userId.toString() === userId);
      if (memberIndex >= 0 && room.members[memberIndex]) {
        const member = room.members[memberIndex];
        
        // Get milestone ID from completedMilestone
        const milestoneId = completedMilestone ? ((completedMilestone as any)._id?.toString() || (completedMilestone as any).id || '') : '';
        
        // Initialize progress if not exists
        if (!member.progress) {
          member.progress = {
            currentPhase: 0,
            currentMilestone: 0,
            completedMilestones: [] as any,
            lastActivity: new Date(),
            progressPercentage: 0,
          };
        }
        
        // Add milestone to completedMilestones if not already there
        if (milestoneId && !(member.progress.completedMilestones as any).includes(milestoneId)) {
          (member.progress.completedMilestones as any).push(milestoneId);
        }
        
        // Calculate progress percentage based on completed topics
        member.progress.progressPercentage = Math.round((completedCount / totalTopics) * 100);
        member.progress.lastActivity = new Date();
        
        // ✨ NEW: Save current position (milestone + next topic)
        member.progress.currentMilestoneId = milestoneId;
        
        // Find the next uncompleted topic in this milestone
        const topics = completedMilestone?.topics || [];
        const nextUncompletedTopic = topics.find((t: any) => {
          const status = typeof t === 'object' ? t.status : 'pending';
          return status !== 'completed';
        });
        
        if (nextUncompletedTopic) {
          const nextTopicTitle = typeof nextUncompletedTopic === 'string' 
            ? nextUncompletedTopic 
            : nextUncompletedTopic.title;
          member.progress.currentTopicTitle = nextTopicTitle;
          console.log(`📍 Next topic to study: ${nextTopicTitle}`);
        } else {
          // All topics in this milestone are complete, find next milestone
          console.log(`🏁 All topics in ${completedMilestone?.title} completed! Looking for next milestone...`);
          
          let foundCurrent = false;
          let nextMilestoneFound = false;
          
          if (room.roadmap && room.roadmap.phases) {
            for (const phase of room.roadmap.phases) {
              for (const m of phase.milestones) {
                if (foundCurrent) {
                  // This is the next milestone
                  const nextMilestoneId = (m as any)._id?.toString() || (m as any).id || '';
                  member.progress.currentMilestoneId = nextMilestoneId;
                  
                  // Get first topic of next milestone
                  if (m.topics && m.topics.length > 0) {
                    const firstTopic = m.topics[0];
                    const firstTopicTitle = typeof firstTopic === 'string' 
                      ? firstTopic 
                      : (firstTopic && (firstTopic as any).title) || '';
                    member.progress.currentTopicTitle = firstTopicTitle;
                    console.log(`➡️ Moving to next milestone: ${m.title}, first topic: ${firstTopicTitle}`);
                  }
                  nextMilestoneFound = true;
                  break;
                }
                
                // Check if this is the current milestone
                const mId = (m as any)._id?.toString() || (m as any).id || '';
                if (mId === milestoneId) {
                  foundCurrent = true;
                }
              }
              if (nextMilestoneFound) break;
            }
          }
          
          if (!nextMilestoneFound) {
            console.log(`🎓 Completed entire roadmap!`);
            member.progress.currentTopicTitle = undefined;
          }
        }
        
        console.log(`✅ Updated member progress: ${member.progress.progressPercentage}% (${completedCount}/${totalTopics} topics)`);
      }

      // ✨ NEW: Update streak ONLY if ALL of today's tasks are completed
      const dayOfWeek = new Date().getDay();
      const todaysScheduledTopics = completedMilestone?.topics?.filter((t: any) => {
        if (!t.scheduledDays || t.scheduledDays.length === 0) return false;
        return t.scheduledDays.includes(dayOfWeek);
      }) || [];
      
      const allTodaysTasksCompleted = todaysScheduledTopics.length === 0 || todaysScheduledTopics.every((t: any) => 
        t.status === 'completed' || t.completed === true
      );
      
      console.log(`📅 Today's scheduled topics: ${todaysScheduledTopics.length}`);
      console.log(`✅ All today's tasks completed: ${allTodaysTasksCompleted}`);
      
      if (allTodaysTasksCompleted) {
        // Update streak
        const today = new Date().setHours(0, 0, 0, 0);
        const streakIndex = room.streaks?.findIndex(s => s.userId.toString() === userId) ?? -1;
        
        if (streakIndex >= 0 && room.streaks && room.streaks[streakIndex]) {
          const lastUpdate = new Date(room.streaks[streakIndex].lastUpdated).setHours(0, 0, 0, 0);
          const daysSinceLastUpdate = Math.floor((today - lastUpdate) / (1000 * 60 * 60 * 24));
          
          if (daysSinceLastUpdate === 1) {
            room.streaks[streakIndex].days += 1;
            console.log(`🔥 Streak incremented: ${room.streaks[streakIndex].days} days`);
          } else if (daysSinceLastUpdate > 1) {
            room.streaks[streakIndex].days = 1;
            console.log(`🔄 Streak reset to 1 day (gap detected)`);
          } else {
            console.log(`⏭️ Streak already updated today`);
          }
          
          room.streaks[streakIndex].lastUpdated = new Date();
          room.streaks[streakIndex].history.push(new Date());
        } else {
          if (!room.streaks) room.streaks = [];
          room.streaks.push({
            userId: new Types.ObjectId(userId),
            days: 1,
            lastUpdated: new Date(),
            history: [new Date()],
          });
          console.log(`🔥 New streak started: 1 day`);
        }
      } else {
        console.log(`⏳ Streak not updated - not all today's tasks completed yet`);
      }

      // Mark modified and save without transaction
      room.markModified('roadmap');
      room.markModified('progress');
      room.markModified('streaks');
      room.markModified('members'); // ⭐ Mark members as modified for progress update
      await room.save();
      
      console.log('📊 After save - Room data:', {
        averageProgress: (room as any).averageProgress,
        progressData: room.progressData,
        memberProgress: room.members.find(m => m.userId.toString() === userId)?.progress
      });

      // Calculate completion percentage
      const userProgress = room.progress?.find(p => p.userId.toString() === userId);
      const overallProgress = (completedCount / totalTopics) * 100;

      console.log('✅ Topic marked complete - triggering event cascade');
      console.log(`📊 Progress: ${completedCount}/${totalTopics} topics (${Math.round(overallProgress)}%)`);
      console.log(`📈 Room averageProgress: ${(room as any).averageProgress || 0}%`);

      // === TRIGGER EVENT CASCADE ===
      // 1. Topic Complete Event
      socketEventManager.emitTopicComplete({
        topicId: topicId || '',
        topicTitle: completedTopicTitle || topicId || 'Unknown Topic',
        userId,
        roomId: room._id.toString(),
        completedAt: new Date(),
      });

      // 2. Progress Update Event
      socketEventManager.emitProgressUpdate({
        roomId: room._id.toString(),
        userId,
        overallProgress,
        completedTopics: completedCount,
        totalTopics,
        todayCompletedCount: completedCount, // TODO: Calculate daily count
      });

      // 3. Kanban Update Event (auto-move to done)
      socketEventManager.emitKanbanUpdate({
        taskId: topicId || '',
        topicId: topicId || '',
        roomId: room._id.toString(),
        newStatus: 'done',
        userId,
      });

      // 4. Streak Update Event
      const userStreak = room.streaks?.find(s => s.userId.toString() === userId);
      if (userStreak) {
        socketEventManager.emitStreakUpdate({
          roomId: room._id.toString(),
          userId,
          streakDays: userStreak.days,
          completedToday: true,
        });
      }

      // 5. Quiz Unlock Event (auto-unlock quiz for completed topic)
      socketEventManager.emitQuizUnlocked({
        roomId: room._id.toString(),
        userId,
        topicId: topicId || '',
        topicTitle: completedTopicTitle || topicId || 'Unknown Topic',
        difficulty: 'medium', // Default difficulty, can be customized
      });

      // 6. Kanban Auto-Management (move task to done)
      await moveTaskToDone(room._id.toString(), topicId || '', userId);

      // 7. Partner Sync (notify partner in duo mode)
      const user = await import('../models/user.model.js').then(m => m.User.findById(userId).select('name'));
      if (user) {
        await notifyPartner(room._id.toString(), userId, {
          userId,
          userName: user.name,
          action: 'topic_complete',
          topicId: topicId || '',
          topicTitle: completedTopicTitle,
          timestamp: new Date(),
        });
        
        // Sync duo streak
        await syncDuoStreak(room._id.toString(), userId);
      }

      res.status(200).json({
        success: true,
        message: 'Topic completed successfully',
        progress: userProgress,
        topicId: topicId || '',
        topicTitle: completedTopicTitle,
        milestone: completedMilestone ? {
          id: (completedMilestone as any)._id?.toString() || (completedMilestone as any).id,
          title: completedMilestone.title,
        } : null,
        order: topicOrder,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(createError('Validation error: ' + error.errors.map(e => e.message).join(', '), 400));
      }
      next(error);
    }
  }

  // ========== PROGRESS & STREAK ==========

  async getUserProgress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw createError('Authentication required', 401);

      const { roomId, userId } = req.params;
      const room = await Room.findById(roomId).select('progress');
      if (!room) throw createError('Room not found', 404);

      const userProgress = room.progress?.find(p => p.userId.toString() === userId);
      
      res.status(200).json({
        success: true,
        progress: userProgress || { completedTopics: 0, totalTopics: 0 },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateUserProgress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw createError('Authentication required', 401);

      const { roomId, userId } = req.params;
      const { completedTopicIds, timeSpent } = updateProgressSchema.parse(req.body);

      const room = await Room.findById(roomId);
      if (!room) throw createError('Room not found', 404);

      // Update progress
      const progressIndex = room.progress?.findIndex(p => p.userId.toString() === userId) ?? -1;
      if (progressIndex >= 0 && room.progress && room.progress[progressIndex]) {
        room.progress[progressIndex].completedTopics = completedTopicIds.length;
        room.progress[progressIndex].updatedAt = new Date();
      } else {
        const totalTopics = room.roadmap?.phases.flatMap(p => p.milestones.flatMap(m => m.topics)).length ?? 0;
        if (!room.progress) room.progress = [];
        room.progress.push({
          userId: new Types.ObjectId(userId),
          completedTopics: completedTopicIds.length,
          totalTopics,
          updatedAt: new Date(),
        });
      }

      room.markModified('progress');
      await room.save();

        // Emit socket event
        const socketService = getSocketServiceInstance();
        if (socketService && room._id) {
          const userProgress = room.progress?.find(p => p.userId.toString() === userId);
          if (userProgress) {
            socketService.emitToRoom(room._id.toString(), 'room:progress:update', {
              roomId: room._id.toString(),
              userId,
              progress: userProgress,
            });
          }
        }

      res.status(200).json({
        success: true,
        progress: room.progress?.find(p => p.userId.toString() === userId),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(createError('Validation error: ' + error.errors.map(e => e.message).join(', '), 400));
      }
      next(error);
    }
  }

  // ========== CHAT ==========

  async getMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw createError('Authentication required', 401);

      const { roomId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      const order = (req.query.order as string) || 'asc';

      // Verify room exists and user is a member
      const room = await Room.findById(roomId);
      if (!room) throw createError('Room not found', 404);

      const isMember = room.members.some(m => m.userId.toString() === req.user!.id);
      if (!isMember) throw createError('Access denied: Not a member of the room', 403);

      // Fetch messages from ChatMessage collection (not embedded in room)
      const ChatMessage = (await import('../models/chatMessage.model.js')).ChatMessage;
      const messages = await ChatMessage.find({ roomId })
        .populate('userId', 'name avatarUrl profilePic customAvatarURL isCustomAvatar')
        .sort({ createdAt: order === 'asc' ? 1 : -1 })
        .limit(limit)
        .lean();

      // Format messages with proper avatar URL
      const env = (await import('../config/env.js')).env;
      const protocol = env.NODE_ENV === 'production' ? 'https' : 'http';
      const host = env.HOST || 'localhost';
      const port = env.NODE_ENV === 'production' ? '' : `:${env.PORT}`;
      
      const formattedMessages = messages.map((msg: any) => {
        let avatarUrl = null;
        if (msg.userId) {
          avatarUrl = msg.userId.isCustomAvatar && msg.userId.customAvatarURL 
            ? msg.userId.customAvatarURL 
            : msg.userId.profilePic || msg.userId.avatarUrl || null;
          
          // Convert relative paths to full URLs for mobile clients
          if (avatarUrl && avatarUrl.startsWith('/uploads/')) {
            avatarUrl = `${protocol}://${host}${port}${avatarUrl}`;
          }
        }
        
        return {
          _id: msg._id.toString(),
          user: msg.userId ? {
            _id: msg.userId._id.toString(),
            name: msg.userId.name,
            avatarUrl: avatarUrl
          } : null,
          content: msg.content,
          type: msg.type,
          timestamp: msg.createdAt,
        };
      });

      // If order is 'asc', reverse to show oldest first
      if (order === 'asc') {
        formattedMessages.reverse();
      }

      res.status(200).json({
        success: true,
        messages: formattedMessages,
      });
    } catch (error) {
      next(error);
    }
  }

  async postMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw createError('Authentication required', 401);

      const { roomId } = req.params;
      const { content } = postMessageSchema.parse(req.body);

      const room = await Room.findById(roomId);
      if (!room) throw createError('Room not found', 404);

      // Escape HTML to prevent XSS
      const sanitizedContent = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');

      const message = {
        id: uuidv4(),
        userId: new Types.ObjectId(req.user.id),
        content: sanitizedContent,
        timestamp: new Date(),
        type: 'user' as const,
      };

      if (!room.messages) room.messages = [];
      room.messages.push(message);
      room.markModified('messages');
      await room.save();

      // Populate user info for response
      await room.populate('messages.userId', 'name avatar');
      const savedMessage = room.messages[room.messages.length - 1];

      // Emit socket event
      const socketService = getSocketServiceInstance();
      if (socketService && room._id) {
        socketService.emitToRoom(room._id.toString(), 'room:message:new', savedMessage);
      }

      res.status(201).json({
        success: true,
        message: savedMessage,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(createError('Validation error: ' + error.errors.map(e => e.message).join(', '), 400));
      }
      next(error);
    }
  }

  // ========== QUIZ ==========

  async generateQuiz(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw createError('Authentication required', 401);

      const { roomId } = req.params;
      const { topics, difficulty } = generateQuizSchema.parse(req.body);

      const room = await Room.findById(roomId);
      if (!room) throw createError('Room not found', 404);

      // Generate quiz using Gemini
      const topicsList = topics && topics.length > 0 
        ? topics 
        : room.roadmap?.phases.flatMap(p => p.milestones.flatMap(m => m.topics.map((t: any) => t.title || t))) || [];

      // Concise prompt for faster generation
      const prompt = `Generate 3 multiple-choice questions about: ${topicsList.join(', ')}.

CRITICAL: Return ONLY a valid JSON object. No extra text before or after.

Format:
{
  "questions": [
    {
      "question": "Your question here?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 0
    }
  ]
}

Rules:
- ${difficulty} difficulty level
- correctAnswer must be 0, 1, 2, or 3
- Keep all text simple and clean
- Do NOT use apostrophes or special quotes
- No markdown, no code blocks, ONLY the JSON object`;

      console.log('🤖 Generating quiz for topics:', topicsList);
      
      // Add timeout wrapper for Gemini call
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Gemini API timeout after 90 seconds')), 90000);
      });
      
      const geminiPromise = geminiService.generateText(prompt, { 
        temperature: 0.7,
        maxOutputTokens: 1024  // Reduced from 2048 to prevent truncation
      });
      
      const response = await Promise.race([geminiPromise, timeoutPromise]) as string;
      console.log('📝 Gemini raw response:', response.substring(0, 500));
      
      // Clean response - remove markdown code blocks and extra whitespace
      let cleanedResponse = response.replace(/```json|```/g, '').trim();
      
      // Remove any text before the first { and after the last }
      const firstBrace = cleanedResponse.indexOf('{');
      const lastBrace = cleanedResponse.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleanedResponse = cleanedResponse.substring(firstBrace, lastBrace + 1);
      }
      
      console.log('🧹 Cleaned response:', cleanedResponse.substring(0, 500));
      
      let quizData: any;
      try {
        quizData = JSON.parse(cleanedResponse);
      } catch (parseError) {
        console.error('❌ JSON parse error:', parseError);
        console.error('📄 Problematic JSON (full):', cleanedResponse);
        
        // Enhanced JSON fixing - handle more cases
        try {
          let fixedJson = cleanedResponse
            // Remove all control characters except newlines we want to keep
            .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g, '')
            // Replace smart quotes with regular quotes
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201C\u201D]/g, '"')
            // Fix escaped single quotes in JSON strings
            .replace(/\\'/g, "'")
            // Remove invalid escape sequences (but keep valid ones)
            .replace(/([^\\])\\([^"\\\/bfnrtu])/g, '$1$2')
            // Fix common contraction escapes that shouldn't be escaped
            .replace(/\\"s/g, "'s")
            .replace(/\\"t/g, "'t")
            .replace(/\\"re/g, "'re")
            .replace(/\\"ll/g, "'ll")
            .replace(/\\"ve/g, "'ve")
            .replace(/\\"m/g, "'m")
            .replace(/\\"d/g, "'d")
            // Replace problematic characters in text
            .replace(/[\r\n\t]/g, ' ') // Replace line breaks and tabs with spaces
            .replace(/\s+/g, ' '); // Collapse multiple spaces
          
          console.log('🔧 Fixed JSON attempt:', fixedJson.substring(0, 500));
          quizData = JSON.parse(fixedJson);
          console.log('✅ Successfully parsed after cleanup');
        } catch (retryError) {
          console.error('❌ Still failed after cleanup, triggering fallback');
          throw parseError; // Trigger fallback
        }
      }
      
      console.log('✅ Parsed quiz data:', JSON.stringify(quizData, null, 2));
      console.log('❓ Number of questions:', quizData.questions?.length);

      // Validate quiz data
      const isValidQuiz = (data: any) => {
        if (!data || !data.questions || !Array.isArray(data.questions) || data.questions.length === 0) return false;
        for (const q of data.questions) {
          if (!q.question || !q.options || !Array.isArray(q.options) || q.options.length < 2) return false;
        }
        return true;
      };

      if (!isValidQuiz(quizData)) {
        console.warn('⚠️ Primary AI generation returned invalid/truncated data, attempting per-topic fallback');

        // Fallback: generate one question per topic with smaller prompts to avoid truncation
        const fallbackQuestions: any[] = [];
        const maxQuestions = 3;  // Reduced from 5 to 3
        const topicsToTry = topicsList.slice(0, Math.max(maxQuestions, 1));

        for (const t of topicsToTry) {
          if (fallbackQuestions.length >= maxQuestions) break;
          try {
            const singlePrompt = `Generate 1 multiple-choice question about: ${t}. Return JSON only: { "questions": [ { "question": "...", "options": ["A","B","C","D"], "correctAnswer": 0 } ] }. No explanation.`;

            const singleTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Gemini single-topic timeout after 30s')), 30000));
            const singlePromise = geminiService.generateText(singlePrompt, { temperature: 0.7, maxOutputTokens: 256 });  // Reduced to 256
            const singleResp = await Promise.race([singlePromise, singleTimeout]) as string;
            const cleanedSingle = singleResp.replace(/```json|```/g, '').trim();
            const singleData = JSON.parse(cleanedSingle);

            if (isValidQuiz(singleData)) {
              // Add first question
              fallbackQuestions.push(singleData.questions[0]);
              console.log(`✅ Fallback question generated for topic: ${t}`);
            } else {
              console.warn(`Fallback generation produced invalid data for topic: ${t}`);
            }
          } catch (singleErr) {
            console.warn('Fallback per-topic generation failed for', t, String(singleErr));
            // continue trying other topics
          }
        }

        if (fallbackQuestions.length === 0) {
          throw createError('AI generated invalid quiz - no questions found (primary + fallback attempts)', 500);
        }

        // Build quiz from fallback questions (limit to maxQuestions)
        const quizDataFromFallback = { questions: fallbackQuestions.slice(0, maxQuestions) };

        // use fallback data
        quizData.questions = quizDataFromFallback.questions;
      }

      const quiz = {
        date: new Date(),
        topics: topicsList.slice(0, 10),
        difficulty,
        questions: quizData.questions,
        results: [],
        generatedAt: new Date(),
      };

      console.log('💾 Saving quiz with', quiz.questions?.length, 'questions');

      if (!room.quizzes) room.quizzes = [];
      room.quizzes.push(quiz);
      room.markModified('quizzes');
      await room.save();

      // Emit socket event
      const socketService = getSocketServiceInstance();
      if (socketService && room._id && room.quizzes && room.quizzes.length > 0) {
        const lastQuiz = room.quizzes[room.quizzes.length - 1];
        if (lastQuiz?._id) {
          socketService.emitToRoom(room._id.toString(), 'room:quiz:new', {
            roomId: room._id.toString(),
            quizId: lastQuiz._id.toString(),
          });
        }
      }

      res.status(201).json({
        success: true,
        quiz: room.quizzes[room.quizzes.length - 1],
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(createError('Validation error: ' + error.errors.map(e => e.message).join(', '), 400));
      }
      next(error);
    }
  }

  async submitQuiz(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw createError('Authentication required', 401);

      const { roomId, quizId } = req.params;
      const { answers } = submitQuizSchema.parse(req.body);

      const room = await Room.findById(roomId);
      if (!room) throw createError('Room not found', 404);

      const quiz = room.quizzes?.find(q => q._id?.toString() === quizId);
      if (!quiz) throw createError('Quiz not found', 404);

      // Grade answers
      let score = 0;
      const details: Array<{ correct: boolean; explanation?: string }> = [];
      
      quiz.questions.forEach((q, i) => {
        const isCorrect = answers[i] === q.correctAnswer;
        if (isCorrect) score++;
        
        details.push({
          correct: isCorrect,
          explanation: !isCorrect ? `Correct answer: ${q.options[q.correctAnswer]}` : undefined,
        });
      });

      const result = {
        userId: new Types.ObjectId(req.user.id),
        score,
        submittedAt: new Date(),
        answers,
      };

      quiz.results.push(result);
      room.markModified('quizzes');
      await room.save();

      // Calculate aggregate statistics for this user across all quizzes in this room
      const allScores: number[] = [];
      
      room.quizzes?.forEach(q => {
        const userResults = q.results.filter(r => r.userId.toString() === req.user!.id);
        userResults.forEach(r => {
          const totalQuestions = q.questions.length || 1;
          const percentage = Math.round((r.score / totalQuestions) * 100);
          allScores.push(percentage);
        });
      });

      const averageScore = allScores.length > 0 
        ? Math.round(allScores.reduce((sum, s) => sum + s, 0) / allScores.length)
        : 0;

      const bestScore = allScores.length > 0 ? Math.max(...allScores) : 0;
      const totalQuizzesCompleted = allScores.length;

      const currentPercentage = Math.round((score / quiz.questions.length) * 100);

      res.status(200).json({
        success: true,
        results: {
          score,
          totalQuestions: quiz.questions.length,
          percentage: currentPercentage,
          details,
          statistics: {
            averageScore,
            bestScore,
            totalQuizzesCompleted,
            currentScore: currentPercentage,
          },
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(createError('Validation error: ' + error.errors.map(e => e.message).join(', '), 400));
      }
      next(error);
    }
  }

  async getQuizzes(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw createError('Authentication required', 401);

      const { roomId } = req.params;
      const room = await Room.findById(roomId).select('quizzes');
      if (!room) throw createError('Room not found', 404);

      res.status(200).json({
        success: true,
        quizzes: room.quizzes || [],
      });
    } catch (error) {
      next(error);
    }
  }

  // ========== KANBAN ==========

  async getKanbanBoard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw createError('Authentication required', 401);

      const { roomId, userId } = req.params;
      const room = await Room.findById(roomId);
      if (!room) throw createError('Room not found', 404);

      let board = room.kanbanBoards?.find(b => b.userId.toString() === userId);
      
      // Check if board needs regeneration:
      // 1. Board doesn't exist
      // 2. All tasks are in one column (likely all in backlog from old logic)
      // 3. Board has no tasks at all
      const needsRegeneration = !board || 
        !board.columns || 
        Object.keys(board.columns).length === 0 ||
        (board.columns.backlog && board.columns.backlog.length > 0 && 
         board.columns.todo && board.columns.todo.length === 0 &&
         board.columns.inProgress && board.columns.inProgress.length === 0);

      if (needsRegeneration) {
        console.log('🔄 Regenerating Kanban board for user:', userId);
        const roadmapArray = Array.isArray(room.roadmap) ? room.roadmap : [];
        console.log('📊 Room has', roadmapArray.length, 'milestones');
        
        // Initialize empty board structure
        board = {
          userId: new Types.ObjectId(userId),
          columns: {
            backlog: [],
            todo: [],
            inProgress: [],
            done: []
          },
          updatedAt: new Date()
        };

        // Auto-populate from roadmap
        if (room.roadmap && Array.isArray(room.roadmap)) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          console.log('📅 Today is:', today.toISOString().split('T')[0]);

          room.roadmap.forEach((milestone: any, milestoneIndex: number) => {
            console.log(`\n📦 Milestone ${milestoneIndex + 1}:`, milestone.title);
            if (milestone.topics && Array.isArray(milestone.topics)) {
              console.log(`   Topics count: ${milestone.topics.length}`);
              milestone.topics.forEach((topic: any, topicIndex: number) => {
                const task = {
                  id: `${milestone._id}-${topicIndex}`,
                  topicId: topic._id?.toString() || `topic-${topicIndex}`,
                  title: topic.title || 'Untitled Topic',
                  description: topic.description || '',
                  dueDate: topic.dueDate ? new Date(topic.dueDate) : null,
                  priority: topic.priority || 'medium',
                  tags: topic.tags || [],
                  assignedTo: topic.assignedTo || userId,
                  order: topicIndex,
                  completed: topic.status === 'completed',
                  createdAt: new Date()
                };

                // Determine column based on status and due date
                console.log(`   Topic "${task.title}":`, {
                  status: topic.status,
                  dueDate: task.dueDate?.toISOString().split('T')[0],
                  completed: task.completed
                });
                
                if (task.completed) {
                  // Completed tasks go to Done
                  board!.columns.done.push(task);
                  console.log('      → Done');
                } else if (topic.status === 'in-progress' || topic.status === 'inprogress') {
                  // In-progress tasks go to In Progress
                  board!.columns.inProgress.push(task);
                  console.log('      → In Progress');
                } else if (task.dueDate) {
                  const dueDate = new Date(task.dueDate);
                  dueDate.setHours(0, 0, 0, 0);
                  
                  if (dueDate < today) {
                    // Overdue tasks go to Backlog
                    board!.columns.backlog.push(task);
                    console.log('      → Backlog (overdue)');
                  } else {
                    // Future/today tasks go to To Do
                    board!.columns.todo.push(task);
                    console.log('      → To Do (future)');
                  }
                } else {
                  // Tasks without due date go to To Do by default
                  board!.columns.todo.push(task);
                  console.log('      → To Do (no due date)');
                }
              });
            }
          });
        }

        // Save the regenerated board
        if (!room.kanbanBoards) room.kanbanBoards = [];
        const existingBoardIndex = room.kanbanBoards.findIndex(b => b.userId.toString() === userId);
        if (existingBoardIndex >= 0) {
          room.kanbanBoards[existingBoardIndex] = board as any;
        } else {
          room.kanbanBoards.push(board as any);
        }
        room.markModified('kanbanBoards');
        await room.save();
        
        console.log('\n✅ Kanban board regenerated successfully');
        console.log('📊 Final distribution:', {
          backlog: board.columns.backlog.length,
          todo: board.columns.todo.length,
          inProgress: board.columns.inProgress.length,
          done: board.columns.done.length
        });
      }

      // Return board with proper structure
      res.status(200).json({
        success: true,
        kanban: {
          backlog: board?.columns?.backlog || [],
          todo: board?.columns?.todo || [],
          inProgress: board?.columns?.inProgress || [],
          done: board?.columns?.done || []
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async moveKanbanTask(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw createError('Authentication required', 401);

      const { roomId, userId } = req.params;
      const { taskId, fromColumn, toColumn, order } = moveKanbanSchema.parse(req.body);

      const room = await Room.findById(roomId);
      if (!room) throw createError('Room not found', 404);

      const boardIndex = room.kanbanBoards?.findIndex(b => b.userId.toString() === userId) ?? -1;
      if (boardIndex === -1 || !room.kanbanBoards) throw createError('Kanban board not found', 404);

      const board = room.kanbanBoards[boardIndex];
      if (!board || !board.columns[fromColumn] || !board.columns[toColumn]) {
        throw createError('Invalid board structure', 400);
      }
      
      const taskIndex = board.columns[fromColumn].findIndex(t => t.id === taskId);
      if (taskIndex === -1) throw createError('Task not found', 404);

      const task = board.columns[fromColumn][taskIndex];
      if (!task) throw createError('Task not found', 404);
      
      board.columns[fromColumn].splice(taskIndex, 1);
      task.order = order;
      board.columns[toColumn].splice(order, 0, task);
      board.updatedAt = new Date();

      room.markModified('kanbanBoards');
      await room.save();

      // Emit socket event
      const socketService = getSocketServiceInstance();
      if (socketService && room._id) {
        socketService.emitToRoom(room._id.toString(), 'room:kanban:update', {
          roomId: room._id.toString(),
          userId,
          change: { taskId, fromColumn, toColumn, order },
        });
      }

      res.status(200).json({
        success: true,
        board,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(createError('Validation error: ' + error.errors.map(e => e.message).join(', '), 400));
      }
      next(error);
    }
  }

  async resetKanbanBoard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw createError('Authentication required', 401);

      const { roomId, userId } = req.params;
      const room = await Room.findById(roomId);
      if (!room) throw createError('Room not found', 404);

      // Remove user's board to force regeneration on next GET
      if (room.kanbanBoards) {
        room.kanbanBoards = room.kanbanBoards.filter(b => b.userId.toString() !== userId);
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

  // ========== FOCUS TIMER ==========

  async startFocusSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw createError('Authentication required', 401);

      const { roomId } = req.params;
      const { topicId, topicTitle } = startFocusSchema.parse(req.body);

      const room = await Room.findById(roomId);
      if (!room) throw createError('Room not found', 404);

      const sessionId = uuidv4();
      const session = {
        userId: new Types.ObjectId(req.user.id),
        topicId,
        topicTitle,
        startTime: new Date(),
        duration: 0,
        completed: false,
      };

      if (!room.focusSessions) room.focusSessions = [];
      room.focusSessions.push(session);
      room.markModified('focusSessions');
      await room.save();

      // Store sessionId mapping in Redis or return with response
      res.status(201).json({
        success: true,
        sessionId,
        startedAt: session.startTime,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(createError('Validation error: ' + error.errors.map(e => e.message).join(', '), 400));
      }
      next(error);
    }
  }

  async pulseFocusSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw createError('Authentication required', 401);

      const { roomId, sessionId } = req.params;
      const { elapsed } = pulseFocusSchema.parse(req.body);

      const room = await Room.findById(roomId);
      if (!room) throw createError('Room not found', 404);

      const session = room.focusSessions?.find(
        s => s.userId.toString() === req.user!.id && s.startTime && !s.completed
      );
      if (!session) throw createError('Focus session not found', 404);

      session.duration = Math.floor(elapsed / 60); // Convert seconds to minutes
      room.markModified('focusSessions');
      await room.save();

      res.status(200).json({
        success: true,
        elapsed,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(createError('Validation error: ' + error.errors.map(e => e.message).join(', '), 400));
      }
      next(error);
    }
  }

  async endFocusSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw createError('Authentication required', 401);

      const { roomId, sessionId } = req.params;

      const room = await Room.findById(roomId);
      if (!room) throw createError('Room not found', 404);

      const session = room.focusSessions?.find(
        s => s.userId.toString() === req.user?.id && !s.completed
      );
      if (!session) throw createError('Focus session not found', 404);

      session.endTime = new Date();
      session.completed = true;
      session.duration = Math.floor((session.endTime.getTime() - session.startTime.getTime()) / 60000);

      room.markModified('focusSessions');
      await room.save();

      res.status(200).json({
        success: true,
        session: {
          duration: session.duration,
          completed: true,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ========== TODAY'S TASKS LOGIC ==========
  
  async getTodaysTasks(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw createError('Authentication required', 401);

      const { roomId } = req.params;
      const room = await Room.findById(roomId);
      if (!room) throw createError('Room not found', 404);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayStr = today.toISOString().split('T')[0];

      // Collect all topics from roadmap
      const allTopics: any[] = [];
      if (room.roadmap?.phases) {
        for (const phase of room.roadmap.phases) {
          for (const milestone of phase.milestones) {
            if (!milestone.topics) continue;
            
            for (const topic of milestone.topics) {
              // Skip string topics, only process IRoadmapTopic objects
              if (typeof topic === 'string') continue;
              
              allTopics.push({
                title: topic.title,
                description: topic.description,
                estimatedHours: topic.estimatedHours,
                status: topic.status,
                completedBy: topic.completedBy,
                completedAt: topic.completedAt,
                milestoneId: (milestone as any)._id || (milestone as any).id,
                phaseName: (phase as any).name || (phase as any).title,
                milestoneName: (milestone as any).name || (milestone as any).title,
              });
            }
          }
        }
      }

      // Find user progress
      const userId = req.user.id;
      const userProgress = room.progress?.find(p => p.userId.toString() === userId);
      const completedTopicIds = Array.isArray(userProgress?.completedTopics) 
        ? (userProgress.completedTopics as string[])
        : [];

      // Filter topics scheduled for today (based on completedBy field)
      const scheduledToday = allTopics.filter(t => {
        // For now, return topics that are pending or in-progress
        return t.status !== 'completed';
      }).slice(0, 5); // Limit to 5 tasks per day

      // Check if user completed everything scheduled for today
      const allScheduledCompleted = scheduledToday.every(t => 
        t.completedBy?.some((id: any) => id.toString() === userId)
      );

      // If user completed early, auto-pull next topic (configurable limit: +1)
      const AUTO_PULL_LIMIT = 1;
      let additionalTopics: any[] = [];

      if (allScheduledCompleted && scheduledToday.length > 0) {
        // Find next uncompleted topics
        const nextTopics = allTopics.filter(t => {
          const isCompleted = t.completedBy?.some((id: any) => id.toString() === userId);
          const isScheduledToday = scheduledToday.some(st => st.title === t.title);
          return !isCompleted && !isScheduledToday;
        }).slice(0, AUTO_PULL_LIMIT);

        additionalTopics = nextTopics.map(t => ({
          ...t,
          isAdditional: true,
        }));
      }

      const todaysTasks = [
        ...scheduledToday.map(t => ({ ...t, isAdditional: false })),
        ...additionalTopics,
      ];

      res.status(200).json({
        success: true,
        date: todayStr,
        totalScheduled: scheduledToday.length,
        completedScheduled: scheduledToday.filter(t => 
          t.completedBy?.some((id: any) => id.toString() === userId)
        ).length,
        additionalPulled: additionalTopics.length,
        tasks: todaysTasks,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const roomEnhancedController = new RoomEnhancedController();

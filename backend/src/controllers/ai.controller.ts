import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { aiService, type RoadmapInput, type QuizInput } from '../services/ai.service.js';
import { createError } from '../middleware/errorHandler.js';

// Input validation schemas
const roadmapInputSchema = z.object({
  goal: z.string().min(5, 'Goal must be at least 5 characters').max(200, 'Goal too long'),
  tags: z.array(z.string()).min(1, 'At least one tag is required').max(10, 'Maximum 10 tags allowed'),
  skillLevel: z.enum(['Beginner', 'Intermediate', 'Advanced'], {
    errorMap: () => ({ message: 'Skill level must be Beginner, Intermediate, or Advanced' }),
  }),
  durationWeeks: z.number().int().min(1, 'Duration must be at least 1 week').max(52, 'Duration cannot exceed 52 weeks').optional().default(12),
});

const quizInputSchema = z.object({
  topic: z.string().min(2, 'Topic must be at least 2 characters').max(100, 'Topic too long'),
  currentMilestone: z.string().optional(),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(),
  count: z.number().int().min(1, 'Count must be at least 1').max(20, 'Count cannot exceed 20').optional(),
  userProgress: z.object({
    completedTopics: z.array(z.string()).optional(),
    currentPhase: z.number().optional(),
  }).optional(),
});

export class AIController {
  // Generate learning roadmap
  async generateRoadmap(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      // Validate input
      const validationResult = roadmapInputSchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorMessage = validationResult.error.errors
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        throw createError(`Validation error: ${errorMessage}`, 400);
      }

      const input: RoadmapInput = validationResult.data;

      // Generate roadmap using AI service
      const roadmap = await aiService.generateRoadmap(input);

      // Send response
      res.status(200).json({
        success: true,
        roadmap,
        metadata: {
          generatedAt: new Date().toISOString(),
          userId: req.user.id,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // Generate quiz questions
  async generateQuiz(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      // Validate input
      const validationResult = quizInputSchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorMessage = validationResult.error.errors
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        throw createError(`Validation error: ${errorMessage}`, 400);
      }

      const input: QuizInput = validationResult.data;

      // Generate quiz using AI service
      const quiz = await aiService.generateQuiz(input);

      // Send response
      res.status(200).json({
        success: true,
        quiz: {
          topic: quiz.topic,
          difficulty: quiz.difficulty,
          items: quiz.items,
          totalQuestions: quiz.items.length,
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          userId: req.user.id,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // Generate room summary and feedback
  async generateRoomSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      // Validate input
      const roomSummarySchema = z.object({
        roomTitle: z.string().min(3, 'Room title must be at least 3 characters').max(200, 'Room title too long'),
        description: z.string().optional(),
        topics: z.array(z.string()).min(1, 'At least one topic is required').max(20, 'Maximum 20 topics allowed'),
        durationDays: z.number().int().min(1, 'Duration must be at least 1 day').max(365, 'Duration cannot exceed 365 days'),
        skillLevel: z.enum(['Beginner', 'Intermediate', 'Advanced']),
        dailyTime: z.string().min(1, 'Daily time commitment is required'),
        goal: z.string().optional(),
      });

      const validationResult = roomSummarySchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorMessage = validationResult.error.errors
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        throw createError(`Validation error: ${errorMessage}`, 400);
      }

      const input = validationResult.data;

      // Generate summary using AI service
      const summary = await aiService.generateRoomSummary(input);

      // Send response
      res.status(200).json({
        success: true,
        summary,
        metadata: {
          generatedAt: new Date().toISOString(),
          userId: req.user.id,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // Generate simple text response for chat
  async generateText(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      console.log('🤖 AI Text Generation Request from user:', req.user.id);

      // Validate input
      const textSchema = z.object({
        prompt: z.string().min(1, 'Prompt is required').max(3000, 'Prompt too long'),
        maxTokens: z.number().int().min(50).max(2000).optional(),
      });

      const validationResult = textSchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorMessage = validationResult.error.errors
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        console.error('❌ Validation error:', errorMessage);
        throw createError(`Validation error: ${errorMessage}`, 400);
      }

      const { prompt, maxTokens } = validationResult.data;
      
      console.log('📝 Prompt length:', prompt.length);
      console.log('🎯 Max tokens:', maxTokens || 200);

      // Generate text using AI service
      const text = await aiService.generateSimpleText(prompt, maxTokens);
      
      console.log('✅ AI Response generated, length:', text.length);

      // Send response
      res.status(200).json({
        success: true,
        text,
        metadata: {
          generatedAt: new Date().toISOString(),
          userId: req.user.id,
        },
      });
    } catch (error) {
      console.error('❌ AI Text Generation Error:', error);
      next(error);
    }
  }
}

// Export singleton instance
export const aiController = new AIController();

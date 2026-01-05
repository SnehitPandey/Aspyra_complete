import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { groupingService, type EmbedProfileData, type GroupStudentsData } from '../services/grouping.service.js';
import { createError } from '../middleware/errorHandler.js';

// Validation schemas
const profileSchema = z.object({
  skills: z.string().min(1, 'Skills are required').max(500),
  interests: z.string().min(1, 'Interests are required').max(500),
  goals: z.string().min(1, 'Goals are required').max(500),
});

const embedProfileSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  profile: profileSchema,
});

const groupStudentsSchema = z.object({
  count: z.number().int().min(1, 'Count must be at least 1').max(20, 'Count cannot exceed 20'),
  groupType: z.enum(['size', 'number']).optional().default('number'),
  algorithm: z.enum(['kmeans', 'similarity']).optional().default('kmeans'),
});

export class GroupingController {
  // Generate and store user profile embedding
  async embedProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      // Validate input
      const validationResult = embedProfileSchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorMessage = validationResult.error.errors
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        throw createError(`Validation error: ${errorMessage}`, 400);
      }

      const data: EmbedProfileData = validationResult.data;

      // Check if user is trying to embed their own profile or if they're an admin
      if (data.userId !== req.user.id && req.user.role !== 'ADMIN' && req.user.role !== 'MODERATOR') {
        throw createError('You can only embed your own profile', 403);
      }

      // Generate and store embedding
      const result = await groupingService.embedProfile(data);

      res.status(200).json({
        success: true,
        userId: result.userId,
        vectorLength: result.vectorLength,
        message: 'Profile embedding generated and stored successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  // Group students based on embeddings
  async groupStudents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      // Check if user has permission to group students (only admins and moderators)
      if (req.user.role !== 'ADMIN' && req.user.role !== 'MODERATOR') {
        throw createError('Only administrators and moderators can group students', 403);
      }

      // Validate input
      const validationResult = groupStudentsSchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorMessage = validationResult.error.errors
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        throw createError(`Validation error: ${errorMessage}`, 400);
      }

      const data: GroupStudentsData & { algorithm?: 'kmeans' | 'similarity' } = validationResult.data;

      // Group students using selected algorithm
      let groups;
      if (data.algorithm === 'similarity') {
        groups = await groupingService.groupStudentsBySimilarity(data);
      } else {
        groups = await groupingService.groupStudents(data);
      }

      // Prepare response
      const response = {
        success: true,
        groups: groups.map(group => ({
          groupId: group.groupId,
          members: group.members,
          memberCount: group.members.length,
          similarity: group.similarity,
        })),
        metadata: {
          totalGroups: groups.length,
          totalStudents: groups.reduce((sum, group) => sum + group.members.length, 0),
          algorithm: data.algorithm,
          groupType: data.groupType,
          requestedCount: data.count,
          generatedAt: new Date().toISOString(),
          generatedBy: req.user.id,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  // Get user's embedding status
  async getEmbeddingStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const { userId } = req.params;
      if (!userId) {
        throw createError('User ID is required', 400);
      }

      // Check permissions
      if (userId !== req.user.id && req.user.role !== 'ADMIN' && req.user.role !== 'MODERATOR') {
        throw createError('Access denied', 403);
      }

      const embedding = await groupingService.getUserEmbedding( userId );

      res.status(200).json({
        success: true,
        hasEmbedding: !!embedding,
        userId,
        embedding: embedding ? {
          id: embedding.id,
          vectorLength: embedding.vector.length,
          profile: embedding.profile,
          createdAt: embedding.createdAt.toISOString(),
          updatedAt: embedding.updatedAt.toISOString(),
        } : null,
      });
    } catch (error) {
      next(error);
    }
  }

  // Get embedding statistics (admin only)
  async getEmbeddingStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      // Only admins can view stats
      if (req.user.role !== 'ADMIN') {
        throw createError('Admin access required', 403);
      }

      const stats = await groupingService.getEmbeddingStats();

      res.status(200).json({
        success: true,
        stats,
      });
    } catch (error) {
      next(error);
    }
  }
}

// Export singleton instance
export const groupingController = new GroupingController();

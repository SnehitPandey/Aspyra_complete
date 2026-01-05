import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { channelService, type CreateChannelData, type CreateNoteData, type UpdateChannelData, type UpdateNoteData } from '../services/channels.service.js';
import type { INote } from '../models/channel.model.js';
import { createError } from '../middleware/errorHandler.js';
import { getFileUrl } from '../middleware/upload.js';

// Validation schemas
const createChannelSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(200, 'Title too long'),
  description: z.string().max(1000, 'Description too long').optional(),
});

const updateChannelSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().max(1000).optional(),
  isActive: z.boolean().optional(),
});

const createNoteSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  content: z.string().max(50000, 'Content too long').optional(),
});

const updateNoteSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(50000).optional(),
  isPublic: z.boolean().optional(),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  search: z.string().optional(),
});

export class ChannelController {
  // Create a new channel
  async createChannel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      // Check if user is a teacher
      if (req.user.role !== 'TEACHER' && req.user.role !== 'ADMIN') {
        throw createError('Only teachers can create channels', 403);
      }

      // Validate input
      const validationResult = createChannelSchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorMessage = validationResult.error.errors
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        throw createError(`Validation error: ${errorMessage}`, 400);
      }

      const data: CreateChannelData = validationResult.data;
      const channel = await channelService.createChannel(req.user.id, data);

      res.status(201).json({
        success: true,
        channel: {
          id: channel.id,
          title: channel.title,
          description: channel.description,
          teacherId: channel.teacherId,
          isActive: channel.isActive,
          notesCount: 0,
          createdAt: channel.createdAt.toISOString(),
          notes: [],
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // Get all channels with pagination
  async getChannels(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Validate query parameters
      const validationResult = paginationSchema.safeParse(req.query);
      if (!validationResult.success) {
        const errorMessage = validationResult.error.errors
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        throw createError(`Validation error: ${errorMessage}`, 400);
      }

      const { page, limit, search } = validationResult.data;
      const result = await channelService.getChannels(page, limit, search);

      res.status(200).json({
        success: true,
        channels: result.channels.map(channel => ({
          id: channel.id,
          title: channel.title,
          description: channel.description,
          teacherId: channel.teacherId,
          notesCount: channel.notes?.length || 0,
          createdAt: channel.createdAt.toISOString(),
          updatedAt: channel.updatedAt.toISOString(),
        })),
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  // Get channel by ID
  async getChannelById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { channelId } = req.params;
      
      if (!channelId) {
        throw createError('Channel ID is required', 400);
      }
      
      const channel = await channelService.getChannelById(channelId);

      res.status(200).json({
        success: true,
        channel: {
          id: channel.id,
          title: channel.title,
          description: channel.description,
          teacherId: channel.teacherId,
          isActive: channel.isActive,
          notesCount: channel.notes?.length || 0,
          notes: channel.notes.map((note: INote) => ({
            id: note._id.toString(),
            title: note.title,
            content: note.content ? note.content.substring(0, 200) + (note.content.length > 200 ? '...' : '') : null,
            hasFile: !!note.fileUrl,
            fileName: note.fileName,
            fileSize: note.fileSize,
            createdAt: note.createdAt.toISOString(),
          })),
          createdAt: channel.createdAt.toISOString(),
          updatedAt: channel.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // Update channel
  async updateChannel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const { channelId } = req.params;
      
      if (!channelId) {
        throw createError('Channel ID is required', 400);
      }

      // Validate input
      const validationResult = updateChannelSchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorMessage = validationResult.error.errors
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        throw createError(`Validation error: ${errorMessage}`, 400);
      }

      const data: UpdateChannelData = validationResult.data;
      const channel = await channelService.updateChannel(channelId, req.user.id, data);

      res.status(200).json({
        success: true,
        channel: {
          id: channel.id,
          title: channel.title,
          description: channel.description,
          isActive: channel.isActive,
          updatedAt: channel.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // Delete channel
  async deleteChannel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const { channelId } = req.params;
      
      if (!channelId) {
        throw createError('Channel ID is required', 400);
      }
      
      await channelService.deleteChannel(channelId, req.user.id);

      res.status(200).json({
        success: true,
        message: 'Channel deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  // Create note in channel
  async createNote(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const { channelId } = req.params;
      
      if (!channelId) {
        throw createError('Channel ID is required', 400);
      }

      // Validate input
      const validationResult = createNoteSchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorMessage = validationResult.error.errors
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        throw createError(`Validation error: ${errorMessage}`, 400);
      }

      const { title, content } = validationResult.data;

      // Prepare note data
      const noteData: CreateNoteData = {
        channelId,
        title,
        content,
      };

      // Handle file upload if present
      if (req.file) {
        const fileUrl = getFileUrl(req, req.file.path);
        noteData.fileInfo = {
          url: fileUrl,
          name: req.file.originalname,
          size: req.file.size,
          type: req.file.mimetype,
        };
      }

      const note = await channelService.createNote(req.user.id, noteData);

      res.status(201).json({
        success: true,
        note: {
          id: note._id.toString(),
          channelId: note.channelId.toString(),
          title: note.title,
          content: note.content,
          fileUrl: note.fileUrl,
          fileName: note.fileName,
          fileSize: note.fileSize,
          fileType: note.fileType,
          isPublic: note.isPublic,
          createdAt: note.createdAt.toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // Get note by ID
  async getNoteById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { channelId, noteId } = req.params;
      if (!channelId) {
        throw createError('Channel ID is required', 400);
      }
      if (!noteId) {
        throw createError('Note ID is required', 400);
      }
      const note = await channelService.getNoteById(channelId, noteId);

      res.status(200).json({
        success: true,
        note: {
          id: note._id.toString(),
          channelId: note.channelId.toString(),
          title: note.title,
          content: note.content,
          fileUrl: note.fileUrl,
          fileName: note.fileName,
          fileSize: note.fileSize,
          fileType: note.fileType,
          isPublic: note.isPublic,
          createdAt: note.createdAt.toISOString(),
          updatedAt: note.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // Update note
  async updateNote(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const { channelId, noteId } = req.params;
      if (!channelId) {
        throw createError('Channel ID is required', 400);
      }
      if (!noteId) {
        throw createError('Note ID is required', 400);
      }

      // Validate input
      const validationResult = updateNoteSchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorMessage = validationResult.error.errors
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        throw createError(`Validation error: ${errorMessage}`, 400);
      }

      const data: UpdateNoteData = validationResult.data;
      const note = await channelService.updateNote(channelId, noteId, req.user.id, data);

      res.status(200).json({
        success: true,
        note: {
          id: note._id.toString(),
          title: note.title,
          content: note.content,
          isPublic: note.isPublic,
          updatedAt: note.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // Delete note
  async deleteNote(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const { channelId, noteId } = req.params;
      if (!channelId) {
        throw createError('Channel ID is required', 400);
      }
      if (!noteId) {
        throw createError('Note ID is required', 400);
      }
      await channelService.deleteNote(channelId, noteId, req.user.id);

      res.status(200).json({
        success: true,
        message: 'Note deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  // Get teacher's own channels
  async getMyChannels(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      if (req.user.role !== 'TEACHER' && req.user.role !== 'ADMIN') {
        throw createError('Only teachers can access this endpoint', 403);
      }

      const channels = await channelService.getTeacherChannels(req.user.id);

      res.status(200).json({
        success: true,
        channels: channels.map(channel => ({
          id: channel.id,
          title: channel.title,
          description: channel.description,
          isActive: channel.isActive,
          notesCount: channel.notes?.length || 0,
          createdAt: channel.createdAt.toISOString(),
          updatedAt: channel.updatedAt.toISOString(),
        })),
      });
    } catch (error) {
      next(error);
    }
  }

  // Get notes for a channel with pagination
  async getChannelNotes(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { channelId } = req.params;
      if (!channelId) {
        throw createError('Channel ID is required', 400);
      }

      // Validate query parameters
      const validationResult = paginationSchema.safeParse(req.query);
      if (!validationResult.success) {
        const errorMessage = validationResult.error.errors
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        throw createError(`Validation error: ${errorMessage}`, 400);
      }

      const { page, limit } = validationResult.data;
      const result = await channelService.getChannelNotes(channelId, page, limit);

      res.status(200).json({
        success: true,
        notes: result.notes.map((note: INote) => ({
          id: note._id.toString(),
          title: note.title,
          content: note.content,
          fileUrl: note.fileUrl,
          fileName: note.fileName,
          fileSize: note.fileSize,
          fileType: note.fileType,
          createdAt: note.createdAt.toISOString(),
          updatedAt: note.updatedAt.toISOString(),
        })),
        pagination: {
          total: result.total,
          page: result.page,
          totalPages: result.totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

// Export singleton instance
export const channelController = new ChannelController();

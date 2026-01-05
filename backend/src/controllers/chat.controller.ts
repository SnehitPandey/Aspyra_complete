import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ChatMessage } from '../models/chatMessage.model.js';
import { Room } from '../models/room.model.js';
import { User } from '../models/user.model.js';
import { createError } from '../middleware/errorHandler.js';

// Validation schemas
const chatHistorySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  since: z.string().datetime().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export interface ChatHistoryResponse {
  messages: Array<{
    id: string;
    userId: string | null;
    username: string;
    content: string;
    type: 'TEXT' | 'SYSTEM' | 'EMOJI' | 'FILE';
    createdAt: string;
  }>;
  nextCursor?: string | null;  // Allow null
  prevCursor?: string | null;  // Allow null
  hasMore: boolean;
  totalCount?: number;
}

export class ChatController {
  // Get chat history for a room
  async getRoomMessages(
    req: Request,
    res: Response<ChatHistoryResponse>,
    next: NextFunction
  ): Promise<void> {
    try {
      const { roomId } = req.params;
      const query = chatHistorySchema.parse(req.query);

      // Verify room exists
      const room = await Room.findById(roomId);
      if (!room) throw createError('Room not found', 404);

      // Check if user has access (must be a member)
      if (!req.user) throw createError('Authentication required', 401);

      const isMember = room.members.some(
        (m: { userId: { toString: () => string } }) => m.userId.toString() === req.user!.id
      );
      if (!isMember) throw createError('Access denied: Not a member of the room', 403);

      // Build Mongo query
      const filter: any = { roomId };

      if (query.since) {
        filter.createdAt = { $gte: new Date(query.since) };
      }

      if (query.cursor) {
        filter._id = query.order === 'desc'
          ? { $lt: query.cursor }
          : { $gt: query.cursor };
      }

      // Fetch messages with user populated
      const messages = await ChatMessage.find(filter)
        .populate('userId', 'name')
        .sort({ createdAt: query.order === 'desc' ? -1 : 1 })
        .limit(query.limit + 1)
        .lean<Array<{
          _id: string;
          userId: { _id: string; name: string } | null;
          content: string;
          type: 'TEXT' | 'SYSTEM' | 'EMOJI' | 'FILE';
          createdAt: Date;
        }>>();

      const hasMore = messages.length > query.limit;
      if (hasMore) messages.pop();

      // Safe cursor calculation with optional chaining and null fallbacks
      let nextCursor: string | null = null;
      let prevCursor: string | null = null;

      if (messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        nextCursor = hasMore && lastMessage?._id
          ? lastMessage._id.toString() 
          : null;
        
        const firstMessage = messages[0];
        prevCursor = query.cursor && firstMessage?._id
          ? firstMessage._id.toString() 
          : null;
      }

      // Total message count in room
      const totalCount = await ChatMessage.countDocuments({ roomId });

      // Format response - fix username access with proper type checking
      const formattedMessages = messages.map((msg) => ({
        id: msg._id.toString(),
        userId: msg.userId?._id?.toString() ?? null,
        username: (msg.userId as any)?.name ?? 'System',  // Type assertion for populated field
        content: msg.content,
        type: msg.type as 'TEXT' | 'SYSTEM' | 'EMOJI' | 'FILE',
        createdAt: msg.createdAt.toISOString(),
      }));

      res.status(200).json({
        messages: formattedMessages,
        nextCursor,
        prevCursor,
        hasMore,
        totalCount,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(createError(`Validation error: ${error.errors.map(e => e.message).join(', ')}`, 400));
      }
      next(error);
    }
  }

  // Get message statistics for a room
  async getRoomMessageStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;

      // Verify room exists and user has access
      const room = await Room.findById(roomId);
      if (!room) throw createError('Room not found', 404);
      if (!req.user) throw createError('Authentication required', 401);

      const isMember = room.members.some(
        m => m.userId.toString() === req.user!.id
      );
      if (!isMember) throw createError('Access denied: Not a member of the room', 403);

      // Total messages count
      const totalMessages = await ChatMessage.countDocuments({ roomId });

      // Messages by type aggregation
      const messagesByType = await ChatMessage.aggregate([
        { $match: { roomId: room._id } },
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]);

      // Top 10 contributors aggregation
      const messagesByUser: Array<{ _id: string; count: number }> = await ChatMessage.aggregate([
        { $match: { roomId: room._id, userId: { $ne: null } } },
        { $group: { _id: '$userId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]);

      // Populate user names
      const userIds = messagesByUser.map((u: { _id: string }) => u._id);
      const users = await User.find({ _id: { $in: userIds } }, { name: 1 }).lean();
      const userMap = new Map(users.map(u => [u._id.toString(), u.name]));

      // Format top contributors
      const topContributors = messagesByUser.map(item => ({
        userId: item._id?.toString() || '',
        username: userMap.get(item._id.toString()) || 'Unknown',
        messageCount: item.count,
      }));

      res.status(200).json({
        totalMessages,
        messagesByType: messagesByType.map(item => ({
          type: item._id,
          count: item.count,
        })),
        topContributors,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const chatController = new ChatController();

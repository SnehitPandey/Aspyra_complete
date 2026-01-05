import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { shareService } from '../services/share.service.js';
import { roomService } from '../services/room.service.js';
import { createError } from '../middleware/errorHandler.js';
import { socketServiceInstance } from '../services/socket.instance.js';
import { notificationService } from '../services/notification.service.js';

const createSchema = z.object({
  ttlDays: z.number().int().min(1).max(365).optional(),
});

const redeemSchema = z.object({
  token: z.string().min(6),
});

export class ShareController {
  async createShare(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw createError('Authentication required', 401);
      const data = createSchema.parse(req.body || {});
      const ttl = data.ttlDays || 7;

      const link = await shareService.createShareLink(req.user.id, req.user.name, ttl);

      res.status(201).json({
        success: true,
        link: {
          token: link.token,
          url: `${req.protocol}://${req.get('host')}/connect/${link.token}`,
          expiresAt: link.expiresAt,
        }
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(createError(error.errors.map(e => e.message).join(', '), 400));
      }
      next(error);
    }
  }

  async redeemShare(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw createError('Authentication required', 401);
      const data = redeemSchema.parse(req.body);

      const link = await shareService.redeemLink(data.token, req.user.id);

      // Notify owner in real-time if they are connected via sockets
      try {
        if (socketServiceInstance) {
          
          // Get full user details for both partners
          const owner = await shareService.getPartner(req.user.id); // Gets the owner (now partner)
          
          // Check online status for both users
          const ownerIsOnline = socketServiceInstance.isUserOnline(String(link.ownerId));
          const redeemerIsOnline = socketServiceInstance.isUserOnline(req.user.id);
          
          // Get activity info for both users
          let ownerActivity: { studying: string | null; topicName: string | null } = { studying: null, topicName: null };
          let redeemerActivity: { studying: string | null; topicName: string | null } = { studying: null, topicName: null };
          
          try {
            const ownerActv = await roomService.getUserActivity(String(link.ownerId));
            if (ownerActv) ownerActivity = { studying: ownerActv.studying, topicName: ownerActv.topicName };
          } catch (e) { /* Activity not available */ }
          
          try {
            const redeemerActv = await roomService.getUserActivity(req.user.id);
            if (redeemerActv) redeemerActivity = { studying: redeemerActv.studying, topicName: redeemerActv.topicName };
          } catch (e) { /* Activity not available */ }
          
          // Get user avatars properly
          const { User } = await import('../models/user.model.js');
          const redeemerUser = await User.findById(req.user.id).lean();
          const ownerUser = owner ? await User.findById(owner._id).lean() : null;
          
          // Emit 'partnerConnected' to owner with redeemer's data
          socketServiceInstance.emitToUser(String(link.ownerId), 'partnerConnected', {
            id: req.user.id,
            name: req.user.name,
            email: req.user.email,
            username: redeemerUser?.username || null,
            avatarUrl: redeemerUser?.customAvatarURL || redeemerUser?.profilePic || redeemerUser?.avatarUrl,
            online: redeemerIsOnline,
            studying: redeemerActivity.studying,
            topicName: redeemerActivity.topicName,
          });
          
          // Emit 'partnerConnected' to redeemer with owner's data
          if (owner && ownerUser) {
            socketServiceInstance.emitToUser(req.user.id, 'partnerConnected', {
              id: String(owner._id),
              name: ownerUser.name,
              email: ownerUser.email,
              username: ownerUser.username || null,
              avatarUrl: ownerUser.customAvatarURL || ownerUser.profilePic || ownerUser.avatarUrl,
              online: ownerIsOnline,
              studying: ownerActivity.studying,
              topicName: ownerActivity.topicName,
            });
          }
          
          // Also emit legacy 'shareLinkRedeemed' for backward compatibility
          socketServiceInstance.emitToUser(String(link.ownerId), 'shareLinkRedeemed', {
            token: link.token,
            redeemedBy: req.user.id,
            redeemedByName: req.user.name,
            usedAt: link.usedAt,
          });
        }

        // Also create a stored notification for the owner
        await notificationService.createNotification({
          userId: String(link.ownerId),
          type: 'ROOM_INVITE',
          title: 'Study Partner Connected',
          message: `${req.user.name} connected using your study link`,
          payload: { token: link.token, redeemedBy: req.user.id }
        });
      } catch (emitErr) {
        console.warn('Failed to notify owner about redeemed link', emitErr);
      }

      res.status(200).json({
        success: true,
        message: 'Link redeemed',
        link: {
          token: link.token,
          ownerId: link.ownerId,
          ownerName: link.ownerName,
          usedAt: link.usedAt,
        }
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(createError(error.errors.map(e => e.message).join(', '), 400));
      }
      next(error);
    }
  }

  // Public GET to inspect link metadata
  async getLink(req: Request, res: Response, next: NextFunction) {
    try {
      const { token } = req.params;
      if (!token) throw createError('Token required', 400);
      const link = await shareService.getByToken(token);
      res.status(200).json({
        success: true,
        link: {
          token: link.token,
          ownerId: link.ownerId,
          ownerName: link.ownerName,
          used: link.used,
          expiresAt: link.expiresAt,
          createdAt: link.createdAt,
        }
      });
    } catch (error) {
      next(error);
    }
  }

  // GET /api/user/partner - Get current user's partner
  async getPartner(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw createError('Authentication required', 401);
      const partner = await shareService.getPartner(req.user.id);
      
      if (!partner) {
        res.status(200).json({ success: true, partner: null });
        return;
      }

      // Check if partner is currently online via socket connection
      const partnerId = String(partner._id);
      const isOnline = socketServiceInstance ? socketServiceInstance.isUserOnline(partnerId) : false;

      // Get partner's current activity from room service (if available)
      let studying: string | null = null;
      let topicName: string | null = null;
      try {
        const activity = await roomService.getUserActivity(String(partner._id));
        if (activity) {
          studying = activity.studying;
          topicName = activity.topicName;
        }
      } catch (activityError) {
        // Activity not available, that's okay
      }

      // Get full partner user data
      const { User } = await import('../models/user.model.js');
      const partnerUser = await User.findById(partner._id).lean();

      if (!partnerUser) {
        res.status(200).json({ success: true, partner: null });
        return;
      }

      res.status(200).json({
        success: true,
        partner: {
          id: partner._id,
          name: partnerUser.name,
          email: partnerUser.email,
          username: partnerUser.username || null,
          avatarUrl: partnerUser.customAvatarURL || partnerUser.profilePic || partnerUser.avatarUrl,
          isCustomAvatar: partnerUser.isCustomAvatar,
          online: isOnline,
          studying: studying,
          topicName: topicName,
        }
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  // POST /api/connect/remove - Disconnect from partner
  async removePartner(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw createError('Authentication required', 401);
      
      // Get partner BEFORE removing the connection
      const partner = await shareService.getPartner(req.user.id);
      
      // Remove the connection bidirectionally
      await shareService.removePartner(req.user.id);
      
      // Also ensure partner's partnerId is cleared (bidirectional cleanup)
      if (partner) {
        await shareService.removePartner(String(partner._id));
      }

      // Notify BOTH users in real-time with multiple event types
      if (partner && socketServiceInstance) {
        const partnerId = String(partner._id);
        
        // Emit to partner
        socketServiceInstance.emitToUser(partnerId, 'partnerDisconnected', {
          userId: req.user.id,
        });
        socketServiceInstance.emitToUser(partnerId, 'duo:update', {
          userId: req.user.id,
          removed: true,
          timestamp: new Date().toISOString(),
        });
        
        // Emit to current user (for multi-tab sync)
        socketServiceInstance.emitToUser(req.user.id, 'duo:update', {
          partnerId: partnerId,
          removed: true,
          timestamp: new Date().toISOString(),
        });
      }

      res.status(200).json({
        success: true,
        message: 'Partner disconnected',
        removedPartnerId: partner?._id,
      });
      return;
    } catch (error) {
      next(error);
    }
  }
}

export const shareController = new ShareController();

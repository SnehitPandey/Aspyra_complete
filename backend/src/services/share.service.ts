import { ShareLink } from '../models/shareLink.model.js';
import { User } from '../models/user.model.js';
import { Types } from 'mongoose';
import { createError } from '../middleware/errorHandler.js';

export class ShareService {
  // Create a share link for a user
  async createShareLink(ownerId: string, ownerName?: string, ttlDays = 7) {
    if (!Types.ObjectId.isValid(ownerId)) throw createError('Invalid owner id', 400);

    // Generate token
    const token = Math.random().toString(36).substring(2, 15);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ttlDays);

    const doc = await ShareLink.create({
      token,
      ownerId: new Types.ObjectId(ownerId),
      ownerName,
      expiresAt,
    });

    // Store the invite code on the user
    await User.findByIdAndUpdate(ownerId, { inviteCode: token });

    return doc;
  }

  // Get share link by token
  async getByToken(token: string) {
    if (!token) throw createError('Token is required', 400);
    const link = await ShareLink.findOne({ token });
    if (!link) throw createError('Link not found', 404);
    return link;
  }

  // Redeem a link for a user
  async redeemLink(token: string, userId: string) {
    if (!token) throw createError('Token is required', 400);
    if (!Types.ObjectId.isValid(userId)) throw createError('Invalid user id', 400);

    const link = await ShareLink.findOne({ token });
    if (!link) throw createError('Link not found', 404);

    if (link.used) throw createError('Link already used', 400);
    if (link.expiresAt && link.expiresAt < new Date()) throw createError('Link expired', 400);
    if (String(link.ownerId) === String(userId)) throw createError('Cannot redeem your own link', 400);

    // Check if either user already has a partner
    const owner = await User.findById(link.ownerId);
    const redeemer = await User.findById(userId);

    if (!owner) throw createError('Link owner not found', 404);
    if (!redeemer) throw createError('Redeemer not found', 404);

    if (owner.partnerId) throw createError('Link owner already has a study partner', 400);
    if (redeemer.partnerId) throw createError('You already have a study partner', 400);

    // Mark link as used
    link.used = true;
    link.usedBy = new Types.ObjectId(userId);
    link.usedAt = new Date();
    await link.save();

    // Set partnerId on both users (bidirectional connection)
    owner.partnerId = new Types.ObjectId(userId);
    owner.inviteCode = undefined; // Clear the invite code after use
    await owner.save();

    redeemer.partnerId = link.ownerId;
    await redeemer.save();

    return link;
  }

  // Remove partner connection
  async removePartner(userId: string) {
    if (!Types.ObjectId.isValid(userId)) throw createError('Invalid user id', 400);

    const user = await User.findById(userId);
    if (!user) throw createError('User not found', 404);
    if (!user.partnerId) throw createError('No partner to remove', 400);

    const partnerId = user.partnerId;
    const partner = await User.findById(partnerId);

    // Clear partnerId on both users
    user.partnerId = undefined;
    await user.save();

    if (partner) {
      partner.partnerId = undefined;
      await partner.save();
    }

    return { success: true };
  }

  // Get partner info for a user
  async getPartner(userId: string) {
    if (!Types.ObjectId.isValid(userId)) throw createError('Invalid user id', 400);

    const user = await User.findById(userId).populate('partnerId', 'name email profilePic customAvatarURL isCustomAvatar avatarUrl');
    if (!user) throw createError('User not found', 404);
    if (!user.partnerId) return null;

    return user.partnerId;
  }
}

export const shareService = new ShareService();

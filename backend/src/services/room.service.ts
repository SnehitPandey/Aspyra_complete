import { Types } from 'mongoose';
import { Room, IRoom, IRoomMember, IRoadmap } from '../models/room.model.js';
import { User } from '../models/user.model.js';
import { createError } from '../middleware/errorHandler.js';
import { connectToRedis } from '../config/redis.js';

export interface CreateRoomData {
  title: string;
  description?: string;
  tags?: string[];
  maxSeats?: number;
  durationDays?: number; // Duration in days to calculate endDate
}

export interface JoinRoomData {
  code: string;
}

export interface UpdateRoomData {
  title?: string;
  status?: 'WAITING' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  maxSeats?: number;
}

export class RoomService {
  private redis = connectToRedis();

  // Generate unique room code
  private generateRoomCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  // Create a new room
  async createRoom(hostId: string, data: CreateRoomData): Promise<IRoom> {
    if (!Types.ObjectId.isValid(hostId)) {
      throw createError('Invalid user ID', 400);
    }

    // Verify host exists
    const host = await User.findById(hostId);
    if (!host) {
      throw createError('User not found', 404);
    }

    // Check room limit for free users (5 rooms max)
    const userRoomCount = await Room.countDocuments({
      'members.userId': new Types.ObjectId(hostId),
      status: { $ne: 'COMPLETED' }
    });

    if (userRoomCount >= 5) {
      throw createError('Free plan limit reached. You can join or create a maximum of 5 rooms. Upgrade to join more rooms.', 403);
    }

    // Generate unique code
    let code = this.generateRoomCode();
    let attempts = 0;
    
    while (attempts < 10) {
      const existing = await Room.findOne({ code });
      if (!existing) break;
      code = this.generateRoomCode();
      attempts++;
    }

    if (attempts === 10) {
      throw createError('Failed to generate unique room code', 500);
    }

    // Calculate endDate if durationDays provided
    const startDate = new Date();
    let endDate: Date | undefined;
    if (data.durationDays && data.durationDays > 0) {
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + data.durationDays);
    }

    // Create room with host as first member
    const room = new Room({
      code,
      hostId: new Types.ObjectId(hostId),
      title: data.title,
      description: data.description,
      tags: data.tags || [],
      maxSeats: data.maxSeats || 8,
      startDate,
      endDate,
      members: [{
        userId: new Types.ObjectId(hostId),
        role: 'HOST',
        ready: false,
        joinedAt: new Date(),
        progress: {
          currentPhase: 0,
          currentMilestone: 0,
          completedMilestones: [],
          lastActivity: new Date(),
        },
      }],
    });

    await room.save();

    // Populate host information
    await room.populate('hostId', 'name email');
    await room.populate('members.userId', 'name email');

    // Initialize presence in Redis
    await this.redis.hset(`room:${room._id}:presence`, hostId, JSON.stringify({
      id: hostId,
      name: host.name,
      ready: false,
      isOnline: true,
    }));

    return room;
  }

  // Join room by code
  async joinRoom(userId: string, data: JoinRoomData): Promise<IRoom> {
    if (!Types.ObjectId.isValid(userId)) {
      throw createError('Invalid user ID', 400);
    }

    // Check room limit for free users (5 rooms max)
    const userRoomCount = await Room.countDocuments({
      'members.userId': new Types.ObjectId(userId),
      status: { $ne: 'COMPLETED' }
    });

    if (userRoomCount >= 5) {
      throw createError('Free plan limit reached. You can join or create a maximum of 5 rooms. Upgrade to join more rooms.', 403);
    }

    // Find room by code
    const room = await Room.findOne({ code: data.code })
      .populate('hostId', 'name email')
      .populate('members.userId', 'name email');

    if (!room) {
      throw createError('Room not found', 404);
    }

    // Validation checks
    if (room.status === 'COMPLETED') {
      throw createError('Room is completed', 400);
    }

    if (room.members.length >= room.maxSeats) {
      throw createError('Room is full', 400);
    }

    // Check if user is already a member
    const existingMember = room.members.find(member => 
      member.userId._id.toString() === userId
    );

    if (existingMember) {
      throw createError('Already a member of this room', 400);
    }

    // Get user info
    const user = await User.findById(userId);
    if (!user) {
      throw createError('User not found', 404);
    }

    // Add user to room
    room.members.push({
      userId: new Types.ObjectId(userId),
      role: 'MEMBER',
      ready: false,
      joinedAt: new Date(),
    } as IRoomMember);

    await room.save();

    // Update Redis presence
    await this.redis.hset(`room:${room._id}:presence`, userId, JSON.stringify({
      id: userId,
      name: user.name,
      ready: false,
      isOnline: true,
    }));

    // Re-populate after save
    await room.populate('members.userId', 'name email');

    return room;
  }

  // Get room by ID
  async getRoomById(roomId: string, userId: string): Promise<IRoom> {
    if (!Types.ObjectId.isValid(roomId) || !Types.ObjectId.isValid(userId)) {
      throw createError('Invalid ID format', 400);
    }

    const room = await Room.findById(roomId)
      .populate('hostId', 'name email')
      .populate('members.userId', 'name email');

    if (!room) {
      throw createError('Room not found', 404);
    }

    // Check if user is a member
    const isMember = room.members.some(member => 
      member.userId._id.toString() === userId
    );

    if (!isMember) {
      throw createError('Access denied - not a room member', 403);
    }

    return room;
  }

  // Update room
  async updateRoom(roomId: string, hostId: string, data: UpdateRoomData): Promise<IRoom> {
    if (!Types.ObjectId.isValid(roomId) || !Types.ObjectId.isValid(hostId)) {
      throw createError('Invalid ID format', 400);
    }

    const room = await Room.findOneAndUpdate(
      { _id: roomId, hostId: new Types.ObjectId(hostId) },
      { $set: data },
      { new: true }
    )
      .populate('hostId', 'name email')
      .populate('members.userId', 'name email');

    if (!room) {
      throw createError('Room not found or access denied', 404);
    }

    return room;
  }

  // Leave room
  async leaveRoom(roomId: string, userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(roomId) || !Types.ObjectId.isValid(userId)) {
      throw createError('Invalid ID format', 400);
    }

    const room = await Room.findById(roomId);
    if (!room) {
      throw createError('Room not found', 404);
    }

    // Remove member from room
    room.members = room.members.filter(member => 
      member.userId.toString() !== userId
    );

    // If host leaves and there are other members, transfer host to first member
    if (room.hostId.toString() === userId && room.members.length > 0) {
      const firstMember = room.members[0];
      if (firstMember) {
        room.hostId = firstMember.userId;
        firstMember.role = 'HOST';
      }
    }

    // If no members left, delete the room entirely
    if (room.members.length === 0) {
      console.log(`🗑️ Room ${roomId} has no members left, deleting room...`);
      
      // Clean up Redis presence data
      await this.redis.del(`room:${roomId}:presence`);
      
      // Delete the room from database
      await Room.findByIdAndDelete(roomId);
      
      console.log(`✅ Room ${roomId} deleted successfully`);
      return; // Exit early, no need to save
    }

    await room.save();

    // Remove from Redis presence
    await this.redis.hdel(`room:${roomId}:presence`, userId);
  }

  // Update user ready status
  async toggleReady(roomId: string, userId: string): Promise<IRoom> {
    if (!Types.ObjectId.isValid(roomId) || !Types.ObjectId.isValid(userId)) {
      throw createError('Invalid ID format', 400);
    }

    const room = await Room.findById(roomId)
      .populate('hostId', 'name email')
      .populate('members.userId', 'name email');

    if (!room) {
      throw createError('Room not found', 404);
    }

    // Find member and toggle ready status
    const member = room.members.find(m => m.userId._id.toString() === userId);
    if (!member) {
      throw createError('Not a member of this room', 403);
    }

    member.ready = !member.ready;
    
    // Check if all members are ready - status will be auto-calculated on save
    // Note: Status is now auto-managed by the model's pre-save hook
    
    await room.save();

    // Update Redis presence
    const user = await User.findById(userId);
    await this.redis.hset(`room:${roomId}:presence`, userId, JSON.stringify({
      id: userId,
      name: user?.name,
      ready: member.ready,
      isOnline: true,
    }));

    return room;
  }

  // Get room presence from Redis
  async getRoomPresence(roomId: string): Promise<any[]> {
    const presence = await this.redis.hgetall(`room:${roomId}:presence`);
    return Object.values(presence).map(data => JSON.parse(data));
  }

  // Update user online status
  async updateUserOnlineStatus(roomId: string, userId: string, isOnline: boolean): Promise<void> {
    const presenceData = await this.redis.hget(`room:${roomId}:presence`, userId);
    if (presenceData) {
      const parsed = JSON.parse(presenceData);
      parsed.isOnline = isOnline;
      await this.redis.hset(`room:${roomId}:presence`, userId, JSON.stringify(parsed));
    }
  }

  // Update user activity (what they're currently studying)
  async updateUserActivity(userId: string, activity: { studying: string | null; topicName: string | null }): Promise<void> {
    const activityData = {
      ...activity,
      lastUpdated: new Date().toISOString()
    };
    await this.redis.hset(`user:${userId}:activity`, 'current', JSON.stringify(activityData));
    await this.redis.expire(`user:${userId}:activity`, 3600); // Expire after 1 hour of inactivity
  }

  // Get user activity
  async getUserActivity(userId: string): Promise<{ studying: string | null; topicName: string | null; lastUpdated: string } | null> {
    const activityData = await this.redis.hget(`user:${userId}:activity`, 'current');
    if (activityData) {
      return JSON.parse(activityData);
    }
    return null;
  }

  // Get multiple users' activities (for Study Duo)
  async getUsersActivities(userIds: string[]): Promise<Record<string, { studying: string | null; topicName: string | null; isOnline: boolean }>> {
    const activities: Record<string, { studying: string | null; topicName: string | null; isOnline: boolean }> = {};
    
    for (const userId of userIds) {
      const activity = await this.getUserActivity(userId);
      activities[userId] = {
        studying: activity?.studying || null,
        topicName: activity?.topicName || null,
        isOnline: !!activity // User is considered online if they have recent activity
      };
    }
    
    return activities;
  }

  // Get user's rooms
  async getUserRooms(userId: string): Promise<IRoom[]> {
    if (!Types.ObjectId.isValid(userId)) {
      throw createError('Invalid user ID', 400);
    }

    return await Room.find({
      'members.userId': new Types.ObjectId(userId),
      status: { $ne: 'COMPLETED' }  // Exclude completed rooms
    })
      .populate('hostId', 'name email')
      .populate('members.userId', 'name email')
      .sort({ updatedAt: -1 });
  }

  // Get user's room count (for limit checking)
  async getUserRoomCount(userId: string): Promise<number> {
    if (!Types.ObjectId.isValid(userId)) {
      throw createError('Invalid user ID', 400);
    }

    return await Room.countDocuments({
      'members.userId': new Types.ObjectId(userId),
      status: { $ne: 'COMPLETED' }  // Exclude completed rooms
    });
  }

  // Update room roadmap
  async updateRoomRoadmap(roomId: string, roadmap: IRoadmap): Promise<IRoom> {
    console.log('📍 [updateRoomRoadmap CALLED]', { roomId });
    
    if (!Types.ObjectId.isValid(roomId)) {
      throw createError('Invalid room ID', 400);
    }

    // Get the room first to check start and end dates
    const existingRoom = await Room.findById(roomId);
    if (!existingRoom) {
      throw createError('Room not found', 404);
    }
    
    console.log('   Room found:', existingRoom.title);
    console.log('   Has startDate:', !!existingRoom.startDate);
    console.log('   Has endDate:', !!existingRoom.endDate);

    // Apply timeline distribution if room has start and end dates
    if (existingRoom.startDate && existingRoom.endDate && roadmap.phases) {
      const startDate = new Date(existingRoom.startDate);
      const endDate = new Date(existingRoom.endDate);
      const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      
      console.log('🔧 [TIMELINE DISTRIBUTION]');
      console.log('  Room:', existingRoom.title);
      console.log('  Start Date:', startDate.toISOString());
      console.log('  End Date:', endDate.toISOString());
      console.log('  Total Days:', totalDays);

      // Distribute milestones across the timeline
      let currentDate = new Date(startDate);
      const allMilestones = roadmap.phases.flatMap(phase => phase.milestones);
      
      // Calculate total weight (use estimatedHours or equal distribution)
      const totalWeight = allMilestones.reduce((sum, m) => sum + (m.estimatedHours || 1), 0);
      
      let milestoneIndex = 0;
      for (const phase of roadmap.phases) {
        for (const milestone of phase.milestones) {
          const weight = milestone.estimatedHours || 1;
          const durationDays = Math.max(1, Math.round((weight / totalWeight) * totalDays));
          
          milestone.startDate = new Date(currentDate);
          milestone.durationDays = durationDays;
          currentDate.setDate(currentDate.getDate() + durationDays);
          milestone.endDate = new Date(currentDate);
          
          // Initialize completedTopics if not set
          if (typeof milestone.completedTopics !== 'number') {
            milestone.completedTopics = 0;
          }
          
          milestoneIndex++;
        }
      }
      
      // Adjust last milestone to match exact end date
      if (allMilestones.length > 0) {
        const lastMilestone = allMilestones[allMilestones.length - 1];
        if (lastMilestone && lastMilestone.startDate) {
          lastMilestone.endDate = new Date(endDate);
          const lastDuration = Math.ceil((endDate.getTime() - new Date(lastMilestone.startDate).getTime()) / (1000 * 60 * 60 * 24));
          lastMilestone.durationDays = Math.max(1, lastDuration);
        }
      }
      
      console.log('  ✅ Timeline distribution applied to', allMilestones.length, 'milestones');
    } else {
      console.log('⚠️ [TIMELINE DISTRIBUTION SKIPPED]');
      console.log('  Has startDate:', !!existingRoom.startDate);
      console.log('  Has endDate:', !!existingRoom.endDate);
      console.log('  Has phases:', !!roadmap.phases);
    }

    const room = await Room.findByIdAndUpdate(
      roomId,
      { roadmap },
      { new: true, runValidators: true }
    )
      .populate('hostId', 'name email')
      .populate('members.userId', 'name email');

    if (!room) {
      throw createError('Room not found', 404);
    }

    return room;
  }

  // Update member progress
  async updateMemberProgress(
    roomId: string,
    userId: string,
    progress: {
      currentPhase?: number;
      currentMilestone?: number;
      completedMilestones?: string[];
    }
  ): Promise<IRoom> {
    if (!Types.ObjectId.isValid(roomId) || !Types.ObjectId.isValid(userId)) {
      throw createError('Invalid ID', 400);
    }

    const room = await Room.findById(roomId);
    if (!room) {
      throw createError('Room not found', 404);
    }

    const member = room.members.find(m => m.userId.toString() === userId);
    if (!member) {
      throw createError('Not a member of this room', 403);
    }

    // Update progress
    if (!member.progress) {
      member.progress = {
        currentPhase: 0,
        currentMilestone: 0,
        completedMilestones: [],
        lastActivity: new Date(),
        progressPercentage: 0, // Initialize with 0%
      };
    }

    if (progress.currentPhase !== undefined) {
      member.progress.currentPhase = progress.currentPhase;
    }
    if (progress.currentMilestone !== undefined) {
      member.progress.currentMilestone = progress.currentMilestone;
    }
    if (progress.completedMilestones) {
      member.progress.completedMilestones = progress.completedMilestones;
      
      // Calculate progress percentage based on completed milestones
      if (room.roadmap) {
        const totalMilestones = room.roadmap.phases.reduce(
          (sum: number, phase: any) => sum + phase.milestones.length,
          0
        );
        member.progress.progressPercentage = totalMilestones > 0
          ? Math.round((progress.completedMilestones.length / totalMilestones) * 100)
          : 0;
      }
    }
    member.progress.lastActivity = new Date();
    
    // Update member's lastActive timestamp
    member.lastActive = new Date();

    await room.save();
    await room.populate('hostId', 'name email');
    await room.populate('members.userId', 'name email');

    return room;
  }

  // Get user's study topics categorized by room status
  async getUserStudyTopics(userId: string): Promise<{ ongoing: string[]; completed: string[] }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw createError('Invalid user ID', 400);
    }

    // Fetch ALL user's rooms (including completed ones)
    const rooms = await Room.find({
      'members.userId': new Types.ObjectId(userId),
    });

    const ongoingTopics = new Set<string>();
    const completedTopics = new Set<string>();

    // Categorize topics by room status
    rooms.forEach(room => {
      const tags = room.tags || [];
      
      if (room.status === 'ONGOING' || room.status === 'PREPARING') {
        tags.forEach(tag => ongoingTopics.add(tag));
      } else if (room.status === 'COMPLETED') {
        tags.forEach(tag => completedTopics.add(tag));
      }
    });

    return {
      ongoing: Array.from(ongoingTopics),
      completed: Array.from(completedTopics),
    };
  }

  // Get public rooms (for join room page)
  async getPublicRooms(userId?: string): Promise<any[]> {
    try {
      // Find rooms that are PREPARING or ONGOING and not full
      const rooms = await Room.find({
        status: { $in: ['PREPARING', 'ONGOING'] },
        // Exclude rooms that are full
        $expr: { $lt: [{ $size: '$members' }, '$maxSeats'] },
      })
        .populate('hostId', 'name username avatarUrl profilePic customAvatarURL isCustomAvatar')
        .populate('members.userId', 'name username avatarUrl profilePic customAvatarURL isCustomAvatar')
        .sort({ createdAt: -1 }) // Most recent first
        .limit(50) // Limit to 50 rooms
        .lean();

      // Filter out rooms the user is already a member of
      const publicRooms = rooms.map((room: any) => {
        const isMember = userId ? room.members.some((m: any) => m.userId._id.toString() === userId) : false;
        
        // Calculate avatar URL for host
        const host = room.hostId;
        let hostAvatarUrl = null;
        if (host) {
          if (host.isCustomAvatar && host.customAvatarURL) {
            hostAvatarUrl = host.customAvatarURL;
          } else if (host.profilePic) {
            hostAvatarUrl = host.profilePic;
          } else if (host.avatarUrl) {
            hostAvatarUrl = host.avatarUrl;
          }
        }

        return {
          id: room._id.toString(),
          code: room.code,
          title: room.title,
          description: room.description || '',
          tags: room.tags || [],
          status: room.status,
          maxSeats: room.maxSeats,
          currentMembers: room.members.length,
          availableSeats: room.maxSeats - room.members.length,
          host: {
            id: host?._id?.toString() || '',
            name: host?.name || 'Unknown',
            username: host?.username || null,
            avatarUrl: hostAvatarUrl,
          },
          startDate: room.startDate,
          endDate: room.endDate,
          createdAt: room.createdAt,
          isMember, // Flag to show if current user is already in this room
        };
      }).filter((room: any) => !room.isMember); // Only return rooms user hasn't joined

      return publicRooms;
    } catch (error: any) {
      console.error('Error fetching public rooms:', error);
      throw new Error('Failed to fetch public rooms');
    }
  }

  // ✨ NEW: Update topic completion status
  async updateTopicStatus(
    roomId: string,
    userId: string,
    milestoneId: string,
    topicTitle: string,
    status: 'pending' | 'in-progress' | 'completed'
  ): Promise<IRoom> {
    if (!Types.ObjectId.isValid(roomId) || !Types.ObjectId.isValid(userId)) {
      throw createError('Invalid room or user ID', 400);
    }

    const room = await Room.findById(roomId);
    if (!room) {
      throw createError('Room not found', 404);
    }

    // Check if user is member
    const isMember = room.members.some(
      (m) => m.userId.toString() === userId
    );
    if (!isMember) {
      throw createError('User is not a member of this room', 403);
    }

    // Find and update topic status
    let topicFound = false;
    let milestoneComplete = false;

    if (room.roadmap?.phases) {
      for (const phase of room.roadmap.phases) {
        for (const milestone of phase.milestones) {
          if (milestone.id === milestoneId) {
            // Update topic status
            milestone.topics = milestone.topics.map((topic: any) => {
              if (typeof topic === 'string') {
                if (topic === topicTitle) {
                  topicFound = true;
                  return { title: topic, status, description: '' };
                }
                return { title: topic, status: 'pending', description: '' };
              } else {
                if (topic.title === topicTitle) {
                  topicFound = true;
                  return { ...topic, status };
                }
                return topic;
              }
            });

            // Calculate completed topics count
            const completedCount = milestone.topics.filter(
              (t: any) => (typeof t === 'object' ? t.status === 'completed' : false)
            ).length;
            milestone.completedTopics = completedCount;

            // Check if all topics completed
            if (completedCount === milestone.topics.length) {
              milestone.completed = true;
              milestoneComplete = true;
            }
          }
        }
      }
    }

    if (!topicFound) {
      throw createError('Topic not found in milestone', 404);
    }

    await room.save();

    // If milestone completed, emit socket event (optional)
    if (milestoneComplete) {
      // TODO: Emit socket event for milestone completion
      console.log(`Milestone ${milestoneId} completed in room ${roomId}`);
    }

    return room;
  }

  // ✨ NEW: Get active milestone for a room
  async getActiveMilestone(roomId: string, userId: string): Promise<any> {
    if (!Types.ObjectId.isValid(roomId) || !Types.ObjectId.isValid(userId)) {
      throw createError('Invalid room or user ID', 400);
    }

    const room = await Room.findById(roomId);
    if (!room) {
      throw createError('Room not found', 404);
    }

    // Check if user is member
    const isMember = room.members.some(
      (m) => m.userId.toString() === userId
    );
    if (!isMember) {
      throw createError('User is not a member of this room', 403);
    }

    // Find active milestone using task generator
    const { findActiveMilestone, getMilestoneProgress } = await import('./taskGenerator.service.js');
    
    let allMilestones: any[] = [];
    if (room.roadmap?.phases) {
      room.roadmap.phases.forEach((phase) => {
        allMilestones = allMilestones.concat(phase.milestones);
      });
    }

    const activeMilestone = findActiveMilestone(allMilestones);
    
    if (!activeMilestone) {
      return null;
    }

    const progress = getMilestoneProgress(activeMilestone);

    return {
      ...activeMilestone,
      progress,
      roomId: room._id.toString(),
      roomName: room.title,
    };
  }

  /**
   * Mark a topic as complete and recalculate overall room progress
   */
  async completeTopicAndRecalculateProgress(
    roomId: string,
    milestoneId: string,
    topicIndex: number,
    userId: string
  ) {
    const room = await Room.findById(roomId);
    
    if (!room) {
      throw new Error('Room not found');
    }

    // Verify user is a member of the room
    const isMember = room.members.some(
      (member) => member.userId.toString() === userId
    );
    
    if (!isMember) {
      throw new Error('You are not a member of this room');
    }

    // Find the milestone in the roadmap
    // ✨ Support both ObjectId format and "p0m1" position format
    let targetMilestone: any = null;
    let milestoneFound = false;

    if (room.roadmap && room.roadmap.phases) {
      // Check if milestoneId is in "p0m1" format (phaseIndex-milestoneIndex)
      const positionMatch = milestoneId.match(/^p(\d+)m(\d+)$/);
      
      if (positionMatch && positionMatch[1] && positionMatch[2]) {
        // ✨ Use array indices to find milestone
        const phaseIndex = parseInt(positionMatch[1], 10);
        const milestoneIndex = parseInt(positionMatch[2], 10);
        
        if (phaseIndex < room.roadmap.phases.length) {
          const phase = room.roadmap.phases[phaseIndex];
          if (phase && phase.milestones && milestoneIndex < phase.milestones.length) {
            targetMilestone = phase.milestones[milestoneIndex];
            milestoneFound = true;
          }
        }
      } else {
        // Fallback: Try to find by MongoDB _id (for backward compatibility)
        for (const phase of room.roadmap.phases) {
          if (phase.milestones && Array.isArray(phase.milestones)) {
            const milestone = phase.milestones.find(
              (m: any) => m._id?.toString() === milestoneId
            );
            if (milestone) {
              targetMilestone = milestone;
              milestoneFound = true;
              break;
            }
          }
        }
      }
    }

    if (!milestoneFound || !targetMilestone) {
      throw new Error('Milestone not found in roadmap');
    }

    // Validate topic index
    if (!targetMilestone.topics || topicIndex < 0 || topicIndex >= targetMilestone.topics.length) {
      throw new Error('Invalid topic index');
    }

    // Mark topic as completed
    const topic = targetMilestone.topics[topicIndex];
    
    // Check if topic is already completed
    let wasAlreadyCompleted = false;
    if (typeof topic === 'object' && topic !== null && topic.status === 'completed') {
      wasAlreadyCompleted = true;
    }
    
    // Handle both string and object topics
    if (typeof topic === 'string') {
      // Convert string to object format
      targetMilestone.topics[topicIndex] = {
        title: topic,
        status: 'completed',
        description: '',
        estimatedHours: 0,
      };
    } else if (typeof topic === 'object' && topic !== null) {
      topic.status = 'completed';
    }

    // Increment completed topics counter only if not already completed
    if (!wasAlreadyCompleted) {
      if (typeof targetMilestone.completedTopics === 'number') {
        targetMilestone.completedTopics += 1;
      } else {
        targetMilestone.completedTopics = 1;
      }
    }

    // Calculate overall progress across all milestones
    let totalTopics = 0;
    let totalCompleted = 0;

    if (room.roadmap && room.roadmap.phases) {
      for (const phase of room.roadmap.phases) {
        if (phase.milestones && Array.isArray(phase.milestones)) {
          for (const milestone of phase.milestones) {
            if (milestone.topics && Array.isArray(milestone.topics)) {
              totalTopics += milestone.topics.length;
              
              // Count completed topics
              for (const t of milestone.topics) {
                if (typeof t === 'object' && t !== null && t.status === 'completed') {
                  totalCompleted += 1;
                }
              }
            }
          }
        }
      }
    }

    // Calculate progress percentage
    const progressPercentage = totalTopics > 0 ? Math.round((totalCompleted / totalTopics) * 100) : 0;

    // Update member progress for the user
    const memberIndex = room.members.findIndex(
      (member) => member.userId.toString() === userId
    );
    
    if (memberIndex !== -1) {
      const member = room.members[memberIndex];
      if (member && member.progress) {
        member.progress.progressPercentage = progressPercentage;
        member.lastActive = new Date();
      }
    }

    // Recalculate average progress
    const totalProgress = room.members.reduce(
      (sum, member) => sum + (member.progress?.progressPercentage || 0),
      0
    );
    if (room.progressData) {
      room.progressData.averageProgress = Math.round(totalProgress / room.members.length);
    }

    // Mark the roadmap as modified to ensure MongoDB saves nested changes
    room.markModified('roadmap');
    room.markModified('members');

    // Save the updated room
    await room.save();

    return room;
  }

  /**
   * Fix old rooms that don't have milestone dates
   */
  async fixOldRoomDates(roomId: string, userId: string) {
    if (!Types.ObjectId.isValid(roomId)) {
      throw createError('Invalid room ID', 400);
    }

    const room = await Room.findById(roomId);
    if (!room) {
      throw createError('Room not found', 404);
    }

    // Verify user is a member
    const isMember = room.members.some(m => m.userId.toString() === userId);
    if (!isMember) {
      throw createError('You are not a member of this room', 403);
    }

    if (!room.roadmap || !room.roadmap.phases) {
      throw createError('Room has no roadmap', 400);
    }

    // Calculate total days from room dates
    const startDate = room.startDate ? new Date(room.startDate) : new Date();
    const endDate = room.endDate || new Date(startDate.getTime() + (180 * 24 * 60 * 60 * 1000));
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    // Collect all milestones
    const allMilestones: any[] = [];
    room.roadmap.phases.forEach(phase => {
      if (phase.milestones && Array.isArray(phase.milestones)) {
        phase.milestones.forEach(m => allMilestones.push(m));
      }
    });

    // Calculate total weight
    const totalWeight = allMilestones.reduce((sum, m) => sum + (m.estimatedHours || 1), 0);

    // Distribute dates
    let currentDate = new Date(startDate);
    allMilestones.forEach((milestone) => {
      const weight = milestone.estimatedHours || 1;
      const durationDays = Math.max(1, Math.round((weight / totalWeight) * totalDays));

      milestone.startDate = new Date(currentDate);
      milestone.durationDays = durationDays;
      currentDate.setDate(currentDate.getDate() + durationDays);
      milestone.endDate = new Date(currentDate);

      // Initialize completedTopics
      if (typeof milestone.completedTopics !== 'number') {
        milestone.completedTopics = 0;
      }
    });

    // Adjust last milestone
    if (allMilestones.length > 0) {
      const lastMilestone = allMilestones[allMilestones.length - 1];
      lastMilestone.endDate = new Date(endDate);
      const lastDuration = Math.ceil((endDate.getTime() - new Date(lastMilestone.startDate).getTime()) / (1000 * 60 * 60 * 24));
      lastMilestone.durationDays = Math.max(1, lastDuration);
    }

    // Mark modified and save
    room.markModified('roadmap');
    await room.save();

    return room;
  }
}

// Export singleton instance
export const roomService = new RoomService();

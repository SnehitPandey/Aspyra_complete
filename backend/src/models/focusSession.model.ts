// backend/src/models/focusSession.model.ts
/**
 * Focus Session Model
 * Tracks active study sessions for timer persistence and cross-device sync
 */

import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IFocusSession extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  roomId: Types.ObjectId;
  topicId: string;
  topicTitle: string;
  milestoneId?: string;
  startedAt: Date;
  lastPulseAt: Date;
  endedAt?: Date;
  elapsedTime: number; // seconds
  isRunning: boolean;
  deviceId: string;
  pausedAt?: Date;
  pausedDuration: number; // seconds spent paused
  createdAt: Date;
  updatedAt: Date;
  getCurrentElapsedTime(): number;
}

export interface IFocusSessionModel extends mongoose.Model<IFocusSession> {
  findActiveSession(
    userId: string | Types.ObjectId,
    roomId: string | Types.ObjectId
  ): Promise<IFocusSession | null>;
  cleanupStaleSessions(): Promise<number>;
}

const focusSessionSchema = new Schema<IFocusSession>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    roomId: {
      type: Schema.Types.ObjectId,
      ref: 'Room',
      required: true,
      index: true,
    },
    topicId: {
      type: String,
      required: true,
    },
    topicTitle: {
      type: String,
      required: true,
    },
    milestoneId: {
      type: String,
    },
    startedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    lastPulseAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    endedAt: {
      type: Date,
    },
    elapsedTime: {
      type: Number,
      default: 0,
      min: 0,
    },
    isRunning: {
      type: Boolean,
      default: true,
    },
    deviceId: {
      type: String,
      required: true,
    },
    pausedAt: {
      type: Date,
    },
    pausedDuration: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for efficient queries
focusSessionSchema.index({ userId: 1, roomId: 1, isRunning: 1 });
focusSessionSchema.index({ lastPulseAt: 1, isRunning: 1 }); // For cleanup of stale sessions

// Instance method to calculate current elapsed time
focusSessionSchema.methods.getCurrentElapsedTime = function(): number {
  if (!this.isRunning) {
    return this.elapsedTime;
  }

  const now = new Date();
  const lastPulse = new Date(this.lastPulseAt);
  const timeSinceLastPulse = Math.floor((now.getTime() - lastPulse.getTime()) / 1000);
  
  return this.elapsedTime + timeSinceLastPulse;
};

// Static method to find active session for user in room
focusSessionSchema.statics.findActiveSession = async function(
  userId: string | Types.ObjectId,
  roomId: string | Types.ObjectId
): Promise<IFocusSession | null> {
  return this.findOne({
    userId: new Types.ObjectId(userId.toString()),
    roomId: new Types.ObjectId(roomId.toString()),
    isRunning: true,
  }).sort({ lastPulseAt: -1 });
};

// Static method to cleanup stale sessions (no pulse for 30+ minutes)
focusSessionSchema.statics.cleanupStaleSessions = async function(): Promise<number> {
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  
  const result = await this.updateMany(
    {
      isRunning: true,
      lastPulseAt: { $lt: thirtyMinutesAgo },
    },
    {
      $set: {
        isRunning: false,
        endedAt: new Date(),
      },
    }
  );
  
  return result.modifiedCount || 0;
};

export const FocusSession = mongoose.model<IFocusSession, IFocusSessionModel>('FocusSession', focusSessionSchema);

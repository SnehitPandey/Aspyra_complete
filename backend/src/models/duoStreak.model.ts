import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IDuoStreak extends Document {
  user1Id: Types.ObjectId;
  user2Id: Types.ObjectId;
  streak: number;
  lastCompletedDate: string | null; // ISO date string (YYYY-MM-DD)
  calendar: Map<string, 'completed' | 'missed'>; // date -> status
  createdAt: Date;
  updatedAt: Date;
  // Methods
  includesUser(userId: string): boolean;
  getPartnerId(userId: string): Types.ObjectId | null;
}

const duoStreakSchema = new Schema<IDuoStreak>(
  {
    user1Id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    user2Id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    streak: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastCompletedDate: {
      type: String,
      default: null,
    },
    calendar: {
      type: Map,
      of: String,
      default: new Map(),
    },
  },
  {
    timestamps: true,
  }
);

// Compound index to ensure one streak document per duo pair (bidirectional)
duoStreakSchema.index({ user1Id: 1, user2Id: 1 }, { unique: true });

// Helper method to check if a user is part of this duo
duoStreakSchema.methods.includesUser = function (userId: string): boolean {
  const id = new Types.ObjectId(userId);
  return this.user1Id.equals(id) || this.user2Id.equals(id);
};

// Helper method to get partner ID
duoStreakSchema.methods.getPartnerId = function (userId: string): Types.ObjectId | null {
  const id = new Types.ObjectId(userId);
  if (this.user1Id.equals(id)) return this.user2Id;
  if (this.user2Id.equals(id)) return this.user1Id;
  return null;
};

const DuoStreak = mongoose.model<IDuoStreak>('DuoStreak', duoStreakSchema);

export default DuoStreak;

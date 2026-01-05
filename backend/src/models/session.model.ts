import { Schema, model, Document, Types } from 'mongoose';

export interface ISession extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  refreshTokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

const sessionSchema = new Schema<ISession>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  refreshTokenHash: {
    type: String,
    required: true,
    unique: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    expires: 0, // TTL index - automatically delete when expired
  },
}, {
  timestamps: { createdAt: true, updatedAt: false },
});

// Indexes
sessionSchema.index({ userId: 1 });
sessionSchema.index({ refreshTokenHash: 1 });
sessionSchema.index({ expiresAt: 1 });

export const Session = model<ISession>('Session', sessionSchema);

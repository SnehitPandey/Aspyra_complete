import { Schema, model, Document, Types } from 'mongoose';

export interface IChatMessage extends Document {
  _id: Types.ObjectId;
  roomId: Types.ObjectId;
  userId?: Types.ObjectId;
  content: string;
  type: 'TEXT' | 'SYSTEM' | 'EMOJI' | 'FILE';
  createdAt: Date;
}

const chatMessageSchema = new Schema<IChatMessage>({
  roomId: {
    type: Schema.Types.ObjectId,
    ref: 'Room',
    required: true,
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: false, // Null for system messages
  },
  content: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ['TEXT', 'SYSTEM', 'EMOJI', 'FILE'],
    default: 'TEXT',
  },
}, {
  timestamps: { createdAt: true, updatedAt: false },
});

// Indexes
chatMessageSchema.index({ roomId: 1, createdAt: -1 });
chatMessageSchema.index({ userId: 1 });

export const ChatMessage = model<IChatMessage>('ChatMessage', chatMessageSchema);

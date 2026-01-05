import { Schema, model, Document, Types } from 'mongoose';

export interface INotification extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: string;
  title: string;
  message?: string;
  payload?: Record<string, any>;
  read: boolean;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  type: {
    type: String,
    required: true,
    enum: ['ROOM_INVITE', 'TASK_ASSIGNED', 'NOTE_UPLOADED', 'ROOM_JOINED', 'QUIZ_GENERATED', 'GROUP_ASSIGNED'],
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  message: {
    type: String,
    trim: true,
  },
  payload: {
    type: Schema.Types.Mixed,
    default: {},
  },
  read: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: { createdAt: true, updatedAt: false },
});

// Indexes
notificationSchema.index({ userId: 1, read: 1 });
notificationSchema.index({ createdAt: -1 });

export const Notification = model<INotification>('Notification', notificationSchema);

import { Schema, model, Document, Types } from 'mongoose';

export interface INote {
  _id: Types.ObjectId;
  title: string;
  content?: string;
  channelId: Types.ObjectId;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IChannel extends Document {
  _id: Types.ObjectId;
  teacherId: Types.ObjectId;
  title: string;
  description?: string;
  isActive: boolean;
  notes: INote[];
  _count?: {
    notes: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const noteSchema = new Schema<INote>({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  content: {
    type: String,
    trim: true,
  },
  channelId: {
    type: Schema.Types.ObjectId,
    required: true,
  },
  fileUrl: String,
  fileName: String,
  fileSize: Number,
  fileType: String,
  isPublic: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
});

const channelSchema = new Schema<IChannel>({
  teacherId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  notes: [noteSchema],
}, {
  timestamps: true,
});

// Indexes
channelSchema.index({ teacherId: 1 });
channelSchema.index({ isActive: 1 });

export const Channel = model<IChannel>('Channel', channelSchema);


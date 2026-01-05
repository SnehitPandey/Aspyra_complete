import { Schema, model, Document, Types } from 'mongoose';

export interface ITask {
  _id: Types.ObjectId;
  title: string;
  description?: string;
  assigneeId?: Types.ObjectId;
  status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
  dueAt?: Date;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IList {
  _id: Types.ObjectId;
  title: string;
  position: number;
  tasks: ITask[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IBoard extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  title: string;
  orgId?: string;
  lists: IList[];
  createdAt: Date;
  updatedAt: Date;
}

const taskSchema = new Schema<ITask>({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  assigneeId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
  status: {
    type: String,
    enum: ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'],
    default: 'TODO',
  },
  dueAt: Date,
  position: {
    type: Number,
    required: true,
    default: 0,
  },
}, {
  timestamps: true,
});

const listSchema = new Schema<IList>({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  position: {
    type: Number,
    required: true,
    default: 0,
  },
  tasks: [taskSchema],
}, {
  timestamps: true,
});

const boardSchema = new Schema<IBoard>({
  ownerId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  orgId: {
    type: String,
    sparse: true, // Allow null values in index
  },
  lists: [listSchema],
}, {
  timestamps: true,
});

// Indexes
boardSchema.index({ ownerId: 1 });
boardSchema.index({ orgId: 1 });

export const Board = model<IBoard>('Board', boardSchema);

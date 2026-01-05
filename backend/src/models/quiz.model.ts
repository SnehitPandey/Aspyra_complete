import { Schema, model, Document, Types } from 'mongoose';

export interface IQuizQuestion {
  q: string;
  options: string[];
  answerIndex: number;
  explanation?: string;
  topicId?: string; // Reference to roadmap topic
  difficulty?: 'Easy' | 'Medium' | 'Hard';
}

export interface IQuizAttempt {
  userId: Types.ObjectId;
  answers: number[]; // Array of selected option indices
  score: number; // 0-100
  completedAt: Date;
  timeSpent: number; // seconds
  passed: boolean; // True if score >= passingScore
}

export interface IQuiz extends Document {
  _id: Types.ObjectId;
  roomId?: Types.ObjectId; // Link to room for daily quizzes
  topic: string;
  difficulty: string;
  questions: IQuizQuestion[];
  forTopics?: string[]; // Topic IDs covered (for room quizzes)
  date?: Date; // Date quiz was generated (for daily quizzes)
  attempts?: IQuizAttempt[]; // User attempts
  status?: 'pending' | 'available' | 'completed';
  maxAttempts?: number; // Default: 3
  passingScore?: number; // Default: 70
  creatorId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  // Methods
  getUserAttempts(userId: Types.ObjectId): IQuizAttempt[];
  hasPassedQuiz(userId: Types.ObjectId): boolean;
  getRemainingAttempts(userId: Types.ObjectId): number;
  getBestScore(userId: Types.ObjectId): number;
}

const quizQuestionSchema = new Schema<IQuizQuestion>({
  q: {
    type: String,
    required: true,
  },
  options: {
    type: [String],
    required: true,
    validate: {
      validator: (v: string[]) => v.length === 4,
      message: 'Quiz must have exactly 4 options',
    },
  },
  answerIndex: {
    type: Number,
    required: true,
    min: 0,
    max: 3,
  },
  explanation: String,
  topicId: String,
  difficulty: {
    type: String,
    enum: ['Easy', 'Medium', 'Hard'],
    default: 'Medium',
  },
}, { _id: false });

const quizAttemptSchema = new Schema<IQuizAttempt>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  answers: {
    type: [Number],
    required: true,
  },
  score: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
  },
  completedAt: {
    type: Date,
    default: Date.now,
  },
  timeSpent: {
    type: Number,
    required: true,
    min: 0,
  },
  passed: {
    type: Boolean,
    required: true,
  },
}, { _id: false });

const quizSchema = new Schema<IQuiz>({
  roomId: {
    type: Schema.Types.ObjectId,
    ref: 'Room',
    index: true,
  },
  topic: {
    type: String,
    required: true,
    trim: true,
  },
  difficulty: {
    type: String,
    default: 'Medium',
    enum: ['Easy', 'Medium', 'Hard'],
  },
  questions: [quizQuestionSchema],
  forTopics: [String],
  date: {
    type: Date,
    index: true,
  },
  attempts: {
    type: [quizAttemptSchema],
    default: [],
  },
  status: {
    type: String,
    enum: ['pending', 'available', 'completed'],
    default: 'available',
  },
  maxAttempts: {
    type: Number,
    default: 3,
    min: 1,
    max: 10,
  },
  passingScore: {
    type: Number,
    default: 70,
    min: 0,
    max: 100,
  },
  creatorId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
}, {
  timestamps: true,
});

// Indexes
quizSchema.index({ topic: 1 });
quizSchema.index({ creatorId: 1 });
quizSchema.index({ difficulty: 1 });
quizSchema.index({ roomId: 1, date: -1 });
quizSchema.index({ roomId: 1, status: 1 });
quizSchema.index({ 'attempts.userId': 1 });

// Methods
quizSchema.methods.getUserAttempts = function(userId: Types.ObjectId): IQuizAttempt[] {
  if (!this.attempts) return [];
  return this.attempts.filter((attempt: IQuizAttempt) => 
    attempt.userId.toString() === userId.toString()
  );
};

quizSchema.methods.hasPassedQuiz = function(userId: Types.ObjectId): boolean {
  const userAttempts = this.getUserAttempts(userId);
  return userAttempts.some((attempt: IQuizAttempt) => attempt.passed);
};

quizSchema.methods.getRemainingAttempts = function(userId: Types.ObjectId): number {
  const userAttempts = this.getUserAttempts(userId);
  const maxAttempts = this.maxAttempts || 3;
  return Math.max(0, maxAttempts - userAttempts.length);
};

quizSchema.methods.getBestScore = function(userId: Types.ObjectId): number {
  const userAttempts = this.getUserAttempts(userId);
  if (userAttempts.length === 0) return 0;
  return Math.max(...userAttempts.map((attempt: IQuizAttempt) => attempt.score));
};

export const Quiz = model<IQuiz>('Quiz', quizSchema);

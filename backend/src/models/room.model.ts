import { Schema, model, Document, Types } from 'mongoose';

export interface IRoomMember {
  userId: Types.ObjectId;
  role: 'HOST' | 'CO_HOST' | 'MEMBER';
  ready: boolean;
  accepted: boolean; // Whether host accepted the join request
  joinedAt: Date;
  lastActive: Date;
  memberStatus: 'WAITING' | 'NOT_STARTED' | 'ON_TRACK' | 'AHEAD' | 'BEHIND' | 'COMPLETED';
  progress?: {
    currentPhase: number;
    currentMilestone: number;
    completedMilestones: string[];
    lastActivity: Date;
    progressPercentage: number; // Calculated progress 0-100
    currentMilestoneId?: string; // ✨ NEW: Track exact milestone user is on
    currentTopicTitle?: string; // ✨ NEW: Track exact topic user is on
  };
}

export interface ITopicResource {
  type: 'youtube' | 'article' | 'documentation' | 'video' | 'book' | 'interactive';
  title: string;
  url: string;
  duration?: string; // e.g., "15 min", "1 hour"
  author?: string;
}

export interface IRoadmapTopic {
  title: string;
  description?: string;
  status: 'pending' | 'in-progress' | 'completed';
  estimatedHours?: number;
  subtopics?: string[]; // NEW: Array of subtopic names
  resources?: ITopicResource[]; // NEW: Learning resources
  completedBy?: Types.ObjectId[]; // NEW: Track which users completed
  completedAt?: Date; // NEW: Completion timestamp
}

export interface IRoadmapMilestone {
  id: string;
  title: string;
  description: string;
  topics: (string | IRoadmapTopic)[];
  estimatedHours: number;
  completed: boolean;
  completedTopics?: number;
  startDate?: Date;
  endDate?: Date;
  durationDays?: number;
}

export interface IRoadmapPhase {
  phase: number;
  title: string;
  description: string;
  milestones: IRoadmapMilestone[];
  duration: string;
}

export interface IRoadmap {
  goal: string;
  tags: string[];
  skillLevel: 'Beginner' | 'Intermediate' | 'Advanced';
  phases: IRoadmapPhase[];
  totalDuration: string;
  generatedAt: Date;
}

export interface IFocusSession {
  userId: Types.ObjectId;
  topicId: string; // Milestone ID (e.g., "p0m0")
  topicTitle: string;
  startTime: Date;
  endTime?: Date;
  duration: number; // minutes
  completed: boolean;
  insights?: string; // AI-generated insights
}

// NEW: Chat message interface
export interface IRoomMessage {
  id: string;
  userId: Types.ObjectId;
  content: string;
  timestamp: Date;
  type?: 'user' | 'system';
}

// NEW: Quiz interface
export interface IRoomQuiz {
  _id?: Types.ObjectId;
  date: Date;
  topics: string[]; // Topic IDs covered
  difficulty: 'easy' | 'medium' | 'hard';
  questions: {
    question: string;
    options: string[];
    correctAnswer: number;
  }[];
  results: {
    userId: Types.ObjectId;
    score: number;
    submittedAt: Date;
    answers: number[];
  }[];
  generatedAt: Date;
}

// NEW: Kanban board interface
export interface IKanbanBoard {
  userId: Types.ObjectId;
  columns: {
    backlog: IKanbanTask[];
    todo: IKanbanTask[];
    inProgress: IKanbanTask[];
    done: IKanbanTask[];
  };
  updatedAt: Date;
}

export interface IKanbanTask {
  id: string;
  topicId: string; // Links to roadmap topic
  title: string;
  description?: string;
  order: number;
  createdAt: Date;
}

// NEW: Streak tracking interface
export interface IStreak {
  userId: Types.ObjectId;
  days: number;
  lastUpdated: Date;
  history: Date[]; // Dates of activity
}

export interface IRoom extends Document {
  _id: Types.ObjectId;
  code: string;
  hostId: Types.ObjectId;
  title: string;
  description?: string;
  tags: string[];
  status: 'PREPARING' | 'ONGOING' | 'COMPLETED' | 'INACTIVE' | 'TERMINATED';
  startDate: Date; // When the learning should begin
  endDate?: Date; // Optional expected end date
  totalDays?: number; // NEW: Total duration in days
  maxSeats: number;
  members: IRoomMember[];
  roadmap?: IRoadmap;
  progressData?: {
    averageProgress: number; // Average progress across all members
    totalMilestones: number;
    completedMilestones: number;
  };
  // NEW: Per-user progress tracking
  progress?: {
    userId: Types.ObjectId;
    completedTopics: number;
    totalTopics: number;
    updatedAt: Date;
  }[];
  // NEW: Chat messages
  messages?: IRoomMessage[];
  // NEW: Quizzes
  quizzes?: IRoomQuiz[];
  // NEW: Kanban boards (per-user)
  kanbanBoards?: IKanbanBoard[];
  // NEW: Streaks (per-user)
  streaks?: IStreak[];
  focusSessions?: IFocusSession[]; // Track focus sessions
  completionSummary?: string; // AI-generated summary when room completes
  createdAt: Date;
  updatedAt: Date;
  calculateRoomStatus(): 'PREPARING' | 'ONGOING' | 'COMPLETED' | 'INACTIVE' | 'TERMINATED';
  calculateMemberStatus(memberId: Types.ObjectId): 'WAITING' | 'NOT_STARTED' | 'ON_TRACK' | 'AHEAD' | 'BEHIND' | 'COMPLETED';
}

const memberProgressSchema = new Schema({
  currentPhase: { type: Number, default: 0 },
  currentMilestone: { type: Number, default: 0 },
  completedMilestones: [{ type: String }],
  lastActivity: { type: Date, default: Date.now },
  progressPercentage: { type: Number, default: 0, min: 0, max: 100 },
  currentMilestoneId: { type: String }, // ✨ NEW: Track exact milestone
  currentTopicTitle: { type: String }, // ✨ NEW: Track exact topic
}, { _id: false });

const roomMemberSchema = new Schema<IRoomMember>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  role: {
    type: String,
    enum: ['HOST', 'CO_HOST', 'MEMBER'],
    default: 'MEMBER',
  },
  ready: {
    type: Boolean,
    default: false,
  },
  accepted: {
    type: Boolean,
    default: false, // HOST is auto-accepted, others need approval
  },
  joinedAt: {
    type: Date,
    default: Date.now,
  },
  lastActive: {
    type: Date,
    default: Date.now,
  },
  memberStatus: {
    type: String,
    enum: ['WAITING', 'NOT_STARTED', 'ON_TRACK', 'AHEAD', 'BEHIND', 'COMPLETED'],
    default: 'WAITING',
  },
  progress: memberProgressSchema,
});

const topicResourceSchema = new Schema({
  type: { 
    type: String, 
    enum: ['youtube', 'article', 'documentation', 'video', 'book', 'interactive'],
    required: true 
  },
  title: { type: String, required: true },
  url: { type: String, required: true },
  duration: { type: String },
  author: { type: String },
}, { _id: false });

const roadmapTopicSchema = new Schema({
  title: { type: String, required: true },
  description: { type: String },
  status: { 
    type: String, 
    enum: ['pending', 'in-progress', 'completed'], 
    default: 'pending' 
  },
  estimatedHours: { type: Number },
  subtopics: [{ type: String }], // NEW: Subtopics array
  resources: [topicResourceSchema], // NEW: Learning resources
  completedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }], // NEW: Users who completed
  completedAt: { type: Date }, // NEW: Completion timestamp
}, { _id: false });

const roadmapMilestoneSchema = new Schema<IRoadmapMilestone>({
  id: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  topics: [{ type: Schema.Types.Mixed }], // Can be string or IRoadmapTopic
  estimatedHours: { type: Number, default: 1 },
  completed: { type: Boolean, default: false },
  completedTopics: { type: Number, default: 0 },
  startDate: { type: Date },
  endDate: { type: Date },
  durationDays: { type: Number },
}, { _id: false });

const roadmapPhaseSchema = new Schema<IRoadmapPhase>({
  phase: { type: Number, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  milestones: [roadmapMilestoneSchema],
  duration: { type: String, required: true },
}, { _id: false });

const roadmapSchema = new Schema<IRoadmap>({
  goal: { type: String, required: true },
  tags: [{ type: String }],
  skillLevel: { 
    type: String, 
    enum: ['Beginner', 'Intermediate', 'Advanced'],
    default: 'Beginner',
  },
  phases: [roadmapPhaseSchema],
  totalDuration: { type: String, required: true },
  generatedAt: { type: Date, default: Date.now },
}, { _id: false });

const progressDataSchema = new Schema({
  averageProgress: { type: Number, default: 0, min: 0, max: 100 },
  totalMilestones: { type: Number, default: 0 },
  completedMilestones: { type: Number, default: 0 },
}, { _id: false });

// NEW: Room message schema
const roomMessageSchema = new Schema({
  id: { type: String, required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  type: { type: String, enum: ['user', 'system'], default: 'user' },
}, { _id: false });

// NEW: Quiz schema
const quizQuestionSchema = new Schema({
  question: { type: String, required: true },
  options: [{ type: String, required: true }],
  correctAnswer: { type: Number, required: true },
}, { _id: false });

const quizResultSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  score: { type: Number, required: true },
  submittedAt: { type: Date, default: Date.now },
  answers: [{ type: Number }],
}, { _id: false });

const roomQuizSchema = new Schema({
  date: { type: Date, required: true },
  topics: [{ type: String }],
  difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
  questions: [quizQuestionSchema],
  results: [quizResultSchema],
  generatedAt: { type: Date, default: Date.now },
}, { _id: true });

// NEW: Kanban task schema
const kanbanTaskSchema = new Schema({
  id: { type: String, required: true },
  topicId: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String },
  order: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

// NEW: Kanban board schema
const kanbanBoardSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  columns: {
    backlog: [kanbanTaskSchema],
    todo: [kanbanTaskSchema],
    inProgress: [kanbanTaskSchema],
    done: [kanbanTaskSchema],
  },
  updatedAt: { type: Date, default: Date.now },
}, { _id: false });

// NEW: Streak schema
const streakSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  days: { type: Number, default: 0 },
  lastUpdated: { type: Date, default: Date.now },
  history: [{ type: Date }],
}, { _id: false });

// NEW: Per-user progress schema (room level)
const userProgressSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  completedTopics: { type: Number, default: 0 },
  totalTopics: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now },
}, { _id: false });

const roomSchema = new Schema<IRoom>({
  code: {
    type: String,
    required: true,
    unique: true,
    length: 6,
  },
  hostId: {
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
  tags: {
    type: [String],
    default: [],
  },
  status: {
    type: String,
    enum: ['PREPARING', 'ONGOING', 'COMPLETED', 'INACTIVE', 'TERMINATED'],
    default: 'PREPARING',
  },
  startDate: {
    type: Date,
    required: true,
    default: () => new Date(), // Default to now if not specified
  },
  endDate: {
    type: Date,
  },
  totalDays: {
    type: Number,
  },
  maxSeats: {
    type: Number,
    default: 8,
    min: 2,
    max: 20,
  },
  members: [roomMemberSchema],
  roadmap: roadmapSchema,
  progressData: progressDataSchema,
  // NEW: Room-level progress tracking array
  progress: [userProgressSchema],
  // NEW: Messages array
  messages: [roomMessageSchema],
  // NEW: Quizzes array
  quizzes: [roomQuizSchema],
  // NEW: Kanban boards array
  kanbanBoards: [kanbanBoardSchema],
  // NEW: Streaks array
  streaks: [streakSchema],
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Instance Methods

/**
 * Calculate room status based on dates and activity
 */
roomSchema.methods.calculateRoomStatus = function(): 'PREPARING' | 'ONGOING' | 'COMPLETED' | 'INACTIVE' | 'TERMINATED' {
  const now = new Date();
  const INACTIVITY_THRESHOLD_DAYS = 7;

  // Check if manually terminated
  if (this.status === 'TERMINATED') {
    return 'TERMINATED';
  }

  // Check if all members completed (room completed)
  if (this.roadmap && this.progressData) {
    const allMilestonesCompleted = this.progressData.totalMilestones > 0 &&
      this.progressData.completedMilestones >= this.progressData.totalMilestones;
    
    if (allMilestonesCompleted) {
      return 'COMPLETED';
    }
  }

  // Check for inactivity
  const acceptedMembers = this.members.filter((m: IRoomMember) => m.accepted);
  if (acceptedMembers.length > 0) {
    const allInactive = acceptedMembers.every((member: IRoomMember) => {
      const daysSinceActivity = (now.getTime() - member.lastActive.getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceActivity > INACTIVITY_THRESHOLD_DAYS;
    });

    if (allInactive && now >= this.startDate) {
      return 'INACTIVE';
    }
  }

  // Check if room has started
  if (now < this.startDate) {
    return 'PREPARING';
  }

  // Check if any learning activity has started
  const hasActivity = this.members.some((m: IRoomMember) => 
    m.accepted && m.progress && m.progress.completedMilestones.length > 0
  );

  if (now >= this.startDate && hasActivity) {
    return 'ONGOING';
  }

  // Room date arrived but no activity yet
  if (now >= this.startDate) {
    return 'ONGOING'; // Auto-transition to ongoing when start date arrives
  }

  return 'PREPARING';
};

/**
 * Calculate individual member status based on their progress
 */
roomSchema.methods.calculateMemberStatus = function(memberId: Types.ObjectId): 'WAITING' | 'NOT_STARTED' | 'ON_TRACK' | 'AHEAD' | 'BEHIND' | 'COMPLETED' {
  const member = this.members.find((m: IRoomMember) => m.userId.equals(memberId));
  
  if (!member) {
    throw new Error('Member not found');
  }

  // Check if waiting for approval
  if (!member.accepted && member.role !== 'HOST') {
    return 'WAITING';
  }

  // Check if host (host status follows room status)
  if (member.role === 'HOST') {
    const roomStatus = this.calculateRoomStatus();
    if (roomStatus === 'COMPLETED') return 'COMPLETED';
    if (roomStatus === 'PREPARING') return 'NOT_STARTED';
    // For ONGOING/INACTIVE, calculate based on progress
  }

  // Check if completed all milestones
  if (this.roadmap && member.progress) {
    const totalMilestones = this.roadmap.phases.reduce(
      (sum: number, phase: any) => sum + phase.milestones.length,
      0
    );
    if (member.progress.completedMilestones.length >= totalMilestones && totalMilestones > 0) {
      return 'COMPLETED';
    }
  }

  // Check if member has started
  if (!member.progress || member.progress.completedMilestones.length === 0) {
    return 'NOT_STARTED';
  }

  // Calculate progress relative to room average
  const memberProgress = member.progress.progressPercentage || 0;
  const roomAverage = this.progressData?.averageProgress || 0;
  const difference = memberProgress - roomAverage;

  // Determine status based on progress comparison
  if (difference >= 15) {
    return 'AHEAD';
  } else if (difference <= -15) {
    return 'BEHIND';
  } else {
    return 'ON_TRACK';
  }
};

// ✅ Virtual field to expose progressData.averageProgress as averageProgress
roomSchema.virtual('averageProgress').get(function() {
  return this.progressData?.averageProgress || 0;
});

// Pre-save hook to auto-calculate progress data
roomSchema.pre('save', function(next) {
  console.log('🔧 [Pre-save hook] Starting progress calculation...');
  console.log(`🔧 [Pre-save hook] Total members in room: ${this.members.length}`);
  this.members.forEach((m: IRoomMember, i: number) => {
    console.log(`🔧 [Pre-save hook] Member ${i}: accepted=${m.accepted}, role=${m.role}, hasProgress=${!!m.progress}`);
  });
  
  // Calculate total milestones
  if (this.roadmap) {
    const totalMilestones = this.roadmap.phases.reduce(
      (sum, phase) => sum + phase.milestones.length,
      0
    );

    // Calculate average progress across all accepted members OR hosts
    // FIX: Include HOST/CO_HOST even if accepted field is false
    const activeMembers = this.members.filter((m: IRoomMember) => 
      m.accepted === true || m.role === 'HOST' || m.role === 'CO_HOST'
    );
    let totalProgress = 0;
    let completedMilestones = 0;

    console.log(`🔧 [Pre-save hook] Active members: ${activeMembers.length}`);
    
    activeMembers.forEach((member: IRoomMember, index: number) => {
      if (member.progress) {
        console.log(`🔧 [Pre-save hook] Member ${index}: progressPercentage=${member.progress.progressPercentage}, completedMilestones=${member.progress.completedMilestones.length}`);
        totalProgress += member.progress.progressPercentage || 0;
        completedMilestones += member.progress.completedMilestones.length;
      } else {
        console.log(`🔧 [Pre-save hook] Member ${index}: NO PROGRESS DATA`);
      }
    });

    const averageProgress = activeMembers.length > 0 
      ? totalProgress / activeMembers.length 
      : 0;

    console.log(`🔧 [Pre-save hook] Calculated averageProgress: ${Math.round(averageProgress)}% (${totalProgress}/${activeMembers.length})`);

    // ✅ UPDATE progressData (virtual field will expose it as averageProgress)
    this.progressData = {
      averageProgress: Math.round(averageProgress),
      totalMilestones,
      completedMilestones,
    };
    
    console.log(`✅ [Pre-save hook] Set progressData.averageProgress = ${Math.round(averageProgress)}%`);
  }

  // Auto-calculate and update room status
  this.status = this.calculateRoomStatus();

  // Auto-calculate and update member statuses
  this.members.forEach((member: IRoomMember) => {
    try {
      member.memberStatus = this.calculateMemberStatus(member.userId);
    } catch (error) {
      console.error('Error calculating member status:', error);
    }
  });

  next();
});

// Indexes
roomSchema.index({ code: 1 });
roomSchema.index({ hostId: 1 });
roomSchema.index({ status: 1 });
roomSchema.index({ startDate: 1 });
roomSchema.index({ 'members.userId': 1 });
roomSchema.index({ 'members.memberStatus': 1 });
roomSchema.index({ tags: 1 });
roomSchema.index({ createdAt: -1 });
// NEW: Indexes for chat, quiz, progress
roomSchema.index({ 'messages.timestamp': -1 });
roomSchema.index({ 'quizzes.date': -1 });
roomSchema.index({ 'progress.userId': 1 });
roomSchema.index({ 'roadmap.phases.milestones.topics._id': 1 });

export const Room = model<IRoom>('Room', roomSchema);

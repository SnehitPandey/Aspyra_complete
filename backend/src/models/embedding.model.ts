import { Schema, model, Document, Types } from 'mongoose';

export interface IProfile {
  skills: string;
  interests: string;
  goals: string;
}

export interface IEmbedding extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  vector: number[];
  profile: IProfile;
  createdAt: Date;
  updatedAt: Date;
}

const profileSchema = new Schema<IProfile>({
  skills: {
    type: String,
    required: true,
  },
  interests: {
    type: String,
    required: true,
  },
  goals: {
    type: String,
    required: true,
  },
});

const embeddingSchema = new Schema<IEmbedding>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  vector: [{
    type: Number,
    required: true,
  }],
  profile: {
    type: profileSchema,
    required: true,
  },
}, {
  timestamps: true,
});

// Indexes
embeddingSchema.index({ userId: 1 });

export const Embedding = model<IEmbedding>('Embedding', embeddingSchema);

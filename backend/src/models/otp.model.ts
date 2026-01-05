import mongoose, { Document, Schema } from 'mongoose';

export interface IOTP extends Document {
  email: string;
  code: string;
  purpose: 'LOGIN' | 'SIGNUP';
  expiresAt: Date;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

const otpSchema = new Schema<IOTP>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
    },
    purpose: {
      type: String,
      enum: ['LOGIN', 'SIGNUP'],
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // TTL index - MongoDB will auto-delete after expiration
    },
    attempts: {
      type: Number,
      default: 0,
      max: 3, // Maximum 3 attempts per OTP
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient queries
otpSchema.index({ email: 1, purpose: 1, expiresAt: 1 });

export const OTP = mongoose.model<IOTP>('OTP', otpSchema);

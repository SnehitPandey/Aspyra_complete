import { Schema, model, Document, Types } from 'mongoose';
import bcrypt from 'bcrypt';

export interface IUser extends Document {
  _id: Types.ObjectId;
  email: string;
  password: string;
  passwordHash: string;
  name: string;
  username?: string;
  bio?: string;
  role: 'ADMIN' | 'MODERATOR' | 'TEACHER' | 'MEMBER';
  skills?: string[];
  timezone?: string;
  googleId?: string;
  profilePic?: string; // Fetched from Google OAuth or Gravatar
  customAvatarURL?: string; // User uploaded custom avatar
  isCustomAvatar?: boolean; // Flag to prioritize custom avatar
  avatarUrl?: string; // Legacy field for backward compatibility
  resumeUrl?: string;
  socialLinks?: {
    github?: string;
    linkedin?: string;
    twitter?: string;
    website?: string;
  };
  isEmailVerified?: boolean;
  partnerId?: Types.ObjectId; // Connected study partner
  inviteCode?: string; // Active invite code for sharing
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  passwordHash: {
    type: String,
    required: false, // Made optional to support OTP and OAuth authentication
    // Validation: password is required only for non-OAuth, non-OTP users
    // OAuth users have googleId, OTP users have isEmailVerified: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  username: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
  },
  bio: {
    type: String,
    maxlength: 500,
    trim: true,
  },
  role: {
    type: String,
    enum: ['ADMIN', 'MODERATOR', 'TEACHER', 'MEMBER'],
    default: 'MEMBER',
  },
  skills: [{
    type: String,
    trim: true,
  }],
  timezone: {
    type: String,
    default: 'UTC',
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true, // Allows null values while maintaining uniqueness
  },
  profilePic: {
    type: String, // Fetched from Google OAuth or Gravatar
  },
  customAvatarURL: {
    type: String, // User uploaded custom avatar
  },
  isCustomAvatar: {
    type: Boolean,
    default: false, // Prioritize custom avatar when true
  },
  avatarUrl: {
    type: String, // Legacy field for backward compatibility
  },
  resumeUrl: {
    type: String,
  },
  socialLinks: {
    github: String,
    linkedin: String,
    twitter: String,
    website: String,
  },
  isEmailVerified: {
    type: Boolean,
    default: false,
  },
  partnerId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
  inviteCode: {
    type: String,
    sparse: true, // Allows multiple null values while maintaining uniqueness when set
  },
}, {
  timestamps: true,
});

// Pre-save validation: Ensure user has at least one authentication method
userSchema.pre('save', function(next) {
  // Skip validation if this is an update that doesn't affect auth fields
  if (!this.isNew && !this.isModified('passwordHash') && !this.isModified('googleId') && !this.isModified('isEmailVerified')) {
    return next();
  }

  // For new users or when auth fields change, ensure at least one auth method exists
  const hasPassword = !!this.passwordHash;
  const hasGoogleAuth = !!this.googleId;
  const hasOTPAuth = this.isEmailVerified === true;

  if (!hasPassword && !hasGoogleAuth && !hasOTPAuth) {
    const error = new Error('User must have at least one authentication method (password, Google OAuth, or email verification via OTP)');
    return next(error);
  }

  next();
});

// Virtual for password (allows setting password directly)
userSchema.virtual('password')
  .set(function(this: IUser, password: string) {
    this.passwordHash = bcrypt.hashSync(password, 10);
  });

// Method to compare password
userSchema.methods.comparePassword = async function(this: IUser, candidatePassword: string): Promise<boolean> {
  if (!this.passwordHash) return false;
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
userSchema.index({ username: 1 });

export const User = model<IUser>('User', userSchema);

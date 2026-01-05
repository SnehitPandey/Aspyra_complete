import bcrypt from 'bcrypt';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { Types } from 'mongoose';
import { User, IUser } from '../models/user.model.js';
import { Session, ISession } from '../models/session.model.js';
import { OTP, IOTP } from '../models/otp.model.js';
import { env } from '../config/env.js';
import { createError } from '../middleware/errorHandler.js';
import { getGravatarUrl } from '../utils/avatarUtils.js';
import { emailService } from './email.service.js';

export interface RegisterData {
  email: string;
  password: string;
  name: string;
  role?: 'TEACHER' | 'MEMBER';
}

export interface LoginData {
  email: string;
  password: string;
}

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  private readonly SALT_ROUNDS = 12;

  // Hash password with bcrypt
  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  // Verify password
  private async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  // Hash refresh token for storage
  private async hashRefreshToken(token: string): Promise<string> {
    return bcrypt.hash(token, 10);
  }

  // Generate JWT tokens
  private createTokens(payload: TokenPayload): AuthTokens {
    const accessToken = (jwt.sign as any)(
      payload, 
      env.JWT_SECRET, 
      {
        expiresIn: env.JWT_ACCESS_TOKEN_EXPIRES_IN,
        issuer: 'studyflow',
        audience: 'studyflow-app',
      }
    );

    const refreshToken = (jwt.sign as any)(
      { userId: payload.userId },
      env.JWT_REFRESH_SECRET,
      {
        expiresIn: env.JWT_REFRESH_TOKEN_EXPIRES_IN,
      }
    );

    return { accessToken, refreshToken };
  }

  // Public method to generate tokens for OAuth
  async generateTokens(user: IUser): Promise<AuthTokens> {
    const tokenPayload: TokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    const tokens = this.createTokens(tokenPayload);

    // Store refresh token in session
    const refreshTokenHash = await this.hashRefreshToken(tokens.refreshToken);
    await Session.create({
      userId: user._id,
      refreshTokenHash,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    });

    return tokens;
  }

  // Register new user
  async register(data: RegisterData): Promise<{ user: IUser; tokens: AuthTokens }> {
    // Check if user already exists
    const existingUser = await User.findOne({ email: data.email.toLowerCase() });
    if (existingUser) {
      throw createError('User with this email already exists', 409);
    }

    // Hash password
    const passwordHash = await this.hashPassword(data.password);

    // Generate username from email (part before @)
    const email = data.email || '';
    const emailParts = email.split('@');
    const emailUsername = (emailParts[0] || 'user').toLowerCase();
    // Make it unique by adding a random suffix if needed
    let username = emailUsername;
    let usernameExists = await User.findOne({ username });
    if (usernameExists) {
      const randomSuffix = Math.floor(Math.random() * 10000);
      username = `${emailUsername}${randomSuffix}`;
    }

    // Generate Gravatar URL from email
    const gravatarUrl = getGravatarUrl(email);
    
    // Create user
    const user = new User({
      email: email.toLowerCase(),
      passwordHash,
      name: data.name,
      username,
      role: data.role || 'MEMBER',
      profilePic: gravatarUrl, // Set Gravatar as default profile picture
      avatarUrl: gravatarUrl, // Legacy field for backward compatibility
      isCustomAvatar: false,
    });

    await user.save();

    // Generate tokens
    const tokenPayload: TokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    const tokens = this.createTokens(tokenPayload);

    // Store refresh token session
    const refreshTokenHash = await this.hashRefreshToken(tokens.refreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const session = new Session({
      userId: user._id,
      refreshTokenHash,
      expiresAt,
    });

    await session.save();

    return { user, tokens };
  }

  // Login user
  async login(data: LoginData): Promise<{ user: IUser; tokens: AuthTokens }> {
    // Find user by email
    const user = await User.findOne({ email: data.email.toLowerCase() });
    if (!user) {
      throw createError('Invalid credentials', 401);
    }

    // Check if user signed up with OAuth (Google)
    if (user.googleId && !user.passwordHash) {
      throw createError('This account was created using Google Sign-In. Please use "Continue with Google" to login.', 400);
    }

    // Check if user has a password hash
    if (!user.passwordHash) {
      throw createError('Invalid account configuration. Please contact support.', 500);
    }

    // Verify password
    const isPasswordValid = await this.verifyPassword(data.password, user.passwordHash);
    if (!isPasswordValid) {
      throw createError('Invalid credentials', 401);
    }

    // Generate tokens
    const tokenPayload: TokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    const tokens = this.createTokens(tokenPayload);

    // Store refresh token session
    const refreshTokenHash = await this.hashRefreshToken(tokens.refreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const session = new Session({
      userId: user._id,
      refreshTokenHash,
      expiresAt,
    });

    await session.save();

    return { user, tokens };
  }

  // Verify access token
  verifyAccessToken(token: string): TokenPayload {
    try {
      return jwt.verify(token, env.JWT_SECRET, {
        issuer: 'studyflow',
        audience: 'studyflow-app',
      }) as TokenPayload;
    } catch (error) {
      throw createError('Invalid access token', 401);
    }
  }

  // Refresh tokens
  async refreshTokens(refreshToken: string): Promise<{ user: IUser; tokens: AuthTokens }> {
    try {
      const payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { userId: string };

      // Find and verify session
      const sessions = await Session.find({ userId: new Types.ObjectId(payload.userId) });
      
      let validSession: ISession | null = null;
      for (const session of sessions) {
        const isValid = await bcrypt.compare(refreshToken, session.refreshTokenHash);
        if (isValid) {
          validSession = session;
          break;
        }
      }

      if (!validSession) {
        throw createError('Invalid refresh token', 401);
      }

      // Get user
      const user = await User.findById(payload.userId);
      if (!user) {
        throw createError('User not found', 404);
      }

      // Generate new tokens
      const tokenPayload: TokenPayload = {
        userId: user._id.toString(),
        email: user.email,
        role: user.role,
      };

      const tokens = this.createTokens(tokenPayload);

      // Update session with new refresh token
      const newRefreshTokenHash = await this.hashRefreshToken(tokens.refreshToken);
      const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      validSession.refreshTokenHash = newRefreshTokenHash;
      validSession.expiresAt = newExpiresAt;
      await validSession.save();

      return { user, tokens };
    } catch (error) {
      throw createError('Invalid refresh token', 401);
    }
  }

  // Logout user
  async logout(refreshToken: string): Promise<void> {
    try {
      const payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { userId: string };

      // Find and delete session
      const sessions = await Session.find({ userId: new Types.ObjectId(payload.userId) });
      
      for (const session of sessions) {
        const isValid = await bcrypt.compare(refreshToken, session.refreshTokenHash);
        if (isValid) {
          await Session.findByIdAndDelete(session._id);
          break;
        }
      }
    } catch (error) {
      // Fail silently for logout
    }
  }

  // Get user by ID
  async getUserById(userId: string): Promise<IUser> {
    if (!Types.ObjectId.isValid(userId)) {
      throw createError('Invalid user ID', 400);
    }

    const user = await User.findById(userId);
    if (!user) {
      throw createError('User not found', 404);
    }

    return user;
  }

  // ============ OTP-based Authentication Methods ============

  /**
   * Send OTP for login/signup
   * @param email - User email address
   * @param purpose - LOGIN or SIGNUP
   */
  async sendOTP(email: string, purpose: 'LOGIN' | 'SIGNUP'): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();

    // For LOGIN: check if user exists
    if (purpose === 'LOGIN') {
      const existingUser = await User.findOne({ email: normalizedEmail });
      if (!existingUser) {
        throw createError('No account found with this email address', 404);
      }
    }

    // For SIGNUP: check if user already exists
    if (purpose === 'SIGNUP') {
      const existingUser = await User.findOne({ email: normalizedEmail });
      if (existingUser) {
        throw createError('An account with this email already exists', 409);
      }
    }

    // Delete any existing OTPs for this email and purpose
    await OTP.deleteMany({ email: normalizedEmail, purpose });

    // Generate new OTP
    const code = emailService.generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Save OTP to database
    await OTP.create({
      email: normalizedEmail,
      code,
      purpose,
      expiresAt,
      attempts: 0,
    });

    // Send email
    await emailService.sendOTP(normalizedEmail, code, purpose);
  }

  /**
   * Verify OTP and authenticate user
   * @param email - User email address
   * @param code - 6-digit OTP code
   * @param purpose - LOGIN or SIGNUP
   * @param userData - Optional user data for signup (name)
   */
  async verifyOTP(
    email: string,
    code: string,
    purpose: 'LOGIN' | 'SIGNUP',
    userData?: { name: string }
  ): Promise<{ user: IUser; tokens: AuthTokens; isNewUser: boolean }> {
    const normalizedEmail = email.toLowerCase().trim();

    // Find OTP
    const otpRecord = await OTP.findOne({
      email: normalizedEmail,
      purpose,
      expiresAt: { $gt: new Date() }, // Not expired
    }).sort({ createdAt: -1 }); // Get the latest OTP

    if (!otpRecord) {
      throw createError('Invalid or expired OTP code', 400);
    }

    // Check attempts
    if (otpRecord.attempts >= 3) {
      await OTP.deleteOne({ _id: otpRecord._id });
      throw createError('Too many failed attempts. Please request a new code', 429);
    }

    // Verify code
    if (otpRecord.code !== code) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      throw createError(
        `Invalid OTP code. ${3 - otpRecord.attempts} attempt(s) remaining`,
        400
      );
    }

    // OTP verified successfully - delete it
    await OTP.deleteOne({ _id: otpRecord._id });

    let user: IUser;
    let isNewUser = false;

    if (purpose === 'SIGNUP') {
      // Create new user
      if (!userData?.name) {
        throw createError('Name is required for signup', 400);
      }

      const gravatarUrl = getGravatarUrl(normalizedEmail);

      user = await User.create({
        email: normalizedEmail,
        name: userData.name,
        username: normalizedEmail.split('@')[0], // Default username from email
        role: 'MEMBER',
        profilePic: gravatarUrl,
        avatarUrl: gravatarUrl,
        isEmailVerified: true, // Mark as verified since OTP was used
      });

      isNewUser = true;
    } else {
      // LOGIN: find existing user
      const foundUser = await User.findOne({ email: normalizedEmail });
      if (!foundUser) {
        throw createError('User not found', 404);
      }

      user = foundUser;

      // Mark email as verified
      if (!user.isEmailVerified) {
        user.isEmailVerified = true;
        await user.save();
      }
    }

    // Generate JWT tokens
    const tokens = await this.generateTokens(user);

    return { user, tokens, isNewUser };
  }

  /**
   * Resend OTP
   * @param email - User email address
   * @param purpose - LOGIN or SIGNUP
   */
  async resendOTP(email: string, purpose: 'LOGIN' | 'SIGNUP'): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();

    // Check for recent OTP (prevent spam)
    const recentOTP = await OTP.findOne({
      email: normalizedEmail,
      purpose,
      createdAt: { $gt: new Date(Date.now() - 60 * 1000) }, // Within last 1 minute
    });

    if (recentOTP) {
      throw createError('Please wait before requesting a new code', 429);
    }

    // Send new OTP
    await this.sendOTP(normalizedEmail, purpose);
  }
}

// Export singleton instance
export const authService = new AuthService();


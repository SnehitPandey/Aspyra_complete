// Type definitions for Express Request extensions
import 'express';

declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      name: string;
      username?: string;
      bio?: string;
      role: string;
      avatarUrl?: string;
      resumeUrl?: string;
      socialLinks?: {
        github?: string;
        linkedin?: string;
        twitter?: string;
        website?: string;
      };
      createdAt: Date;
      updatedAt: Date;
    }

    interface Request {
      user?: User;
    }
  }
}

export {};

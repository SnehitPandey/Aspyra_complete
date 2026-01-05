import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';

// Extend Request type to include user
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
    createdAt: Date;
    updatedAt: Date;
  };
}

// AI-specific rate limiter with higher restrictions
export const aiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each user to 100 AI requests per windowMs (increased for development/testing)
  message: {
    error: 'Too many AI requests',
    message: 'You have exceeded the AI request limit. Please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Use user ID if authenticated, otherwise IP
    const authReq = req as AuthenticatedRequest;
    return authReq.user?.id || req.ip || 'unknown';
  },
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      message: 'Too many AI requests. Please try again later.',
      retryAfter: res.get('Retry-After'),
      limit: res.get('X-RateLimit-Limit'),
      remaining: res.get('X-RateLimit-Remaining'),
      reset: res.get('X-RateLimit-Reset'),
    });
  },
});

// General API rate limiter (more permissive)
export const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // Limit each IP to 2000 requests per windowMs (increased for development with React StrictMode)
  message: {
    error: 'Too many requests',
    message: 'You have made too many requests. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.ip || 'unknown',
});

// Auth-specific rate limiter
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 login requests per windowMs (increased for development/testing)
  message: {
    error: 'Too many auth requests',
    message: 'Too many authentication attempts. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.ip || 'unknown',
  skipSuccessfulRequests: true, // Don't count successful auth attempts
});

// Upload-specific rate limiter
export const uploadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each user to 200 uploads per windowMs (increased for development/testing)
  message: {
    error: 'Too many upload requests',
    message: 'You have exceeded the upload limit. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const authReq = req as AuthenticatedRequest;
    return authReq.user?.id || req.ip || 'unknown';
  },
});


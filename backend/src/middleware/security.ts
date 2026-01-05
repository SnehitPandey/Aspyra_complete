import helmet from 'helmet';
import type { Application } from 'express';
import { env } from '../config/env.js';

export const configureSecurityMiddleware = (app: Application): void => {
  // Helmet for security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        scriptSrc: ["'self'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://api.openai.com"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false, // Disable for file uploads
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: "same-origin" },
  }));

  // Remove X-Powered-By header
  app.disable('x-powered-by');
};

// JWT Security Configuration
export const jwtSecurityConfig = {
  algorithms: ['HS256'] as const,
  issuer: 'studyflow',
  audience: 'studyflow-app',
  clockTolerance: 30, // 30 seconds tolerance for clock skew
};

// Session Security Configuration  
export const sessionSecurityConfig = {
  name: 'studyflow.sid', // Don't use default session name
  secret: env.COOKIE_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: env.NODE_ENV === 'production', // Only over HTTPS in production
    httpOnly: true, // Prevent XSS
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    sameSite: 'strict' as const, // CSRF protection
  },
};

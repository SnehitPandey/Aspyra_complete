import express, { Application } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import pinoImport from 'pino';

const pino = pinoImport.default || pinoImport;

import { env } from './config/env.js';
import { connectToDatabase } from './config/db.js';
import { connectToRedis, disconnectFromRedis } from './config/redis.js';
import { createChatQueue } from './config/queue.js';
import { configureSecurityMiddleware } from './middleware/security.js';
import passport from './config/passport.js';
import { configureGoogleAuth } from './config/passport.js';
import { auditLogMiddleware } from './middleware/auditLog.js';
import {
  generalRateLimiter,
  authRateLimiter,
  aiRateLimiter,
  uploadRateLimiter,
} from './middleware/rateLimiter.js';
import { errorHandler } from './middleware/errorHandler.js';

import { healthRouter } from './routes/health.js';
import { dbCheckRouter } from './routes/dbCheck.js';
import { authRouter } from './routes/auth.routes.js';
import { roomRouter } from './routes/room.routes.js';
import { chatRouter } from './routes/chat.routes.js';
import { taskRouter } from './routes/task.routes.js';
import { aiRouter } from './routes/ai.routes.js';
import { groupingRouter } from './routes/grouping.routes.js';
import { channelRouter } from './routes/channel.routes.js';
import { notificationRouter } from './routes/notification.routes.js';
import shareRouter from './routes/share.routes.js';
import connectRouter from './routes/connect.routes.js';
import userRouter from './routes/user.routes.js';
import duoStreakRouter from './routes/duoStreak.routes.js';
import { roomEnhancedRouter } from './routes/room-enhanced.routes.js';
import { debugRouter } from './routes/debug.routes.js';
import focusSessionRouter from './routes/focusSession.routes.js';
import dailyTaskRouter from './routes/dailyTask.routes.js';
import kanbanRouter from './routes/kanban.routes.js';
import partnerRouter from './routes/partner.routes.js';
import summaryRouter from './routes/summary.routes.js';
import contentRouter from './routes/content.routes.js';

// Initialize logger
export const logger = (pino as any)({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        levelFirst: true,
        translateTime: 'yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname',
        messageFormat: '[{levelLabel}] {msg}',
      },
    },
  }),
  ...(env.NODE_ENV === 'production' && {
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    timestamp: (pino as any).stdTimeFunctions.isoTime,
  }),
});

// Create Express application
const createApp = async (): Promise<Application> => {
  const app = express();

  // Initialize database connection
  try {
    await connectToDatabase(logger);
    logger.info('Database connection established');
  } catch (error) {
    logger.fatal({ error }, 'Failed to connect to MongoDB');
    process.exit(1);
  }

  // Initialize Redis connection
  try {
    connectToRedis(logger);
    logger.info('Redis connection established');
  } catch (error) {
    logger.error({ error }, 'Redis connection failed - some features may be limited');
  }

  // Initialize chat queue
  try {
    createChatQueue(logger);
    logger.info('Chat queue initialized');
  } catch (error) {
    logger.error({ error }, 'Chat queue initialization failed - background processing may be affected');
  }

  // Security middleware (should be first)
  configureSecurityMiddleware(app);

  // Initialize Passport for Google OAuth
  configureGoogleAuth();
  app.use(passport.initialize());

  // Trust proxy for accurate IP addresses behind load balancers/reverse proxies
  app.set('trust proxy', 1);

  // Disable X-Powered-By header for security
  app.disable('x-powered-by');

  // CORS configuration with environment-specific origins
  app.use(cors({
    origin: env.NODE_ENV === 'production' 
      ? [
          'https://studyflow.app',
          'https://app.studyflow.com',
          'https://www.studyflow.app'
        ]
      : [
          'http://localhost:3000',
          'http://localhost:3001',
          'http://127.0.0.1:3000',
          'https://1z3b60pd-3000.inc1.devtunnels.ms'
        ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 
      'Authorization', 
      'X-Requested-With',
      'X-API-Key'
    ],
    exposedHeaders: [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset'
    ],
    maxAge: 86400, // 24 hours
  }));

  // Cookie parser middleware
  app.use(cookieParser(env.COOKIE_SECRET));

  // Body parsing middleware with size limits
  app.use(express.json({ 
    limit: '10mb',
    type: ['application/json', 'text/plain']
  }));
  app.use(express.urlencoded({ 
    extended: true, 
    limit: '10mb',
    parameterLimit: 1000
  }));

  // Static file serving for uploads with proper caching
  app.use('/uploads', express.static(path.join(process.cwd(), env.UPLOAD_DIR || './uploads'), {
    maxAge: '7d', // Cache for 7 days
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      // Set appropriate content type based on file extension
      const ext = path.extname(filePath).toLowerCase();
      if (['.pdf', '.doc', '.docx'].includes(ext)) {
        res.setHeader('Content-Disposition', 'inline');
      }
    }
  }));

  // Audit logging middleware (before routes, after body parsing)
  app.use(auditLogMiddleware);

  // Request logging middleware
  app.use((req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info({
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        userId: (req as any).user?.id || null,
      }, `${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
    });
    
    next();
  });

  // Health check routes (no rate limiting)
  app.use('/health', healthRouter);
  app.use('/db-check', dbCheckRouter);

  // API routes with specific rate limiting
  app.use('/api/auth', authRateLimiter, authRouter);
  app.use('/api/notifications', generalRateLimiter, notificationRouter);
  app.use('/api/rooms', generalRateLimiter, roomRouter);
  app.use('/api/rooms', generalRateLimiter, roomEnhancedRouter); // Enhanced room features
  app.use('/api/rooms', generalRateLimiter, focusSessionRouter); // Focus session endpoints
  app.use('/api/rooms', generalRateLimiter, dailyTaskRouter); // Daily task generation
  app.use('/api/rooms', generalRateLimiter, kanbanRouter); // Kanban board management
  app.use('/api/rooms', generalRateLimiter, partnerRouter); // Partner sync (duo mode)
  app.use('/api/rooms', generalRateLimiter, summaryRouter); // Daily summaries
  app.use('/api/rooms', generalRateLimiter, chatRouter); // Chat routes under /api/rooms/:roomId/messages
  app.use('/api', generalRateLimiter, taskRouter); // Task routes at /api/boards, /api/lists, /api/tasks
  app.use('/api/ai', aiRateLimiter, aiRouter); // AI routes with stricter limits
  app.use('/api/ai', aiRateLimiter, groupingRouter); // Grouping routes under /api/ai
  app.use('/api/channels', uploadRateLimiter, channelRouter); // Channel routes with upload limits
  app.use('/api/share', generalRateLimiter, shareRouter);
  app.use('/api/connect', generalRateLimiter, connectRouter); // Alias for share routes with /connect naming
  app.use('/api/users', generalRateLimiter, userRouter);
  app.use('/api/user', generalRateLimiter, userRouter); // Alternative singular form for /api/user/partner
  app.use('/api/duo-streak', generalRateLimiter, duoStreakRouter);
  app.use('/api/content', aiRateLimiter, contentRouter); // Content generation with AI rate limits
  
  // Debug endpoints (development/staging only recommended)
  if (env.NODE_ENV !== 'production') {
    app.use('/debug', debugRouter);
  }

  // Backward compatibility routes (without /api prefix)
  app.use('/auth', authRateLimiter, authRouter);
  app.use('/notifications', generalRateLimiter, notificationRouter);
  app.use('/rooms', generalRateLimiter, roomRouter);
  app.use('/rooms', generalRateLimiter, chatRouter);
  app.use('/', generalRateLimiter, taskRouter);
  app.use('/ai', aiRateLimiter, aiRouter);
  app.use('/ai', aiRateLimiter, groupingRouter);
  app.use('/channels', uploadRateLimiter, channelRouter);
  app.use('/share', generalRateLimiter, shareRouter);
  app.use('/users', generalRateLimiter, userRouter);

  // API documentation route (if needed)
  app.get('/api', (req, res) => {
    res.json({
      name: 'StudyFlow API',
      version: '1.0.0',
      description: 'AI-powered productivity & learning platform',
      endpoints: {
        auth: '/api/auth/*',
        rooms: '/api/rooms/*',
        tasks: '/api/boards, /api/lists, /api/tasks',
        ai: '/api/ai/*',
        channels: '/api/channels/*',
        notifications: '/api/notifications/*',
      },
      documentation: 'https://docs.studyflow.app',
      status: 'active',
      timestamp: new Date().toISOString(),
    });
  });

  // Handle 404 - Route not found
  app.use('*', (req, res) => {
    logger.warn({
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    }, `404 - Route not found: ${req.method} ${req.originalUrl}`);

    res.status(404).json({
      success: false,
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'The requested endpoint does not exist',
        path: req.originalUrl,
        method: req.method,
        suggestion: 'Check the API documentation for available endpoints',
      },
      timestamp: new Date().toISOString(),
    });
  });

  // Global error handler (must be last middleware)
  app.use(errorHandler(logger));

  // Graceful shutdown handling
  const gracefulShutdown = (signal: string) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    
    // Close MongoDB connection
    import('./config/db.js').then(({ mongoose }) => {
      mongoose.connection.close();
    });
    
    // Close Redis connection
    import('./config/redis.js').then(({ disconnectFromRedis }) => {
      disconnectFromRedis();
    });
    
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error({
      reason,
      promise
    }, 'Unhandled Promise Rejection');
  });

  // Uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'Uncaught Exception');
    process.exit(1);
  });

  return app;
};

export { createApp };

import { Worker, Job } from 'bullmq';
import { connectToRedis } from '../config/redis.js';
import { ChatMessage } from '../models/chatMessage.model.js';
import { Room } from '../models/room.model.js';
import { User } from '../models/user.model.js';
import { createChatQueue, type ChatMessageJob } from '../config/queue.js';
import pinoImport from 'pino';
import { env } from '../config/env.js';

const pino = pinoImport.default || pinoImport;

// Initialize logger
const logger = (pino as any)({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        levelFirst: true,
        translateTime: 'yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  }),
});

class ChatWorker {
  private worker: Worker<ChatMessageJob>;

  constructor() {
    const connection = connectToRedis(logger);

    this.worker = new Worker<ChatMessageJob>(
      'chat.persist',
      async (job) => {
        await this.processChatMessage(job.data);
      },
      {
        connection,
        concurrency: 5, // Process up to 5 jobs concurrently
        limiter: {
          max: 100, // Maximum 100 jobs
          duration: 60000, // Per 60 seconds
        },
      }
    );

    this.setupEventHandlers();
  }

  private async processChatMessage(data: ChatMessageJob): Promise<void> {
    try {
      logger.info(
        {
          roomId: data.roomId,
          userId: data.userId,
          username: data.username,
          type: data.type,
          contentLength: data.content.length,
        },
        'Processing chat message'
      );

      // Verify room exists using Mongoose
      const room = await Room.findById(data.roomId);

      if (!room) {
        throw new Error(`Room ${data.roomId} not found`);
      }

      // For system messages, userId can be null
      if (data.userId && data.type !== 'SYSTEM') {
        // Verify user exists and is member of room
        const [user, isMember] = await Promise.all([
          User.findById(data.userId),
          Room.findOne({
            _id: data.roomId,
            'members.userId': data.userId,
          }),
        ]);

        if (!user) {
          throw new Error(`User ${data.userId} not found`);
        }

        if (!isMember) {
          throw new Error(`User ${data.userId} is not a member of room ${data.roomId}`);
        }
      }

      // Save message to database using Mongoose
      const chatMessage = await ChatMessage.create({
        roomId: data.roomId,
        userId: data.userId,
        content: data.content,
        type: data.type,
        createdAt: new Date(data.timestamp),
      });

      logger.info(
        {
          messageId: chatMessage._id.toString(),
          roomId: data.roomId,
          userId: data.userId,
          type: data.type,
        },
        'Chat message saved successfully'
      );
    } catch (error) {
      logger.error(
        {
          error,
          jobData: data,
        },
        'Failed to process chat message'
      );
      throw error; // Re-throw to trigger job retry
    }
  }

  private setupEventHandlers(): void {
    this.worker.on('completed', (job: Job<ChatMessageJob>) => {
      logger.debug(
        {
          jobId: job.id,
          roomId: job.data.roomId,
          username: job.data.username,
        },
        'Chat message job completed'
      );
    });

    this.worker.on('failed', (job: Job<ChatMessageJob> | undefined, error: Error) => {
      logger.error(
        {
          jobId: job?.id,
          error,
          jobData: job?.data,
        },
        'Chat message job failed'
      );
    });

    this.worker.on('error', (error: Error) => {
      logger.error({ error }, 'Chat worker error');
    });

    this.worker.on('ready', () => {
      logger.info('✅ Chat worker ready');
    });
  }

  async close(): Promise<void> {
    await this.worker.close();
    logger.info('✅ Chat worker closed');
  }
}

// Create and start worker
const chatWorker = new ChatWorker();

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info({ signal }, 'Received shutdown signal, closing chat worker...');

  try {
    await chatWorker.close();
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Error during chat worker shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', async (err) => {
  logger.fatal({ error: err }, 'Uncaught Exception in chat worker');
  await chatWorker.close();
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  logger.fatal({ reason }, 'Unhandled Rejection in chat worker');
  await chatWorker.close();
  process.exit(1);
});

export { chatWorker };

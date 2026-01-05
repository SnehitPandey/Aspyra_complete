import { connectToRedis } from './redis.js';
import type { Logger } from 'pino';
import { Queue, Job } from 'bullmq';

export interface ChatMessageJob {
  roomId: string;
  userId: string | null;
  username: string;
  content: string;
  type: 'TEXT' | 'SYSTEM' | 'EMOJI' | 'FILE';
  timestamp: string;
}

let chatQueue: Queue<ChatMessageJob> | null = null;
let queueAvailable = true;

export const createChatQueue = (logger?: Logger): Queue<ChatMessageJob> | null => {
  if (!chatQueue && queueAvailable) {
    try {
      const connection = connectToRedis(logger);
      
      chatQueue = new Queue<ChatMessageJob>('chat.persist', {
        connection,
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        },
      });

      if (logger) {
        chatQueue.on('error', (error: Error) => {
          logger.warn({ error }, 'Chat queue error (Redis unavailable - messages will not persist)');
          queueAvailable = false;
        });

        // BullMQ v4: 'waiting' event receives a Job object, not a string
        chatQueue.on('waiting', (job: Job<ChatMessageJob>) => {
          logger.debug({ jobId: job.id }, 'Chat job waiting');
        });
        
        logger.info('Chat queue initialized');
      }
    } catch (error) {
      if (logger) {
        logger.warn({ error }, 'Redis unavailable - chat queue disabled (messages will not persist)');
      }
      queueAvailable = false;
      return null;
    }
  }

  return chatQueue;
};

export const getChatQueue = (): Queue<ChatMessageJob> | null => {
  return chatQueue;
};

export const closeChatQueue = async (logger?: Logger): Promise<void> => {
  if (chatQueue) {
    await chatQueue.close();
    chatQueue = null;
    if (logger) {
      logger.info('Chat queue closed');
    }
  }
};

import mongoose from 'mongoose';
import { env } from './env.js';
import type { Logger } from 'pino';

let isConnected = false;

/**
 * Connect to MongoDB using Mongoose.
 * Ensures a singleton connection.
 */
export const connectToDatabase = async (logger?: Logger): Promise<void> => {
  if (isConnected) {
    logger?.info('MongoDB connection already established.');
    return;
  }

  try {
   await mongoose.connect(env.DATABASE_URL, {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
});

    isConnected = true;

    // Ready event
    mongoose.connection.once('open', () => {
      logger?.info(
        {
          db: mongoose.connection.name,
          host: mongoose.connection.host,
          port: mongoose.connection.port,
        },
        '✅ Connected to MongoDB',
      );
    });

    // Error event
    mongoose.connection.on('error', (err: Error) => {
      logger?.error({ err }, '❌ Mongoose connection error');
    });

    // Disconnected event
    mongoose.connection.on('disconnected', () => {
      isConnected = false;
      logger?.warn('⚠️ Mongoose disconnected');
    });

    // Reconnected event
    mongoose.connection.on('reconnected', () => {
      isConnected = true;
      logger?.info('✅ MongoDB reconnected');
    });
  } catch (err) {
    logger?.fatal({ err }, '❌ Failed to connect to MongoDB');
    process.exit(1);
  }
};

/**
 * Disconnect from MongoDB.
 */
export const disconnectFromDatabase = async (logger?: Logger): Promise<void> => {
  if (!isConnected) return;

  try {
    await mongoose.disconnect();
    isConnected = false;
    logger?.info('Disconnected from MongoDB');
  } catch (err) {
    logger?.error({ err }, 'Error while disconnecting MongoDB');
  }
};

export { mongoose };



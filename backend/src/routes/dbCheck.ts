import { Router } from 'express';
import type { Request, Response } from 'express';
import { mongoose } from '../config/db.js';
import { User } from '../models/user.model.js';
import { createError } from '../middleware/errorHandler.js';

const router = Router();

interface DbCheckResponse {
  userCount: number;
  connected: boolean;
  timestamp: string;
  databaseInfo: {
    name: string;
    version?: string;
    host?: string;
    port?: number;
    database?: string;
  };
}

// Database connection test endpoint
router.get('/', async (req: Request, res: Response<DbCheckResponse>) => {
  try {
    // Check if MongoDB is connected
    const isConnected = mongoose.connection.readyState === 1;
    
    if (!isConnected) {
      throw createError('Database not connected', 503);
    }

    // Get user count using Mongoose
    const userCount = await User.countDocuments();

    // Get MongoDB version and server info
    let dbVersion: string | undefined;
    try {
      const adminDb = mongoose.connection.db?.admin();
      const serverInfo = await adminDb?.serverInfo();
      dbVersion = serverInfo?.version;
    } catch (error) {
      console.warn('Could not retrieve MongoDB version:', error);
    }

    const response: DbCheckResponse = {
      userCount,
      connected: true,
      timestamp: new Date().toISOString(),
      databaseInfo: {
        name: 'MongoDB',
        version: dbVersion,
        host: mongoose.connection.host,
        port: mongoose.connection.port,
        database: mongoose.connection.name,
      },
    };

    res.status(200).json(response);
  } catch (error) {
    // Log error but don't expose sensitive database details
    console.error('Database check failed:', error);

    throw createError('Database connection failed', 503);
  }
});

export { router as dbCheckRouter };

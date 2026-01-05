import { Router } from 'express';
import type { Request, Response } from 'express';

const router = Router();

interface HealthResponse {
  status: 'ok' | 'error';
  uptime: number;
  timestamp: string;
  environment: string;
  version: string;
}

// Health check endpoint
router.get('/', (req: Request, res: Response<HealthResponse>) => {
  const healthData: HealthResponse = {
    status: 'ok',
    uptime: parseFloat(process.uptime().toFixed(2)),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
  };

  res.status(200).json(healthData);
});

export { router as healthRouter };

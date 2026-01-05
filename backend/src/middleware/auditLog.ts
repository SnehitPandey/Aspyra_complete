import { AuditLog } from '../models/auditLog.model.js';
import { User } from '../models/user.model.js';
import type { Request, Response, NextFunction } from 'express';
import type { Logger } from 'pino';

export class AuditLogService {
  private logger: Logger | undefined;

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  // Create audit log middleware
  createMiddleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      const startTime = Date.now();

      // Override res.json to capture response
      const originalJson = res.json;
      res.json = function (body: any) {
        // Calculate latency
        const latencyMs = Date.now() - startTime;

        // Create audit log (async, don't block response)
        setImmediate(() => {
          auditLogService
            .createAuditLog({
              userId: (req as any).user?.id ?? null,
              method: req.method,
              path: req.originalUrl,
              status: res.statusCode,
              latencyMs,
              userAgent: req.get('User-Agent') ?? null,
              ipAddress: req.ip ?? 'unknown',
            })
            .catch((error) => {
              auditLogService.logger?.error({ error }, 'Failed to create audit log');
            });
        });

        // Call original json method
        return originalJson.call(this, body);
      };

      next();
    };
  }

  // Create audit log entry using Mongoose
  private async createAuditLog(data: {
    userId: string | null;
    method: string;
    path: string;
    status: number;
    latencyMs: number;
    userAgent: string | null;
    ipAddress: string;
  }): Promise<void> {
    try {
      await AuditLog.create({
        userId: data.userId,
        method: data.method,
        path: data.path,
        status: data.status,
        latencyMs: data.latencyMs,
        userAgent: data.userAgent,
        ipAddress: data.ipAddress,
      });
    } catch (error) {
      this.logger?.error({ error, data }, 'Failed to create audit log');
    }
  }

  // Get audit logs with filtering (admin only)
  async getAuditLogs(filters: {
    userId?: string;
    method?: string;
    status?: number;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
  }): Promise<{
    logs: any[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 100); // Max 100 per request
    const skip = (page - 1) * limit;

    // Build MongoDB query filter
    const query: any = {};

    if (filters.userId) query.userId = filters.userId;
    if (filters.method) query.method = filters.method;
    if (filters.status) query.status = filters.status;
    
    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) query.createdAt.$gte = filters.startDate;
      if (filters.endDate) query.createdAt.$lte = filters.endDate;
    }

    // Execute queries in parallel using Mongoose
    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .populate('userId', 'id name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(query),
    ]);

    return {
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

// Create singleton instance
export const auditLogService = new AuditLogService();

// Export middleware
export const auditLogMiddleware = auditLogService.createMiddleware();

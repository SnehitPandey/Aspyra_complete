import type { Request, Response, NextFunction } from 'express';
import type { Logger } from 'pino';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export const errorHandler = (logger: Logger) => {
  return (err: AppError, req: Request, res: Response, next: NextFunction): void => {
    // Default error values
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    const isOperational = err.isOperational || false;

    // Log error details
    logger.error({
      error: {
        name: err.name,
        message: err.message,
        stack: err.stack,
        statusCode,
        isOperational,
      },
      request: {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      },
    }, 'Request error occurred');

    // Send error response
    const response = {
      error: {
        message,
        ...(process.env.NODE_ENV === 'development' && {
          stack: err.stack,
          details: err,
        }),
      },
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
    };

    res.status(statusCode).json(response);
  };
};

// Create operational error
export const createError = (message: string, statusCode = 500): AppError => {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  error.isOperational = true;
  return error;
};

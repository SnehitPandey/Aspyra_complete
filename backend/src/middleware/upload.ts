import multer from 'multer';
import path from 'path';
import fs from 'fs-extra';
import { env } from '../config/env.js';
import { createError } from './errorHandler.js';
import type { Request } from 'express';

// Ensure upload directory exists
const uploadDir = env.UPLOAD_DIR;
fs.ensureDirSync(uploadDir);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Create subdirectories based on file type
    const fileType = file.mimetype.split('/')[0] || 'other'; // 'image', 'application', etc.
    const uploadPath = path.join(uploadDir, fileType);
    
    fs.ensureDirSync(uploadPath);
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-random-original
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    const basename = path.basename(file.originalname, extension);
    
    cb(null, `${basename}-${uniqueSuffix}${extension}`);
  },
});

// File filter function
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'image/png',
    'image/jpeg',
    'image/jpg'
  ];
  
  // Check file MIME type
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(createError(`File type ${file.mimetype} not allowed. Allowed types: PDF, DOC, DOCX, TXT, MD, PNG, JPG`, 400));
  }
};

// Create multer instance
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
    files: 1, // Only one file per request
  },
});

// Middleware for single file upload
export const uploadSingle = (fieldName: string = 'file') => {
  return upload.single(fieldName);
};

// Middleware for handling multer errors
export const handleUploadError = (error: any, req: Request, res: any, next: any) => {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return next(createError('File too large. Maximum size: 10MB', 400));
      case 'LIMIT_FILE_COUNT':
        return next(createError('Too many files. Only one file allowed.', 400));
      case 'LIMIT_UNEXPECTED_FILE':
        return next(createError('Unexpected file field', 400));
      default:
        return next(createError(`Upload error: ${error.message}`, 400));
    }
  }
  next(error);
};

// Utility function to get file URL
export const getFileUrl = (req: Request, filepath: string): string => {
  const relativePath = path.relative(uploadDir, filepath);
  return `${req.protocol}://${req.get('host')}/uploads/${relativePath.replace(/\\/g, '/')}`;
};

// Utility function to delete file
export const deleteFile = async (filepath: string): Promise<void> => {
  try {
    await fs.remove(filepath);
  } catch (error) {
    console.error('Failed to delete file:', filepath, error);
  }
};

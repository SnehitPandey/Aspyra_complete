import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Request } from 'express';

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
const avatarsDir = path.join(uploadsDir, 'avatars');
const resumesDir = path.join(uploadsDir, 'resumes');

[uploadsDir, avatarsDir, resumesDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure storage for avatars
const avatarStorage = multer.diskStorage({
  destination: (req: Request, file: Express.Multer.File, cb) => {
    cb(null, avatarsDir);
  },
  filename: (req: Request, file: Express.Multer.File, cb) => {
    const userId = (req as any).user?.id;
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `avatar-${userId}-${timestamp}${ext}`);
  },
});

// Configure storage for resumes
const resumeStorage = multer.diskStorage({
  destination: (req: Request, file: Express.Multer.File, cb) => {
    cb(null, resumesDir);
  },
  filename: (req: Request, file: Express.Multer.File, cb) => {
    const userId = (req as any).user?.id;
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `resume-${userId}-${timestamp}${ext}`);
  },
});

// File filter for images (avatars)
const imageFileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'));
  }
};

// File filter for resumes
const resumeFileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, DOC, and DOCX files are allowed.'));
  }
};

// Avatar upload middleware
export const uploadAvatar = multer({
  storage: avatarStorage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
}).single('avatar');

// Resume upload middleware
export const uploadResume = multer({
  storage: resumeStorage,
  fileFilter: resumeFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
}).single('resume');

// Helper function to delete old file
export const deleteFile = (filePath: string): void => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error('Error deleting file:', error);
  }
};

// Helper to get file URL
export const getFileUrl = (req: Request, filePath: string): string => {
  const relativePath = path.relative(uploadsDir, filePath).replace(/\\/g, '/');
  // Return relative URL to work with frontend proxy
  return `/uploads/${relativePath}`;
};
